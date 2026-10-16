//! The sync actor (AD-16), and the one seam it is generic over.
//!
//! Three properties shape every line below.
//!
//! **Nothing here blocks.** The actor is spawned behind an `mpsc` channel and owns all of
//! its state, so a command is a message and a fault is a status, never a failed launch and
//! never a held lock. No mutex of this crate's is held across an `.await`, and the only
//! lock the actor's work ever takes is the one inside `DatasetSlot` during a guarded swap.
//!
//! **Nothing reaches the network except through the gate.** The actor never builds a
//! transport or a credential itself: `SyncHost::connect` is the single path, it runs
//! `SyncGate::check` before it vends and `SyncGate::vend` before it builds a store, and it
//! returns an already-wrapped `GatedStore`. A local-only, un-entitled or Frozen dataset
//! therefore produces no task work, no client and no request.
//!
//! **Milestone 1 has no capture hook.** There is no `sync_log` yet, so "the dataset
//! changed" is detected by polling `PRAGMA data_version` on the actor's *own* connection:
//! SQLite bumps that counter on a connection whenever **another** connection commits, it
//! costs one page-cache read, it needs no schema, no trigger and no write of our own, and
//! it cannot miss a commit. Milestone 2 Story 15 replaces it with the pre-update hook.

use std::collections::{BTreeMap, VecDeque};
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use rusqlite::Connection;
use serde::Serialize;
use tokio::sync::{mpsc, oneshot, watch};
use tokio::time::Instant;

use crate::db::backup::{DatasetSlot, LocalData};
use crate::db::sync_blobs::{self, ImageFetchTarget};
use crate::db::sync_state::FrozenReason;
use crate::entitlements::MULTI_DEVICE_SYNC;
use crate::models::ProjectImage;

use super::auth::{AccountPin, AuthError};
use super::blob::{self, BlobError};
use super::bootstrap::{
    self, BootstrapError, BootstrapPlan, LinkChoice, LinkOutcome, ReplaceTarget, RestoreTarget,
    SeparateContext,
};
use super::gate::{
    CapabilitySource, DatasetLink, GateStateSource, GatedError, GatedStore, SyncBlocked, SyncGate,
};
use super::clock::{self, Clock};
use super::limits::{DatasetLimits, Oversize, RequestRateCap};
use super::owner::{owner_object_body, owner_sub_from_body, OWNER_OBJECT_KEY};
use tracing::{info, warn};

use super::apply;
use super::reconcile;
use super::retention;
use super::segment::{self, Applier, Head, PollReport, PullCursor, SegmentBatch, SegmentError};
use super::snapshot::{self, LatestSnapshot, SnapshotError, UploadOutcome};
use super::store::{ETag, ObjectStore, StoreError};

/// What the UI shows, and what `sync:status` carries (AD-16).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncState {
    /// Sync has not been turned on for this dataset, or the dataset cannot sync at all.
    Unlinked,
    Idle,
    Syncing,
    Offline,
    /// Transfers are stopped; the local app is unaffected and the cloud copy is kept.
    Frozen,
    /// The cloud copy was written by a newer build (AD-11, CAP-7).
    UpdateNeeded,
    /// This computer's wall clock disagrees with the other computers' by more than AD-4's drift
    /// limit. Local use is unaffected; the user has to fix the date and time.
    ClockSkew,
    /// Waiting for the user to answer CAP-5's replace-or-separate question.
    LinkChoiceRequired,
    /// Waiting for the user to answer load-or-keep after a conflict.
    RemoteChanged,
    Error,
}

/// A question only the user can answer. Counts and timings, never values (AD-16).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SyncPrompt {
    LinkChoice {
        local_rows: i64,
        remote_created_ms: i64,
        remote_schema_version: u32,
    },
    RemoteChanged {
        remote_created_ms: i64,
        remote_schema_version: u32,
    },
}

/// The `sync:status` payload, and what `sync_status` returns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SyncStatusPayload {
    pub state: SyncState,
    pub dataset_id: String,
    pub enabled: bool,
    /// The user's durable "sync across my computers" switch, read back from the dataset. Distinct
    /// from `!enabled`, which is also true while an automatic join is still waiting for a network
    /// or a session — the UI has to tell "you turned this off" from "not started yet".
    pub paused: bool,
    pub last_sync_ms: Option<i64>,
    pub error_code: Option<String>,
    pub recoverable: bool,
    pub prompt: Option<SyncPrompt>,
}

/// What `sync_enable` concluded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum SyncEnableOutcome {
    Enabled {
        state: SyncState,
    },
    /// CAP-5: this computer already holds data, so `sync_enable` must be called again with
    /// the user's choice. Deliberately not a seventh command.
    LinkChoiceRequired {
        local_rows: i64,
        remote_created_ms: i64,
        remote_schema_version: u32,
    },
    /// *Separate* provisioned a second profile for the cloud copy. This dataset stays
    /// exactly as it was and is **not** synced; activating the new profile is
    /// `select_dataset`'s job (AD-6: one hot-swap path).
    SeparateProfileCreated {
        dataset_id: String,
    },
    /// Nothing could be joined yet and there is nothing for anyone to do: the account's current
    /// snapshot predates row identities, and the computer that owns it republishes an
    /// identity-bearing one within a cycle or two. Retried automatically.
    Waiting,
}

/// The answer to a conflict prompt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteChoice {
    /// Load the cloud copy, keeping the current file as a dated backup (Story 9 replace).
    LoadRemote,
    /// Keep this computer's copy; it is published over the cloud one on the next settle.
    KeepLocal,
}

/// Every way a sync operation can fail, as one typed surface so `AppError::Sync` carries a
/// stable `code` and never service prose or a row value (AD-16).
#[derive(Debug, Clone, PartialEq)]
pub enum SyncFault {
    Blocked(SyncBlocked),
    Auth(AuthError),
    Store(StoreError),
    Snapshot(SnapshotError),
    /// A segment, head or roster could not be read, written or handed on (AD-6).
    Segment(SegmentError),
    /// The guarded file swap failed. The dataset is rolled back unless `rolled_back` is
    /// false, which is reserved for a rollback that itself failed.
    Swap { rolled_back: bool },
    /// The cloud copy needs a schema this build does not have.
    UpdateNeeded { found: u32, supported: u32 },
    /// AD-18: an object this computer was about to write is larger than the cap for its
    /// namespace. Refused, never retried (the same bytes would be the same size) and never
    /// fatal: a segment candidate is split instead, and a refused snapshot or picture leaves
    /// the local dataset untouched.
    TooLarge(Oversize),
    /// A remote stamp was more than AD-4's drift limit ahead of this computer's wall clock, so it
    /// was refused the right to move this clock. Carries how far ahead, never a timestamp.
    ClockSkew { ahead_ms: i64 },
    OwnerMismatch,
    /// The *separate* profile could not be provisioned; nothing was restored.
    Registry,
    /// The dataset's own database could not be read.
    StateUnavailable,
    /// The project has no picture, so there is nothing to fetch for it.
    ImageMissing,
    /// What came back is not the picture the row names: the payload does not hash to the key, or
    /// the body is not a Nixus object at all. Never written to the dataset.
    ImageCorrupt,
    NotEnabled,
    NoPendingPrompt,
    /// The actor's task is gone (a dataset switch or sign-out stopped it).
    ActorUnavailable,
}

impl SyncFault {
    /// The stable discriminator. Support reads it in diagnostics and the UI switches on it;
    /// it is never a service message and never derived from user data.
    pub fn code(&self) -> &'static str {
        match self {
            SyncFault::Blocked(SyncBlocked::LocalOnlyDataset) => "local_only",
            SyncFault::Blocked(SyncBlocked::CapabilityMissing { .. }) => "not_entitled",
            SyncFault::Blocked(SyncBlocked::Frozen { .. }) => "frozen",
            SyncFault::Blocked(SyncBlocked::PinMismatch { .. })
            | SyncFault::Auth(AuthError::PinMismatch(_)) => "account_mismatch",
            SyncFault::Blocked(SyncBlocked::StateUnavailable)
            | SyncFault::Auth(AuthError::StateUnavailable)
            | SyncFault::StateUnavailable => "state_unavailable",
            SyncFault::Auth(AuthError::SignedOut) => "signed_out",
            SyncFault::Auth(AuthError::Unconfigured) => "not_configured",
            SyncFault::Auth(AuthError::MalformedOwnerObject) => "owner_malformed",
            SyncFault::Auth(error) if error.retryable() => "offline",
            SyncFault::Auth(_) => "identity_rejected",
            SyncFault::Store(StoreError::NotFound) => "remote_missing",
            SyncFault::Store(StoreError::ContentHashMismatch) => "install_collision",
            SyncFault::Store(StoreError::Forbidden) => "forbidden",
            SyncFault::Store(StoreError::CredentialsExpired) => "credentials_expired",
            SyncFault::Store(StoreError::PreconditionFailed)
            | SyncFault::Store(StoreError::ConditionalConflict) => "remote_changed",
            SyncFault::Store(error) if error.retryable() => "offline",
            SyncFault::Store(_) => "transport",
            SyncFault::Snapshot(SnapshotError::Build { .. }) => "snapshot_build",
            SyncFault::Snapshot(SnapshotError::SourceBusy) => "dataset_busy",
            SyncFault::Snapshot(SnapshotError::SchemaTooNew { .. })
            | SyncFault::UpdateNeeded { .. } => "update_needed",
            SyncFault::TooLarge(_) => "payload_too_large",
            SyncFault::ClockSkew { .. } => "clock_skew",
            SyncFault::Snapshot(_) => "snapshot_invalid",
            SyncFault::Segment(error) => error.code(),
            SyncFault::Swap { .. } => "restore_failed",
            SyncFault::OwnerMismatch => "owner_mismatch",
            SyncFault::Registry => "profile_create_failed",
            SyncFault::ImageMissing => "image_missing",
            SyncFault::ImageCorrupt => "image_corrupt",
            SyncFault::NotEnabled => "not_enabled",
            SyncFault::NoPendingPrompt => "no_pending_prompt",
            SyncFault::ActorUnavailable => "actor_unavailable",
        }
    }

    /// Whether repeating the same operation later can succeed on its own.
    pub fn retryable(&self) -> bool {
        match self {
            SyncFault::Auth(error) => error.retryable(),
            SyncFault::Store(error) => error.retryable(),
            SyncFault::Snapshot(SnapshotError::SourceBusy) => true,
            // A conflict is resolved by re-reading, which the upload path already does, so
            // the operation that produced it is not the one to repeat.
            _ => false,
        }
    }

    /// Whether the user can act on it: sign in, reconnect, re-upgrade, answer a prompt.
    /// Distinct from `retryable`, which is about an unattended repeat.
    pub fn recoverable(&self) -> bool {
        match self {
            SyncFault::Blocked(SyncBlocked::PinMismatch { .. })
            | SyncFault::Auth(AuthError::PinMismatch(_))
            | SyncFault::OwnerMismatch
            | SyncFault::Auth(AuthError::Unconfigured) => false,
            SyncFault::Blocked(_)
            | SyncFault::Auth(_)
            | SyncFault::Store(_)
            | SyncFault::Snapshot(_)
            | SyncFault::Segment(_)
            | SyncFault::UpdateNeeded { .. }
            | SyncFault::ClockSkew { .. }
            | SyncFault::TooLarge(_)
            | SyncFault::Swap { .. }
            | SyncFault::Registry
            | SyncFault::StateUnavailable
            | SyncFault::ImageMissing
            | SyncFault::ImageCorrupt
            | SyncFault::NotEnabled
            | SyncFault::NoPendingPrompt
            | SyncFault::ActorUnavailable => true,
        }
    }

    /// One fixed sentence per code, for support and for a UI that has no string yet. The
    /// frontend narrows on `code` and renders its own i18n copy (Story 11).
    pub fn message(&self) -> &'static str {
        match self.code() {
            "local_only" => "This profile is not linked to a Nixus Cloud account.",
            "not_entitled" => "This Nixus Cloud account does not include sync.",
            "frozen" => "Sync is paused; this computer keeps working normally.",
            "account_mismatch" | "owner_mismatch" => {
                "The cloud copy belongs to a different Nixus Cloud account."
            }
            "state_unavailable" => "This profile's sync state could not be read.",
            "signed_out" => "Sign in to your Nixus Cloud account to sync.",
            "not_configured" => "Sync is not available in this build.",
            "owner_malformed" => "The cloud account marker could not be read.",
            "offline" => "Sync could not reach the cloud and will retry.",
            "identity_rejected" => "The cloud rejected this session.",
            "remote_missing" => "The cloud copy could not be found.",
            "install_collision" => "This computer's install id is already in use.",
            "forbidden" => "The cloud refused this request.",
            "credentials_expired" => "The cloud session expired and will be renewed.",
            "remote_changed" => "The cloud copy changed on another computer.",
            "transport" => "The cloud request failed.",
            "snapshot_build" => "This profile's data could not be packaged for upload.",
            "dataset_busy" => "This profile was busy; the upload will be retried.",
            "update_needed" => "Update Nixus to read the cloud copy.",
            "snapshot_invalid" => "The cloud copy could not be verified.",
            "restore_failed" => "The cloud copy could not be loaded onto this computer.",
            "profile_create_failed" => "A separate profile could not be created.",
            "image_missing" => "This project has no picture to download.",
            "image_corrupt" => "The stored picture could not be verified.",
            "not_enabled" => "Sync is not turned on for this profile.",
            "segment_invalid" => "A change from another computer could not be read.",
            "apply_failed" => "A change from another computer could not be applied yet.",
            "clock_skew" => "This computer's date and time are too far off to order changes.",
            "payload_too_large" => "This change is too large to send to the cloud.",
            _ => "Sync is unavailable.",
        }
    }
}

