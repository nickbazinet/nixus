//! New-computer bootstrap, the CAP-5 link choice, and the CAP-2 budget (AD-9, AD-15).
//!
//! The shape of a bootstrap is: prove who owns the account prefix, find the current
//! snapshot, download and verify it, and hand the database bytes to `db::backup`'s guarded
//! swap. Four rules shape every line below.
//!
//! 1. **No SQL here.** The restore sequence and everything it has to know about SQLite
//!    lives in `db/backup.rs`, which is where AD-9 puts it and what CAP-5 names. This file
//!    orchestrates; it does not open a database.
//! 2. **Nothing is decided without the owner object.** An absent `owner` means no computer
//!    has ever enabled sync for this account, which is a *first enable* and not a
//!    bootstrap: there is nothing to download and this computer's data is the seed.
//!    An owner holding a different `sub` refuses outright (AD-7).
//! 3. **A dataset that already holds data never loses it silently.** It either keeps a
//!    dated backup (*replace*) or stays exactly as it is (*separate*), and the choice is
//!    returned to the caller rather than guessed at here.
//! 4. **The active-dataset lock is never taken.** Closing and republishing connections is
//!    the `DatasetSlot` seam, and activating a newly provisioned dataset is
//!    `select_dataset_now`'s job — so the registry lock is always released before anything
//!    touches the active dataset (AD-6's lock order: registry then active).

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::db::backup::{
    restore_snapshot_file, DatasetSlot, LocalData, SwapFailed, SwapReport, UnopenedDataset,
};
use crate::models::Dataset;

use super::auth::{AccountPin, AuthError};
use super::gate::{
    CapabilitySource, DatasetLink, GateStateSource, GatedError, GatedStore, SyncBlocked,
};
use super::owner::{owner_sub_from_body, OWNER_OBJECT_KEY};
use super::snapshot::{fetch_latest, read_snapshot, LatestSnapshot, SnapshotError};
use super::store::{ETag, ObjectStore, StoreError};

/// CAP-2's link budget: "usable within 5 s on a 10 Mbps connection".
// Read by the CAP-2 timing gate and by Story 12's new-computer proof; Milestone 1's
// production path measures nothing.
#[allow(dead_code)]
pub const CAP2_BUDGET: Duration = Duration::from_secs(5);

/// 10 Mbps expressed as bytes per second, which is the unit the object store throttles in.
#[allow(dead_code)] // Same: the CAP-2 gate and Story 12's proof.
pub const CAP2_BYTES_PER_SECOND: u64 = 1_250_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BootstrapError {
    /// This dataset may not sync at all (local-only, un-entitled, Frozen, pin mismatch).
    /// Not a fault: it is the state of the dataset, and no byte was transferred.
    Blocked(SyncBlocked),
    Store(StoreError),
    Auth(AuthError),
    /// The account prefix is owned by a different user-pool `sub` (AD-7). Never repaired
    /// automatically: continuing would mean two accounts writing one source of truth.
    OwnerMismatch,
    Snapshot(SnapshotError),
    /// The snapshot was written by a newer build. Refused, never applied (AD-11, CAP-7).
    SnapshotTooNew { found: u32, supported: u32 },
    /// The guarded swap failed. Carries the stage and whether the dataset was rolled back.
    Swap(SwapFailed),
    /// The separate dataset could not be provisioned, so nothing was restored and the
    /// existing dataset is untouched.
    Registry,
    /// AD-18: an object the bootstrap was about to write exceeds its size cap.
    TooLarge(crate::sync::limits::Oversize),
}

impl From<GatedError> for BootstrapError {
    fn from(error: GatedError) -> Self {
        match error {
            GatedError::Blocked(blocked) => BootstrapError::Blocked(blocked),
            GatedError::Store(error) => BootstrapError::Store(error),
            GatedError::Auth(error) => BootstrapError::Auth(error),
            GatedError::TooLarge(oversize) => BootstrapError::TooLarge(oversize),
        }
    }
}

impl From<SnapshotError> for BootstrapError {
    fn from(error: SnapshotError) -> Self {
        match error {
            SnapshotError::SchemaTooNew { found, supported } => {
                BootstrapError::SnapshotTooNew { found, supported }
            }
            SnapshotError::Store(error) => BootstrapError::from(error),
            other => BootstrapError::Snapshot(other),
        }
    }
}

impl From<SwapFailed> for BootstrapError {
    fn from(failure: SwapFailed) -> Self {
        BootstrapError::Swap(failure)
    }
}

