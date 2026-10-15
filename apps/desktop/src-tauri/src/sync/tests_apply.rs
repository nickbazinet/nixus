//! Story 20's apply path, against two real computers (AD-1, AD-11, AD-12).
//!
//! Every test here drives the REAL pipeline end to end on real files: a captured write on computer
//! A, a real segment cut and framed, then `sync::apply` on B's SECOND connection. Nothing is
//! simulated and nothing is hand-fed, because the properties being checked — delete-wins, the
//! applied vector's atomicity, the parking queue — are properties of that whole path and not of a
//! function's return value.
//!
//! The N-replica convergence gate lives in `sync::sim` (the real engine is Story 20's too). What
//! these add is the cases a randomized scenario cannot aim at: a poison message, a commit that
//! fails, a batch that dies midway, a message parked past its give-up window.

use rusqlite::Connection;
use tempfile::TempDir;

use crate::db::account::{self as account_db, BalanceCauseRow, CashFlowKind};
use crate::db::{capture_fixtures as fixtures, sync_apply as apply_db, sync_identity, test_dataset};
use crate::db::{ActiveDataset, WriteTx};
use crate::error::AppError;
use crate::models::{CreateAccountInput, DatasetKind};

use super::apply::{self, ApplyReport};
use super::capture::{payload, BalanceCause, Capture};
use super::clock::Clock;
use super::reconcile;
use super::segment::{self, MessageKind, SegmentBatch, SegmentMessage};
use super::state::ensure_install_on;

/// One computer: its own file, its own install id, the real hook on its write connection and the
/// real apply path on a second one.
struct Computer {
    _dir: TempDir,
    dataset: ActiveDataset,
    apply: Connection,
    clock: Clock,
    install: String,
    shipped: i64,
}

impl Computer {
    fn open() -> Self {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("nixus.db");
        let conn = test_dataset::migrated_dataset(&db_path);
        let capture = Capture::for_dataset(DatasetKind::CloudLinked, &conn)
            .expect("capture is built")
            .expect("a cloud-linked dataset captures");
        capture.attach(&conn).expect("the hook is installed");

        let apply = crate::db::open_configured(&db_path).expect("the apply connection opens");
        let install = ensure_install_on(&conn).expect("the install row reads").install_id;

        Self {
            _dir: dir,
            dataset: ActiveDataset {
                id: Some("apply-test".to_string()),
                conn: Some(conn),
                capture: Some(capture),
            },
            clock: Clock::new(&install).expect("the clock builds"),
            install,
            apply,
            shipped: 0,
        }
    }

    fn conn(&self) -> &Connection {
        self.dataset.conn.as_ref().expect("a computer has a connection")
    }