impl From<GatedError> for SyncFault {
    fn from(error: GatedError) -> Self {
        match error {
            GatedError::Blocked(blocked) => SyncFault::Blocked(blocked),
            GatedError::Store(error) => SyncFault::Store(error),
            GatedError::Auth(error) => SyncFault::Auth(error),
            GatedError::TooLarge(oversize) => SyncFault::TooLarge(oversize),
        }
    }
}

impl From<SnapshotError> for SyncFault {
    fn from(error: SnapshotError) -> Self {
        match error {
            SnapshotError::Store(error) => SyncFault::from(error),
            SnapshotError::TooLarge(oversize) => SyncFault::TooLarge(oversize),
            other => SyncFault::Snapshot(other),
        }
    }
}

impl From<BlobError> for SyncFault {
    fn from(error: BlobError) -> Self {
        match error {
            BlobError::Store(error) => SyncFault::from(error),
            BlobError::TooLarge(oversize) => SyncFault::TooLarge(oversize),
            // A hash that is not a digest can only come from a row the schema's hex CHECK
            // admitted, so it is the same class of problem as a payload that does not match:
            // the picture this computer holds cannot be addressed, and no retry changes that.
            BlobError::InvalidHash | BlobError::ContentMismatch { .. } | BlobError::Header(_) => {
                SyncFault::ImageCorrupt
            }
        }
    }
}

impl From<SegmentError> for SyncFault {
    fn from(error: SegmentError) -> Self {
        match error {
            SegmentError::Store(error) => SyncFault::from(error),
            other => SyncFault::Segment(other),
        }
    }
}

impl From<BootstrapError> for SyncFault {
    fn from(error: BootstrapError) -> Self {
        match error {
            BootstrapError::Blocked(blocked) => SyncFault::Blocked(blocked),
            BootstrapError::Store(error) => SyncFault::Store(error),
            BootstrapError::Auth(error) => SyncFault::Auth(error),
            BootstrapError::OwnerMismatch => SyncFault::OwnerMismatch,
            BootstrapError::TooLarge(oversize) => SyncFault::TooLarge(oversize),
            BootstrapError::Snapshot(error) => SyncFault::Snapshot(error),
            BootstrapError::SnapshotTooNew { found, supported } => {
                SyncFault::UpdateNeeded { found, supported }
            }
            BootstrapError::Swap(failure) => SyncFault::Swap {
                rolled_back: failure.rolled_back,
            },
            BootstrapError::Registry => SyncFault::Registry,
        }
    }
}

impl From<SyncFault> for crate::error::AppError {
    fn from(fault: SyncFault) -> Self {
        crate::error::AppError::Sync {
            code: fault.code().to_string(),
            message: fault.message().to_string(),
            recoverable: fault.recoverable(),
        }
    }
}

/// Every timing the actor runs on, injectable so a test states them instead of waiting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SyncTuning {
    /// How often `data_version` is read.
    pub poll_interval: Duration,
    /// How long the dataset has to be unchanged before an upload starts.
    pub settle_window: Duration,
    /// The floor between two uploads, whatever the edit rate.
    pub min_upload_interval: Duration,
    pub initial_backoff: Duration,
    pub max_backoff: Duration,
    /// The floor between two reads of `roster` and the known heads. Bounded and configurable
    /// because AD-6 bills a `304` as a GET: the steady-state cost of sync is
    /// `1 + <known heads>` requests per interval, whatever the edit rate.
    pub remote_poll_interval: Duration,
    /// The floor between two segment ships, so a burst of edits becomes one object rather than one
    /// per keystroke.
    pub segment_interval: Duration,
    /// The floor between two sweeps of the expired tombstones (AD-5: a delete is restorable for 30
    /// days). Local file work only, so it runs whatever the entitlement and whatever the network.
    pub tombstone_purge_interval: Duration,
    /// AD-9's snapshot trigger: a new snapshot is written once the tail the current one does not
    /// cover exceeds EITHER of these. Two limits and not one because the two failure modes differ —
    /// bytes bound a new computer's download, messages bound how long applying the tail takes.
    pub snapshot_tail_max_bytes: u64,
    pub snapshot_tail_max_messages: u64,
    /// AD-18's maximum object rate for this dataset, applied at the gated store boundary so every
    /// request type counts. Stated here so there is one place the rate is configured.
    pub request_rate: RequestRateCap,
    /// The floor between two reconcile passes (AD-3).
    ///
    /// Dated from CONSTRUCTION like the two log floors, so the startup pass happens one interval
    /// after the app opened the dataset rather than inside the first tick — reconcile reads every
    /// travelling table, and launch belongs to the snapshot path (AD-16). After that pass only an
    /// unmigrated write site justifies another one, which is what "when idle while unmigrated write
    /// sites remain" means.
    pub reconcile_interval: Duration,
    /// The floor between two attempts at the AUTOMATIC join, which is how a join that could not
    /// run yet (offline, no session, throttled) starts by itself instead of waiting for a relaunch.
    pub auto_join_interval: Duration,
    /// The floor between two attempts for an account that does not hold the capability. Far longer
    /// than `auto_join_interval` and on its own cadence so an upgrade mid-session is still picked
    /// up without an un-entitled account being re-asked every half minute (AD-14, AD-18).
    pub capability_recheck_interval: Duration,
}

impl Default for SyncTuning {
    fn default() -> Self {
        Self {
            poll_interval: Duration::from_secs(2),
            settle_window: Duration::from_secs(5),
            min_upload_interval: Duration::from_secs(60),
            initial_backoff: Duration::from_secs(5),
            max_backoff: Duration::from_secs(300),
            remote_poll_interval: Duration::from_secs(30),
            segment_interval: Duration::from_secs(10),
            tombstone_purge_interval: Duration::from_secs(6 * 60 * 60),
            reconcile_interval: Duration::from_secs(60),
            auto_join_interval: Duration::from_secs(30),
            capability_recheck_interval: Duration::from_secs(15 * 60),
            request_rate: RequestRateCap::default(),
            snapshot_tail_max_bytes: 2 * 1024 * 1024,
            snapshot_tail_max_messages: 5_000,
        }
    }
}

/// A gated store and the account it was vended for: the whole result of `connect`.
pub(crate) struct SyncSession<S, L, C, T> {
    pub store: GatedStore<S, SyncGate<L, C, T>>,
    pub pin: AccountPin,
}

pub(crate) type HostSession<H> = SyncSession<
    <H as SyncHost>::Store,
    <H as SyncHost>::Link,
    <H as SyncHost>::Caps,
    <H as SyncHost>::GateState,
>;

/// Everything the actor needs from the dataset it syncs, as one seam.
///
/// `connect` returns a boxed future rather than being an `async fn` so that this trait can
/// be implemented over a Tauri `AppHandle` in `sync/host.rs` without that type reaching
/// this file: `manager.rs` names no Tauri item, which is what keeps the whole actor
/// testable with fakes.
pub(crate) trait SyncHost {
    type Store: ObjectStore;
    type Link: DatasetLink;
    type Caps: CapabilitySource;
    type GateState: GateStateSource;
    type Slot: DatasetSlot;

    fn dataset_id(&self) -> &str;
    fn db_path(&self) -> &Path;
    /// Where a displaced database file is kept (CAP-5's dated backup).
    fn backup_dir(&self) -> &Path;
    /// The app-data root, which owns the dataset registry (inherited AD-3).
    fn root(&self) -> &Path;
    /// The label a *separate* profile is created with.
    fn label(&self) -> &str;
    fn schema_version(&self) -> u32;
    fn now_ms(&self) -> i64;
    /// `PRAGMA data_version` on the actor's own connection.
    fn data_version(&self) -> Result<i64, SyncFault>;
    fn local_data(&self) -> Result<LocalData, SyncFault>;
    /// Runs one read or write on the actor's own connection to the dataset.
    ///
    /// Generic rather than one method per question (which would be five) because the lazy-image
    /// path needs several short statements and every one of them already lives in `db/`. It is a
    /// generic method, which costs nothing here: the actor is `SyncActor<H>` and no `dyn SyncHost`
    /// exists. The connection is opened on first use and closed by `release` before a file swap.
    fn with_dataset<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, crate::error::AppError>,
    ) -> Result<T, SyncFault>;
    fn slot(&self) -> &Self::Slot;
    /// Where fetched remote messages go. Boxed rather than an associated type: the actor needs it
    /// by `&mut` on every poll, and an associated type would force every host to carry interior
    /// mutability for it. Story 20 returns the real apply path from here.
    fn applier(&self) -> Box<dyn Applier + Send>;
    /// Releases the actor's own connection(s) so nothing holds the dataset file.
    fn release(&self);
    /// Records that transfers must stop until support intervenes (AD-14, AD-7).
    fn freeze(&self, reason: FrozenReason);
    /// Drops the vended AWS credentials. Async because the cache is behind an async mutex
    /// that a concurrent refresh may be holding.
    fn forget_credentials(&self) -> Pin<Box<dyn std::future::Future<Output = ()> + '_>>;
    fn connect(
        &self,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<HostSession<Self>, SyncFault>> + '_>>;
    /// AD-18's bounds for this dataset. Owned by the host because the host owns the store, and
    /// shared so the cap outlives the per-cycle re-vend.
    fn limits(&self) -> &Arc<DatasetLimits>;
}

/// One entry of the bounded transition history AD-16's "states and transitions" asks for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SyncTransition {
    pub state: SyncState,
    pub at_ms: i64,
    pub error_code: Option<String>,
}

