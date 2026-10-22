//! The `AccountPinStore` implementation (Story 5's seam) and the install identity, both
//! over the dataset's own `sync_state` row (AD-4, AD-15).
//!
//! The connection arrives behind an `Arc<Mutex<Option<_>>>` rather than as a borrow.
//! `Connection` is `Send` but not `Sync`, so a `&Connection` held by this store would make
//! every future that touches it `!Send`. The `Option` is what AD-9 needs: the manager's own
//! connection has to be *closed* before a file swap, and `None` is that closed state — a
//! state read through a closed connection is `StateUnavailable`, which the gate already
//! treats as "prove nothing, allow nothing". The lock is taken for exactly one statement
//! and never across an `.await`.

use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::db::sync_state;
use crate::error::AppError;
use crate::models::DatasetKind;

use super::auth::{verify_account_pin, AccountPin, AccountPinStore, AuthError};
use super::clock::{machine_fingerprint, new_install_id, MachineSignals};

/// What `ensure_install` concluded about the machine this dataset is opening on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallOutcome {
    /// The row already existed and its fingerprint still describes this machine.
    Unchanged,
    /// The row did not exist: this dataset has just been given its install id.
    Created,
    /// The stored fingerprint describes a different machine, so the database was copied
    /// here. A new install id was minted and the dataset is now unlinked (AD-4, AD-9).
    Relinked,
}

/// The dataset's sync state, as the `AccountPinStore` the credential vendor needs.
pub struct SyncStateStore {
    conn: Arc<Mutex<Option<Connection>>>,
}

impl SyncStateStore {
    /// The store for a dataset, or `None` when that dataset is not cloud-linked.
    ///
    /// `None` is what makes inherited AD-12 structural rather than a rule to remember: a
    /// local-only dataset cannot produce a store, so it cannot produce a pin, a gate that
    /// passes, or a `sync_state` row. Nothing about sync runs for it.
    pub fn for_dataset(kind: DatasetKind, conn: Arc<Mutex<Option<Connection>>>) -> Option<Self> {
        match kind {
            DatasetKind::Local => None,
            DatasetKind::CloudLinked => Some(Self { conn }),
        }
    }

    fn with_conn<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, crate::error::AppError>,
    ) -> Result<T, AuthError> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| AuthError::StateUnavailable)?;
        let conn = guard.as_ref().ok_or(AuthError::StateUnavailable)?;

        operation(conn).map_err(|_| AuthError::StateUnavailable)
    }

    /// Reads the row, creating or re-minting the install identity as AD-4 requires.
    pub fn ensure_install(&self) -> Result<InstallOutcome, AuthError> {
        self.with_conn(|conn| ensure_install_outcome(conn).map(|(_, outcome)| outcome))
    }

    /// The row's frozen reason, and whether a pin has been recorded — everything the gate
    /// needs, read once so a check cannot see half of one state and half of another.
    pub fn gate_state(&self) -> Result<GateState, AuthError> {
        self.with_conn(|conn| {
            let Some(state) = sync_state::load(conn)? else {
                return Ok(GateState {
                    pin: None,
                    frozen_reason: None,
                });
            };

            Ok(GateState {
                pin: state
                    .identity_id
                    .zip(state.owner_sub)
                    .map(|(identity_id, owner_sub)| AccountPin::new(identity_id, owner_sub)),
                frozen_reason: state.frozen_reason,
            })
        })
    }

    /// Freezes (`Some`) or resumes (`None`) transfers (AD-14, CAP-8).
    pub fn set_frozen_reason(
        &self,
        reason: Option<sync_state::FrozenReason>,
    ) -> Result<(), AuthError> {
        self.with_conn(|conn| sync_state::set_frozen_reason(conn, reason))
    }
}