    fn write<T>(&self, operation: impl FnOnce(&WriteTx<'_>) -> Result<T, AppError>) -> T {
        self.dataset.write(operation).expect("the captured write succeeds")
    }

    /// Everything captured since the last ship, as the batch the pull side would hand to apply.
    fn ship(&mut self) -> SegmentBatch {
        let schema_version = u32::try_from(crate::db::latest_schema_version()).unwrap_or(u32::MAX);
        let cut = segment::cut(self.conn(), &self.install, schema_version)
            .expect("the cut reads")
            .expect("there was something to ship");
        segment::mark_shipped(self.conn(), &cut).expect("the rows are marked");
        self.shipped += 1;

        let verified = segment::read_segment(&cut.object, &cut.install, cut.seq)
            .expect("the segment this build wrote is readable");

        SegmentBatch {
            install: cut.install,
            seq: cut.seq,
            messages: verified.messages,
        }
    }

    fn receive(&self, batch: &SegmentBatch) -> ApplyReport {
        apply::apply_batch(&self.apply, &self.clock, batch).expect("the batch applies")
    }

    fn uuid_of(&self, table: &str, row_id: i64) -> [u8; 16] {
        sync_identity::lookup(self.conn(), table, row_id)
            .expect("the mapping reads")
            .unwrap_or_else(|| panic!("{table}#{row_id} has no identity"))
    }

    fn row_id_of(&self, table: &str, row_uuid: &[u8; 16]) -> Option<i64> {
        sync_identity::row_id_for(&self.apply, table, row_uuid).expect("the mapping reads")
    }

    fn text(&self, sql: &str) -> Option<String> {
        self.apply
            .query_row(sql, [], |row| row.get::<_, Option<String>>(0))
            .unwrap_or(None)
    }

    fn number(&self, sql: &str) -> i64 {
        self.apply.query_row(sql, [], |row| row.get(0)).expect("the count reads")
    }

    fn pragma(&self, name: &str) -> i64 {
        self.apply
            .query_row(&format!("PRAGMA {name}"), [], |row| row.get(0))
            .expect("the pragma reads")
    }

    fn seed_account(&self, name: &str) -> i64 {
        self.write(|tx| {
            account_db::insert_account(
                tx,
                &CreateAccountInput {
                    name: name.to_string(),
                    institution: "Test Bank".to_string(),
                    account_type: "chequing".to_string(),
                    currency: "CAD".to_string(),
                },
            )
        })
        .id
    }
}

/// Makes `receiver` agree with `origin` about what a row's identity is, which is what a real
/// segment exchange does on its own; used where a test seeds both sides directly.
fn adopt(receiver: &Computer, table: &str, row_id: i64, row_uuid: &[u8; 16]) {
    sync_identity::forget(receiver.conn(), table, row_id).expect("the local mapping drops");
    sync_identity::ensure(receiver.conn(), table, row_id, row_uuid).expect("the identity binds");
}

fn field_message(
    hlc: &str,
    table: &str,
    row_uuid: [u8; 16],
    cells: &[(&str, rusqlite::types::Value)],
) -> SegmentMessage {
    let encoded: Vec<(&str, Vec<u8>)> = cells
        .iter()
        .map(|(name, value)| (*name, payload::encode(value)))
        .collect();

    SegmentMessage {
        hlc: hlc.to_string(),
        kind: MessageKind::Field,
        table_name: table.to_string(),
        row_uuid,
        column_name: Some(super::capture::ROW_COLUMN_MARKER.to_string()),
        cause_uuid: None,
        payload: Some(payload::encode_row_of(&encoded)),
    }
}

/// A synthetic stamp in Story 13's frozen encoding.
///
/// Offset above every real NTP64 the local clock produces on purpose: a message has to be NEWER
/// than the captured write it is competing with, and the frozen encoding compares as text, so an
/// `0x1000` would silently lose to a real stamp and the test would pass vacuously.
fn stamp(order: u64, install: &str) -> String {
    format!("{:016x}-{install}", 0x7FFF_0000_0000_0000u64 + order)
}

#[test]
fn a_remote_insert_creates_the_row_with_the_identity_the_message_named() {
    let mut origin = Computer::open();
    let receiver = Computer::open();

    let group = origin.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
    let uuid = origin.uuid_of("budget_groups", group);
    let batch = origin.ship();

    let report = receiver.receive(&batch);

    assert!(report.applied > 0, "the batch applied nothing: {report:?}");
    assert_eq!(
        receiver.text("SELECT name FROM budget_groups LIMIT 1"),
        Some("Living".to_string())
    );
    assert!(
        receiver.row_id_of("budget_groups", &uuid).is_some(),
        "the row was created without binding the identity the message named"
    );
    assert_eq!(
        apply_db::applied_position(&receiver.apply, &batch.install).expect("the vector reads"),
        Some((0, batch.messages.len() as i64)),
        "the applied vector did not move with the rows"
    );
}

/// AD-5, per COLUMN and not per row: two computers editing different columns of one row both win.
#[test]
fn two_writers_win_the_column_each_wrote_last() {
    let mut left = Computer::open();
    let mut right = Computer::open();

    let group = left.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
    let uuid = left.uuid_of("budget_groups", group);
    let created = left.ship();
    right.receive(&created);

    let right_row = right.row_id_of("budget_groups", &uuid).expect("the row arrived");

    // `right` renames it, `left` moves it: different columns, so neither loses.
    right.write(|tx| fixtures::rename_budget_group(tx, right_row, "Renamed"));
    left.write(|tx| {
        tx.execute(
            "UPDATE budget_groups SET sort_order = 7 WHERE id = ?1",
            [group],
        )?;
        Ok(())
    });

    let renamed = right.ship();
    let reordered = left.ship();
    left.receive(&renamed);
    right.receive(&reordered);

    for computer in [&left, &right] {
        assert_eq!(
            computer.text("SELECT name FROM budget_groups LIMIT 1"),
            Some("Renamed".to_string()),
            "the rename was lost"
        );
        assert_eq!(
            computer.number("SELECT sort_order FROM budget_groups LIMIT 1"),
            7,
            "the reorder was lost"
        );
    }
}

/// The same column from two computers: the higher `hlc` wins, whatever the arrival order.
#[test]
fn the_later_stamp_wins_one_column_in_both_arrival_orders() {
    for deliver_older_last in [false, true] {
        let mut origin = Computer::open();
        let receiver = Computer::open();

        let group = origin.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
        let uuid = origin.uuid_of("budget_groups", group);
        let created = origin.ship();
        receiver.receive(&created);

        let older = field_message(
            &stamp(0x1000, "aaaaaaaaaaaaaaaa"),
            "budget_groups",
            uuid,
            &[("name", rusqlite::types::Value::Text("Older".into()))],
        );
        let newer = field_message(
            &stamp(0x2000, "aaaaaaaaaaaaaaaa"),
            "budget_groups",
            uuid,
            &[("name", rusqlite::types::Value::Text("Newer".into()))],
        );

        let messages = if deliver_older_last {
            vec![newer, older]
        } else {
            vec![older, newer]
        };
        receiver.receive(&SegmentBatch {
            install: "aaaaaaaaaaaaaaaa".to_string(),
            seq: 0,
            messages,
        });

        assert_eq!(
            receiver.text("SELECT name FROM budget_groups LIMIT 1"),
            Some("Newer".to_string()),
            "the older stamp won (older delivered last: {deliver_older_last})"
        );
    }
}

/// AD-6 expects duplicate delivery. Applying the same segment four times must change nothing, and
/// that has to hold for the kinds whose payload is an INCREMENT, not a value.
#[test]
fn re_applying_a_batch_changes_nothing_including_deltas_and_counters() {
    let mut origin = Computer::open();
    let receiver = Computer::open();

    let group = origin.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
    let category = origin.write(|tx| fixtures::insert_budget_category(tx, group, "Groceries"));
    let account = origin.seed_account("Chequing");
    let expense = origin.write(|tx| fixtures::insert_expense_row(tx, category, account, 2_500));
    origin.write(|tx| {
        account_db::adjust_account_balance(
            tx,
            account,
            CashFlowKind::Expense,
            2_500,
            BalanceCauseRow::new("expenses", expense, BalanceCause::Created),
        )
    });
    let hint = origin.write(|tx| {
        let id = fixtures::insert_merchant_hint(tx, "Metro", category)?;
        crate::sync::identity::ensure_derived(
            tx,
            "merchant_category_hints",
            id,
            &crate::sync::identity::merchant_category_hint(
                "Metro",
                &origin.uuid_of("budget_categories", category),
            ),
        )?;
        Ok(id)
    });
    origin.write(|tx| fixtures::bump_merchant_hint(tx, hint, 1));

    let batch = origin.ship();
    receiver.receive(&batch);

    let balance = receiver.number("SELECT balance_cents FROM accounts LIMIT 1");
    let usage = receiver.number("SELECT usage_count FROM merchant_category_hints LIMIT 1");
    let rows = receiver.number("SELECT COUNT(*) FROM expenses");

    for _ in 0..3 {
        receiver.receive(&batch);
    }

    assert_eq!(
        receiver.number("SELECT balance_cents FROM accounts LIMIT 1"),
        balance,
        "a re-delivered balance delta was counted twice"
    );
    assert_eq!(
        receiver.number("SELECT usage_count FROM merchant_category_hints LIMIT 1"),
        usage,
        "a re-delivered counter delta was counted twice"
    );
    assert_eq!(
        receiver.number("SELECT COUNT(*) FROM expenses"),
        rows,
        "a re-delivered insert created a second row"
    );
    assert_eq!(receiver.number("SELECT COUNT(*) FROM sync_quarantine"), 0);
}

/// AD-11: a child whose parent has not arrived is PARKED, and applies unchanged when it does.
#[test]
fn a_child_before_its_parent_parks_and_applies_when_the_parent_arrives() {
    let mut origin = Computer::open();
    let mut middle = Computer::open();
    let receiver = Computer::open();

    // The parent is created on one computer and the child on a SECOND, so the two travel in
    // segments of different installs and nothing about the pull side's per-install ordering says
    // which lands first.
    let source = origin.write(|tx| fixtures::insert_income_source(tx, "Employer"));
    let parent_batch = origin.ship();
    middle.receive(&parent_batch);
    let middle_source = middle
        .row_id_of("income_sources", &origin.uuid_of("income_sources", source))
        .expect("the source arrived");
    middle.write(|tx| fixtures::insert_income_entry(tx, middle_source, 400_000, "2026-03-01"));
    let child_batch = middle.ship();

    let report = receiver.receive(&child_batch);

    assert_eq!(report.parked, 1, "the child was not parked: {report:?}");
    assert_eq!(receiver.number("SELECT COUNT(*) FROM income_entries"), 0);
    assert_eq!(apply_db::parked_count(&receiver.apply).expect("the queue reads"), 1);

    receiver.receive(&parent_batch);

    assert_eq!(
        receiver.number("SELECT COUNT(*) FROM income_entries"),
        1,
        "the parked child did not apply once its parent arrived"
    );
    assert_eq!(apply_db::parked_count(&receiver.apply).expect("the queue reads"), 0);
    assert_eq!(receiver.number("SELECT COUNT(*) FROM sync_quarantine"), 0);
}

/// The bound AD-11 asks for: a message waiting for a row that never comes is quarantined with a
/// reason rather than waiting forever.
#[test]
fn a_message_parked_past_its_give_up_window_is_quarantined() {
    let mut origin = Computer::open();
    let mut middle = Computer::open();
    let receiver = Computer::open();

    let source = origin.write(|tx| fixtures::insert_income_source(tx, "Employer"));
    let parent_batch = origin.ship();
    middle.receive(&parent_batch);
    let middle_source = middle
        .row_id_of("income_sources", &origin.uuid_of("income_sources", source))
        .expect("the source arrived");
    middle.write(|tx| fixtures::insert_income_entry(tx, middle_source, 400_000, "2026-03-01"));
    let child_batch = middle.ship();

    receiver.receive(&child_batch);
    assert_eq!(apply_db::parked_count(&receiver.apply).expect("the queue reads"), 1);

    // Backdated rather than waited out: the window is measured in days.
    receiver
        .apply
        .execute(
            "UPDATE sync_pending SET received_at = datetime('now', ?1)",
            [format!("-{} days", apply::PENDING_GIVE_UP_DAYS + 1)],
        )
        .expect("the parked row is backdated");

    let unrelated = {
        let group = origin.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
        assert!(group > 0);
        origin.ship()
    };
    receiver.receive(&unrelated);

    assert_eq!(apply_db::parked_count(&receiver.apply).expect("the queue reads"), 0);
    assert_eq!(
        apply_db::quarantine_reasons(&receiver.apply).expect("the quarantine reads"),
        vec![("income_entries".to_string(), "apply_failed".to_string())]
    );
}

/// AD-11: a poison message goes to quarantine and does NOT stop the others, which is what the
/// per-message savepoint replay exists for.
#[test]
fn a_poison_message_is_quarantined_and_the_rest_of_the_batch_applies() {
    let mut origin = Computer::open();
    let receiver = Computer::open();

    let source = origin.write(|tx| fixtures::insert_income_source(tx, "Employer"));
    let entry = origin.write(|tx| fixtures::insert_income_entry(tx, source, 400_000, "2026-03-01"));
    let created = origin.ship();
    receiver.receive(&created);

    let entry_uuid = origin.uuid_of("income_entries", entry);
    let source_uuid = origin.uuid_of("income_sources", source);
    let install = "bbbbbbbbbbbbbbbb";

    // `income_entries.amount_cents` has a `CHECK(amount_cents > 0)`, so the first message cannot be
    // applied by any build; the second must land anyway.
    let batch = SegmentBatch {
        install: install.to_string(),
        seq: 0,
        messages: vec![
            field_message(
                &stamp(0x9000, install),
                "income_entries",
                entry_uuid,
                &[("amount_cents", rusqlite::types::Value::Integer(-1))],
            ),
            field_message(
                &stamp(0x9001, install),
                "income_sources",
                source_uuid,
                &[("name", rusqlite::types::Value::Text("Renamed".into()))],
            ),
        ],
    };

    let report = receiver.receive(&batch);

    assert_eq!(report.quarantined, 1, "the poison message was not quarantined: {report:?}");
    assert_eq!(
        apply_db::quarantine_reasons(&receiver.apply).expect("the quarantine reads"),
        vec![(
            "income_entries".to_string(),
            "constraint_violation".to_string()
        )]
    );
    assert_eq!(
        receiver.text("SELECT name FROM income_sources LIMIT 1"),
        Some("Renamed".to_string()),
        "a poison message blocked the message after it"
    );
    assert_eq!(
        receiver.number("SELECT amount_cents FROM income_entries LIMIT 1"),
        400_000,
        "the refused value was written anyway"
    );
    assert_eq!(
        apply_db::applied_position(&receiver.apply, install).expect("the vector reads"),
        Some((0, 2)),
        "the vector did not move past a batch that was fully dealt with"
    );
}

/// AD-11: the vector moves in the SAME transaction as the rows, so a batch that dies midway leaves
/// neither.
#[test]
fn a_batch_that_dies_midway_leaves_the_vector_and_the_rows_untouched() {
    let mut origin = Computer::open();
    let receiver = Computer::open();

    let group = origin.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
    let uuid = origin.uuid_of("budget_groups", group);
    let created = origin.ship();
    receiver.receive(&created);

    let before = receiver.text("SELECT name FROM budget_groups LIMIT 1");
    let vector_before =
        apply_db::applied_position(&receiver.apply, &created.install).expect("the vector reads");

    // An install id of the wrong width: every one of the three worklists CHECKs it, so recording
    // the message fails after its row write — the transaction dies with work already done.
    let doomed = SegmentBatch {
        install: "tooshort".to_string(),
        seq: 0,
        messages: vec![field_message(
            &stamp(0x9000, "aaaaaaaaaaaaaaaa"),
            "budget_groups",
            uuid,
            &[("name", rusqlite::types::Value::Text("Half applied".into()))],
        )],
    };

    let outcome = apply::apply_batch(&receiver.apply, &receiver.clock, &doomed);

    assert!(outcome.is_err(), "the doomed batch reported success: {outcome:?}");
    assert_eq!(
        receiver.text("SELECT name FROM budget_groups LIMIT 1"),
        before,
        "a rolled-back batch left its row behind"
    );
    assert_eq!(
        apply_db::applied_position(&receiver.apply, "tooshort").expect("the vector reads"),
        None,
        "the vector moved for a batch that never committed"
    );
    assert_eq!(
        apply_db::applied_position(&receiver.apply, &created.install).expect("the vector reads"),
        vector_before
    );
}

/// AD-11: a segment that would skip over a gap is refused, so the watermark never claims a segment
/// that was not applied. The pull side already buffers for contiguity; this is what keeps that from
/// being load-bearing.
#[test]
fn a_segment_that_skips_a_gap_is_refused_and_stays_owed() {
    let mut origin = Computer::open();
    let receiver = Computer::open();

    origin.write(|tx| fixtures::insert_budget_group(tx, "First", 0));
    let first = origin.ship();
    origin.write(|tx| fixtures::insert_budget_group(tx, "Second", 1));
    let second = origin.ship();
    origin.write(|tx| fixtures::insert_budget_group(tx, "Third", 2));
    let third = origin.ship();

    receiver.receive(&first);

    let refused = apply::apply_batch(&receiver.apply, &receiver.clock, &third);

    assert!(refused.is_err(), "a segment past a gap was applied: {refused:?}");
    assert_eq!(
        apply_db::applied_position(&receiver.apply, &third.install).expect("the vector reads"),
        Some((0, first.messages.len() as i64)),
        "the watermark moved past a segment that was never applied"
    );

    receiver.receive(&second);
    receiver.receive(&third);

    assert_eq!(
        receiver.number("SELECT COUNT(*) FROM budget_groups"),
        3,
        "the refused segment did not apply once its predecessor had"
    );
}

/// AD-5/AD-12: delete wins over a concurrent edit, in both arrival orders, and a second delete of
/// the same row changes nothing.
#[test]
fn a_delete_beats_a_concurrent_edit_in_both_orders() {
    for delete_first in [true, false] {
        let mut origin = Computer::open();
        let receiver = Computer::open();

        let group = origin.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
        let uuid = origin.uuid_of("budget_groups", group);
        let created = origin.ship();
        receiver.receive(&created);

        origin.write(|tx| {
            tx.execute("DELETE FROM budget_groups WHERE id = ?1", [group])?;
            Ok(())
        });
        let deleted = origin.ship();

        let edit = SegmentBatch {
            install: "cccccccccccccccc".to_string(),
            seq: 0,
            messages: vec![field_message(
                &stamp(0xFFFF_FFFF, "cccccccccccccccc"),
                "budget_groups",
                uuid,
                &[("name", rusqlite::types::Value::Text("Edited".into()))],
            )],
        };

        if delete_first {
            receiver.receive(&deleted);
            receiver.receive(&edit);
        } else {
            receiver.receive(&edit);
            receiver.receive(&deleted);
        }

        assert_eq!(
            receiver.number("SELECT COUNT(*) FROM budget_groups"),
            0,
            "an edit resurrected a deleted row (delete first: {delete_first})"
        );
        assert_eq!(
            receiver.number("SELECT COUNT(*) FROM sync_tombstone"),
            1,
            "the delete was not retained for a restore"
        );
        assert!(
            apply_db::tombstone(&receiver.apply, "budget_groups", &uuid)
                .expect("the tombstone reads")
                .is_some_and(|tombstone| tombstone.row_json.contains("Living")),
            "the retained row is not the row that was deleted"
        );

        receiver.receive(&deleted);
        assert_eq!(
            receiver.number("SELECT COUNT(*) FROM sync_tombstone"),
            1,
            "a second delete of one row produced a second tombstone"
        );
    }
}

/// AD-12: deleting a parent lets the schema's own CASCADE run, and every child it takes keeps a
/// tombstone of its own so a later message about it is absorbed rather than parked forever.
#[test]
fn a_cascaded_child_is_tombstoned_with_its_parent_and_a_late_edit_is_dropped() {
    let mut origin = Computer::open();
    let receiver = Computer::open();

    let source = origin.write(|tx| fixtures::insert_income_source(tx, "Employer"));
    let entry = origin.write(|tx| fixtures::insert_income_entry(tx, source, 400_000, "2026-03-01"));
    let entry_uuid = origin.uuid_of("income_entries", entry);
    let created = origin.ship();
    receiver.receive(&created);

    origin.write(|tx| {
        tx.execute("DELETE FROM income_sources WHERE id = ?1", [source])?;
        Ok(())
    });
    let deleted = origin.ship();
    receiver.receive(&deleted);

    assert_eq!(receiver.number("SELECT COUNT(*) FROM income_entries"), 0);
    assert!(
        apply_db::tombstone(&receiver.apply, "income_entries", &entry_uuid)
            .expect("the tombstone reads")
            .is_some(),
        "a cascaded child kept no tombstone"
    );

    let late = SegmentBatch {
        install: "dddddddddddddddd".to_string(),
        seq: 0,
        messages: vec![field_message(
            &stamp(0xFFFF_FFFF, "dddddddddddddddd"),
            "income_entries",
            entry_uuid,
            &[("amount_cents", rusqlite::types::Value::Integer(1))],
        )],
    };
    let report = receiver.receive(&late);

    assert_eq!(report.dropped, 1, "a message for a cascaded child was not dropped: {report:?}");
    assert_eq!(apply_db::parked_count(&receiver.apply).expect("the queue reads"), 0);
    assert_eq!(receiver.number("SELECT COUNT(*) FROM income_entries"), 0);
}

/// AD-5: a balance is the latest `balance_set` plus the deltas stamped after it, and a delta is
/// added VERBATIM — never recomputed against the receiver's own balance.
#[test]
fn a_balance_set_and_its_later_deltas_fold_to_the_value_the_origin_holds() {
    let mut origin = Computer::open();
    let receiver = Computer::open();

    let group = origin.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
    let category = origin.write(|tx| fixtures::insert_budget_category(tx, group, "Groceries"));
    let account = origin.seed_account("Credit Card");
    origin.write(|tx| account_db::update_account_balance(tx, account, -10_000));
    let expense = origin.write(|tx| fixtures::insert_expense_row(tx, category, account, 4_000));
    origin.write(|tx| {
        account_db::adjust_account_balance(
            tx,
            account,
            CashFlowKind::Expense,
            4_000,
            BalanceCauseRow::new("expenses", expense, BalanceCause::Created),
        )
    });

    let expected = origin
        .conn()
        .query_row("SELECT balance_cents FROM accounts LIMIT 1", [], |row| {
            row.get::<_, i64>(0)
        })
        .expect("the origin balance reads");

    let batch = origin.ship();
    receiver.receive(&batch);

    assert_eq!(
        receiver.number("SELECT balance_cents FROM accounts LIMIT 1"),
        expected,
        "the folded balance is not the one the origin holds"
    );
}

/// AD-5: two computers reacting to the SAME real-world cause contribute one delta.
#[test]
fn the_same_cause_from_two_computers_is_counted_once() {
    let mut left = Computer::open();
    let mut right = Computer::open();

    let group = left.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
    let category = left.write(|tx| fixtures::insert_budget_category(tx, group, "Groceries"));
    let account = left.seed_account("Chequing");
    let expense = left.write(|tx| fixtures::insert_expense_row(tx, category, account, 2_500));
    let created = left.ship();
    right.receive(&created);

    // Both computers delete the same expense, so both emit the SAME cause key.
    for (computer, account_id, expense_id) in [
        (&left, account, expense),
        (
            &right,
            right
                .row_id_of("accounts", &left.uuid_of("accounts", account))
                .expect("the account arrived"),
            right
                .row_id_of("expenses", &left.uuid_of("expenses", expense))
                .expect("the expense arrived"),
        ),
    ] {
        computer.write(|tx| {
            account_db::reverse_adjustment(
                tx,
                account_id,
                CashFlowKind::Expense,
                2_500,
                BalanceCauseRow::new("expenses", expense_id, BalanceCause::Deleted),
            )
        });
    }

    let left_reversal = left.ship();
    let right_reversal = right.ship();
    left.receive(&right_reversal);
    right.receive(&left_reversal);

    let left_balance = left.number("SELECT balance_cents FROM accounts LIMIT 1");
    let right_balance = right.number("SELECT balance_cents FROM accounts LIMIT 1");

    assert_eq!(left_balance, right_balance, "the two computers disagree about the balance");
    assert_eq!(
        left_balance, 2_500,
        "one real-world deletion was counted twice (expected the 2,500 the expense had taken back)"
    );
}

/// AD-5, fix F4: a remote delta addressed to a row that PREDATES capture must move the opening
/// balance the column holds instead of replacing it with the sum of the deltas — the remote
/// counterpart of the `require_base` guard the local re-fold has (fix F1) — and once Story 22's
/// reconcile publishes a base for that row the two computers must agree on one number.
#[test]
fn a_remote_delta_for_a_pre_capture_account_keeps_its_opening_balance() {
    let mut origin = Computer::open();
    let mut receiver = Computer::open();

    let group = origin.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
    let category = origin.write(|tx| fixtures::insert_budget_category(tx, group, "Groceries"));
    let origin_account = origin.seed_account("Chequing");
    let uuid = origin.uuid_of("accounts", origin_account);
    let expense =
        origin.write(|tx| fixtures::insert_expense_row(tx, category, origin_account, 2_500));
    origin.write(|tx| {
        account_db::reverse_adjustment(
            tx,
            origin_account,
            CashFlowKind::Expense,
            2_500,
            BalanceCauseRow::new("expenses", expense, BalanceCause::Deleted),
        )
    });

    // The receiver's account is the pre-capture row the fix is about: raw SQL on the connection
    // that carries no hook, so its 10,000 cents of opening balance are in the column and NOTHING
    // in the log describes them.
    let local_account =
        fixtures::insert_account(&receiver.apply, "Chequing", 10_000).expect("the row inserts");
    sync_identity::ensure(&receiver.apply, "accounts", local_account, &uuid)
        .expect("the identity binds");

    // Only the delta travels: the origin's own `balance_set` would hand the row the very base the
    // scenario is about not having yet.
    let shipped = origin.ship();
    let credit = SegmentBatch {
        install: shipped.install.clone(),
        seq: shipped.seq,
        messages: shipped
            .messages
            .iter()
            .filter(|message| message.kind == MessageKind::BalanceDelta)
            .cloned()
            .collect(),
    };
    assert_eq!(credit.messages.len(), 1, "the fixture must emit one delta");

    let report = receiver.receive(&credit);
    assert_eq!(report.applied, 1, "the delta did not apply: {report:?}");
    assert_eq!(
        receiver.number("SELECT balance_cents FROM accounts LIMIT 1"),
        12_500,
        "the remote credit wiped out the opening balance instead of moving it"
    );

    let reconciled = reconcile::reconcile_all(&receiver.apply, &receiver.clock, &receiver.install)
        .expect("the reconcile pass runs");
    assert_eq!(
        reconciled.balances, 1,
        "reconcile must publish the base the row never had: {reconciled:?}"
    );

    let published = receiver.ship();
    origin.receive(&published);

    assert_eq!(
        origin.number("SELECT balance_cents FROM accounts LIMIT 1"),
        receiver.number("SELECT balance_cents FROM accounts LIMIT 1"),
        "the two computers disagree once the base is published"
    );
    assert_eq!(
        origin.number("SELECT balance_cents FROM accounts LIMIT 1"),
        12_500,
        "and they agree on the opening balance plus the credit"
    );
}

/// AD-5: remote-applied changes write NO audit row and produce NO message of this computer's own.
/// The capture hook is per connection, so this is structural — the test is what proves it stayed
/// structural.
#[test]
fn apply_writes_no_audit_row_and_no_message_of_its_own() {
    let mut origin = Computer::open();
    let receiver = Computer::open();

    let group = origin.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
    origin.write(|tx| fixtures::rename_budget_group(tx, group, "Renamed"));
    origin.write(|tx| {
        tx.execute("DELETE FROM budget_groups WHERE id = ?1", [group])?;
        Ok(())
    });
    let batch = origin.ship();

    receiver.receive(&batch);

    assert_eq!(
        receiver.number("SELECT COUNT(*) FROM audit_log"),
        0,
        "apply wrote an audit row"
    );
    assert_eq!(
        receiver.number("SELECT COUNT(*) FROM sync_log WHERE install = (SELECT install_id FROM sync_state)"),
        0,
        "apply captured its own writes as new messages"
    );
    assert_eq!(
        receiver.number("SELECT COUNT(*) FROM sync_log WHERE seq IS NULL"),
        0,
        "apply left unshipped messages behind, which the segment cutter would publish"
    );
    assert_eq!(
        receiver.number("SELECT COUNT(*) FROM sync_log"),
        batch.messages.len() as i64,
        "the recorded messages are not exactly the ones that arrived"
    );
}

/// AD-11's pragma contract, including the trap that makes it a contract rather than a formality:
/// SQLite clears `defer_foreign_keys` at every commit, and refuses `foreign_keys` INSIDE a
/// transaction.
#[test]
fn the_apply_connection_enforces_foreign_keys_and_defers_them_only_per_transaction() {
    let mut origin = Computer::open();
    let receiver = Computer::open();

    let source = origin.write(|tx| fixtures::insert_income_source(tx, "Employer"));
    origin.write(|tx| fixtures::insert_income_entry(tx, source, 400_000, "2026-03-01"));
    let batch = origin.ship();
    receiver.receive(&batch);

    assert_eq!(
        receiver.pragma("foreign_keys"),
        1,
        "the apply connection is not enforcing foreign keys"
    );
    assert_eq!(
        receiver.pragma("defer_foreign_keys"),
        0,
        "SQLite is expected to clear this at commit, which is why apply re-issues it per transaction"
    );

    // The cascade AD-12 relies on is the schema's, so it has to be live on this connection.
    let source_row = receiver
        .row_id_of("income_sources", &origin.uuid_of("income_sources", source))
        .expect("the source arrived");
    receiver
        .apply
        .execute("DELETE FROM income_sources WHERE id = ?1", [source_row])
        .expect("the delete runs");

    assert_eq!(
        receiver.number("SELECT COUNT(*) FROM income_entries"),
        0,
        "the schema's ON DELETE CASCADE did not run on the apply connection"
    );
}

/// A message this build cannot place is recorded with a reason and never crashes the actor
/// (AD-11, CAP-7). Story 24 completes the user-facing states.
#[test]
fn a_message_naming_an_unknown_table_or_column_is_quarantined() {
    let receiver = Computer::open();
    let install = "eeeeeeeeeeeeeeee";

    let batch = SegmentBatch {
        install: install.to_string(),
        seq: 0,
        messages: vec![
            field_message(
                &stamp(0x1000, install),
                "a_table_from_a_newer_build",
                [1; 16],
                &[("whatever", rusqlite::types::Value::Integer(1))],
            ),
            field_message(
                &stamp(0x1001, install),
                "budget_groups",
                [2; 16],
                &[("a_column_from_a_newer_build", rusqlite::types::Value::Integer(1))],
            ),
            SegmentMessage {
                hlc: stamp(0x1002, install),
                kind: MessageKind::Tombstone,
                table_name: "budget_groups".to_string(),
                row_uuid: [3; 16],
                column_name: None,
                cause_uuid: None,
                payload: Some(payload::encode(&rusqlite::types::Value::Text(
                    "not json".into(),
                ))),
            },
        ],
    };

    let report = receiver.receive(&batch);

    assert_eq!(report.quarantined, 3, "a message this build cannot place was not recorded: {report:?}");
    assert_eq!(
        apply_db::quarantine_reasons(&receiver.apply).expect("the quarantine reads"),
        vec![
            ("a_table_from_a_newer_build".to_string(), "unknown_table".to_string()),
            ("budget_groups".to_string(), "unknown_column".to_string()),
            ("budget_groups".to_string(), "malformed_payload".to_string()),
        ]
    );
    assert_eq!(
        apply_db::applied_position(&receiver.apply, install).expect("the vector reads"),
        Some((0, 3)),
        "a batch of messages this build cannot apply must still not be owed forever"
    );
}

/// A `LocalOnly` table never travels, so a message naming one is refused rather than written: it is
/// either a bug or a forged object, and both are the same answer.
#[test]
fn a_message_naming_a_local_only_table_is_refused() {
    let receiver = Computer::open();
    let install = "ffffffffffffffff";

    let report = receiver.receive(&SegmentBatch {
        install: install.to_string(),
        seq: 0,
        messages: vec![field_message(
            &stamp(0x1000, install),
            "sync_state",
            [4; 16],
            &[("install_id", rusqlite::types::Value::Text("hijacked".into()))],
        )],
    });

    assert_eq!(report.quarantined, 1);
    assert_eq!(
        receiver.text("SELECT install_id FROM sync_state LIMIT 1"),
        Some(receiver.install.clone()),
        "a remote message rewrote this computer's own install id"
    );
}

/// AD-11 applies at most 500 messages per transaction. The boundary is where the vector and the
/// per-message dedup have to agree, so it gets its own case.
#[test]
fn a_batch_larger_than_one_transaction_applies_every_message_once() {
    let receiver = Computer::open();
    let install = "1111111111111111";
    let count = apply::APPLY_MAX_MESSAGES + 7;

    let messages: Vec<SegmentMessage> = (0..count)
        .map(|index| {
            let mut row_uuid = [0u8; 16];
            row_uuid[..8].copy_from_slice(&(index as u64).to_be_bytes());
            row_uuid[8] = 0x5A;

            field_message(
                &stamp(0x2000 + index as u64, install),
                "budget_groups",
                row_uuid,
                &[
                    (
                        "name",
                        rusqlite::types::Value::Text(format!("Group {index}")),
                    ),
                    ("sort_order", rusqlite::types::Value::Integer(index as i64)),
                ],
            )
        })
        .collect();

    let batch = SegmentBatch {
        install: install.to_string(),
        seq: 0,
        messages,
    };
    let report = receiver.receive(&batch);

    assert_eq!(report.applied, count, "not every message applied: {report:?}");
    assert_eq!(receiver.number("SELECT COUNT(*) FROM budget_groups"), count as i64);
    assert_eq!(
        apply_db::applied_position(&receiver.apply, install).expect("the vector reads"),
        Some((0, count as i64))
    );

    receiver.receive(&batch);
    assert_eq!(
        receiver.number("SELECT COUNT(*) FROM budget_groups"),
        count as i64,
        "re-delivering a multi-transaction batch duplicated its rows"
    );
}

/// AD-12's one `RESTRICT` edge: a live child wins and the account's tombstone is overridden — but
/// it is held, not forgotten, so the delete still happens once the child is gone.
#[test]
fn a_live_child_on_the_restrict_edge_overrides_the_account_tombstone() {
    let mut origin = Computer::open();
    let receiver = Computer::open();

    let account = origin.seed_account("Chequing");
    let account_uuid = origin.uuid_of("accounts", account);
    let created = origin.ship();
    receiver.receive(&created);

    let receiver_account = receiver
        .row_id_of("accounts", &account_uuid)
        .expect("the account arrived");

    // A project contribution funded by that account is the schema's RESTRICT child.
    let contribution = receiver.write(|tx| {
        tx.execute(
            "INSERT INTO projects (name, target_cents, priority) VALUES ('Trip', 100000, 1)",
            [],
        )?;
        let project = tx.last_insert_rowid();
        tx.execute(
            "INSERT INTO project_contributions (project_id, account_id, amount_cents, source, date) \
             VALUES (?1, ?2, 5000, 'manual', '2026-03-01')",
            rusqlite::params![project, receiver_account],
        )?;

        Ok(tx.last_insert_rowid())
    });

    origin.write(|tx| {
        tx.execute("DELETE FROM accounts WHERE id = ?1", [account])?;
        Ok(())
    });
    let deleted = origin.ship();

    let report = receiver.receive(&deleted);

    assert_eq!(report.parked, 1, "the blocked tombstone was not held: {report:?}");
    assert_eq!(
        receiver.number("SELECT COUNT(*) FROM accounts"),
        1,
        "the account was deleted while a live contribution still funded it"
    );
    assert_eq!(receiver.number("SELECT COUNT(*) FROM sync_tombstone"), 0);

    receiver.write(|tx| {
        tx.execute(
            "DELETE FROM project_contributions WHERE id = ?1",
            [contribution],
        )?;
        Ok(())
    });

    let unrelated = {
        origin.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
        origin.ship()
    };
    receiver.receive(&unrelated);

    assert_eq!(
        receiver.number("SELECT COUNT(*) FROM accounts"),
        0,
        "the held tombstone did not apply once the child was gone"
    );
    assert_eq!(apply_db::parked_count(&receiver.apply).expect("the queue reads"), 0);
}

/// AD-12: a delta addressed to an account that is already deleted is kept against the row retained
/// in `sync_tombstone`, so a restore brings back the balance the other computers agree on.
#[test]
fn a_delta_for_a_tombstoned_account_lands_in_the_retained_row() {
    let mut origin = Computer::open();
    let receiver = Computer::open();

    let group = origin.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
    origin.write(|tx| fixtures::insert_budget_category(tx, group, "Groceries"));
    let account = origin.seed_account("Chequing");
    origin.write(|tx| account_db::update_account_balance(tx, account, 50_000));
    let account_uuid = origin.uuid_of("accounts", account);
    let created = origin.ship();
    receiver.receive(&created);

    origin.write(|tx| {
        tx.execute("DELETE FROM accounts WHERE id = ?1", [account])?;
        Ok(())
    });
    let deleted = origin.ship();
    receiver.receive(&deleted);

    // A second computer had not heard about the delete and spends from the account. It builds its
    // own rows and then adopts the identities a real segment exchange would have given it.
    let mut other = Computer::open();
    let other_group = other.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
    let other_category =
        other.write(|tx| fixtures::insert_budget_category(tx, other_group, "Groceries"));
    let other_account = other.seed_account("Chequing");
    adopt(&other, "accounts", other_account, &account_uuid);
    let other_expense =
        other.write(|tx| fixtures::insert_expense_row(tx, other_category, other_account, 1_500));

    // Its own setup is not what this test is about: shipped and dropped, so the batch that reaches
    // the receiver holds exactly the balance delta.
    let _setup = other.ship();
    other.write(|tx| {
        account_db::adjust_account_balance(
            tx,
            other_account,
            CashFlowKind::Expense,
            1_500,
            BalanceCauseRow::new("expenses", other_expense, BalanceCause::Created),
        )
    });
    let spent = other.ship();

    receiver.receive(&spent);

    let retained = apply_db::tombstone(&receiver.apply, "accounts", &account_uuid)
        .expect("the tombstone reads")
        .expect("the account is retained");
    let row: serde_json::Value =
        serde_json::from_str(&retained.row_json).expect("the retained row is JSON");

    assert_eq!(
        row.get("balance_cents").and_then(serde_json::Value::as_i64),
        Some(48_500),
        "the delta was lost instead of being kept against the retained row"
    );
    assert_eq!(
        receiver.number("SELECT COUNT(*) FROM accounts"),
        0,
        "the account came back"
    );
}