/// What AD-16 lets out: counts, states, timings and error codes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SyncDiagnostics {
    pub dataset_id: String,
    pub capability: &'static str,
    pub state: SyncState,
    pub transitions: Vec<SyncTransition>,
    pub enabled: bool,
    pub has_pulled_latest: bool,
    pub pending_prompt: Option<SyncPrompt>,
    pub uploads: u64,
    pub segments_shipped: u64,
    pub segments_fetched: u64,
    pub messages_received: u64,
    pub reconcile_messages: u64,
    /// Segments held back because the computer that wrote them runs a newer schema (AD-11).
    pub parked_segments: u64,
    /// Messages waiting in `sync_pending` for a row that has not arrived yet (AD-11).
    pub pending_messages: i64,
    /// Messages in `sync_quarantine`: kept, never applied, never silently dropped (AD-11).
    pub quarantined_messages: i64,
    pub clock_skews: u64,
    /// How far ahead the furthest refused remote stamp was, in ms (AD-4). A number, never a stamp.
    pub last_clock_skew_ms: Option<i64>,
    pub segments_deleted: u64,
    pub snapshots_deleted: u64,
    pub roster_pruned: u64,
    /// Requests AD-18's rate cap made wait. A count: never dropped, never a value.
    pub rate_delays: u64,
    /// Objects AD-18's size caps refused, at the boundary or in a producer. Also only a count.
    pub oversize_refusals: u64,
    pub conflicts: u64,
    pub restores: u64,
    pub failures: u64,
    pub blocked: u64,
    pub last_error_code: Option<String>,
    pub last_sync_ms: Option<i64>,
    pub last_build_ms: Option<u64>,
    pub last_object_bytes: Option<usize>,
    pub last_payload_bytes: Option<usize>,
    pub local_rows: Option<i64>,
    pub schema_version: u32,
    pub frozen_reason: Option<&'static str>,
    pub backoff_ms: Option<u64>,
    pub settle_window_ms: u64,
    pub min_upload_interval_ms: u64,
    pub poll_interval_ms: u64,
}

#[derive(Debug, Default, Clone, Copy)]
struct SyncStats {
    uploads: u64,
    segments_shipped: u64,
    segments_fetched: u64,
    messages_received: u64,
    /// Messages reconcile had to emit because a write bypassed capture (AD-3). Counts only.
    reconcile_messages: u64,
    /// Cycles that refused at least one remote stamp for drift (AD-4). Counts only.
    clock_skews: u64,
    conflicts: u64,
    restores: u64,
    snapshots_deleted: u64,
    segments_deleted: u64,
    roster_pruned: u64,
    failures: u64,
    blocked: u64,
    last_build_ms: Option<u64>,
    last_object_bytes: Option<usize>,
    last_payload_bytes: Option<usize>,
}

#[derive(Debug, Clone)]
enum PendingDecision {
    LinkChoice {
        latest: LatestSnapshot,
        local_rows: i64,
    },
    RemoteChanged {
        theirs: LatestSnapshot,
        their_etag: ETag,
    },
}

impl PendingDecision {
    fn prompt(&self) -> SyncPrompt {
        match self {
            PendingDecision::LinkChoice {
                latest, local_rows, ..
            } => SyncPrompt::LinkChoice {
                local_rows: *local_rows,
                remote_created_ms: latest.created_ms,
                remote_schema_version: latest.schema_version,
            },
            PendingDecision::RemoteChanged { theirs, .. } => SyncPrompt::RemoteChanged {
                remote_created_ms: theirs.created_ms,
                remote_schema_version: theirs.schema_version,
            },
        }
    }
}

/// Bounded so a long-running actor cannot grow one entry per transition forever; the tail
/// is what a support report needs.
const TRANSITION_HISTORY: usize = 20;

struct Backoff {
    attempt: u32,
    until: Instant,
}

/// The actor's behaviour, separated from the channel loop below so every rule in this file
/// is driven directly by a test under virtual time instead of through a mailbox.
pub(crate) struct SyncActor<H: SyncHost> {
    host: H,
    tuning: SyncTuning,
    status: watch::Sender<SyncStatusPayload>,
    events: mpsc::UnboundedSender<SyncStatusPayload>,
    state: SyncState,
    enabled: bool,
    known_latest: Option<ETag>,
    /// What the `snap/LATEST` this computer last read or wrote already contains, per install. The
    /// snapshot trigger and the unfillable-gap test are both expressed against it.
    snapshot_watermark: BTreeMap<String, i64>,
    /// Set when a segment this computer still owes is BELOW the current snapshot's watermark: the
    /// object is gone (AD-13 reclaimed it) and the snapshot is the only remaining copy, so the
    /// gap is not fillable and the next tick re-bootstraps.
    needs_rebootstrap: bool,
    pending: Option<PendingDecision>,
    last_change: Option<Instant>,
    last_upload: Option<Instant>,
    last_seen_version: Option<i64>,
    last_sync_ms: Option<i64>,
    last_error: Option<&'static str>,
    frozen_reason: Option<&'static str>,
    recoverable: bool,
    backoff: Option<Backoff>,
    stats: SyncStats,
    transitions: VecDeque<SyncTransition>,
    install: Option<String>,
    pull: PullCursor,
    applier: Box<dyn Applier + Send>,
    head_etag: Option<ETag>,
    published_seq: Option<i64>,
    in_roster: bool,
    last_segment_ship: Option<Instant>,
    last_remote_poll: Option<Instant>,
    last_tombstone_purge: Option<Instant>,
    /// The pass in progress, or `None` between passes (AD-3, AD-16: one chunk per cycle).
    reconcile: Option<reconcile::Cursor>,
    /// Reconcile's stamping clock: the ONE clock of this install (AD-4), shared with the capture
    /// hook and the applier even though this pass runs on the actor's own connection. A second
    /// instance would stamp from a clock that had never heard the other's stamps, and a reconcile
    /// message that loses its own per-column comparison re-emits the value the tables already hold
    /// forever (fix F5, fix F6).
    reconcile_clock: Option<Arc<Clock>>,
    last_reconcile: Option<Instant>,
    reconcile_done_once: bool,
    /// The furthest a refused remote stamp was ahead of this computer (AD-4). Kept for diagnostics
    /// after the state has cleared, because "it happened and then it was fixed" is what support
    /// needs to read.
    last_clock_skew_ms: Option<i64>,
    /// The user's durable opt-out, cached so building a status payload never reads the dataset.
    opted_out: bool,
    last_auto_join: Option<Instant>,
    /// Whether the last automatic join was refused for a reason the user is not supposed to see
    /// (no capability, no session). Keeps the refusal off the indicator and out of the log after
    /// the first time, and selects the slower retry cadence.
    auto_join_quiet: bool,
    /// Whether the `snap/LATEST` this computer last read was written before row identities
    /// travelled. A joined computer that finds one republishes, which is what stops a new computer
    /// from ever having to bootstrap off it.
    latest_carries_identities: bool,
}

impl<H: SyncHost> SyncActor<H> {
    pub(in crate::sync) fn new(
        host: H,
        tuning: SyncTuning,
    ) -> (
        Self,
        watch::Receiver<SyncStatusPayload>,
        mpsc::UnboundedReceiver<SyncStatusPayload>,
    ) {
        let opted_out = host
            .with_dataset(crate::db::sync_state::load)
            .ok()
            .flatten()
            .is_some_and(|state| state.sync_disabled);
        let initial = SyncStatusPayload {
            state: SyncState::Unlinked,
            dataset_id: host.dataset_id().to_string(),
            enabled: false,
            paused: opted_out,
            last_sync_ms: None,
            error_code: None,
            recoverable: true,
            prompt: None,
        };
        let (status, status_rx) = watch::channel(initial);
        let (events, events_rx) = mpsc::unbounded_channel();

        // AD-18: the tuning is the one statement of the rate, so it is pushed into the host's
        // limiter here rather than read at each request.
        host.limits().reconfigure(tuning.request_rate);

        let applier = host.applier();
        let started = Instant::now();
        let actor = Self {
            host,
            tuning,
            status,
            events,
            state: SyncState::Unlinked,
            enabled: false,
            known_latest: None,
            snapshot_watermark: BTreeMap::new(),
            needs_rebootstrap: false,
            pending: None,
            last_change: None,
            last_upload: None,
            last_seen_version: None,
            last_sync_ms: None,
            last_error: None,
            frozen_reason: None,
            recoverable: true,
            backoff: None,
            stats: SyncStats::default(),
            transitions: VecDeque::with_capacity(TRANSITION_HISTORY),
            install: None,
            pull: PullCursor::default(),
            // Dated from construction, so the first log cycle happens one interval after the actor
            // starts rather than on its first tick: launch belongs to the snapshot path (AD-16),
            // and `sync_now` forces a cycle anyway.
            applier,
            head_etag: None,
            published_seq: None,
            in_roster: false,
            last_segment_ship: Some(started),
            last_remote_poll: Some(started),
            // Deliberately NOT dated from construction: the first tick is the startup sweep AD-5
            // asks for, and it is a local `DELETE` on an indexed column rather than a request.
            last_tombstone_purge: None,
            reconcile: None,
            reconcile_clock: None,
            last_reconcile: Some(started),
            reconcile_done_once: false,
            last_clock_skew_ms: None,
            opted_out,
            // Dated from CONSTRUCTION like the two log floors: the unattended retry in `tick` is
            // the backstop, and launch's own attempt comes from the explicit `auto_start_now`
            // the supervisor issues, which is not subject to the floor.
            last_auto_join: Some(started),
            auto_join_quiet: false,
            latest_carries_identities: true,
        };

        (actor, status_rx, events_rx)
    }

    pub(in crate::sync) fn status(&self) -> SyncStatusPayload {
        SyncStatusPayload {
            state: self.state,
            dataset_id: self.host.dataset_id().to_string(),
            enabled: self.enabled,
            paused: self.opted_out,
            last_sync_ms: self.last_sync_ms,
            error_code: self.last_error.map(str::to_string),
            recoverable: self.recoverable,
            prompt: self.pending.as_ref().map(PendingDecision::prompt),
        }
    }

    /// Arranges the `remote_changed` prompt.
    ///
    /// Story 23 left exactly one way to reach it: a `snap/LATEST` that appeared BETWEEN the
    /// bootstrap assessment and the create-only publish of a first snapshot. Two computers over
    /// one fake cloud cannot be interleaved inside a single `enable` call, so the state is set
    /// here and both resolutions are then driven through the real `resolve_remote`.
    #[cfg(test)]
    pub(in crate::sync) fn arrange_remote_changed(&mut self, theirs: LatestSnapshot, etag: ETag) {
        self.pending = Some(PendingDecision::RemoteChanged {
            theirs,
            their_etag: etag,
        });
        self.state = SyncState::RemoteChanged;
    }

    /// The pull cursor, so a test can assert what is buffered, what is owed, and arrange the one
    /// state the protocol cannot produce by itself: a head re-read after it was already consumed.
    #[cfg(test)]
    pub(in crate::sync) fn pull(&mut self) -> &mut super::segment::PullCursor {
        &mut self.pull
    }

