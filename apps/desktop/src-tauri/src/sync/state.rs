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
use crate::entitlements::{EntitlementAnswer, MULTI_DEVICE_SYNC};
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
        let guard = self.conn.lock().map_err(|_| AuthError::StateUnavailable)?;
        let conn = guard.as_ref().ok_or(AuthError::StateUnavailable)?;

        operation(conn).map_err(|_| AuthError::StateUnavailable)
    }

    /// Reads the row, creating or re-minting the install identity as AD-4 requires, and settles
    /// billing AD-11's relink requirement on the way.
    ///
    /// The relink lives here because this is the **sync host's** single pre-flight read: it is
    /// called from `DatasetHost::connect` and nowhere else, so it runs exactly on app start, on
    /// sign-in, on `enable` and on `sync_now` — the moments a relink decision is allowed to be
    /// taken — and never on a captured write.
    pub fn ensure_install(&self) -> Result<InstallOutcome, AuthError> {
        self.with_conn(|conn| {
            let (_, outcome) = ensure_install_outcome(conn)?;
            settle_relink(conn)?;

            Ok(outcome)
        })
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

    /// Brings the recorded `EntitlementLapsed` reason in step with what the entitlement authority
    /// last ANSWERED — billing AD-11's recording half, and the single writer of that reason.
    ///
    /// Must be called AFTER `ensure_install` and BEFORE the gate check; `settle_entitlement_freeze`
    /// below states why that order is the only workable one.
    ///
    /// Read and write happen inside ONE `with_conn`, so a decision cannot be taken against a
    /// reason another caller replaced in between.
    pub fn settle_entitlement_freeze(
        &self,
        answer: EntitlementAnswer,
    ) -> Result<EntitlementFreeze, AuthError> {
        self.with_conn(|conn| settle_entitlement_freeze(conn, answer))
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

/// Whether this dataset's local file and the cloud copy have diverged behind a freeze, so
/// regaining the capability is a **relink** rather than a plain resume (billing AD-11).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelinkRequirement {
    NotRequired,
    Required,
}

/// AD-11's relink decision, as a pure function over the two pieces of DURABLE sync state it is
/// allowed to read.
///
/// **Evidence-based, never absence-based.** The inputs are the recorded freeze and whether this
/// install ever published a position — both facts written by this dataset's own history. A
/// missing or cleared entitlement cache is deliberately NOT an input and must never become one:
/// profile D5/D11 clear client caches on every identity change, so an ordinary sign-in would
/// otherwise raise the destructive "publish local over the cloud copy" prompt on a dataset that
/// never lapsed at all.
///
/// All three conditions are load-bearing:
///
/// - Only `EntitlementLapsed` counts. `OwnerMismatch` is a different account reaching this
///   prefix and `Support` is a human holding transfers while something is investigated; neither
///   means this device's own edits diverged from the cloud copy, and both are documented as never
///   cleared automatically.
/// - `joined` must hold, because a dataset that has not joined already goes through the link
///   decision on its next enable — clearing a marker it does not have would change nothing.
/// - A published position must exist, because without one nothing of this device's is in the
///   cloud copy. There is then no divergence to reconcile and the ordinary first-join assessment
///   is sound, so raising the prompt would be gratuitous.
pub fn relink_requirement(
    frozen_reason: Option<sync_state::FrozenReason>,
    joined: bool,
    published_position: Option<i64>,
) -> RelinkRequirement {
    let froze_on_entitlement = matches!(
        frozen_reason,
        Some(sync_state::FrozenReason::EntitlementLapsed)
    );

    if froze_on_entitlement && joined && published_position.is_some() {
        RelinkRequirement::Required
    } else {
        RelinkRequirement::NotRequired
    }
}

/// Applies AD-11's relink by clearing the join marker, which is what makes the NEXT enable
/// re-enter the sync spine's existing link decision (`bootstrap::assess` → `ChoiceRequired`).
///
/// No new UX and no new merge path: the one prompt the spine already owns is reused, exactly as
/// a restored backup and a copied profile already reuse it. Idempotent — once the marker is gone
/// the dataset is unjoined, so `joined` is false and this answers `NotRequired` thereafter.
fn settle_relink(conn: &Connection) -> Result<RelinkRequirement, AppError> {
    let Some(state) = sync_state::load(conn)? else {
        return Ok(RelinkRequirement::NotRequired);
    };

    // One past the highest seq this install ever shipped, so `0` means it has published nothing.
    let published = match sync_state_published_position(conn, &state.install_id)? {
        0 => None,
        next => Some(next - 1),
    };

    let requirement = relink_requirement(state.frozen_reason, state.joined(), published);
    if requirement == RelinkRequirement::Required {
        sync_state::clear_joined_at(conn)?;
        tracing::info!(
            "A frozen dataset regained its entitlement; the next enable re-enters the link decision"
        );
    }

    Ok(requirement)
}

/// The durable last-published position, read through the segment module that owns the log rather
/// than with a second query of its table.
fn sync_state_published_position(conn: &Connection, install: &str) -> Result<i64, AppError> {
    crate::db::sync_segment::next_seq(conn, install)
}

/// What the entitlement authority last ANSWERED about `multi_device_sync`.
///
/// Three answers and not two, which is the entire reason AD-11's recording half reads an
/// `EntitlementAnswer` instead of the `bool` the gate is content with. A gate may conflate the
/// last two: a grant it could not prove and a grant that was proven absent both deny, and denying
/// is correct for both. A DURABLE record may not, because one of them is evidence of a lapse and
/// the other is the absence of evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CapabilityAnswer {
    /// A verified statement that carries the capability.
    Granted,
    /// A verified statement that does not carry it — a free or lower plan. A real lapse.
    VerifiedAbsent,
    /// Nothing was proven: no session, no cached statement, an unverifiable one, or an authority
    /// that could not be reached (`entitlements::EntitlementAnswer::Unestablished`).
    Unestablished,
}