impl std::fmt::Display for BootstrapError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            BootstrapError::Blocked(blocked) => write!(f, "sync is not available: {blocked:?}"),
            BootstrapError::Store(error) => write!(f, "bootstrap transfer: {error:?}"),
            BootstrapError::Auth(error) => write!(f, "bootstrap identity: {error}"),
            BootstrapError::OwnerMismatch => {
                f.write_str("the cloud copy belongs to a different account")
            }
            BootstrapError::Snapshot(error) => write!(f, "bootstrap snapshot: {error}"),
            BootstrapError::SnapshotTooNew { found, supported } => {
                write!(f, "the cloud copy needs schema {found}, this build has {supported}")
            }
            BootstrapError::Swap(failure) => write!(f, "bootstrap restore: {failure}"),
            BootstrapError::Registry => f.write_str("the separate profile could not be created"),
            BootstrapError::TooLarge(oversize) => write!(f, "bootstrap upload: {oversize}"),
        }
    }
}

impl std::error::Error for BootstrapError {}

/// What this computer should do, decided before anything is downloaded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BootstrapPlan {
    /// No `owner` object: this account has never enabled sync, so this computer is the
    /// first one and its own data is the seed (AD-9). Story 10 uploads instead.
    FirstEnable,
    /// The owner exists but no snapshot has been published yet — another computer created
    /// the binding and has not finished its initial upload.
    NoSnapshot,
    /// The local dataset holds no user data, so the cloud copy can be restored without
    /// asking anything.
    Restore { latest: LatestSnapshot, etag: ETag },
    /// CAP-5: this computer already has data, so the outcome is the user's to choose.
    ChoiceRequired {
        latest: LatestSnapshot,
        etag: ETag,
        local: LocalData,
    },
}

/// CAP-5's two outcomes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkChoice {
    /// Load the cloud copy here, keeping the current file as a dated backup.
    Replace,
    /// Keep the current dataset exactly as it is and put the cloud copy in a profile of
    /// its own.
    Separate,
}

/// Where a restore happens and where its dated backup goes.
pub struct RestoreTarget<'a> {
    pub db_path: &'a Path,
    /// `None` restores without keeping a dated copy, which is only ever correct for a
    /// dataset that holds no user data (there is nothing to back up).
    pub dated_backup_dir: Option<&'a Path>,
}

/// What a bootstrap did, in counts and durations (AD-16: never values).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootstrapReport {
    pub snap_id: String,
    pub schema_version: u32,
    /// Whether the snapshot was older than this build and had migrations applied to it.
    pub migrated: bool,
    pub object_bytes: usize,
    pub payload_bytes: usize,
    pub swap: SwapReport,
}

/// What the link choice produced.
#[derive(Debug, Clone, PartialEq)]
pub enum LinkOutcome {
    /// The cloud copy is now this dataset, and the old file is at `dated_backup`.
    Replaced { report: BootstrapReport },
    /// The existing dataset was left untouched and the cloud copy is in `dataset`.
    ///
    /// Deliberately **not** activated here: making it the active dataset is
    /// `commands::datasets::select_dataset_now`'s job, which is what keeps one hot-swap
    /// path and one `dataset:switched` emitter (AD-6). Returning the entry rather than
    /// switching also means the registry lock is long released by the time anything takes
    /// the active-dataset lock.
    Separated {
        dataset: Dataset,
        report: BootstrapReport,
    },
}

/// Verifies the owner, reads `snap/LATEST`, and decides what this computer should do.
///
/// `observed` is the account the caller has just obtained credentials for; `local` is the
/// summary `db::backup::local_data_summary` produced for the dataset about to be linked.
/// Both travel in rather than being read here: this file opens no database and vends no
/// credential, which is what keeps the gate the only path to the network.
pub async fn assess<S, L, C, T>(
    store: &GatedStore<S, super::gate::SyncGate<L, C, T>>,
    observed: &AccountPin,
    local: &LocalData,
) -> Result<BootstrapPlan, BootstrapError>
where
    S: ObjectStore,
    L: DatasetLink,
    C: CapabilitySource,
    T: GateStateSource,
{
    match store.get(OWNER_OBJECT_KEY).await {
        Ok(stored) => {
            let owner_sub = owner_sub_from_body(&stored.bytes).map_err(BootstrapError::Auth)?;
            if owner_sub != observed.owner_sub {
                return Err(BootstrapError::OwnerMismatch);
            }
        }
        Err(GatedError::Store(StoreError::NotFound)) => return Ok(BootstrapPlan::FirstEnable),
        Err(error) => return Err(error.into()),
    }

    let Some((latest, etag)) = fetch_latest(store).await? else {
        return Ok(BootstrapPlan::NoSnapshot);
    };

    // Refused here rather than after the download: the pointer carries the version that
    // produced the snapshot, so an object this build cannot apply costs no bandwidth to
    // turn down (AD-11, CAP-7). `read_snapshot` checks the header again regardless, since
    // the pointer is another computer's claim about the object, not the object.
    let supported = u32::try_from(crate::db::latest_schema_version()).unwrap_or(u32::MAX);
    if latest.schema_version > supported {
        return Err(BootstrapError::SnapshotTooNew {
            found: latest.schema_version,
            supported,
        });
    }

    if local.is_empty() {
        return Ok(BootstrapPlan::Restore { latest, etag });
    }

    Ok(BootstrapPlan::ChoiceRequired {
        latest,
        etag,
        local: local.clone(),
    })
}