    pub(in crate::sync) fn diagnostics(&self) -> SyncDiagnostics {
        let worklist = self.worklist_counts();

        SyncDiagnostics {
            dataset_id: self.host.dataset_id().to_string(),
            capability: MULTI_DEVICE_SYNC.name(),
            state: self.state,
            transitions: self.transitions.iter().cloned().collect(),
            enabled: self.enabled,
            has_pulled_latest: self.known_latest.is_some(),
            pending_prompt: self.pending.as_ref().map(PendingDecision::prompt),
            uploads: self.stats.uploads,
            segments_shipped: self.stats.segments_shipped,
            segments_fetched: self.stats.segments_fetched,
            messages_received: self.stats.messages_received,
            reconcile_messages: self.stats.reconcile_messages,
            parked_segments: self.pull.parked_count(),
            pending_messages: worklist.0,
            quarantined_messages: worklist.1,
            clock_skews: self.stats.clock_skews,
            last_clock_skew_ms: self.last_clock_skew_ms,
            segments_deleted: self.stats.segments_deleted,
            snapshots_deleted: self.stats.snapshots_deleted,
            roster_pruned: self.stats.roster_pruned,
            rate_delays: self.host.limits().delays(),
            oversize_refusals: self.host.limits().oversize_refusals(),
            conflicts: self.stats.conflicts,
            restores: self.stats.restores,
            failures: self.stats.failures,
            blocked: self.stats.blocked,
            last_error_code: self.last_error.map(str::to_string),
            last_sync_ms: self.last_sync_ms,
            last_build_ms: self.stats.last_build_ms,
            last_object_bytes: self.stats.last_object_bytes,
            last_payload_bytes: self.stats.last_payload_bytes,
            local_rows: self.host.local_data().ok().map(|local| local.rows),
            schema_version: self.host.schema_version(),
            frozen_reason: self.frozen_reason,
            backoff_ms: self
                .backoff
                .as_ref()
                .map(|backoff| backoff.until.saturating_duration_since(Instant::now()))
                .map(millis),
            settle_window_ms: millis(self.tuning.settle_window),
            min_upload_interval_ms: millis(self.tuning.min_upload_interval),
            poll_interval_ms: millis(self.tuning.poll_interval),
        }
    }

    /// Emits only on a real transition, so a listener counts changes rather than ticks.
    fn publish(&mut self, state: SyncState) {
        self.state = state;
        let payload = self.status();
        if *self.status.borrow() == payload {
            return;
        }

        // AD-16 asks diagnostics to carry states *and transitions*: a count alone cannot
        // tell "offline once, retried, fine" from "flapping every tick".
        if self.transitions.len() == TRANSITION_HISTORY {
            self.transitions.pop_front();
        }
        self.transitions.push_back(SyncTransition {
            state,
            at_ms: self.host.now_ms(),
            error_code: self.last_error.map(str::to_string),
        });

        let _ = self.status.send(payload.clone());
        let _ = self.events.send(payload);
    }

    fn clear_error(&mut self) {
        self.last_error = None;
        self.recoverable = true;
        self.frozen_reason = None;
        self.backoff = None;
    }

    fn record_fault(&mut self, fault: &SyncFault) {
        self.last_error = Some(fault.code());
        self.recoverable = fault.recoverable();
        self.frozen_reason = match fault {
            SyncFault::Blocked(SyncBlocked::Frozen { reason }) => Some(reason.code()),
            SyncFault::Blocked(SyncBlocked::CapabilityMissing { .. }) => {
                Some(FrozenReason::EntitlementLapsed.code())
            }
            _ => None,
        };

        // AD-7: continuing would mean two accounts writing one source of truth, so the
        // refusal is persisted in the dataset's own row. This run still reports `error`
        // (AD-7's wording); every later launch reads it back as `frozen`.
        if matches!(fault.code(), "account_mismatch" | "owner_mismatch") {
            self.host.freeze(FrozenReason::OwnerMismatch);
        }

        let state = match fault {
            SyncFault::Blocked(SyncBlocked::LocalOnlyDataset) | SyncFault::NotEnabled => {
                SyncState::Unlinked
            }
            SyncFault::Blocked(SyncBlocked::Frozen { .. })
            | SyncFault::Blocked(SyncBlocked::CapabilityMissing { .. }) => SyncState::Frozen,
            SyncFault::UpdateNeeded { .. }
            | SyncFault::Snapshot(SnapshotError::SchemaTooNew { .. }) => SyncState::UpdateNeeded,
            SyncFault::ClockSkew { .. } => SyncState::ClockSkew,
            other if other.retryable() => SyncState::Offline,
            _ => SyncState::Error,
        };

        match state {
            // A refusal is a state of the product, not a fault to count or to back off
            // from: the next tick re-asks the gate, which is how leaving Frozen resumes.
            SyncState::Frozen | SyncState::Unlinked => {
                self.stats.blocked += 1;
                self.backoff = None;
            }
            // Neither is a transfer that failed and neither is fixed by waiting: an old build has
            // to be updated and a wrong clock has to be corrected. Backing off would also stop the
            // segments this build CAN still apply, which AD-11 forbids.
            SyncState::UpdateNeeded | SyncState::ClockSkew => {
                self.backoff = None;
            }
            SyncState::Offline => {
                self.stats.failures += 1;
                self.schedule_backoff();
            }
            _ => {
                self.stats.failures += 1;
                self.backoff = None;
            }
        }

        self.publish(state);
    }

    /// Exponential with full jitter on the increment, capped. The jitter matters because
    /// every computer on one account wakes on the same poll cadence: without it, two of
    /// them that went offline together would retry in lockstep forever.
    fn schedule_backoff(&mut self) {
        let attempt = self
            .backoff
            .as_ref()
            .map(|backoff| backoff.attempt.saturating_add(1))
            .unwrap_or(0);

        let base = self
            .tuning
            .initial_backoff
            .saturating_mul(1u32 << attempt.min(16))
            .min(self.tuning.max_backoff);
        let span = millis(base).max(1);
        let jitter = Duration::from_millis(rand::random::<u64>() % span);

        self.backoff = Some(Backoff {
            attempt,
            until: Instant::now() + base + jitter,
        });
    }

    fn mark_synced(&mut self) {
        self.last_sync_ms = Some(self.host.now_ms());
        self.last_change = None;
        self.last_upload = Some(Instant::now());
        self.last_seen_version = self.host.data_version().ok();
        self.clear_error();
        self.publish(SyncState::Idle);
    }

    /// Whether this dataset has really joined the account's sync, read from the dataset itself.
    ///
    /// `link_state` cannot answer this: it is set at the first credential vend, so a computer that
    /// only saw CAP-5's question and dismissed it would read as linked and be asked again forever.
    fn joined(&self) -> bool {
        self.host
            .with_dataset(crate::db::sync_state::load)
            .ok()
            .flatten()
            .is_some_and(|state| state.joined())
    }

    fn refresh_opt_out(&mut self) {
        if let Ok(Some(state)) = self.host.with_dataset(crate::db::sync_state::load) {
            self.opted_out = state.sync_disabled;
        }
    }

    /// Writes the user's switch through to the dataset, which is what makes it survive a relaunch,
    /// a sign-in, a dataset switch and a wipe. `install()` first because the row has to exist.
    fn set_opted_out(&mut self, disabled: bool) {
        self.opted_out = disabled;

        if let Err(fault) = self.install().and_then(|_| {
            self.host
                .with_dataset(|conn| crate::db::sync_state::set_sync_disabled(conn, disabled))
        }) {
            warn!("the sync switch could not be stored: {}", fault.code());
        }
    }

    /// Records that a join genuinely completed — a first publish, a restore or an answered
    /// replace. Deliberately unreachable from the credential vend, which runs before any of them.
    fn mark_joined(&mut self) {
        if let Err(fault) = self
            .install()
            .and_then(|_| self.host.with_dataset(crate::db::sync_state::mark_joined))
        {
            warn!("the sync join marker could not be stored: {}", fault.code());
        }
    }

    /// The AUTOMATIC join: the user configures nothing and is asked nothing.
    ///
    /// Driven at launch, at a dataset switch and from every `tick`, which is what makes it
    /// self-healing — a join that could not run because the machine was offline, the session was
    /// not there yet or the account had just been upgraded starts by itself, with no restart.
    /// Refusals the user cannot act on are SILENT: the state stays `unlinked`, no backoff is
    /// scheduled, and nothing is logged twice.
    /// The launch / dataset-switch attempt: the same join, without the unattended retry floor.
    pub(in crate::sync) async fn auto_start_now(&mut self) {
        self.last_auto_join = None;
        self.auto_start().await;
    }

    pub(in crate::sync) async fn auto_start(&mut self) {
        if self.enabled || self.pending.is_some() {
            return;
        }

        // An un-entitled account is re-checked on its own slow cadence: an upgrade mid-session
        // still gets picked up, without the account endpoint being asked every half minute.
        let floor = match self.last_error {
            Some("not_entitled") | Some("not_configured") => {
                self.tuning.capability_recheck_interval
            }
            _ => self.tuning.auto_join_interval,
        };
        if self.last_auto_join.is_some_and(|at| at.elapsed() < floor) {
            return;
        }
        self.last_auto_join = Some(Instant::now());

        self.refresh_opt_out();
        if self.opted_out {
            return;
        }

        // Only for a dataset that has something to resume: showing `syncing` to an account that
        // is about to be refused for want of the capability is exactly the chrome AD-14 forbids.
        if self.joined() {
            self.publish(SyncState::Syncing);
        }

        match self.enable_inner(None).await {
            Ok(outcome) => {
                self.auto_join_quiet = false;
                self.settle_enable(&outcome).await;
            }
            Err(fault) if quiet_for_auto_join(&fault) => self.note_quiet_refusal(&fault),
            Err(fault) => self.record_fault(&fault),
        }
    }

    /// A refusal the user is not meant to see as a failure: no capability, no session yet.
    ///
    /// The state stays `unlinked`, so the always-mounted indicator renders nothing at all, while
    /// the CODE is kept so the settings screen can explain why sync is not running.
    fn note_quiet_refusal(&mut self, fault: &SyncFault) {
        if !self.auto_join_quiet {
            info!("Sync is not starting automatically: {}", fault.code());
            self.auto_join_quiet = true;
        }

        self.stats.blocked += 1;
        self.backoff = None;
        self.last_error = Some(fault.code());
        self.recoverable = fault.recoverable();
        self.frozen_reason = None;
        self.publish(SyncState::Unlinked);
    }

    /// The user turning sync on, or answering CAP-5's question. Clears the durable opt-out,
    /// because this call IS the user asking for it.
    pub(in crate::sync) async fn enable(
        &mut self,
        choice: Option<LinkChoice>,
    ) -> Result<SyncEnableOutcome, SyncFault> {
        self.set_opted_out(false);
        self.publish(SyncState::Syncing);

        match self.enable_inner(choice).await {
            Ok(outcome) => {
                self.settle_enable(&outcome).await;

                Ok(outcome)
            }
            Err(fault) => {
                self.record_fault(&fault);
                Err(fault)
            }
        }
    }

    async fn settle_enable(&mut self, outcome: &SyncEnableOutcome) {
        match outcome {
            SyncEnableOutcome::Enabled { .. } => {
                self.enabled = true;
                // AD-9 restores the snapshot AND the tail after its vector. The log cycle
                // is what fetches that tail, and without this call a freshly linked
                // computer would sit on a snapshot-aged dataset until the first poll
                // interval elapsed (Story 19 recorded exactly that gap).
                if self.pending.is_none() {
                    self.mark_joined();
                    if let Err(fault) = self.log_cycle(true).await {
                        self.record_fault(&fault);
                    }
                }
                if self.pending.is_some() {
                    self.clear_error();
                    self.publish(SyncState::RemoteChanged);
                } else {
                    self.mark_synced();
                }
            }
            SyncEnableOutcome::LinkChoiceRequired { .. } => {
                self.publish(SyncState::LinkChoiceRequired)
            }
            SyncEnableOutcome::SeparateProfileCreated { .. } => {
                self.enabled = false;
                self.pending = None;
                // This dataset is CAP-5's deliberately-unsynced half: the cloud copy went to the
                // new profile. Persisting the switch is what stops the automatic join from asking
                // the same question again on the very next tick.
                self.set_opted_out(true);
                self.clear_error();
                self.publish(SyncState::Unlinked);
            }
            SyncEnableOutcome::Waiting => {
                self.enabled = false;
                self.clear_error();
                self.publish(SyncState::Unlinked);
            }
        }
    }