/// Projects the authority's answer onto the one fact the durable record turns on.
///
/// **This function is the destructive-prompt guard**, and the `Unestablished` arm is the whole of
/// it. Profile D5/D11 clear client caches on every identity change, so an ordinary sign-in reaches
/// here with nothing proven; folding that into `VerifiedAbsent` would record a lapse on a dataset
/// that never lapsed, and the next re-entitlement would offer to publish it over a cloud copy it
/// has no divergence from.
pub fn capability_answer(answer: EntitlementAnswer) -> CapabilityAnswer {
    match answer {
        EntitlementAnswer::Verified(capabilities) if capabilities.grants(MULTI_DEVICE_SYNC) => {
            CapabilityAnswer::Granted
        }
        EntitlementAnswer::Verified(_) => CapabilityAnswer::VerifiedAbsent,
        EntitlementAnswer::Unestablished => CapabilityAnswer::Unestablished,
    }
}

/// What a settle did to the row, so a caller — and a test — can tell a write from a no-op.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntitlementFreeze {
    /// The authority proved the capability is gone, so AD-11's reason is now recorded.
    Recorded,
    /// The capability is granted again, so the recorded reason is lifted and transfers resume.
    Cleared,
    /// Nothing was written.
    Unchanged,
}

/// Billing AD-11's RECORDING half: the counterpart of `settle_relink` above, which only ever
/// reads the reason this writes.
///
/// Without it the relink trigger is dormant. Nothing else in production writes
/// `EntitlementLapsed`, so a device that loses `multi_device_sync` stops transferring, keeps
/// accumulating local changes nobody ever publishes, and then re-subscribes into a plain
/// incremental resume against a cloud copy it has no recent common ancestor with.
///
/// **One function owns both halves of the lifecycle.** `OwnerMismatch` is documented as never
/// cleared automatically, because a second account reaching this prefix is not a condition that
/// lapses. An entitlement lapse is the opposite: AD-14 makes an absent capability a Frozen state
/// that *resumes* when the capability returns. A recorded reason is also what the gate's third
/// check refuses on, so a reason written with no paired way to lift it would freeze the dataset
/// for good. Setting and clearing in one place is what makes that pairing reviewable.
///
/// Two of the twelve answer-by-reason combinations write; the rest deliberately do not:
///
/// - A `VerifiedAbsent` answer on a row holding NO reason records the lapse. A row that already
///   holds one is left alone — re-recording is a no-op, and overwriting `OwnerMismatch` or
///   `Support` with a reason that *is* lifted automatically would lift theirs by proxy, resuming
///   transfers against a prefix another account owns or one support is holding.
/// - A `Granted` answer lifts the reason, and ONLY `EntitlementLapsed`.
/// - An `Unestablished` entitlement writes NOTHING, in EITHER direction. It is not evidence of a
///   lapse (`capability_answer`), and it is not evidence of a resume either: clearing on it would
///   erase the very record the relink is decided from, so the next connect would resume
///   incrementally and publish the divergence silently.
///
/// **Ordering, which is load-bearing.** The caller runs `ensure_install` — and with it
/// `settle_relink` — BEFORE this, and the gate check AFTER it. A recorded lapse is therefore
/// consumed into the relink while it is still on the row, the reason is only then brought in step
/// with the live answer, and only then does the gate decide. Lifting it before `settle_relink` had
/// read it would lose the relink; lifting it after the gate is unreachable, because the gate
/// refuses on the very reason that has to be lifted.
fn settle_entitlement_freeze(
    conn: &Connection,
    answer: EntitlementAnswer,
) -> Result<EntitlementFreeze, AppError> {
    let Some(state) = sync_state::load(conn)? else {
        return Ok(EntitlementFreeze::Unchanged);
    };

    match (capability_answer(answer), state.frozen_reason) {
        (CapabilityAnswer::VerifiedAbsent, None) => {
            sync_state::set_frozen_reason(conn, Some(sync_state::FrozenReason::EntitlementLapsed))?;
            tracing::info!(
                "This account no longer grants multi-device sync; transfers are stopped, the cloud \
                 copy is kept, and the lapse is recorded so regaining it re-enters the link decision"
            );

            Ok(EntitlementFreeze::Recorded)
        }
        (CapabilityAnswer::Granted, Some(sync_state::FrozenReason::EntitlementLapsed)) => {
            sync_state::set_frozen_reason(conn, None)?;
            tracing::info!("This account grants multi-device sync again; transfers resume");

            Ok(EntitlementFreeze::Cleared)
        }
        _ => Ok(EntitlementFreeze::Unchanged),
    }
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
    use crate::entitlements::AccountCapabilities;
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
        store
            .ensure_install()
            .expect("the install identity is minted");

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

        assert_eq!(
            store.load().expect_err("load must fail"),
            AuthError::StateUnavailable
        );
        assert_eq!(
            store
                .store(&AccountPin::new("us-east-1:abc", "sub-1"))
                .expect_err("store must fail"),
            AuthError::StateUnavailable
        );
        assert!(!AuthError::StateUnavailable.retryable());
    }

    // ----- billing AD-11's relink trigger -----

    /// Ships one segment for this install, which is the durable "last published position" the
    /// relink decision reads. Driven through the segment module's own seed-and-ship helpers
    /// rather than hand-written SQL, so the row satisfies the log's named constraints and the
    /// position is the one `next_seq` derives from `MAX(seq)`.
    fn publish_one_segment(store: &SyncStateStore) {
        store
            .with_conn(|conn| {
                let state = sync_state::load(conn)?.expect("the row exists");
                crate::db::sync_segment::seed_log_messages(conn, &state.install_id, 1);
                let pending = crate::db::sync_segment::unshipped(conn, &state.install_id, 1)?;
                let assignments: Vec<(i64, i64)> = pending
                    .iter()
                    .enumerate()
                    .map(|(index, message)| (message.id, index as i64))
                    .collect();
                crate::db::sync_segment::mark_shipped(conn, 0, &assignments)?;

                Ok(())
            })
            .expect("a published segment is recorded");
    }

    fn joined_at(store: &SyncStateStore) -> Option<String> {
        store
            .with_conn(sync_state::load)
            .expect("load")
            .expect("row exists")
            .joined_at
    }

    /// The decision table, stated directly: only a recorded entitlement freeze on a joined
    /// dataset that has published something is a relink. Every other row is a plain resume.
    #[test]
    fn only_a_recorded_entitlement_freeze_on_a_published_join_requires_a_relink() {
        use sync_state::FrozenReason;

        assert_eq!(
            relink_requirement(Some(FrozenReason::EntitlementLapsed), true, Some(0)),
            RelinkRequirement::Required
        );

        for (label, reason, joined, published) in [
            ("no freeze at all", None, true, Some(0)),
            (
                "a different account reached the prefix",
                Some(FrozenReason::OwnerMismatch),
                true,
                Some(0),
            ),
            (
                "a human holding transfers",
                Some(FrozenReason::Support),
                true,
                Some(0),
            ),
            (
                "never joined, so the link decision is already owed",
                Some(FrozenReason::EntitlementLapsed),
                false,
                Some(0),
            ),
            (
                "nothing of this device's is in the cloud copy",
                Some(FrozenReason::EntitlementLapsed),
                true,
                None,
            ),
        ] {
            assert_eq!(
                relink_requirement(reason, joined, published),
                RelinkRequirement::NotRequired,
                "{label}"
            );
        }
    }

    /// The exact pair billing AD-11 demands be proven: a cleared cache plus an ordinary sign-in
    /// raises NO prompt, while a recorded freeze plus a later re-entitlement does.
    ///
    /// Both halves run against the same durable state through the same `ensure_install` the sync
    /// host calls on every connect, so what is measured is the real trigger rather than the pure
    /// table above. The entitlement cache is not represented here AT ALL, which is the point:
    /// there is no input by which clearing it could reach this decision.
    #[test]
    fn a_cleared_cache_and_an_ordinary_sign_in_never_raise_the_relink_prompt() {
        let store = store();
        store.ensure_install().expect("ensure");
        store
            .store(&AccountPin::new("us-east-1:abc", "sub-1"))
            .expect("pin");
        store
            .with_conn(sync_state::mark_joined)
            .expect("this computer has joined");
        publish_one_segment(&store);

        let marker = joined_at(&store).expect("a joined dataset records when");

        // An ordinary sign-in: the host connects, which is where the decision is taken. Nothing
        // froze, so the join survives and the next enable resumes rather than asking.
        for _ in 0..3 {
            store.ensure_install().expect("connect");
        }

        assert_eq!(
            joined_at(&store).as_deref(),
            Some(marker.as_str()),
            "an ordinary sign-in must not turn a healthy synced dataset into an unjoined one"
        );
    }

    #[test]
    fn a_recorded_freeze_and_a_later_re_entitlement_do_raise_the_relink_prompt() {
        let store = store();
        store.ensure_install().expect("ensure");
        store
            .store(&AccountPin::new("us-east-1:abc", "sub-1"))
            .expect("pin");
        store
            .with_conn(sync_state::mark_joined)
            .expect("this computer has joined");
        publish_one_segment(&store);

        // The lapse: transfers stopped while the device kept accumulating local edits.
        store
            .set_frozen_reason(Some(sync_state::FrozenReason::EntitlementLapsed))
            .expect("freeze");

        // Re-subscribed, so the host connects again.
        store.ensure_install().expect("connect");

        assert!(
            joined_at(&store).is_none(),
            "the join marker must be cleared so the next enable re-enters the link decision"
        );

        // Idempotent: a second connect has nothing left to clear and asks for nothing more.
        store.ensure_install().expect("connect again");
        assert!(joined_at(&store).is_none());
        assert_eq!(
            store.with_conn(settle_relink).expect("settle"),
            RelinkRequirement::NotRequired
        );
    }

    /// A dataset frozen for the OTHER reasons keeps its join, because neither means this
    /// device's own edits diverged from the cloud copy.
    #[test]
    fn a_freeze_for_any_other_reason_leaves_the_join_marker_alone() {
        for reason in [
            sync_state::FrozenReason::OwnerMismatch,
            sync_state::FrozenReason::Support,
        ] {
            let store = store();
            store.ensure_install().expect("ensure");
            store.with_conn(sync_state::mark_joined).expect("joined");
            publish_one_segment(&store);
            store.set_frozen_reason(Some(reason)).expect("freeze");

            store.ensure_install().expect("connect");

            assert!(
                joined_at(&store).is_some(),
                "{reason:?} must not relink this dataset"
            );
        }
    }

    /// A frozen dataset that never published anything has no divergence to reconcile, so the
    /// ordinary first-join assessment is sound and no marker is touched.
    #[test]
    fn a_freeze_with_nothing_ever_published_is_a_plain_resume() {
        let store = store();
        store.ensure_install().expect("ensure");
        store.with_conn(sync_state::mark_joined).expect("joined");
        store
            .set_frozen_reason(Some(sync_state::FrozenReason::EntitlementLapsed))
            .expect("freeze");

        store.ensure_install().expect("connect");

        assert!(joined_at(&store).is_some());
    }

    // ----- billing AD-11's recording half, which is what makes the trigger above fire -----

    /// A verified statement that carries the capability.
    fn granted() -> EntitlementAnswer {
        EntitlementAnswer::Verified(AccountCapabilities::from_capabilities(&[MULTI_DEVICE_SYNC]))
    }

    /// A verified statement that does not: the authority spoke, and the plan excludes sync.
    fn verified_absent() -> EntitlementAnswer {
        EntitlementAnswer::Verified(AccountCapabilities::empty())
    }

    fn frozen_reason(store: &SyncStateStore) -> Option<sync_state::FrozenReason> {
        store.gate_state().expect("read").frozen_reason
    }

    /// SQLite's own count of rows this connection has ever written. The only honest proof that a
    /// settle was a no-op: `updated_at` has one-second resolution, so two writes inside the same
    /// second are indistinguishable by it.
    fn writes(store: &SyncStateStore) -> u64 {
        store
            .conn
            .lock()
            .expect("lock")
            .as_ref()
            .expect("the connection is open")
            .total_changes()
    }

    /// The production pre-flight, in the order `DatasetHost::connect` runs it: the relink settle
    /// first, so a recorded lapse is consumed while it is still on the row, then the reason
    /// brought in step with the authority's answer.
    fn pre_flight(store: &SyncStateStore, answer: EntitlementAnswer) -> EntitlementFreeze {
        store.ensure_install().expect("the host connects");
        store
            .settle_entitlement_freeze(answer)
            .expect("the entitlement settles")
    }

    /// The three-way projection, stated directly. The third row is the one that matters: a gate
    /// may fold it into the second, and a durable record may not.
    #[test]
    fn the_authority_s_answer_tells_a_verified_absence_from_an_unestablished_entitlement() {
        assert_eq!(capability_answer(granted()), CapabilityAnswer::Granted);
        assert_eq!(
            capability_answer(verified_absent()),
            CapabilityAnswer::VerifiedAbsent
        );
        assert_eq!(
            capability_answer(EntitlementAnswer::Unestablished),
            CapabilityAnswer::Unestablished
        );
        assert_ne!(
            CapabilityAnswer::VerifiedAbsent,
            CapabilityAnswer::Unestablished,
            "a proven lapse and an unprovable one must never be the same value"
        );
    }

    #[test]
    fn an_authority_that_verifies_the_capability_is_absent_records_the_lapse() {
        let store = store();
        store.ensure_install().expect("ensure");
        assert_eq!(frozen_reason(&store), None);

        assert_eq!(
            store
                .settle_entitlement_freeze(verified_absent())
                .expect("settle"),
            EntitlementFreeze::Recorded
        );

        assert_eq!(
            frozen_reason(&store),
            Some(sync_state::FrozenReason::EntitlementLapsed),
            "the lapse has to be DURABLE, or a later re-entitlement cannot know it happened"
        );
    }

    /// **The destructive-prompt guard.** An entitlement that could not be established is not
    /// evidence of anything, and every way of failing to establish one collapses to the same
    /// answer: an unreachable authority, an empty cache, a statement that does not verify, no
    /// session at all. Profile D5/D11 clear the cache on every identity change, so an ordinary
    /// sign-in lands here — and recording a lapse for it would offer to publish this computer's
    /// data over a cloud copy it has not diverged from.
    ///
    /// Asserted in BOTH directions, because clearing on it is the same defect wearing the other
    /// hat: it would erase the one record the relink is decided from.
    #[test]
    fn an_unestablished_entitlement_records_nothing_and_clears_nothing() {
        let store = store();
        store.ensure_install().expect("ensure");

        let before = writes(&store);
        assert_eq!(
            store
                .settle_entitlement_freeze(EntitlementAnswer::Unestablished)
                .expect("settle"),
            EntitlementFreeze::Unchanged
        );
        assert_eq!(frozen_reason(&store), None, "an unreachable authority, an empty cache and an unverifiable statement are not a lapse");
        assert_eq!(writes(&store), before, "the row must not be touched at all");

        store
            .settle_entitlement_freeze(verified_absent())
            .expect("the authority then proves the lapse");
        let after_lapse = writes(&store);

        assert_eq!(
            store
                .settle_entitlement_freeze(EntitlementAnswer::Unestablished)
                .expect("settle"),
            EntitlementFreeze::Unchanged
        );
        assert_eq!(
            frozen_reason(&store),
            Some(sync_state::FrozenReason::EntitlementLapsed),
            "going offline must not erase a recorded lapse; the next connect would resume \
             incrementally and publish the divergence silently"
        );
        assert_eq!(writes(&store), after_lapse);
    }

    #[test]
    fn recording_the_same_lapse_twice_writes_nothing_the_second_time() {
        let store = store();
        store.ensure_install().expect("ensure");
        store.with_conn(sync_state::mark_joined).expect("joined");
        publish_one_segment(&store);
        let marker = joined_at(&store).expect("a joined dataset records when");

        assert_eq!(
            store
                .settle_entitlement_freeze(verified_absent())
                .expect("first settle"),
            EntitlementFreeze::Recorded
        );
        let after_first = writes(&store);

        for _ in 0..3 {
            assert_eq!(
                store
                    .settle_entitlement_freeze(verified_absent())
                    .expect("settle again"),
                EntitlementFreeze::Unchanged
            );
        }

        assert_eq!(
            writes(&store),
            after_first,
            "freezing twice must not churn the row"
        );
        assert_eq!(
            frozen_reason(&store),
            Some(sync_state::FrozenReason::EntitlementLapsed)
        );
        assert_eq!(
            joined_at(&store).as_deref(),
            Some(marker.as_str()),
            "recording the lapse is not the relink; only settle_relink touches the join marker"
        );
    }

    #[test]
    fn the_capability_returning_lifts_the_recorded_lapse_so_transfers_resume() {
        let store = store();
        store.ensure_install().expect("ensure");
        store
            .settle_entitlement_freeze(verified_absent())
            .expect("the lapse is recorded");

        assert_eq!(
            store.settle_entitlement_freeze(granted()).expect("settle"),
            EntitlementFreeze::Cleared
        );
        assert_eq!(
            frozen_reason(&store),
            None,
            "a reason with no paired way to lift it would freeze this dataset for good"
        );

        let after_clear = writes(&store);
        assert_eq!(
            store
                .settle_entitlement_freeze(granted())
                .expect("settle again"),
            EntitlementFreeze::Unchanged
        );
        assert_eq!(writes(&store), after_clear);
    }

    /// The two reasons this function does not own are neither overwritten nor lifted.
    ///
    /// Both are documented as never cleared automatically, and overwriting one with a reason that
    /// IS cleared automatically would lift it by proxy — resuming transfers against a prefix
    /// another account owns, or one a human is deliberately holding.
    #[test]
    fn a_freeze_this_function_does_not_own_is_neither_overwritten_nor_lifted() {
        for reason in [
            sync_state::FrozenReason::OwnerMismatch,
            sync_state::FrozenReason::Support,
        ] {
            for answer in [
                granted(),
                verified_absent(),
                EntitlementAnswer::Unestablished,
            ] {
                let store = store();
                store.ensure_install().expect("ensure");
                store.set_frozen_reason(Some(reason)).expect("freeze");
                let before = writes(&store);

                assert_eq!(
                    store.settle_entitlement_freeze(answer).expect("settle"),
                    EntitlementFreeze::Unchanged,
                    "{reason:?} is not this function's to change"
                );
                assert_eq!(frozen_reason(&store), Some(reason));
                assert_eq!(writes(&store), before);
            }
        }
    }

    /// A wiped row has nothing to settle, and must read as that rather than as a failure: AD-15's
    /// wipe deletes the row, and the next `ensure_install` is what creates it again.
    #[test]
    fn a_settle_against_a_wiped_row_is_a_no_op_rather_than_an_error() {
        let store = store();
        store.ensure_install().expect("ensure");
        store
            .conn
            .lock()
            .expect("lock")
            .as_ref()
            .expect("the connection is open")
            .execute("DELETE FROM sync_state", [])
            .expect("wipe");

        for answer in [
            granted(),
            verified_absent(),
            EntitlementAnswer::Unestablished,
        ] {
            assert_eq!(
                store.settle_entitlement_freeze(answer).expect("settle"),
                EntitlementFreeze::Unchanged
            );
        }
        assert_eq!(row_count(&store), 0);
    }

    /// End to end through the real types and the real production order: a lapse the AUTHORITY
    /// proved, on a joined dataset that has published a position, raises AD-11's relink on the
    /// next pre-flight — and the reason is lifted in the same pass, so the gate can pass again.
    #[test]
    fn a_proven_lapse_and_a_later_re_entitlement_raise_the_relink_through_the_host_pre_flight() {
        let store = store();
        store.ensure_install().expect("ensure");
        store
            .store(&AccountPin::new("us-east-1:abc", "sub-1"))
            .expect("pin");
        store
            .with_conn(sync_state::mark_joined)
            .expect("this computer has joined");
        publish_one_segment(&store);
        let marker = joined_at(&store).expect("a joined dataset records when");

        // The lapse lands while the app is running: the pre-flight records it, and the relink is
        // NOT taken yet, because `settle_relink` ran before the reason was on the row.
        assert_eq!(
            pre_flight(&store, verified_absent()),
            EntitlementFreeze::Recorded
        );
        assert_eq!(
            joined_at(&store).as_deref(),
            Some(marker.as_str()),
            "the pass that records the lapse has nothing to relink yet"
        );

        // Re-entitled, and the app connects again. One pass does both halves: the recorded lapse
        // is consumed into the relink, then the reason is lifted.
        assert_eq!(pre_flight(&store, granted()), EntitlementFreeze::Cleared);

        assert!(
            joined_at(&store).is_none(),
            "the join marker must be cleared so the next enable re-enters the link decision"
        );
        assert_eq!(
            frozen_reason(&store),
            None,
            "transfers have to resume, or the relink could never be answered"
        );
        assert_eq!(
            store.gate_state().expect("read").pin,
            Some(AccountPin::new("us-east-1:abc", "sub-1")),
            "a relink changes the join marker and nothing about the account"
        );

        // Idempotent: nothing is left to relink and nothing is left to lift.
        assert_eq!(pre_flight(&store, granted()), EntitlementFreeze::Unchanged);
        assert!(joined_at(&store).is_none());
        assert_eq!(
            store.with_conn(settle_relink).expect("settle"),
            RelinkRequirement::NotRequired
        );
    }

    /// The other half of the pair, through the same real pre-flight: an ordinary sign-in on a
    /// computer whose entitlement cache was just cleared establishes NOTHING, so it records
    /// nothing and raises no prompt — however many times it reconnects.
    #[test]
    fn an_ordinary_sign_in_with_a_cleared_cache_raises_no_relink_through_the_host_pre_flight() {
        let store = store();
        store.ensure_install().expect("ensure");
        store
            .store(&AccountPin::new("us-east-1:abc", "sub-1"))
            .expect("pin");
        store
            .with_conn(sync_state::mark_joined)
            .expect("this computer has joined");
        publish_one_segment(&store);
        let marker = joined_at(&store).expect("a joined dataset records when");

        for _ in 0..3 {
            assert_eq!(
                pre_flight(&store, EntitlementAnswer::Unestablished),
                EntitlementFreeze::Unchanged
            );
        }

        assert_eq!(
            joined_at(&store).as_deref(),
            Some(marker.as_str()),
            "an ordinary sign-in must never turn a healthy synced dataset into an unjoined one"
        );
        assert_eq!(frozen_reason(&store), None);
    }
}
