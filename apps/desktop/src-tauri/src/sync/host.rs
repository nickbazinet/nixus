//! The production `SyncHost`: the actor's own connection, its gate, its credentials and
//! the `DatasetSlot` that closes everything before a guarded file swap (AD-9, AD-11).
//!
//! This is the only file under `sync/` that names Tauri. Keeping it separate from
//! `manager.rs` is what lets the whole actor be driven by fakes: the actor knows a
//! `SyncHost`, and an `AppHandle` never reaches it.
//!
//! The connection is **writable**, which is a deliberate reading of AD-11 rather than a
//! slip: AD-15 names the manager as the writer of `sync_state`, and the account pin has to
//! be persisted from this connection. Nothing else is ever written through it — the data
//! tables are read by the snapshot's own `query_only` connection (Story 8) and by
//! `local_data_summary`.
//!
//! It also lives behind `Arc<Mutex<Option<Connection>>>` because AD-9 requires it to be
//! *closed* before any file swap. `None` is that closed state; it reopens on next use.

use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use tauri::{AppHandle, Manager};
use tracing::warn;

use crate::datasets;
use crate::db::backup::{local_data_summary, DatasetSlot, LocalData};
use crate::db::sync_state::{self, LinkState};
use crate::db::{data_version, open_configured, DbState};
use crate::error::AppError;
use crate::models::DatasetKind;

use super::auth::{
    CognitoIdentityVendor, CommandAuthIdTokenProvider, SyncCredentials, SystemClock,
};
use super::config::{production_bucket, IdentityPoolConfig, SYNC_REGION};
use super::gate::{AccountEntitlement, GatedStore, SyncGate};
use super::manager::{SyncFault, SyncHost, SyncSession};
use super::s3::S3ObjectStore;
use super::state::SyncStateStore;

type ProductionCredentials =
    SyncCredentials<CognitoIdentityVendor, CommandAuthIdTokenProvider, SystemClock>;

/// Closes and republishes every connection this process holds to one dataset file.
///
/// Two owners have to be handled, which is exactly why AD-9 made this a seam: the UI's
/// connection in `DbState` and the actor's own. Only the active-dataset lock is taken, and
/// never the registry lock, so AD-6's order (registry then active) cannot be inverted here.
pub struct AppDatasetSlot {
    app: AppHandle,
    own: Arc<Mutex<Option<Connection>>>,
}

/// Checkpointing before the drop is best-effort: dropping the connection checkpoints
/// anyway, and SQLite only unlinks the `-wal`/`-shm` sidecars once the last connection
/// closes. A failure here must not stop the close, or the swap could never proceed.
fn checkpoint_and_drop(conn: Connection) {
    if let Err(error) = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)") {
        warn!("Pre-swap WAL checkpoint failed, continuing: {}", error);
    }

    drop(conn);
}

impl DatasetSlot for AppDatasetSlot {
    fn close(&self) -> Result<(), AppError> {
        if let Some(conn) = self
            .own
            .lock()
            .map_err(|e| AppError::Database {
                message: e.to_string(),
            })?
            .take()
        {
            checkpoint_and_drop(conn);
        }

        let state = self.app.state::<DbState>();
        let mut active = state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;

        if let Some(conn) = active.conn.take() {
            checkpoint_and_drop(conn);
        }

        Ok(())
    }

    fn adopt(&self, conn: Connection) -> Result<(), AppError> {
        let state = self.app.state::<DbState>();
        let mut active = state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        active.conn = Some(conn);

        Ok(())
    }
}

pub struct DatasetHost {
    dataset_id: String,
    label: String,
    kind: DatasetKind,
    db_path: PathBuf,
    backup_dir: PathBuf,
    root: PathBuf,
    bucket: String,
    conn: Arc<Mutex<Option<Connection>>>,
    credentials: ProductionCredentials,
    slot: AppDatasetSlot,
}

impl DatasetHost {
    /// The host for the active dataset, or `None` when that dataset can never sync.
    ///
    /// `None` for a local profile is the structural half of inherited AD-12: no host means
    /// no actor, no thread, no client and no request — not a started actor that refuses.
    pub fn for_active_dataset(app: &AppHandle) -> Result<Option<Self>, AppError> {
        let dataset_id = datasets::active_dataset_id(&app.state::<DbState>())?;
        let root = datasets::global_root(app)?;
        let entry = datasets::load_registry(app)?
            .into_iter()
            .find(|entry| entry.id == dataset_id)
            .ok_or_else(|| AppError::Validation {
                message: format!("Unknown dataset: {}", dataset_id),
                field: Some("dataset_id".to_string()),
            })?;

        if !syncs(&entry.kind) {
            return Ok(None);
        }

        let identity_pool = IdentityPoolConfig::production().map_err(SyncFault::Auth)?;
        let bucket = production_bucket().map_err(SyncFault::Auth)?;
        let conn = Arc::new(Mutex::new(None));

        Ok(Some(Self {
            dataset_id: entry.id.clone(),
            label: entry.label,
            kind: entry.kind,
            db_path: datasets::dataset_db_path(&root, &entry.id),
            backup_dir: datasets::dataset_backup_dir(&root, &entry.id),
            root,
            bucket,
            conn: Arc::clone(&conn),
            credentials: SyncCredentials::new(
                CognitoIdentityVendor::new(&identity_pool),
                CommandAuthIdTokenProvider,
                SystemClock,
            ),
            slot: AppDatasetSlot {
                app: app.clone(),
                own: conn,
            },
        }))
    }