    async fn enable_inner(
        &mut self,
        choice: Option<LinkChoice>,
    ) -> Result<SyncEnableOutcome, SyncFault> {
        let session = self.host.connect().await?;

        // A dataset that has joined is never assessed again: `assess` answers `ChoiceRequired` for
        // any dataset that holds rows while the account holds a snapshot, which is true of every
        // launch of every computer that is already syncing.
        if self.joined() {
            return self.resume(&session).await;
        }

        let local = self.host.local_data()?;
        let plan = bootstrap::assess(&session.store, &session.pin, &local).await?;

        match plan {
            BootstrapPlan::FirstEnable => {
                claim_owner(&session, self.host.now_ms()).await?;
                self.publish_snapshot(&session, None, LostCas::Prompt).await
            }
            BootstrapPlan::NoSnapshot => {
                self.publish_snapshot(&session, None, LostCas::Prompt).await
            }
            BootstrapPlan::SnapshotNotReady => Ok(SyncEnableOutcome::Waiting),
            BootstrapPlan::Restore { latest, etag } => {
                self.close_applier();
                let report = bootstrap::restore_latest(
                    &session.store,
                    &latest,
                    &RestoreTarget {
                        db_path: self.host.db_path(),
                        // Nothing to back up: `assess` only returns `Restore` for a
                        // dataset holding no user data.
                        dated_backup_dir: None,
                    },
                    self.host.slot(),
                )
                .await?;

                self.stats.restores += 1;
                self.stats.last_object_bytes = Some(report.object_bytes);
                self.stats.last_payload_bytes = Some(report.payload_bytes);
                self.known_latest = Some(etag);
                self.snapshot_watermark = latest.watermark.clone();
                self.latest_carries_identities = latest.carries_identities;
                self.reopen_applier();

                Ok(SyncEnableOutcome::Enabled {
                    state: SyncState::Idle,
                })
            }
            BootstrapPlan::ChoiceRequired {
                latest,
                etag,
                local,
            } => match choice {
                None => {
                    let outcome = SyncEnableOutcome::LinkChoiceRequired {
                        local_rows: local.rows,
                        remote_created_ms: latest.created_ms,
                        remote_schema_version: latest.schema_version,
                    };
                    self.pending = Some(PendingDecision::LinkChoice {
                        latest,
                        local_rows: local.rows,
                    });

                    Ok(outcome)
                }
                Some(choice) => self.apply_link_choice(&session, &latest, etag, choice).await,
            },
        }
    }

    /// Resumes a dataset that has already joined: no assessment, no question, ever.
    ///
    /// The owner object is still verified, because AD-7's rule that a prefix owned by another
    /// account must freeze rather than sync does not depend on how sync was started. After that it
    /// is the ordinary cycle — the other computers' tail applied by HLC and per-field LWW, local
    /// changes pushed — which is the whole of what "seamless and automatic" means.
    async fn resume(&mut self, session: &HostSession<H>) -> Result<SyncEnableOutcome, SyncFault> {
        match session.store.get(OWNER_OBJECT_KEY).await {
            Ok(stored) => {
                let owner_sub = owner_sub_from_body(&stored.bytes).map_err(SyncFault::Auth)?;
                if owner_sub != session.pin.owner_sub {
                    return Err(SyncFault::OwnerMismatch);
                }
            }
            // No binding at all: there is nothing to resume ONTO, so this is a first enable in
            // everything but name. Re-claiming and publishing asks the user nothing.
            Err(GatedError::Store(StoreError::NotFound)) => {
                claim_owner(session, self.host.now_ms()).await?;

                return self.publish_snapshot(session, None, LostCas::Adopt).await;
            }
            Err(error) => return Err(error.into()),
        }

        match snapshot::fetch_latest(&session.store).await? {
            Some((latest, etag)) => {
                self.snapshot_watermark = latest.watermark;
                self.latest_carries_identities = latest.carries_identities;
                self.known_latest = Some(etag);

                Ok(SyncEnableOutcome::Enabled {
                    state: SyncState::Idle,
                })
            }
            // Joined, but the pointer is missing: publishing is the `NoSnapshot` path, and the
            // lost-CAS prompt has no place here — the log has already carried every change both
            // ways, so a pointer that appeared meanwhile is the same converged account (story 23).
            None => self.publish_snapshot(session, None, LostCas::Adopt).await,
        }
    }

    async fn apply_link_choice(
        &mut self,
        session: &HostSession<H>,
        latest: &LatestSnapshot,
        etag: ETag,
        choice: LinkChoice,
    ) -> Result<SyncEnableOutcome, SyncFault> {
        self.close_applier();
        let outcome = bootstrap::apply_choice(
            &session.store,
            latest,
            choice,
            &ReplaceTarget {
                db_path: self.host.db_path(),
                dated_backup_dir: self.host.backup_dir(),
            },
            &SeparateContext {
                root: self.host.root(),
                kept_dataset_id: self.host.dataset_id(),
                owner_sub: &session.pin.owner_sub,
                label: self.host.label(),
            },
            self.host.slot(),
        )
        .await?;

        self.stats.restores += 1;
        self.reopen_applier();

        match outcome {
            LinkOutcome::Replaced { report } => {
                self.discard_unsent_log();
                self.stats.last_object_bytes = Some(report.object_bytes);
                self.stats.last_payload_bytes = Some(report.payload_bytes);
                self.known_latest = Some(etag);
                self.snapshot_watermark = latest.watermark.clone();
                self.latest_carries_identities = latest.carries_identities;
                self.pending = None;

                Ok(SyncEnableOutcome::Enabled {
                    state: SyncState::Idle,
                })
            }
            LinkOutcome::Separated { dataset, report } => {
                self.stats.last_object_bytes = Some(report.object_bytes);
                self.stats.last_payload_bytes = Some(report.payload_bytes);

                Ok(SyncEnableOutcome::SeparateProfileCreated {
                    dataset_id: dataset.id,
                })
            }
        }
    }

    async fn publish_snapshot(
        &mut self,
        session: &HostSession<H>,
        known_latest: Option<&ETag>,
        lost_cas: LostCas,
    ) -> Result<SyncEnableOutcome, SyncFault> {
        let state = match self.upload(session, known_latest, lost_cas).await? {
            UploadStep::Published => SyncState::Idle,
            UploadStep::RemoteChanged => SyncState::RemoteChanged,
        };

        Ok(SyncEnableOutcome::Enabled { state })
    }

    async fn upload(
        &mut self,
        session: &HostSession<H>,
        known_latest: Option<&ETag>,
        lost_cas: LostCas,
    ) -> Result<UploadStep, SyncFault> {
        // Blobs FIRST, and the snapshot only if they all succeeded: a snapshot names its
        // pictures by `image_sha256`, so publishing it before their objects exist would give
        // every other computer a hash it cannot resolve (AD-10). A blob fault returns here,
        // before `snap/LATEST` is read or written, so the pointer never moves on a half upload.
        self.upload_image_blobs(session).await?;

        let built =
            snapshot::build_snapshot(self.host.db_path(), self.host.schema_version()).await?;

        self.stats.last_build_ms = Some(millis(built.build_duration));
        self.stats.last_object_bytes = Some(built.object_bytes());
        self.stats.last_payload_bytes = Some(built.payload_bytes);

        match snapshot::upload_snapshot(&session.store, &built, known_latest, self.host.now_ms())
            .await?
        {
            UploadOutcome::Published { latest, .. } => {
                self.stats.uploads += 1;
                self.known_latest = Some(latest);
                self.snapshot_watermark = built.watermark.clone();
                // Anything this build writes carries a watermark and row identities, so a publish
                // is also how an account's Milestone-1 snapshot stops being the one a new computer
                // would have to bootstrap from.
                self.latest_carries_identities = true;
                self.pending = None;
                self.compact(session).await;

                Ok(UploadStep::Published)
            }
            // AD-13's own argument, applied to the pointer: in continuous sync a lost
            // compare-and-swap means another computer published a NEWER snapshot of the same
            // converged account, not that two sources of truth disagree. Adopting theirs costs
            // nothing (every message either side holds is in the log) and asking the user to
            // choose between two views of one dataset would be a question with no wrong answer.
            // The enable path keeps the prompt: there the two files really can be different data.
            UploadOutcome::RemoteChanged {
                theirs, their_etag, ..
            } => {
                self.stats.conflicts += 1;
                match lost_cas {
                    LostCas::Adopt => {
                        self.snapshot_watermark = theirs.watermark.clone();
                        self.latest_carries_identities = theirs.carries_identities;
                        self.known_latest = Some(their_etag);
                        self.pending = None;

                        Ok(UploadStep::Published)
                    }
                    LostCas::Prompt => {
                        self.pending = Some(PendingDecision::RemoteChanged { theirs, their_etag });

                        Ok(UploadStep::RemoteChanged)
                    }
                }
            }
        }
    }

    /// Closes the AD-11 apply connection so nothing holds the dataset file during a swap (AD-9).
    fn close_applier(&mut self) {
        self.applier = Box::new(ClosedApplier);
    }

    /// Reopens it against the file that is now there, and forgets the fetch cursor: the restored
    /// file carries its own `sync_applied_vector`, which is the only honest statement of what it
    /// already holds.
    fn reopen_applier(&mut self) {
        self.applier = self.host.applier();
        self.pull = PullCursor::default();
    }

    /// Drops this computer's unsent log after an EXPLICIT choice to take the cloud copy (CAP-5).
    ///
    /// Only on the two paths where the user said "discard my local data" — a `replace` link
    /// choice and `load_remote`. Shipping the unsent rows afterwards would republish part of what
    /// they chose to discard. The retention re-bootstrap is the opposite case (no such intent) and
    /// REPLAYS its unsent log instead. Never fatal: the swap already succeeded, and the restored
    /// file is correct either way.
    fn discard_unsent_log(&self) {
        match self
            .host
            .with_dataset(apply::discard_unsent_and_refold)
        {
            Ok(dropped) if dropped > 0 => {
                info!("{dropped} unsent change(s) dropped with this computer's replaced data");
            }
            Ok(_) => {}
            Err(error) => {
                warn!(
                    "the unsent log could not be dropped after a replace: {}",
                    error.code()
                );
            }
        }
    }

    /// AD-13's sweep, run only by the computer that has just published a snapshot.
    ///
    /// Never fatal: reclaiming storage is maintenance, so a failure is logged and the next
    /// publish tries again rather than putting the actor into backoff and stopping replication.
    async fn compact(&mut self, session: &HostSession<H>) {
        let Ok(install) = self.install() else {
            return;
        };

        match retention::compact(&session.store, &install, self.host.now_ms()).await {
            Ok(report) => {
                self.stats.segments_deleted += report.segments_deleted as u64;
                self.stats.snapshots_deleted += report.snapshots_deleted as u64;
                self.stats.roster_pruned += report.roster_pruned as u64;
            }
            Err(error) => warn!("the retention sweep did not finish: {}", error),
        }
    }

