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

use std::collections::VecDeque;
use std::path::Path;
use std::pin::Pin;
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
use super::owner::{owner_object_body, owner_sub_from_body, OWNER_OBJECT_KEY};
use super::segment::{self, Applier, Head, PollReport, PullCursor, SegmentError};
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
        }
    }
}

impl From<SnapshotError> for SyncFault {
    fn from(error: SnapshotError) -> Self {
        match error {
            SnapshotError::Store(error) => SyncFault::from(error),
            other => SyncFault::Snapshot(other),
        }
    }
}

impl From<BlobError> for SyncFault {
    fn from(error: BlobError) -> Self {
        match error {
            BlobError::Store(error) => SyncFault::from(error),
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
    conflicts: u64,
    restores: u64,
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
        let initial = SyncStatusPayload {
            state: SyncState::Unlinked,
            dataset_id: host.dataset_id().to_string(),
            enabled: false,
            last_sync_ms: None,
            error_code: None,
            recoverable: true,
            prompt: None,
        };
        let (status, status_rx) = watch::channel(initial);
        let (events, events_rx) = mpsc::unbounded_channel();

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
        };

        (actor, status_rx, events_rx)
    }

    pub(in crate::sync) fn status(&self) -> SyncStatusPayload {
        SyncStatusPayload {
            state: self.state,
            dataset_id: self.host.dataset_id().to_string(),
            enabled: self.enabled,
            last_sync_ms: self.last_sync_ms,
            error_code: self.last_error.map(str::to_string),
            recoverable: self.recoverable,
            prompt: self.pending.as_ref().map(PendingDecision::prompt),
        }
    }

    /// The pull cursor, so a test can assert what is buffered, what is owed, and arrange the one
    /// state the protocol cannot produce by itself: a head re-read after it was already consumed.
    #[cfg(test)]
    pub(in crate::sync) fn pull(&mut self) -> &mut super::segment::PullCursor {
        &mut self.pull
    }

    pub(in crate::sync) fn diagnostics(&self) -> SyncDiagnostics {
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

    pub(in crate::sync) async fn enable(
        &mut self,
        choice: Option<LinkChoice>,
    ) -> Result<SyncEnableOutcome, SyncFault> {
        self.publish(SyncState::Syncing);

        match self.enable_inner(choice).await {
            Ok(outcome) => {
                match &outcome {
                    SyncEnableOutcome::Enabled { .. } => {
                        self.enabled = true;
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
                        self.clear_error();
                        self.publish(SyncState::Unlinked);
                    }
                }

                Ok(outcome)
            }
            Err(fault) => {
                self.record_fault(&fault);
                Err(fault)
            }
        }
    }

    async fn enable_inner(
        &mut self,
        choice: Option<LinkChoice>,
    ) -> Result<SyncEnableOutcome, SyncFault> {
        let session = self.host.connect().await?;
        let local = self.host.local_data()?;
        let plan = bootstrap::assess(&session.store, &session.pin, &local).await?;

        match plan {
            BootstrapPlan::FirstEnable => {
                claim_owner(&session, self.host.now_ms()).await?;
                self.publish_snapshot(&session, None).await
            }
            BootstrapPlan::NoSnapshot => self.publish_snapshot(&session, None).await,
            BootstrapPlan::Restore { latest, etag } => {
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

    async fn apply_link_choice(
        &mut self,
        session: &HostSession<H>,
        latest: &LatestSnapshot,
        etag: ETag,
        choice: LinkChoice,
    ) -> Result<SyncEnableOutcome, SyncFault> {
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

        match outcome {
            LinkOutcome::Replaced { report } => {
                self.stats.last_object_bytes = Some(report.object_bytes);
                self.stats.last_payload_bytes = Some(report.payload_bytes);
                self.known_latest = Some(etag);
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
    ) -> Result<SyncEnableOutcome, SyncFault> {
        let state = match self.upload(session, known_latest).await? {
            UploadStep::Published => SyncState::Idle,
            UploadStep::RemoteChanged => SyncState::RemoteChanged,
        };

        Ok(SyncEnableOutcome::Enabled { state })
    }

    async fn upload(
        &mut self,
        session: &HostSession<H>,
        known_latest: Option<&ETag>,
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
                self.pending = None;

                Ok(UploadStep::Published)
            }
            UploadOutcome::RemoteChanged {
                theirs, their_etag, ..
            } => {
                self.stats.conflicts += 1;
                self.pending = Some(PendingDecision::RemoteChanged { theirs, their_etag });

                Ok(UploadStep::RemoteChanged)
            }
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
        let install = self.install()?;

        if ship_due {
            self.last_segment_ship = Some(Instant::now());
            self.ship_log(&session, &install).await?;
        }
        if poll_due {
            self.last_remote_poll = Some(Instant::now());
            self.poll_remote(&session, &install).await?;
        }

        Ok(())
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
            &mut report,
        )
        .await?;

        self.stats.segments_fetched += report.segments_fetched;
        self.stats.messages_received += report.messages_applied;

        Ok(())
    }

    /// One poll: read the change signal, and upload if the dataset has settled.
    pub(in crate::sync) async fn tick(&mut self) {
        if !self.enabled || self.pending.is_some() {
            return;
        }

        if let Some(backoff) = &self.backoff {
            if Instant::now() < backoff.until {
                return;
            }
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
        match self.upload(&session, known.as_ref()).await {
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

    pub(in crate::sync) async fn disable(&mut self) {
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

    pub async fn disable(&self) -> Result<(), SyncFault> {
        self.request(|reply| SyncCommand::Disable { reply }).await
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
                Some(SyncCommand::Disable { reply }) => {
                    actor.disable().await;
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

    actor.disable().await;
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