/// Downloads the snapshot `latest` points at, verifies it, and restores it into `target`.
///
/// `slot` is what closes the dataset's connections before the swap and takes the restored
/// one afterwards (AD-9). `UnopenedDataset` is the right slot when nothing has the target
/// open, which is the *separate* branch below.
pub async fn restore_latest<S, L, C, T>(
    store: &GatedStore<S, super::gate::SyncGate<L, C, T>>,
    latest: &LatestSnapshot,
    target: &RestoreTarget<'_>,
    slot: &impl DatasetSlot,
) -> Result<BootstrapReport, BootstrapError>
where
    S: ObjectStore,
    L: DatasetLink,
    C: CapabilitySource,
    T: GateStateSource,
{
    let object = store.get(&latest.snapshot_key()?).await?;
    let object_bytes = object.bytes.len();

    let verified = read_snapshot(&object.bytes)?;
    // The pointer's hash is a second, independent claim about which snapshot this is: the
    // header proves the payload has not been altered, and this proves it is the payload
    // `snap/LATEST` named. A mirror or a cache serving a *valid older* snapshot would pass
    // the first check and fail this one.
    if verified.payload_sha256 != latest.hash {
        return Err(BootstrapError::Snapshot(SnapshotError::HashMismatch {
            expected: latest.hash.clone(),
            found: verified.payload_sha256,
        }));
    }

    let supported = u32::try_from(crate::db::latest_schema_version()).unwrap_or(u32::MAX);
    let swap = restore_snapshot_file(
        slot,
        target.db_path,
        &verified.payload,
        target.dated_backup_dir,
    )?;

    Ok(BootstrapReport {
        snap_id: latest.snap_id.clone(),
        schema_version: verified.schema_version,
        migrated: verified.schema_version < supported,
        object_bytes,
        payload_bytes: verified.payload.len(),
        swap,
    })
}

/// Everything the *separate* branch needs to provision a profile of its own.
pub struct SeparateContext<'a> {
    /// The app data root, which owns the registry (AD-3).
    pub root: &'a Path,
    /// The dataset being kept as it is, recorded as the new profile's provenance.
    pub kept_dataset_id: &'a str,
    pub owner_sub: &'a str,
    pub label: &'a str,
}

/// Applies CAP-5's choice.
///
/// *Replace* swaps the cloud copy into the dataset at `target` and keeps the old file as a
/// dated backup — the backup directory is therefore **required** here, because this is the
/// branch that displaces data.
///
/// *Separate* provisions a second cloud-linked profile and restores into that one. The
/// dataset at `target` is never opened for writing on this path, so its file is left byte
/// for byte as it was; `most_recent_for_sub` makes the new profile the one a later sign-in
/// opens, which is what keeps the old data unsynced without a registry `kind` change the
/// model does not have.
pub async fn apply_choice<S, L, C, T>(
    store: &GatedStore<S, super::gate::SyncGate<L, C, T>>,
    latest: &LatestSnapshot,
    choice: LinkChoice,
    target: &ReplaceTarget<'_>,
    separate: &SeparateContext<'_>,
    slot: &impl DatasetSlot,
) -> Result<LinkOutcome, BootstrapError>
where
    S: ObjectStore,
    L: DatasetLink,
    C: CapabilitySource,
    T: GateStateSource,
{
    match choice {
        LinkChoice::Replace => {
            let report = restore_latest(
                store,
                latest,
                &RestoreTarget {
                    db_path: target.db_path,
                    dated_backup_dir: Some(target.dated_backup_dir),
                },
                slot,
            )
            .await?;

            Ok(LinkOutcome::Replaced { report })
        }
        LinkChoice::Separate => {
            // Provisioned before the download so a failure to create the profile costs
            // nothing and, more importantly, leaves the kept dataset untouched. The call
            // takes and releases the registry lock on its own (AD-6's lock order).
            let dataset = crate::datasets::create_cloud_dataset_at(
                separate.root,
                separate.owner_sub,
                separate.label,
                Some(separate.kept_dataset_id),
            )
            .map_err(|_| BootstrapError::Registry)?;

            let db_path = crate::datasets::dataset_db_path(separate.root, &dataset.id);
            let report = restore_latest(
                store,
                latest,
                &RestoreTarget {
                    db_path: &db_path,
                    // The profile was created empty a moment ago, so there is no data to
                    // keep a dated copy of.
                    dated_backup_dir: None,
                },
                &UnopenedDataset,
            )
            .await?;

            Ok(LinkOutcome::Separated { dataset, report })
        }
    }
}