    /// Puts every full image this computer holds and has not yet sent into `blob/<sha256>`.
    ///
    /// Three things keep this from re-sending megabytes on every cycle: the queue only contains
    /// rows whose bytes are actually here, a 0-byte presence probe answers for anything another
    /// computer already uploaded, and a local marker is written for every hash that is confirmed
    /// stored — so a second cycle with no new picture makes no blob request at all.
    async fn upload_image_blobs(&mut self, session: &HostSession<H>) -> Result<(), SyncFault> {
        let pending = self.host.with_dataset(sync_blobs::pending_image_blobs)?;

        for hash in pending {
            // AD-6: an existing key whose stored hash matches IS success, and `put_immutable`
            // already turns a mismatch into an error, so both outcomes of a put that returned
            // `Ok` mean the object is there and the marker is owed either way.
            if !blob::blob_present(&session.store, &hash).await? {
                // Read inside the loop and by hash: the picture may have been replaced since the
                // queue was read, and then there is nothing to send under this key.
                let Some(bytes) = self
                    .host
                    .with_dataset(|conn| sync_blobs::image_blob_bytes(conn, &hash))?
                else {
                    continue;
                };

                let (uploaded, _) =
                    blob::put_image_blob(&session.store, self.host.schema_version(), &bytes)
                        .await?;

                // The key is derived from the bytes that were just read, so this cannot differ;
                // asserting it is what makes the marker below provably about the right object.
                if uploaded != hash {
                    return Err(SyncFault::ImageCorrupt);
                }
            }

            self.host
                .with_dataset(|conn| sync_blobs::mark_image_blob_uploaded(conn, &hash))?;
        }

        Ok(())
    }

    /// Downloads one project's full picture and writes it into the row it belongs to (AD-10).
    ///
    /// A row that already holds its bytes answers from the dataset and never calls `connect`, so
    /// no credential is vended and no request is made for a picture this computer has.
    pub(in crate::sync) async fn fetch_image(
        &mut self,
        project_id: i64,
    ) -> Result<ProjectImage, SyncFault> {
        let hash = match self
            .host
            .with_dataset(|conn| sync_blobs::image_fetch_target(conn, project_id))?
        {
            ImageFetchTarget::NoImage => return Err(SyncFault::ImageMissing),
            ImageFetchTarget::AlreadyLocal => return self.image_payload(project_id),
            ImageFetchTarget::Needed { image_sha256 } => image_sha256,
        };

        let session = self.host.connect().await?;
        let bytes = blob::fetch_image_blob(&session.store, &hash).await?;

        // `Ok(false)` is the picture having been replaced while the download was in flight: the
        // hash in the WHERE clause matched no row, nothing was overwritten, and the honest answer
        // is whatever the row holds now rather than a failure (`db::projects` documents it).
        self.host
            .with_dataset(|conn| {
                crate::db::projects::set_project_image_bytes(conn, project_id, &hash, &bytes)
            })?;

        self.image_payload(project_id)
    }

    fn image_payload(&self, project_id: i64) -> Result<ProjectImage, SyncFault> {
        self.host
            .with_dataset(|conn| {
                crate::commands::projects::get_project_image_inner(conn, project_id)
            })?
            .ok_or(SyncFault::ImageMissing)
    }

    /// This install's id, read once from the dataset's own `sync_state` row (AD-4).
    ///
    /// Through `ensure_install_on`, which is the same function capture calls: whichever runs first
    /// settles the id, and a database copied to another machine is re-minted by the fingerprint
    /// comparison instead of appending to the original's `(install, seq)` space.
    fn install(&mut self) -> Result<String, SyncFault> {
        if let Some(install) = &self.install {
            return Ok(install.clone());
        }

        let state = self.host.with_dataset(super::state::ensure_install_on)?;
        self.install = Some(state.install_id.clone());

        Ok(state.install_id)
    }

    /// AD-5's retention, swept at the first tick after launch and then while the app idles.
    ///
    /// A failure is logged and never raised as a sync fault: an unpurged tombstone costs disk, not
    /// correctness, and the delete MESSAGE it describes is untouched either way.
    fn purge_tombstones(&mut self) {
        let due = self
            .last_tombstone_purge
            .is_none_or(|at| at.elapsed() >= self.tuning.tombstone_purge_interval);
        if !due {
            return;
        }

        self.last_tombstone_purge = Some(Instant::now());
        match self
            .host
            .with_dataset(crate::db::sync_apply::purge_expired_tombstones)
        {
            Ok(removed) if removed > 0 => {
                tracing::info!("Purged {} expired tombstone(s)", removed);
            }
            Ok(_) => {}
            Err(fault) => tracing::warn!("Expired tombstones could not be purged: {}", fault.code()),
        }
    }

    /// Whether a reconcile pass should start now (AD-3).
    ///
    /// Once after the dataset is opened, and afterwards only while an unmigrated write site exists:
    /// with every write site migrated there is nothing left that can bypass capture, so a repeating
    /// pass would be a full-table scan per interval that provably finds nothing.
    fn reconcile_pass_due(&self) -> bool {
        let elapsed = self
            .last_reconcile
            .is_none_or(|at| at.elapsed() >= self.tuning.reconcile_interval);

        elapsed && (!self.reconcile_done_once || reconcile::unmigrated_write_sites_remain())
    }

    /// One bounded chunk of a reconcile pass, on the actor's own connection.
    ///
    /// Capture is OFF structurally: the hook is per connection and this one never had it, so
    /// reconcile's `sync_log` rows are messages rather than captured changes. A failure is logged
    /// and never raised as a sync fault — the cursor keeps its place and the next cycle retries —
    /// because an unreconciled row costs convergence latency, not correctness, and the alternative
    /// is a backoff that would also stop shipping and receiving (AD-16).
    fn reconcile_chunk(&mut self, install: &str) {
        if self.reconcile.is_none() {
            if !self.reconcile_pass_due() {
                return;
            }
            self.reconcile = Some(reconcile::Cursor::default());
        }

        if self.reconcile_clock.is_none() {
            match self.host.with_dataset(|conn| clock::shared(conn, install)) {
                Ok(clock) => self.reconcile_clock = Some(clock),
                Err(error) => {
                    tracing::warn!("Reconcile could not build a clock: {:?}", error);
                    self.reconcile = None;
                    return;
                }
            }
        }

        let mut cursor = self.reconcile.take().unwrap_or_default();
        let stepped = {
            // Unreachable — the clock was just built — and it puts the cursor back rather than
            // returning with it taken, so an unreachable branch cannot silently lose a pass.
            let Some(clock) = self.reconcile_clock.as_ref() else {
                self.reconcile = Some(cursor);
                return;
            };

            self.host
                .with_dataset(|conn| reconcile::step(conn, clock, install, &mut cursor))
        };

        match stepped {
            Ok(report) => {
                self.stats.reconcile_messages += report.messages() as u64;
                if report.messages() > 0 {
                    tracing::info!(
                        "Reconcile emitted {} missing message(s) for {} row(s)",
                        report.messages(),
                        report.rows
                    );
                }
            }
            Err(fault) => {
                tracing::warn!("A reconcile chunk failed: {}", fault.code());
                self.reconcile = Some(cursor);
                return;
            }
        }

        if cursor.done() {
            self.last_reconcile = Some(Instant::now());
            self.reconcile_done_once = true;
            self.reconcile = None;
        } else {
            self.reconcile = Some(cursor);
        }
    }

    /// One cycle of the log protocol (AD-6): ship what is local, publish the head and the roster,
    /// then poll the roster and the known heads.
    ///
    /// Both halves are on their own floor from `SyncTuning`, and the floors are checked BEFORE
    /// anything is connected or read, so a tick with nothing due costs nothing at all. The M1
    /// snapshot flow below is untouched by this: Story 23 replaces it.
    async fn log_cycle(&mut self, forced: bool) -> Result<(), SyncFault> {
        let ship_due = forced
            || self
                .last_segment_ship
                .is_none_or(|at| at.elapsed() >= self.tuning.segment_interval);
        let poll_due = forced
            || self
                .last_remote_poll
                .is_none_or(|at| at.elapsed() >= self.tuning.remote_poll_interval);
        if !ship_due && !poll_due {
            return Ok(());
        }

        // The gate first: a local-only, un-entitled or Frozen dataset must not even read its own
        // install id for a cycle it is not allowed to run (AD-14).
        let session = self.host.connect().await?;

        // BEFORE anything reads the dataset: a re-bootstrap replaces the file, so an install id or
        // a reconcile cursor read before it would describe a database that no longer exists.
        if self.needs_rebootstrap {
            self.rebootstrap(&session).await?;
        }

        let install = self.install()?;

        // BEFORE the ship, so whatever reconcile had to emit leaves in this same cycle (AD-3).
        self.reconcile_chunk(&install);

        if ship_due {
            self.last_segment_ship = Some(Instant::now());
            self.ship_log(&session, &install).await?;
        }
        if poll_due {
            self.last_remote_poll = Some(Instant::now());
            self.poll_remote(&session, &install).await?;
        }

        self.settle_cycle_states();

        Ok(())
    }

    /// Turns what the cycle observed into AD-16's two "the user has to act, sync is not broken"
    /// states, and clears them by itself when the cause is gone.
    ///
    /// Order is deliberate: a wrong clock is reported ahead of version skew because it also affects
    /// the messages this build CAN apply (a clock that is behind loses every last-write-wins
    /// comparison), so it is the more urgent of the two.
    fn settle_cycle_states(&mut self) {
        if let Some(ahead_ms) = self.applier.take_clock_skew() {
            self.stats.clock_skews += 1;
            self.last_clock_skew_ms = Some(ahead_ms);
            self.record_fault(&SyncFault::ClockSkew { ahead_ms });
            return;
        }

        let parked = self.pull.parked();
        if let Some(found) = parked.iter().map(|(_, _, version)| *version).max() {
            self.record_fault(&SyncFault::UpdateNeeded {
                found,
                supported: self.host.schema_version(),
            });
            return;
        }

        // Both causes are gone, so neither state may persist. Narrow on purpose: only the two
        // states this cycle owns are cleared here, so an `offline` backoff or a swap failure is
        // still the business of the path that set it.
        if matches!(self.state, SyncState::UpdateNeeded | SyncState::ClockSkew) {
            self.clear_error();
            self.publish(SyncState::Idle);
        }
    }

    /// `sync_pending` and `sync_quarantine` as counts (AD-16: counts, never values).
    ///
    /// A failure to read them is NOT a fault: diagnostics must answer even when the dataset is
    /// mid-swap, and "unknown" is reported as zero rather than as a refusal to produce a report.
    fn worklist_counts(&self) -> (i64, i64) {
        self.host
            .with_dataset(|conn| {
                Ok((
                    crate::db::sync_apply::parked_count(conn)?,
                    crate::db::sync_apply::quarantined_count(conn)?,
                ))
            })
            .unwrap_or((0, 0))
    }

    /// Cuts and ships every bounded segment the unshipped tail holds, then publishes this install's
    /// head and joins the roster.
    async fn ship_log(
        &mut self,
        session: &HostSession<H>,
        install: &str,
    ) -> Result<(), SyncFault> {
        let schema_version = self.host.schema_version();
        let mut highest = None;

        for _ in 0..segment::MAX_SEGMENTS_PER_CYCLE {
            let Some(cut) = self
                .host
                .with_dataset(|conn| segment::cut(conn, install, schema_version))?
            else {
                break;
            };

            segment::ship(&session.store, &cut).await?;
            // Only now: a crash before this leaves the rows unshipped, and the re-cut is
            // byte-identical, so the create-only put dedups instead of minting a second segment.
            self.host
                .with_dataset(|conn| segment::mark_shipped(conn, &cut))?;

            self.stats.segments_shipped += 1;
            highest = Some(cut.seq);
        }

        let Some(seq) = highest.or(self.published_seq) else {
            return Ok(());
        };

        if self.published_seq != Some(seq) {
            let head = Head {
                install: install.to_string(),
                seq,
            };
            self.head_etag =
                Some(segment::publish_head(&session.store, &head, self.head_etag.as_ref()).await?);
            self.published_seq = Some(seq);
        }

        // On first publish, and never again: the roster is a membership list, so one successful
        // compare-and-swap is the whole of this computer's interest in it.
        if !self.in_roster {
            segment::join_roster(&session.store, install).await?;
            self.in_roster = true;
        }

        Ok(())
    }

