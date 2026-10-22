//! Story 25: the wipe, restore, backup-import and dataset-copy semantics (AD-4, AD-9, AD-15).
//!
//! Real files, the real capture hook, real segments and the real apply path, like
//! `tests_restore.rs`: what the story claims is that a WHOLE-FILE operation does not travel, and
//! only the real hook can prove that nothing was captured.

use rusqlite::Connection;
use tempfile::TempDir;

use crate::db::{
    capture_fixtures as fixtures, danger_zone, sync_capture, sync_state, test_dataset,
    ActiveDataset, WriteTx,
};
use crate::error::AppError;
use crate::models::DatasetKind;

use super::apply;
use super::capture::Capture;
use super::clock::{machine_fingerprint, Clock, MachineSignals};
use super::segment::{self, SegmentBatch};
use super::state::{ensure_install_on, remint_install_on, InstallOutcome};

struct Computer {
    _dir: TempDir,
    dataset: ActiveDataset,
    apply: Connection,
    clock: Clock,
    install: String,
}

impl Computer {
    fn open(id: &str) -> Self {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("nixus.db");
        let conn = test_dataset::migrated_dataset(&db_path);
        let capture = Capture::for_dataset(DatasetKind::CloudLinked, &conn)
            .expect("capture is built")
            .expect("a cloud-linked dataset captures");
        capture.attach(&conn).expect("the hook is installed");

        let apply = crate::db::open_configured(&db_path).expect("the apply connection opens");
        let install = ensure_install_on(&conn)
            .expect("the install row reads")
            .install_id;
        sync_state::set_pin(&conn, "identity-1", "owner-sub-1").expect("the dataset is linked");

        Self {
            _dir: dir,
            dataset: ActiveDataset {
                id: Some(id.to_string()),
                conn: Some(conn),
                capture: Some(capture),
            },
            clock: Clock::new(&install).expect("the clock builds"),
            install,
            apply,
        }
    }

    fn conn(&self) -> &Connection {
        self.dataset
            .conn
            .as_ref()
            .expect("a computer has a connection")
    }