/// The dataset's install identity, created or re-minted as AD-4 requires.
///
/// The fingerprint comparison lives here rather than in `db/` because the decision is a sync rule,
/// not a storage one: a stored fingerprint that no longer matches means the `.db` file was copied
/// to another computer, and continuing to append under the old install id would let two machines
/// share one `(install, seq)` space.
///
/// A free function over a bare `&Connection` because there are now TWO callers that must reach the
/// same conclusion — the credential vendor's store and `sync::capture`, which stamps every message
/// with this install id. Whichever runs first settles it; the other sees `Unchanged`.
pub fn ensure_install_on(conn: &Connection) -> Result<sync_state::SyncState, AppError> {
    ensure_install_outcome(conn).map(|(state, _)| state)
}

/// Re-mints the install identity unconditionally, for a dataset file that was just REPLACED or
/// COPIED (a backup restore, a backup import, a dataset copy — AD-4, AD-9).
///
/// Separate from `ensure_install_on` because the fingerprint comparison cannot answer this case:
/// a file copied into a second dataset directory on the SAME computer carries a fingerprint that
/// still matches, so `ensure_install_on` reports `Unchanged` and two live datasets would append
/// under one `(install, seq)` space — the exact thing AD-15 forbids. The caller knows a copy
/// happened; the file cannot. The pin is KEPT (a copy is almost always the same user, Story 6)
/// and the dataset is left Unlinked, so the next enable goes through the CAP-5 choice.
///
/// The JOIN MARKER is cleared here and ONLY here (story wipe-epoch). `ensure_install_outcome`
/// below reaches `relink_install` on mere fingerprint drift — a renamed computer, a missing host
/// environment variable — and a healthy synced dataset must not be turned into an unjoined one by
/// that: it would re-assess, raise CAP-5's question, and `replace` would drop its unsent edits.
/// Here the caller knows the file is a copy, so "it has not joined under this install id" is
/// simply true, and it is what makes the CAP-5 choice happen and what keeps an imported backup
/// out of the wipe epoch's self-wipe.
pub fn remint_install_on(conn: &Connection) -> Result<InstallOutcome, AppError> {
    let fingerprint = machine_fingerprint(&MachineSignals::from_environment());

    if sync_state::load(conn)?.is_none() {
        sync_state::ensure(conn, &new_install_id(), &fingerprint)?;
        return Ok(InstallOutcome::Created);
    }

    sync_state::relink_install(conn, &new_install_id(), &fingerprint)?;
    sync_state::clear_joined_at(conn)?;

    Ok(InstallOutcome::Relinked)
}

fn ensure_install_outcome(
    conn: &Connection,
) -> Result<(sync_state::SyncState, InstallOutcome), AppError> {
    let fingerprint = machine_fingerprint(&MachineSignals::from_environment());

    let Some(state) = sync_state::load(conn)? else {
        let created = sync_state::ensure(conn, &new_install_id(), &fingerprint)?;
        return Ok((created, InstallOutcome::Created));
    };

    if state.machine_fingerprint == fingerprint {
        return Ok((state, InstallOutcome::Unchanged));
    }

    sync_state::relink_install(conn, &new_install_id(), &fingerprint)?;
    let relinked = sync_state::load(conn)?.ok_or_else(|| AppError::Database {
        message: "the sync_state row vanished immediately after it was relinked".to_string(),
    })?;

    Ok((relinked, InstallOutcome::Relinked))
}

/// The slice of `sync_state` a gate decision is made from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GateState {
    pub pin: Option<AccountPin>,
    pub frozen_reason: Option<sync_state::FrozenReason>,
}

impl AccountPinStore for SyncStateStore {
    fn load(&self) -> Result<Option<AccountPin>, AuthError> {
        Ok(self.gate_state()?.pin)
    }