    async fn poll_remote(
        &mut self,
        session: &HostSession<H>,
        install: &str,
    ) -> Result<(), SyncFault> {
        let mut report = PollReport::default();
        let installs =
            segment::poll_roster(&session.store, &mut self.pull, install, &mut report).await?;

        for remote in &installs {
            if !self.pull.knows(remote) {
                // Resume from the apply path's durable watermark, so a relaunch does not re-fetch
                // what Story 20 has already written into the tables.
                let applied = self
                    .host
                    .with_dataset(|conn| crate::db::sync_segment::applied_seq(conn, remote))?;
                self.pull.start(remote, applied.map_or(0, |seq| seq + 1));
            }
        }

        segment::poll_heads(
            &session.store,
            &mut self.pull,
            &installs,
            self.applier.as_mut(),
            self.host.schema_version(),
            &mut report,
        )
        .await?;

        self.stats.segments_fetched += report.segments_fetched;
        self.stats.messages_received += report.messages_applied;
        let unfillable = std::mem::take(&mut report.unfillable_gaps);
        self.note_unfillable_gaps(session, &unfillable).await?;

        Ok(())
    }

    /// One poll: read the change signal, and upload if the dataset has settled.
    pub(in crate::sync) async fn tick(&mut self) {
        self.purge_tombstones();

        if self.pending.is_some() {
            return;
        }

        if let Some(backoff) = &self.backoff {
            if Instant::now() < backoff.until {
                return;
            }
        }

        // Self-healing, and the whole of "the user never enables anything": a join that could not
        // run at launch is retried here until it succeeds, so sync starts by itself once the
        // network or the session is back and without an app restart.
        if !self.enabled {
            self.auto_start().await;
            return;
        }

        // The log protocol runs on every tick, independently of the snapshot settle window: it
        // moves individual changes, and a computer that makes no local edit still has to receive.
        if let Err(fault) = self.log_cycle(false).await {
            self.record_fault(&fault);
            return;
        }

        match self.host.data_version() {
            Ok(version) => {
                if self.last_seen_version != Some(version) {
                    self.last_seen_version = Some(version);
                    self.last_change = Some(Instant::now());
                }
            }
            Err(fault) => {
                self.record_fault(&fault);
                return;
            }
        }

        // Before the settle window, because this one is not driven by a local edit: the account's
        // current snapshot predates row identities, this computer has now minted them for every
        // row, and until it republishes no new computer can bootstrap at all.
        if self.snapshot_upgrade_due() {
            let _ = self.run_upload().await;
            return;
        }

        let Some(changed_at) = self.last_change else {
            return;
        };
        if changed_at.elapsed() < self.tuning.settle_window {
            return;
        }
        if let Some(uploaded_at) = self.last_upload {
            if uploaded_at.elapsed() < self.tuning.min_upload_interval {
                return;
            }
        }
        // THE BEHAVIOUR CHANGE Story 23 makes (AD-9): a snapshot is no longer written because
        // something changed — the log already moved every change — but because the tail the
        // current snapshot does not cover has grown past what a new computer should have to
        // replay. The settle window still gates it so a build never runs mid-burst.
        if !self.snapshot_due() {
            return;
        }

        let _ = self.run_upload().await;
    }

    /// An upload the user asked for: the settle window and the minimum interval are the
    /// policy for *unattended* uploads, so an explicit `sync_now` is not subject to them.
    pub(in crate::sync) async fn sync_now(&mut self) -> Result<(), SyncFault> {
        if !self.enabled {
            let fault = SyncFault::NotEnabled;
            self.record_fault(&fault);
            return Err(fault);
        }

        self.backoff = None;
        if let Err(fault) = self.log_cycle(true).await {
            self.record_fault(&fault);
            return Err(fault);
        }

        self.run_upload().await
    }

    /// Whether the account's current snapshot has to be replaced because it predates row
    /// identities (Milestone 1 stripped `sync_uuid` and published no watermark).
    ///
    /// Gated on a COMPLETED reconcile pass: only then does every local row have an identity and a
    /// creation message, which is what makes the replacement snapshot one a new computer can
    /// bootstrap from and then apply this computer's tail on top of without duplicating rows.
    fn snapshot_upgrade_due(&self) -> bool {
        self.known_latest.is_some() && !self.latest_carries_identities && self.reconcile_done_once
    }

    /// Whether the unsnapshotted tail has passed either AD-9 threshold.
    ///
    /// A computer that has never seen a `snap/LATEST` is NOT due: its first snapshot is the one
    /// `enable` publishes, and treating "no watermark" as "everything is uncovered" would make
    /// every linked computer race to republish the account on its first tick.
    fn snapshot_due(&mut self) -> bool {
        if self.known_latest.is_none() {
            return false;
        }

        let watermark = self.snapshot_watermark.clone();
        match self
            .host
            .with_dataset(|conn| crate::db::snapshot_strip::tail_since_watermark(conn, &watermark))
        {
            Ok((messages, bytes)) => {
                messages >= self.tuning.snapshot_tail_max_messages
                    || bytes >= self.tuning.snapshot_tail_max_bytes
            }
            Err(fault) => {
                self.record_fault(&fault);
                false
            }
        }
    }

    /// AD-13's "offline longer than that re-bootstraps": the segment this computer still owes was
    /// reclaimed, and the snapshot that claims it is the only remaining copy.
    ///
    /// Decided from the pull side alone — a gap whose `seq` is at or below the current snapshot's
    /// watermark — so no listing and no extra request is needed to tell "not visible yet" from
    /// "gone forever".
    async fn note_unfillable_gaps(
        &mut self,
        session: &HostSession<H>,
        gaps: &[(String, i64)],
    ) -> Result<(), SyncFault> {
        if gaps.is_empty() {
            return Ok(());
        }

        // The pointer is re-read HERE and only here: a gap is the one moment the difference
        // between "not visible yet" and "reclaimed" matters, and the current watermark is the only
        // thing that can tell them apart. Steady-state polling still costs what AD-6 says it does.
        if let Some((latest, _)) = snapshot::fetch_latest(&session.store).await? {
            self.snapshot_watermark = latest.watermark;
            self.latest_carries_identities = latest.carries_identities;
        }

        for (install, seq) in gaps {
            if self
                .snapshot_watermark
                .get(install)
                .is_some_and(|claimed| *seq <= *claimed)
            {
                self.needs_rebootstrap = true;
            }
        }

        Ok(())
    }

    /// Restores the current snapshot over this dataset and replays this computer's own unsent log.
    ///
    /// The dated backup is REQUIRED: this path displaces local data, and CAP-5's rule that nothing
    /// is replaced without a copy does not stop applying because the cause was retention.
    async fn rebootstrap(&mut self, session: &HostSession<H>) -> Result<(), SyncFault> {
        let Some((latest, etag)) = snapshot::fetch_latest(&session.store).await? else {
            self.needs_rebootstrap = false;
            return Ok(());
        };

        self.close_applier();
        let report = bootstrap::restore_latest(
            &session.store,
            &latest,
            &RestoreTarget {
                db_path: self.host.db_path(),
                dated_backup_dir: Some(self.host.backup_dir()),
            },
            self.host.slot(),
        )
        .await?;

        self.stats.restores += 1;
        self.stats.last_object_bytes = Some(report.object_bytes);
        self.stats.last_payload_bytes = Some(report.payload_bytes);
        self.known_latest = Some(etag);
        self.snapshot_watermark = latest.watermark.clone();
        self.latest_carries_identities = latest.carries_identities;
        self.needs_rebootstrap = false;
        self.reopen_applier();
        self.replay_unsent()?;

        Ok(())
    }

    /// Re-materializes the unsent log the guarded swap carried over (AD-9).
    ///
    /// The ONE clock of this install (AD-4), caught up to the file that was just swapped in: the
    /// restored copy carries stamps from every computer the snapshot had heard from, and a clock
    /// this process was already holding accepted none of them. Without that, a replayed field —
    /// and every later local write to the same column — can be stamped BEHIND the value the
    /// restored file already holds, which no other computer would ever accept (fix F6).
    fn replay_unsent(&mut self) -> Result<(), SyncFault> {
        let install = self.install()?;
        let clock = match self.host.with_dataset(|conn| {
            let clock = clock::shared(conn, &install)?;
            clock::catch_up(conn, &clock)?;

            Ok(clock)
        }) {
            Ok(clock) => clock,
            Err(error) => {
                warn!("the unsent log could not be replayed after a restore: {:?}", error);
                return Ok(());
            }
        };

        let report: apply::ApplyReport = self
            .host
            .with_dataset(|conn| apply::replay_own_unsent(conn, &clock, &install))?;
        if report.handled() > 0 {
            info!(
                "replayed {} of this computer's own unsent message(s) after a restore",
                report.handled()
            );
        }

        Ok(())
    }

    async fn run_upload(&mut self) -> Result<(), SyncFault> {
        self.publish(SyncState::Syncing);

        let session = match self.host.connect().await {
            Ok(session) => session,
            Err(fault) => {
                self.record_fault(&fault);
                return Err(fault);
            }
        };

        let known = self.known_latest.clone();
        match self.upload(&session, known.as_ref(), LostCas::Adopt).await {
            Ok(UploadStep::Published) => {
                self.mark_synced();
                Ok(())
            }
            Ok(UploadStep::RemoteChanged) => {
                self.clear_error();
                self.publish(SyncState::RemoteChanged);
                Ok(())
            }
            Err(fault) => {
                self.record_fault(&fault);
                Err(fault)
            }
        }
    }

    pub(in crate::sync) async fn resolve_remote(
        &mut self,
        action: RemoteChoice,
    ) -> Result<(), SyncFault> {
        let Some(PendingDecision::RemoteChanged { theirs, their_etag }) = self.pending.clone()
        else {
            let fault = SyncFault::NoPendingPrompt;
            self.record_fault(&fault);
            return Err(fault);
        };

        match action {
            RemoteChoice::LoadRemote => {
                self.publish(SyncState::Syncing);

                let session = match self.host.connect().await {
                    Ok(session) => session,
                    Err(fault) => {
                        self.record_fault(&fault);
                        return Err(fault);
                    }
                };

                self.close_applier();
                let restored = bootstrap::restore_latest(
                    &session.store,
                    &theirs,
                    &RestoreTarget {
                        db_path: self.host.db_path(),
                        // The displaced file is this computer's data, so CAP-5's dated
                        // backup is mandatory here and is what makes the choice safe.
                        dated_backup_dir: Some(self.host.backup_dir()),
                    },
                    self.host.slot(),
                )
                .await;

                match restored {
                    Ok(report) => {
                        self.stats.restores += 1;
                        self.stats.last_object_bytes = Some(report.object_bytes);
                        self.stats.last_payload_bytes = Some(report.payload_bytes);
                        self.pending = None;
                        self.known_latest = Some(their_etag);
                        self.snapshot_watermark = theirs.watermark.clone();
                        self.latest_carries_identities = theirs.carries_identities;
                        self.reopen_applier();
                        self.discard_unsent_log();
                        self.mark_synced();

                        Ok(())
                    }
                    Err(error) => {
                        let fault = SyncFault::from(error);
                        self.record_fault(&fault);

                        Err(fault)
                    }
                }
            }
            RemoteChoice::KeepLocal => {
                self.pending = None;
                // Adopting their ETag is what makes the next `If-Match` succeed: this
                // computer now believes the cloud is at their snapshot, and publishing
                // over it is the user's explicit decision rather than a blind overwrite.
                self.known_latest = Some(their_etag);
                self.last_change = Some(Instant::now());
                self.last_upload = None;
                self.clear_error();
                self.publish(SyncState::Idle);

                Ok(())
            }
        }
    }