    /// Whether this dataset was already synced on a previous launch, which is what makes
    /// `sync_enable` a one-time action rather than something the user repeats every start.
    /// A pin is the record of that: it is written the first time sync is enabled and is
    /// carried by backup, restore and the guarded swap because it lives in the file.
    pub fn resume_wanted(&self) -> bool {
        self.with_conn(sync_state::load)
            .ok()
            .flatten()
            .is_some_and(|state| matches!(state.link_state, LinkState::Linked))
    }

    fn with_conn<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, AppError>,
    ) -> Result<T, SyncFault> {
        let mut guard = self.conn.lock().map_err(|_| SyncFault::StateUnavailable)?;

        if guard.is_none() {
            *guard = Some(open_configured(&self.db_path).map_err(|_| SyncFault::StateUnavailable)?);
        }

        let conn = guard.as_ref().ok_or(SyncFault::StateUnavailable)?;

        operation(conn).map_err(|_| SyncFault::StateUnavailable)
    }

    fn pins(&self) -> Result<SyncStateStore, SyncFault> {
        // The connection is opened here rather than in the constructor so that a dataset
        // whose actor never gets as far as a gate check never opens a second handle to the
        // file — which is also what keeps a failed launch impossible (AD-16).
        self.with_conn(|_| Ok(()))?;

        SyncStateStore::for_dataset(self.kind.clone(), Arc::clone(&self.conn)).ok_or(SyncFault::Blocked(
            super::gate::SyncBlocked::LocalOnlyDataset,
        ))
    }

    fn gate(&self) -> Result<SyncGate<DatasetKind, AccountEntitlement, SyncStateStore>, SyncFault> {
        Ok(SyncGate::new(
            self.kind.clone(),
            AccountEntitlement,
            self.pins()?,
        ))
    }
}

impl SyncHost for DatasetHost {
    type Store = S3ObjectStore;
    type Link = DatasetKind;
    type Caps = AccountEntitlement;
    type GateState = SyncStateStore;
    type Slot = AppDatasetSlot;

    fn dataset_id(&self) -> &str {
        &self.dataset_id
    }

    fn db_path(&self) -> &Path {
        &self.db_path
    }

    fn backup_dir(&self) -> &Path {
        &self.backup_dir
    }

    fn root(&self) -> &Path {
        &self.root
    }

    fn label(&self) -> &str {
        &self.label
    }

    fn schema_version(&self) -> u32 {
        u32::try_from(crate::db::latest_schema_version()).unwrap_or(u32::MAX)
    }

    fn now_ms(&self) -> i64 {
        chrono::Utc::now().timestamp_millis()
    }

    fn data_version(&self) -> Result<i64, SyncFault> {
        self.with_conn(data_version)
    }

    fn local_data(&self) -> Result<LocalData, SyncFault> {
        self.with_conn(local_data_summary)
    }

    fn slot(&self) -> &Self::Slot {
        &self.slot
    }

    fn freeze(&self, reason: sync_state::FrozenReason) {
        if let Ok(pins) = self.pins() {
            if let Err(error) = pins.set_frozen_reason(Some(reason)) {
                warn!("Sync could not record that transfers are stopped: {}", error);
            }
        }
    }

    fn forget_credentials(&self) -> Pin<Box<dyn std::future::Future<Output = ()> + '_>> {
        Box::pin(self.credentials.forget())
    }

    fn release(&self) {
        if let Ok(mut guard) = self.conn.lock() {
            if let Some(conn) = guard.take() {
                checkpoint_and_drop(conn);
            }
        }
    }

    fn connect(
        &self,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<SyncSession<S3ObjectStore, DatasetKind, AccountEntitlement, SyncStateStore>, SyncFault>> + '_>>
    {
        Box::pin(async move {
            // AD-4: the install identity is minted here, and re-minted when the stored
            // machine fingerprint no longer describes this computer. It precedes the gate
            // because a dataset with no `sync_state` row has no pin for the gate to check.
            self.pins()?.ensure_install().map_err(SyncFault::Auth)?;

            let gate = self.gate()?;
            gate.check(None).await.map_err(SyncFault::Blocked)?;

            let vended = gate.vend(&self.credentials, &self.pins()?).await?;
            let store = S3ObjectStore::for_vend(&vended, SYNC_REGION, &self.bucket);

            Ok(SyncSession {
                store: GatedStore::new(store, self.gate()?),
                pin: vended.pin(),
            })
        })
    }
}

/// Whether a profile of this kind may sync at all (inherited AD-12).
///
/// Split out of `for_active_dataset` so the decision is testable without a running Tauri
/// app — which is the only way the "a local profile starts no actor" claim gets a test at
/// the production level rather than only through a fake.
fn syncs(kind: &DatasetKind) -> bool {
    matches!(kind, DatasetKind::CloudLinked)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_cloud_linked_profile_gets_an_actor() {
        assert!(syncs(&DatasetKind::CloudLinked));
        assert!(
            !syncs(&DatasetKind::Local),
            "a local profile must start no actor, no client and no request"
        );
    }
}