    fn write<T>(&self, operation: impl FnOnce(&WriteTx<'_>) -> Result<T, AppError>) -> T {
        self.dataset
            .write(operation)
            .expect("the captured write succeeds")
    }

    /// The wipe exactly as `commands::danger_zone::delete_all_data` performs it.
    fn wipe(&self) -> u64 {
        self.dataset
            .write_uncaptured(danger_zone::wipe_all)
            .expect("the wipe succeeds")
    }

    fn cut(&mut self) -> Option<SegmentBatch> {
        let schema_version = u32::try_from(crate::db::latest_schema_version()).unwrap_or(u32::MAX);
        let cut = segment::cut(self.conn(), &self.install, schema_version).expect("the cut reads")?;
        segment::mark_shipped(self.conn(), &cut).expect("the rows are marked");

        let verified = segment::read_segment(&cut.object, &cut.install, cut.seq)
            .expect("the segment this build wrote is readable");

        Some(SegmentBatch {
            install: cut.install,
            seq: cut.seq,
            messages: verified.messages,
        })
    }

    fn receive(&self, batch: &SegmentBatch) {
        apply::apply_batch(&self.apply, &self.clock, batch).expect("the batch applies");
    }

    fn number(&self, sql: &str) -> i64 {
        self.conn()
            .query_row(sql, [], |row| row.get(0))
            .expect("the count reads")
    }

    fn applied_number(&self, sql: &str) -> i64 {
        self.apply
            .query_row(sql, [], |row| row.get(0))
            .expect("the count reads")
    }

    fn state(&self) -> sync_state::SyncState {
        sync_state::load(self.conn())
            .expect("the state reads")
            .expect("a row is present")
    }
}

#[test]
fn a_wipe_detaches_the_hook_so_it_produces_no_message_and_no_tombstone() {
    let computer = Computer::open("wipe");

    computer.write(|tx| fixtures::insert_income_source(tx, "Salary"));
    computer.write(|tx| fixtures::insert_income_source(tx, "Consulting"));
    assert!(
        computer.number("SELECT COUNT(*) FROM sync_log") > 0,
        "the captured writes produced no message, so this test would prove nothing"
    );

    let deleted = computer.wipe();

    assert!(deleted > 0, "the wipe deleted nothing");
    assert_eq!(
        computer.number("SELECT COUNT(*) FROM sync_log"),
        0,
        "the wipe produced log rows: every deleted row would travel as a deletion"
    );
    assert_eq!(
        computer.number("SELECT COUNT(*) FROM sync_tombstone"),
        0,
        "the wipe produced tombstones"
    );
    assert_eq!(computer.number("SELECT COUNT(*) FROM income_sources"), 0);
}

/// Non-vacuity for the test above: the SAME deletes through the captured path DO travel, so the
/// zero above is the detach's doing and not an absence of capture.
#[test]
fn the_same_delete_through_the_captured_path_does_produce_a_tombstone() {
    let computer = Computer::open("captured-delete");

    let source = computer.write(|tx| fixtures::insert_income_source(tx, "Salary"));
    computer.write(|tx| fixtures::delete_income_source(tx, source));

    assert_eq!(
        computer.number("SELECT COUNT(*) FROM sync_tombstone"),
        1,
        "the hook is not live on this dataset, so the detach proves nothing"
    );
}

/// Still true and still the mechanism (story wipe-epoch did not change it): the wipe leaves a
/// never-joined, unpinned dataset with a new install identity. What CHANGED is only what happens
/// next — the dataset no longer rejoins and re-downloads the account's copy, because
/// `delete_all_data` also leaves `config.sync_wipe_pending` and the next join registers a wipe
/// EVENT that moves the whole account forward. That half is proven in `tests_wipe_epoch.rs`.
#[test]
fn a_wipe_unlinks_the_dataset_with_a_fresh_install_identity_and_no_pin() {
    let computer = Computer::open("unlink");
    let before = computer.state();
    assert_eq!(before.link_state, sync_state::LinkState::Linked);

    computer.wipe();

    // The row is deleted by the wipe (AD-15: deleting it IS Unlinked) and re-created by the
    // re-attach that follows, which is what gives this computer a NEW install identity: the file
    // it is about to be used as is, for the `(install, seq)` space, a different computer.
    let after = computer.state();
    assert_ne!(
        after.install_id, before.install_id,
        "the wiped dataset kept its install id and could re-append to a space it has left"
    );
    assert_eq!(after.link_state, sync_state::LinkState::Unlinked);
    assert_eq!(after.identity_id, None, "the account pin survived the wipe");
    assert_eq!(after.owner_sub, None, "the account pin survived the wipe");
    assert_eq!(after.frozen_reason, None);
    assert!(
        !after.joined(),
        "a wiped dataset has joined nothing: it holds none of the account's rows any more"
    );
    // There is no user-facing off switch, so a wipe must not leave a permanent opt-out nobody can
    // clear: the wiped dataset is a never-joined empty computer that rejoins — at the NEW epoch
    // its own join registers (story wipe-epoch), which is what stops the rejoin from being a
    // re-download of what the user just deleted.
    assert!(
        !after.sync_disabled,
        "a wipe must not leave sync permanently switched off"
    );
}

/// INTENTIONAL BEHAVIOUR REVERSAL in the TITLE's claim, not in this test's mechanism (story
/// wipe-epoch, revising AD-15). The other computer no longer keeps everything: it empties itself
/// when it reads the account's new wipe epoch, which `tests_wipe_epoch.rs` proves end to end.
///
/// What is asserted here is the part that had to stay true for that to be safe, and that this
/// harness is the only one that can prove: the wipe captures NOTHING, so there is no segment to
/// ship and the other computer's data is never deleted by a flood of replicated tombstones. The
/// account is told out of band by the `wipe` marker instead — bounded, one object, and not
/// restorable from `sync_tombstone` for 30 days as a captured delete would have been.
#[test]
fn a_wipe_ships_no_message_so_no_tombstone_ever_deletes_another_computers_rows() {
    let mut wiped = Computer::open("wiped");
    let other = Computer::open("other");

    wiped.write(|tx| fixtures::insert_income_source(tx, "Salary"));
    wiped.write(|tx| fixtures::insert_income_source(tx, "Consulting"));
    let batch = wiped.cut().expect("there was something to ship");
    other.receive(&batch);
    assert_eq!(other.applied_number("SELECT COUNT(*) FROM income_sources"), 2);

    wiped.wipe();

    // Nothing to cut is the claim: the wipe produced no message, so there is nothing to upload and
    // nothing for anyone to apply. The pin is gone as well, so the gate would refuse a request
    // even if one were attempted. The other computer IS emptied — by the wipe epoch, on its own
    // next cycle (`tests_wipe_epoch.rs`) — and this is what proves it does not happen through the
    // log, which would have been an unbounded tombstone flood.
    assert!(
        wiped.cut().is_none(),
        "the wipe left something to ship, which would delete the other computer's rows through \
         the log instead of through the bounded account-wide event"
    );
    assert_eq!(wiped.state().identity_id, None);

    assert_eq!(
        other.applied_number("SELECT COUNT(*) FROM income_sources"),
        2,
        "the other computer's rows were deleted by a replicated message rather than by the event"
    );
    assert_eq!(other.applied_number("SELECT COUNT(*) FROM sync_tombstone"), 0);
}

#[test]
fn a_copied_database_is_detected_by_its_machine_fingerprint_and_keeps_its_pin() {
    let computer = Computer::open("clone");
    let before = computer.state();

    // The same file as it would read on a SECOND computer: the data is this install's, the
    // fingerprint is someone else's.
    let elsewhere = machine_fingerprint(&MachineSignals {
        host: Some("another-computer".to_string()),
        user: Some("another-user".to_string()),
        platform: "windows",
    });
    assert_ne!(
        elsewhere,
        machine_fingerprint(&MachineSignals::from_environment()),
        "the two fake machines hash the same, so the mismatch below is not a mismatch"
    );
    computer
        .conn()
        .execute(
            "UPDATE sync_state SET machine_fingerprint = ?1 WHERE id = 1",
            [&elsewhere],
        )
        .expect("the fingerprint is rewritten");

    // `ensure_install_on` is what every dataset OPEN path reaches: `Capture::for_dataset` and
    // `Capture::attach` both call it, and `select_dataset_now` calls both — which is also the
    // startup path, because startup selects the default dataset through it.
    let reopened = ensure_install_on(computer.conn()).expect("the open path settles the identity");

    assert_ne!(
        reopened.install_id, before.install_id,
        "a copied database kept its install id and would share one `(install, seq)` space"
    );
    assert_eq!(reopened.link_state, sync_state::LinkState::Unlinked);
    assert_eq!(
        reopened.identity_id.as_deref(),
        Some("identity-1"),
        "the pin was discarded, so the next vend could adopt a different account"
    );
    assert_eq!(
        reopened.machine_fingerprint,
        machine_fingerprint(&MachineSignals::from_environment())
    );
}

#[test]
fn reopening_a_database_that_did_not_move_changes_nothing() {
    let computer = Computer::open("same-machine");
    let before = computer.state();

    let reopened = ensure_install_on(computer.conn()).expect("the open path reads");

    assert_eq!(reopened.install_id, before.install_id);
    assert_eq!(reopened.link_state, sync_state::LinkState::Linked);
}

#[test]
fn attaching_the_hook_to_a_copied_database_relinks_it_before_the_first_write() {
    let computer = Computer::open("clone-attach");
    let before = computer.state();

    let elsewhere = machine_fingerprint(&MachineSignals {
        host: Some("a-laptop".to_string()),
        user: Some("someone".to_string()),
        platform: "linux",
    });
    computer
        .conn()
        .execute(
            "UPDATE sync_state SET machine_fingerprint = ?1 WHERE id = 1",
            [&elsewhere],
        )
        .expect("the fingerprint is rewritten");

    let capture = computer
        .dataset
        .capture
        .as_ref()
        .expect("a cloud-linked dataset captures");
    capture
        .attach(computer.conn())
        .expect("the hook re-attaches on every open");

    let after = computer.state();
    assert_ne!(after.install_id, before.install_id);
    assert_eq!(after.link_state, sync_state::LinkState::Unlinked);

    // And the messages the hook stamps from here on carry the NEW id, which is the reason the
    // re-mint has to happen before the first write rather than at the next sync attempt.
    computer.write(|tx| fixtures::insert_income_source(tx, "Salary"));
    let stamped: String = computer
        .conn()
        .query_row("SELECT DISTINCT install FROM sync_log", [], |row| row.get(0))
        .expect("a message was captured");
    assert_eq!(stamped, after.install_id);
}

#[test]
fn a_restored_or_imported_file_is_re_minted_and_left_unlinked() {
    let computer = Computer::open("import");
    let before = computer.state();

    // The restore/import/copy paths know what the file cannot: it was replaced or duplicated.
    let outcome = remint_install_on(computer.conn()).expect("the re-mint succeeds");

    assert_eq!(outcome, InstallOutcome::Relinked);
    let after = computer.state();
    assert_ne!(after.install_id, before.install_id);
    assert_eq!(after.link_state, sync_state::LinkState::Unlinked);
    assert_eq!(
        after.identity_id.as_deref(),
        Some("identity-1"),
        "the pin is kept: a restore is almost always the same user on the same account"
    );
    assert_eq!(
        after.machine_fingerprint,
        machine_fingerprint(&MachineSignals::from_environment())
    );
}

#[test]
fn a_re_mint_of_a_wiped_file_creates_the_identity_instead_of_failing() {
    let computer = Computer::open("import-after-wipe");
    computer
        .conn()
        .execute("DELETE FROM sync_state", [])
        .expect("the row is removed");

    let outcome = remint_install_on(computer.conn()).expect("the re-mint succeeds");

    assert_eq!(outcome, InstallOutcome::Created);
    assert_eq!(computer.state().link_state, sync_state::LinkState::Unlinked);
}

/// CAP-5 `replace`/`load_remote` mean "discard my local data", so the unsent log goes with it —
/// while the SHIPPED rows stay, because `next_seq` is derived from them (story 19).
#[test]
fn an_explicit_replace_drops_the_unsent_log_and_keeps_the_shipped_one() {
    let mut computer = Computer::open("replace");

    computer.write(|tx| fixtures::insert_income_source(tx, "Salary"));
    computer.cut().expect("the first batch ships");
    let shipped = computer.number("SELECT COUNT(*) FROM sync_log WHERE seq IS NOT NULL");
    assert!(shipped > 0, "nothing was marked shipped");

    computer.write(|tx| fixtures::insert_income_source(tx, "Consulting"));
    let unsent = computer.number("SELECT COUNT(*) FROM sync_log WHERE seq IS NULL");
    assert!(unsent > 0, "nothing is unsent, so the drop below proves nothing");

    let dropped = sync_capture::discard_unsent(computer.conn()).expect("the unsent rows are gone");

    assert_eq!(dropped as i64, unsent);
    assert_eq!(computer.number("SELECT COUNT(*) FROM sync_log WHERE seq IS NULL"), 0);
    assert_eq!(
        computer.number("SELECT COUNT(*) FROM sync_log WHERE seq IS NOT NULL"),
        shipped,
        "a shipped row was dropped, so the next cut would reuse a sequence number"
    );
}