    /// Stops syncing this dataset.
    ///
    /// `persist` is the difference between the USER turning the switch off — which has to survive
    /// a relaunch, or the next launch would silently turn sync back on — and the teardown a
    /// dataset switch, a sign-out or a process exit does, which must change nothing durable.
    pub(in crate::sync) async fn disable(&mut self, persist: bool) {
        if persist {
            self.set_opted_out(true);
        }

        self.enabled = false;
        self.pending = None;
        self.last_change = None;
        self.known_latest = None;
        self.pull = PullCursor::default();
        self.head_etag = None;
        self.published_seq = None;
        self.in_roster = false;
        self.last_segment_ship = None;
        self.last_remote_poll = None;
        self.clear_error();
        // Both halves of "stop touching the cloud": no connection to the dataset file, and
        // no AWS credential in memory for an account this computer is no longer syncing.
        self.host.release();
        self.host.forget_credentials().await;
        self.publish(SyncState::Unlinked);
    }
}

/// Stands in for the AD-11 apply connection while a file swap is in progress.
///
/// REFUSES rather than counts: a batch handed to it must stay owed, because the file it would
/// have been applied to is being replaced. The real applier holds its own connection to the
/// dataset file (AD-11's one exception), and that connection has to be closed before the swap and
/// reopened afterwards — a connection to a file that has been copied over is a connection to a
/// database SQLite no longer has consistent state for.
#[derive(Debug, Default)]
struct ClosedApplier;

impl Applier for ClosedApplier {
    fn apply(&mut self, _batch: &SegmentBatch) -> Result<usize, crate::error::AppError> {
        Err(crate::error::AppError::Database {
            message: "the dataset is being replaced; the apply connection is closed".to_string(),
        })
    }
}

/// Whether an automatic join's refusal is one the user must not be shown as a failure.
///
/// An account without the capability and a process with no session yet are STATES of the product,
/// not faults: AD-14 says such a user sees no sync at all, and AD-16 says a fault never becomes
/// chrome. Everything else (offline, transport, a frozen dataset) keeps its ordinary state so the
/// user can see that sync is waiting on something real.
pub(in crate::sync) fn quiet_for_auto_join(fault: &SyncFault) -> bool {
    matches!(
        fault.code(),
        "not_entitled" | "signed_out" | "not_configured" | "local_only"
    )
}

/// What a lost `snap/LATEST` compare-and-swap means to the caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LostCas {
    Adopt,
    Prompt,
}

enum UploadStep {
    Published,
    RemoteChanged,
}

fn millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

/// Writes the create-only `acct/<identity>/owner` binding (AD-7, Story 3's contract).
///
/// A 412 here is not a failure: another computer bound the same account between `assess`
/// reading an absent owner and this write. Re-reading and comparing the `sub` is the only
/// correct answer — the same `sub` is ordinary operation, a different one refuses.
async fn claim_owner<S, L, C, T>(
    session: &SyncSession<S, L, C, T>,
    created_ms: i64,
) -> Result<(), SyncFault>
where
    S: ObjectStore,
    L: DatasetLink,
    C: CapabilitySource,
    T: GateStateSource,
{
    let body = owner_object_body(&session.pin, created_ms);

    match session.store.put_if_absent(OWNER_OBJECT_KEY, body).await {
        Ok(_) => Ok(()),
        Err(GatedError::Store(StoreError::PreconditionFailed)) => {
            let stored = session.store.get(OWNER_OBJECT_KEY).await?;
            let owner_sub = owner_sub_from_body(&stored.bytes).map_err(SyncFault::Auth)?;

            if owner_sub == session.pin.owner_sub {
                Ok(())
            } else {
                Err(SyncFault::OwnerMismatch)
            }
        }
        Err(error) => Err(error.into()),
    }
}

/// What the handle can ask the actor to do. Every variant carries its own reply channel, so
/// a caller awaits its own answer and never a shared one.
enum SyncCommand {
    Enable {
        choice: Option<LinkChoice>,
        reply: oneshot::Sender<Result<SyncEnableOutcome, SyncFault>>,
    },
    Disable {
        persist: bool,
        reply: oneshot::Sender<()>,
    },
    AutoStart {
        reply: oneshot::Sender<()>,
    },
    Now {
        reply: oneshot::Sender<Result<(), SyncFault>>,
    },
    Diagnostics {
        reply: oneshot::Sender<SyncDiagnostics>,
    },
    ResolveRemote {
        action: RemoteChoice,
        reply: oneshot::Sender<Result<(), SyncFault>>,
    },
    FetchImage {
        project_id: i64,
        reply: oneshot::Sender<Result<ProjectImage, SyncFault>>,
    },
    Stop,
}

/// The actor's mailbox and its current status. Cloneable, and the only thing
/// `commands/sync.rs` ever holds.
#[derive(Clone)]
pub struct SyncHandle {
    dataset_id: String,
    commands: mpsc::Sender<SyncCommand>,
    status: watch::Receiver<SyncStatusPayload>,
}

impl SyncHandle {
    pub fn dataset_id(&self) -> &str {
        &self.dataset_id
    }

    /// Read from the `watch` channel rather than through the mailbox, so reading the status
    /// can never queue behind a running snapshot build (AD-16: sync never blocks the UI).
    pub fn status(&self) -> SyncStatusPayload {
        self.status.borrow().clone()
    }

    async fn request<T>(
        &self,
        make: impl FnOnce(oneshot::Sender<T>) -> SyncCommand,
    ) -> Result<T, SyncFault> {
        let (reply, answer) = oneshot::channel();
        self.commands
            .send(make(reply))
            .await
            .map_err(|_| SyncFault::ActorUnavailable)?;

        answer.await.map_err(|_| SyncFault::ActorUnavailable)
    }

    pub async fn enable(&self, choice: Option<LinkChoice>) -> Result<SyncEnableOutcome, SyncFault> {
        self.request(|reply| SyncCommand::Enable { choice, reply })
            .await?
    }

    /// The user's switch: durable, so a relaunch does not turn sync back on.
    pub async fn disable(&self) -> Result<(), SyncFault> {
        self.request(|reply| SyncCommand::Disable {
            persist: true,
            reply,
        })
        .await
    }

    /// Asks the actor to join automatically if it may. Carries no choice and no user intent, so it
    /// respects the durable switch and reports nothing the user cannot act on.
    pub async fn auto_start(&self) -> Result<(), SyncFault> {
        self.request(|reply| SyncCommand::AutoStart { reply }).await
    }

    pub async fn sync_now(&self) -> Result<(), SyncFault> {
        self.request(|reply| SyncCommand::Now { reply }).await?
    }

    pub async fn diagnostics(&self) -> Result<SyncDiagnostics, SyncFault> {
        self.request(|reply| SyncCommand::Diagnostics { reply })
            .await
    }

    pub async fn resolve_remote(&self, action: RemoteChoice) -> Result<(), SyncFault> {
        self.request(|reply| SyncCommand::ResolveRemote { action, reply })
            .await?
    }

    /// Fetches one project's full picture on demand (AD-10). It goes through the actor so the
    /// gate and the credential vend stay the single path to the cloud, and so the download cannot
    /// run while a guarded file swap has the dataset closed.
    pub async fn fetch_image(&self, project_id: i64) -> Result<ProjectImage, SyncFault> {
        self.request(|reply| SyncCommand::FetchImage { project_id, reply })
            .await?
    }

    /// Best-effort and synchronous: a dataset switch or a sign-out must not wait on an
    /// upload in flight, and a full mailbox already means the actor is alive and busy.
    pub fn stop(&self) {
        let _ = self.commands.try_send(SyncCommand::Stop);
    }
}

/// Serves the mailbox and the poll tick until `Stop` or the last sender is dropped. The
/// tick is the only driver, which is what makes a tight retry loop impossible: a fault sets
/// a backoff and returns to this `select!`.
async fn serve<H: SyncHost>(
    mut actor: SyncActor<H>,
    mut commands: mpsc::Receiver<SyncCommand>,
) {
    let poll = actor.tuning.poll_interval;

    loop {
        tokio::select! {
            command = commands.recv() => match command {
                None | Some(SyncCommand::Stop) => break,
                Some(SyncCommand::Enable { choice, reply }) => {
                    let _ = reply.send(actor.enable(choice).await);
                }
                Some(SyncCommand::Disable { persist, reply }) => {
                    actor.disable(persist).await;
                    let _ = reply.send(());
                }
                Some(SyncCommand::AutoStart { reply }) => {
                    actor.auto_start_now().await;
                    let _ = reply.send(());
                }
                Some(SyncCommand::Now { reply }) => {
                    let _ = reply.send(actor.sync_now().await);
                }
                Some(SyncCommand::Diagnostics { reply }) => {
                    let _ = reply.send(actor.diagnostics());
                }
                Some(SyncCommand::ResolveRemote { action, reply }) => {
                    let _ = reply.send(actor.resolve_remote(action).await);
                }
                Some(SyncCommand::FetchImage { project_id, reply }) => {
                    let _ = reply.send(actor.fetch_image(project_id).await);
                }
            },
            _ = tokio::time::sleep(poll) => actor.tick().await,
        }
    }

    actor.disable(false).await;
}

/// How many commands may queue before `enable`/`sync_now` wait. Small on purpose: the UI
/// issues one at a time, and a deep queue would only hide that the actor is stuck.
const COMMAND_QUEUE: usize = 8;

/// Starts the actor on a thread of its own and hands back the mailbox immediately.
///
/// A dedicated thread with a current-thread runtime, not `spawn`: the gate's
/// `CapabilitySource` and the `ObjectStore` port are `async fn`-in-trait, so futures
/// composed from them are not provably `Send` and could not be spawned onto the shared
/// runtime without `Send` bounds every fake would then have to satisfy. One thread per
/// *active* dataset is also what makes AD-11's "one extra connection" literally true, and
/// it keeps a multi-megabyte snapshot build off the runtime the UI's commands run on.
///
/// Returns before any network or database work happens, so a sync fault — or a hang — can
/// never delay launch (AD-16).
pub(crate) fn spawn<H: SyncHost + Send + 'static>(
    host: H,
    tuning: SyncTuning,
) -> std::io::Result<(SyncHandle, mpsc::UnboundedReceiver<SyncStatusPayload>)> {
    let dataset_id = host.dataset_id().to_string();
    let (commands, mailbox) = mpsc::channel(COMMAND_QUEUE);
    let (actor, status, events) = SyncActor::new(host, tuning);

    std::thread::Builder::new()
        .name(format!("nixus-sync-{dataset_id}"))
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_time()
                .enable_io()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    tracing::error!("Sync actor could not start its runtime: {error}");
                    return;
                }
            };

            runtime.block_on(serve(actor, mailbox));
        })?;

    Ok((
        SyncHandle {
            dataset_id,
            commands,
            status,
        },
        events,
    ))
}