/// The dataset *replace* displaces, and where its dated backup goes.
pub struct ReplaceTarget<'a> {
    pub db_path: &'a Path,
    pub dated_backup_dir: &'a Path,
}

/// CAP-2's measurement, split the way the capability is stated: a network leg modelled
/// from the object size at 10 Mbps, and a real measured CPU/disk leg.
///
/// The split is what makes the gate meaningful on a CI runner. The network leg of "5 s at
/// 10 Mbps" is a property of the object's *size*, which is deterministic, so modelling it
/// measures the thing CAP-2 claims instead of measuring the test machine's loopback. The
/// rest — verify, decompress, write, migrate, reopen — is real work on a real disk and is
/// timed as such.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)] // Constructed by `measure_link`, which the CAP-2 gate drives.
pub struct LinkBudget {
    pub transferred_bytes: u64,
    pub measured: Duration,
}

#[allow(dead_code)] // Read by the CAP-2 gate and by Story 12's proof.
impl LinkBudget {
    pub fn network_model(&self) -> Duration {
        Duration::from_secs_f64(self.transferred_bytes as f64 / CAP2_BYTES_PER_SECOND as f64)
    }

    pub fn model_total(&self) -> Duration {
        self.network_model() + self.measured
    }

    pub fn within_budget(&self) -> bool {
        self.model_total() <= CAP2_BUDGET
    }

    pub fn breakdown(&self) -> String {
        format!(
            "CAP-2: {} B over the wire = {:.3} s modelled at 10 Mbps + {:.3} s measured \
             (CPU/disk) = {:.3} s of a {:.3} s budget",
            self.transferred_bytes,
            self.network_model().as_secs_f64(),
            self.measured.as_secs_f64(),
            self.model_total().as_secs_f64(),
            CAP2_BUDGET.as_secs_f64()
        )
    }
}

/// Times `work` and pairs the real elapsed time with the bytes that crossed the wire.
///
/// **Requires the store's throttle to run under paused (virtual) time.** That is what makes
/// the split sound rather than approximate: a virtual `sleep` consumes no real time, so the
/// real wall clock across the whole call is exactly the CPU/disk leg, and the network leg is
/// added from the object's size at 10 Mbps. Measuring a real network here instead would turn
/// a CAP-2 gate into a measurement of the test machine's loopback.
///
/// `transferred` is read after the work finishes rather than taken from the report, so a
/// bootstrap that moved more bytes than expected is counted honestly.
#[allow(dead_code)] // The CAP-2 timing gate is its only caller until Story 12.
pub async fn measure_link<F, T, E>(
    work: F,
    transferred: impl FnOnce() -> u64,
) -> (Result<T, E>, LinkBudget)
where
    F: std::future::Future<Output = Result<T, E>>,
{
    let started = Instant::now();
    let outcome = work.await;
    let measured = started.elapsed();

    (
        outcome,
        LinkBudget {
            transferred_bytes: transferred(),
            measured,
        },
    )
}

/// The file names the guarded swap owns, so a caller can clean up or recognise them.
#[allow(dead_code)] // Story 12's proof cleans up with it; nothing in M1 needs the names.
pub fn scratch_paths(db_path: &Path) -> (PathBuf, PathBuf) {
    (
        crate::db::backup::with_suffix(db_path, crate::db::backup::INCOMING_SUFFIX),
        crate::db::backup::with_suffix(db_path, crate::db::backup::BOOTSTRAP_SAFETY_SUFFIX),
    )
}