    /// Writes the pin, refusing an overwrite that would change the account.
    ///
    /// `verify_account_pin` is re-applied here even though `current_pinned` already
    /// called it: this is the function that actually persists, so making it the authority
    /// is what stops a later caller — or a retry that re-read the row in between — from
    /// silently rebinding a linked dataset to a different account. Re-storing an
    /// identical pin is a no-op write rather than a conflict, so the path stays idempotent.
    fn store(&self, pin: &AccountPin) -> Result<(), AuthError> {
        let stored = self.load()?;
        verify_account_pin(stored.as_ref(), pin).map_err(AuthError::PinMismatch)?;

        self.with_conn(|conn| sync_state::set_pin(conn, &pin.identity_id, &pin.owner_sub))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::run_migrations;
    use crate::sync::auth::PinField;

    fn store() -> SyncStateStore {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable fks");
        run_migrations(&conn).expect("run migrations");

        SyncStateStore::for_dataset(DatasetKind::CloudLinked, Arc::new(Mutex::new(Some(conn))))
            .expect("a cloud-linked dataset has a store")
    }

    fn row_count(store: &SyncStateStore) -> i64 {
        store
            .conn
            .lock()
            .expect("lock")
            .as_ref()
            .expect("the connection is open")
            .query_row("SELECT COUNT(*) FROM sync_state", [], |r| r.get(0))
            .expect("count")
    }

    #[test]
    fn a_closed_connection_reports_the_state_as_unavailable_rather_than_as_absent() {
        let store = store();
        store.ensure_install().expect("the install identity is minted");

        // What AD-9 does before a file swap: the manager's own connection is released.
        *store.conn.lock().expect("lock") = None;

        assert_eq!(store.gate_state(), Err(AuthError::StateUnavailable));
        assert_eq!(store.load(), Err(AuthError::StateUnavailable));
        assert_eq!(
            store.ensure_install(),
            Err(AuthError::StateUnavailable),
            "a closed dataset must never read as one that has no install identity"
        );
    }

    #[test]
    fn a_local_only_dataset_has_no_store_at_all() {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        run_migrations(&conn).expect("run migrations");
        let shared = Arc::new(Mutex::new(Some(conn)));

        assert!(SyncStateStore::for_dataset(DatasetKind::Local, Arc::clone(&shared)).is_none());

        let rows: i64 = shared
            .lock()
            .expect("lock")
            .as_ref()
            .expect("the connection is open")
            .query_row("SELECT COUNT(*) FROM sync_state", [], |r| r.get(0))
            .expect("count");
        assert_eq!(rows, 0, "a local-only dataset must create no sync state");
    }

    #[test]
    fn the_install_identity_is_minted_once_and_then_left_alone() {
        let store = store();

        assert_eq!(
            store.ensure_install().expect("first ensure"),
            InstallOutcome::Created
        );
        let first = store
            .with_conn(sync_state::load)
            .expect("load")
            .expect("row exists");

        assert_eq!(
            store.ensure_install().expect("second ensure"),
            InstallOutcome::Unchanged
        );
        let second = store
            .with_conn(sync_state::load)
            .expect("load")
            .expect("row exists");

        assert_eq!(first.install_id, second.install_id);
        assert_eq!(row_count(&store), 1);
    }

    #[test]
    fn a_fingerprint_from_another_machine_mints_a_new_install_and_unlinks() {
        let store = store();
        store.ensure_install().expect("ensure");
        store
            .store(&AccountPin::new("us-east-1:abc", "sub-1"))
            .expect("pin");
        let before = store
            .with_conn(sync_state::load)
            .expect("load")
            .expect("row exists");

        // Simulates the copy: the row now claims a machine this one is not.
        store
            .with_conn(|conn| {
                sync_state::relink_install(
                    conn,
                    &before.install_id,
                    "cd00000000000000000000000000000000000000000000000000000000000000",
                )
            })
            .expect("plant a foreign fingerprint");
        store
            .with_conn(|conn| sync_state::set_pin(conn, "us-east-1:abc", "sub-1"))
            .expect("restore the linked state");

        assert_eq!(
            store.ensure_install().expect("ensure after the copy"),
            InstallOutcome::Relinked
        );

        let after = store
            .with_conn(sync_state::load)
            .expect("load")
            .expect("row exists");
        assert_ne!(after.install_id, before.install_id);
        assert_eq!(after.link_state, sync_state::LinkState::Unlinked);
        assert_eq!(
            after.identity_id.as_deref(),
            Some("us-east-1:abc"),
            "the account survives a copy; only the install changes"
        );
    }

    #[test]
    fn the_first_pin_is_stored_and_read_back() {
        let store = store();
        store.ensure_install().expect("ensure");
        assert_eq!(store.load().expect("load"), None);

        let pin = AccountPin::new("us-east-1:abc", "sub-1");
        store.store(&pin).expect("store the first pin");

        assert_eq!(store.load().expect("load"), Some(pin));
    }

    #[test]
    fn storing_the_same_pin_again_is_a_no_op() {
        let store = store();
        store.ensure_install().expect("ensure");
        let pin = AccountPin::new("us-east-1:abc", "sub-1");

        store.store(&pin).expect("first store");
        store.store(&pin).expect("second store");

        assert_eq!(store.load().expect("load"), Some(pin));
    }

    #[test]
    fn a_different_account_is_refused_rather_than_overwritten() {
        let store = store();
        store.ensure_install().expect("ensure");
        let pinned = AccountPin::new("us-east-1:abc", "sub-1");
        store.store(&pinned).expect("store the first pin");

        for (other, field) in [
            (
                AccountPin::new("us-east-1:other", "sub-1"),
                PinField::IdentityId,
            ),
            (
                AccountPin::new("us-east-1:abc", "sub-2"),
                PinField::OwnerSub,
            ),
        ] {
            let error = store.store(&other).expect_err("a mismatch must be refused");
            assert!(
                matches!(error, AuthError::PinMismatch(mismatch) if mismatch.field == field),
                "expected a {field:?} mismatch, got {error:?}"
            );
            assert_eq!(
                store.load().expect("load"),
                Some(pinned.clone()),
                "a refused store must leave the recorded account untouched"
            );
        }
    }

    #[test]
    fn freezing_and_resuming_are_visible_to_the_gate() {
        let store = store();
        store.ensure_install().expect("ensure");

        assert_eq!(store.gate_state().expect("read").frozen_reason, None);

        store
            .set_frozen_reason(Some(sync_state::FrozenReason::EntitlementLapsed))
            .expect("freeze");
        assert_eq!(
            store.gate_state().expect("read").frozen_reason,
            Some(sync_state::FrozenReason::EntitlementLapsed)
        );

        store.set_frozen_reason(None).expect("resume");
        assert_eq!(store.gate_state().expect("read").frozen_reason, None);
    }

    #[test]
    fn a_wiped_row_reads_as_unlinked_and_not_frozen() {
        let store = store();
        store.ensure_install().expect("ensure");
        store
            .store(&AccountPin::new("us-east-1:abc", "sub-1"))
            .expect("pin");
        store
            .set_frozen_reason(Some(sync_state::FrozenReason::Support))
            .expect("freeze");

        store
            .conn
            .lock()
            .expect("lock")
            .as_ref()
            .expect("the connection is open")
            .execute("DELETE FROM sync_state", [])
            .expect("wipe");

        let state = store.gate_state().expect("read");
        assert_eq!(state.pin, None);
        assert_eq!(state.frozen_reason, None);
    }

    #[test]
    fn a_broken_database_surfaces_as_state_unavailable() {
        let store = store();
        store
            .conn
            .lock()
            .expect("lock")
            .as_ref()
            .expect("the connection is open")
            .execute_batch("DROP TABLE sync_state")
            .expect("drop the table");

        assert_eq!(store.load().expect_err("load must fail"), AuthError::StateUnavailable);
        assert_eq!(
            store
                .store(&AccountPin::new("us-east-1:abc", "sub-1"))
                .expect_err("store must fail"),
            AuthError::StateUnavailable
        );
        assert!(!AuthError::StateUnavailable.retryable());
    }
}
