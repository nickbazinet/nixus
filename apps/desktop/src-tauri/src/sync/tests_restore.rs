//! Story 21's restore, retention and the derived-identity revival (AD-5, AD-12, AD-2).
//!
//! Real files, the real capture hook, real segments and the real apply path, like
//! `tests_apply.rs` — a restore is only correct if it travels, so nothing here hand-feeds a
//! message. Delete-wins in both arrival orders and the `RESTRICT` override are proven in
//! `tests_apply.rs` (`a_delete_beats_a_concurrent_edit_in_both_orders`,
//! `a_live_child_on_the_restrict_edge_overrides_the_account_tombstone`) and are not repeated here.

use rusqlite::Connection;
use tempfile::TempDir;

use crate::db::{
    capture_fixtures as fixtures, sync_apply as apply_db, sync_identity, test_dataset,
    ActiveDataset, WriteTx,
};
use crate::error::AppError;
use crate::models::{CreateAccountInput, DatasetKind};

use super::apply::{self, ApplyReport};
use super::capture::Capture;
use super::clock::Clock;
use super::identity;
use super::restore;
use super::segment::{self, SegmentBatch};
use super::state::ensure_install_on;

struct Computer {
    _dir: TempDir,
    dataset: ActiveDataset,
    apply: Connection,
    clock: Clock,
    install: String,
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
        let install = ensure_install_on(&conn)
            .expect("the install row reads")
            .install_id;

        Self {
            _dir: dir,
            dataset: ActiveDataset {
                id: Some("restore-test".to_string()),
                conn: Some(conn),
                capture: Some(capture),
            },
            clock: Clock::new(&install).expect("the clock builds"),
            install,
            apply,
        }
    }

    fn local_only() -> Self {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("nixus.db");
        let conn = test_dataset::migrated_dataset(&db_path);
        let apply = crate::db::open_configured(&db_path).expect("the apply connection opens");

        Self {
            _dir: dir,
            dataset: ActiveDataset {
                id: Some("local-only".to_string()),
                conn: Some(conn),
                capture: None,
            },
            clock: Clock::new("0123456789abcdef").expect("the clock builds"),
            install: "0123456789abcdef".to_string(),
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

    fn ship(&mut self) -> SegmentBatch {
        let schema_version = u32::try_from(crate::db::latest_schema_version()).unwrap_or(u32::MAX);
        let cut = segment::cut(self.conn(), &self.install, schema_version)
            .expect("the cut reads")
            .expect("there was something to ship");
        segment::mark_shipped(self.conn(), &cut).expect("the rows are marked");

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

    fn list(&self) -> restore::RecentlyDeletedView {
        restore::list(&self.dataset).expect("the view reads")
    }

    fn restore(&self, id: &str) -> Result<restore::RestoreOutcome, AppError> {
        let key = restore::TombstoneKey::parse(id)?;

        restore::restore(&self.dataset, &key)
    }
}

fn error_code(error: &AppError) -> String {
    match error {
        AppError::Sync { code, .. } => code.clone(),
        other => panic!("expected a typed sync error, got {other:?}"),
    }
}

/// A hint row written the way its production insert site does it: the row, then the derived
/// identity AD-2 requires, inside one captured write.
fn insert_hint(computer: &Computer, merchant: &str, category_id: i64) -> ([u8; 16], i64) {
    let category_uuid = computer.uuid_of("budget_categories", category_id);
    let uuid = identity::merchant_category_hint(merchant, &category_uuid);
    let merchant = merchant.to_string();

    let row_id = computer.write(|tx| {
        let row_id = fixtures::insert_merchant_hint(tx, &merchant, category_id)?;
        identity::ensure_derived(tx, "merchant_category_hints", row_id, &uuid)?;

        Ok(row_id)
    });

    (uuid, row_id)
}

#[test]
fn a_deleted_row_is_listed_with_a_label_and_restored_as_an_ordinary_captured_write() {
    let computer = Computer::open();

    let source = computer.write(|tx| fixtures::insert_income_source(tx, "Salary"));
    let original_uuid = computer.uuid_of("income_sources", source);
    computer.write(|tx| fixtures::delete_income_source(tx, source));
    assert_eq!(computer.number("SELECT COUNT(*) FROM income_sources"), 0);

    let view = computer.list();
    assert!(view.sync_available);
    assert_eq!(view.items.len(), 1, "the delete was not listed: {view:?}");
    let item = &view.items[0];
    assert_eq!(item.table_name, "income_sources");
    assert_eq!(item.label, "Salary");
    assert_eq!(item.child_count, 0);
    assert!(
        item.days_left > 27 && item.days_left <= 30,
        "a fresh delete should have most of its 30 days left, got {}",
        item.days_left
    );

    let messages_before = computer.number("SELECT COUNT(*) FROM sync_log WHERE kind = 'field'");
    let outcome = computer.restore(&item.id).expect("the restore succeeds");

    assert_eq!(outcome.restored_rows, 1);
    assert_eq!(computer.number("SELECT COUNT(*) FROM income_sources"), 1);
    assert_eq!(
        computer.number("SELECT COUNT(*) FROM income_sources WHERE name = 'Salary'"),
        1
    );
    assert!(
        computer.number("SELECT COUNT(*) FROM sync_log WHERE kind = 'field'") > messages_before,
        "the restored row produced no message, so it would never reach another computer"
    );
    assert!(
        computer.list().items.is_empty(),
        "the restored row is still listed as deleted"
    );

    // AD-2 + story 13: a surrogate row's uuid died with its tombstone, so it comes back as a new
    // identity rather than resurrecting one every other computer has absorbed.
    let restored_id = computer.number("SELECT id FROM income_sources LIMIT 1");
    assert_ne!(
        computer.uuid_of("income_sources", restored_id),
        original_uuid,
        "a surrogate row was restored under the identity its tombstone retired"
    );
}

#[test]
fn a_cascaded_group_is_listed_once_and_restored_whole() {
    let computer = Computer::open();

    let source = computer.write(|tx| fixtures::insert_income_source(tx, "Salary"));
    computer.write(|tx| fixtures::insert_income_entry(tx, source, 250_000, "2026-03-01"));
    computer.write(|tx| fixtures::insert_income_entry(tx, source, 250_000, "2026-04-01"));
    computer.write(|tx| fixtures::delete_income_source(tx, source));

    let view = computer.list();
    assert_eq!(
        view.items.len(),
        1,
        "the cascaded children were listed as their own deletes: {view:?}"
    );
    assert_eq!(view.items[0].child_count, 2);

    let outcome = computer
        .restore(&view.items[0].id)
        .expect("the restore succeeds");

    assert_eq!(outcome.restored_rows, 3);
    assert_eq!(computer.number("SELECT COUNT(*) FROM income_sources"), 1);
    assert_eq!(
        computer.number("SELECT COUNT(*) FROM income_entries"),
        2,
        "the cascaded children did not come back with their parent"
    );
    assert_eq!(
        computer.number(
            "SELECT COUNT(*) FROM income_entries e JOIN income_sources s ON s.id = e.source_id"
        ),
        2,
        "a restored child points at something other than its restored parent"
    );
    assert_eq!(
        computer.number("SELECT COUNT(*) FROM sync_tombstone"),
        0,
        "the group's tombstones outlived the restore"
    );
}

#[test]
fn a_natural_key_re_created_since_the_delete_restores_nothing_at_all() {
    let computer = Computer::open();

    let group = computer.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
    let category = computer.write(|tx| fixtures::insert_budget_category(tx, group, "Groceries"));
    let (uuid, hint) = insert_hint(&computer, "Metro", category);
    computer.write(|tx| {
        tx.execute(
            "DELETE FROM merchant_category_hints WHERE id = ?1",
            [hint],
        )?;

        Ok(())
    });

    // The same natural key again, from a path that binds no identity — which is what a row written
    // before this dataset was linked looks like (story 22's reconcile owns those).
    computer
        .dataset
        .write_uncaptured(|conn| fixtures::insert_merchant_hint(conn, "Metro", category))
        .expect("the unlinked-style write succeeds");

    let id = format!("merchant_category_hints:{}", hex(&uuid));
    let error = computer.restore(&id).expect_err("the restore must refuse");

    assert_eq!(error_code(&error), "restore_conflict");
    assert_eq!(
        computer.number("SELECT COUNT(*) FROM merchant_category_hints"),
        1,
        "the refused restore left a partially restored row behind"
    );
    assert_eq!(
        computer.number("SELECT COUNT(*) FROM sync_tombstone"),
        1,
        "the refused restore dropped the tombstone it could not use"
    );
}

#[test]
fn a_restore_whose_parent_is_no_longer_retained_is_refused() {
    let computer = Computer::open();

    let source = computer.write(|tx| fixtures::insert_income_source(tx, "Salary"));
    let entry = computer.write(|tx| fixtures::insert_income_entry(tx, source, 250_000, "2026-03-01"));
    let entry_uuid = computer.uuid_of("income_entries", entry);
    let source_uuid = computer.uuid_of("income_sources", source);

    computer.write(|tx| {
        tx.execute("DELETE FROM income_entries WHERE id = ?1", [entry])?;

        Ok(())
    });
    computer.write(|tx| fixtures::delete_income_source(tx, source));

    // The parent's retention window closed first (its tombstone was purged), which is the one way
    // a child can outlive what it belonged to.
    apply_db::delete_tombstone(computer.conn(), "income_sources", &source_uuid)
        .expect("the parent tombstone drops");

    let id = format!("income_entries:{}", hex(&entry_uuid));
    let error = computer.restore(&id).expect_err("the restore must refuse");

    assert_eq!(error_code(&error), "restore_parent_missing");
    assert_eq!(computer.number("SELECT COUNT(*) FROM income_entries"), 0);
    assert_eq!(computer.number("SELECT COUNT(*) FROM income_sources"), 0);
}

#[test]
fn an_account_comes_back_with_its_balance_and_publishes_it_as_a_balance_set() {
    let computer = Computer::open();

    let account = computer.write(|tx| {
        crate::db::account::insert_account(
            tx,
            &CreateAccountInput {
                name: "Chequing".to_string(),
                institution: "Test Bank".to_string(),
                account_type: "chequing".to_string(),
                currency: "CAD".to_string(),
            },
        )
    });
    computer.write(|tx| {
        crate::db::account::update_account_balance(tx, account.id, 123_456).map(|_| ())
    });
    computer.write(|tx| {
        tx.execute("DELETE FROM accounts WHERE id = ?1", [account.id])?;

        Ok(())
    });

    let view = computer.list();
    let item = view
        .items
        .iter()
        .find(|item| item.table_name == "accounts")
        .expect("the deleted account is listed");
    let sets_before = computer.number("SELECT COUNT(*) FROM sync_log WHERE kind = 'balance_set'");

    computer.restore(&item.id).expect("the restore succeeds");

    assert_eq!(
        computer.number("SELECT balance_cents FROM accounts LIMIT 1"),
        123_456,
        "the restored account lost its balance, which is i64 cents and never a float"
    );
    assert!(
        computer.number("SELECT COUNT(*) FROM sync_log WHERE kind = 'balance_set'") > sets_before,
        "the restored balance was not published, so another computer would hold 0"
    );
}

#[test]
fn a_restored_row_reaches_another_computer_as_an_ordinary_change() {
    let mut origin = Computer::open();
    let receiver = Computer::open();

    let source = origin.write(|tx| fixtures::insert_income_source(tx, "Salary"));
    let created = origin.ship();
    receiver.receive(&created);

    origin.write(|tx| fixtures::delete_income_source(tx, source));
    let deleted = origin.ship();
    receiver.receive(&deleted);
    assert_eq!(
        receiver.applied_number("SELECT COUNT(*) FROM income_sources"),
        0,
        "the delete did not reach the other computer"
    );

    let view = origin.list();
    origin
        .restore(&view.items[0].id)
        .expect("the restore succeeds");
    let restored = origin.ship();
    receiver.receive(&restored);

    assert_eq!(
        receiver.applied_number("SELECT COUNT(*) FROM income_sources WHERE name = 'Salary'"),
        1,
        "the restore did not travel"
    );
}

/// Story 20's OPEN item, closed: a DERIVED identity's uuid is a function of its key, so an
/// absorbing tombstone would make the row un-restorable on every other computer forever.
///
/// The two receivers see the delete (from A) and the restore (from B) in OPPOSITE orders, which is
/// the freedom AD-11 really leaves — segments of ONE install apply in `seq` order, so a delete and
/// the restore that undoes it can only be reordered when they come from different computers.
#[test]
fn a_restored_derived_row_converges_whichever_order_the_two_computers_messages_arrive_in() {
    let mut deleter = Computer::open();
    let mut restorer = Computer::open();
    let delete_first = Computer::open();
    let restore_first = Computer::open();

    let group = deleter.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
    let category = deleter.write(|tx| fixtures::insert_budget_category(tx, group, "Groceries"));
    let (uuid, hint) = insert_hint(&deleter, "Metro", category);
    let base = deleter.ship();
    for computer in [&restorer, &delete_first, &restore_first] {
        computer.receive(&base);
    }

    deleter.write(|tx| {
        tx.execute("DELETE FROM merchant_category_hints WHERE id = ?1", [hint])?;

        Ok(())
    });
    let delete = deleter.ship();
    restorer.receive(&delete);
    assert_eq!(
        restorer.applied_number("SELECT COUNT(*) FROM merchant_category_hints"),
        0,
        "the delete did not reach the computer that restores it"
    );

    let id = format!("merchant_category_hints:{}", hex(&uuid));
    restorer.restore(&id).expect("the restore succeeds");
    let restored = restorer.ship();

    assert!(
        sync_identity::row_id_for(restorer.conn(), "merchant_category_hints", &uuid)
            .expect("the mapping reads")
            .is_some(),
        "the restored derived row did not take the identity its key dictates"
    );

    delete_first.receive(&delete);
    delete_first.receive(&restored);

    restore_first.receive(&restored);
    restore_first.receive(&delete);

    for (name, computer) in [
        ("delete-first", &delete_first),
        ("restore-first", &restore_first),
    ] {
        assert_eq!(
            computer.applied_number("SELECT COUNT(*) FROM merchant_category_hints"),
            1,
            "the {name} computer disagrees about the restored derived row"
        );
        assert_eq!(
            computer.applied_number("SELECT COUNT(*) FROM sync_tombstone"),
            0,
            "the {name} computer kept a tombstone for a row that is alive"
        );
    }
}

/// AD-5: a partial edit is still absorbed, so the restore above does not weaken delete-wins.
#[test]
fn a_concurrent_edit_to_a_derived_row_still_loses_to_the_delete() {
    let mut origin = Computer::open();
    let mut editor = Computer::open();
    let receiver = Computer::open();

    let group = origin.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
    let category = origin.write(|tx| fixtures::insert_budget_category(tx, group, "Groceries"));
    let (uuid, hint) = insert_hint(&origin, "Metro", category);
    let base = origin.ship();
    editor.receive(&base);
    receiver.receive(&base);

    let editor_row = sync_identity::row_id_for(&editor.apply, "merchant_category_hints", &uuid)
        .expect("the mapping reads")
        .expect("the editor holds the row");
    editor.write(|tx| {
        tx.execute(
            "UPDATE merchant_category_hints SET confidence_score = 0.1 WHERE id = ?1",
            [editor_row],
        )?;

        Ok(())
    });
    let edit = editor.ship();

    origin.write(|tx| {
        tx.execute("DELETE FROM merchant_category_hints WHERE id = ?1", [hint])?;

        Ok(())
    });
    let delete = origin.ship();

    receiver.receive(&delete);
    receiver.receive(&edit);

    assert_eq!(
        receiver.applied_number("SELECT COUNT(*) FROM merchant_category_hints"),
        0,
        "a concurrent edit resurrected a deleted row"
    );
}

#[test]
fn an_expired_tombstone_is_purged_and_the_delete_message_is_untouched() {
    let computer = Computer::open();

    let kept = computer.write(|tx| fixtures::insert_income_source(tx, "Salary"));
    let expired = computer.write(|tx| fixtures::insert_income_source(tx, "Bonus"));
    let expired_uuid = computer.uuid_of("income_sources", expired);
    computer.write(|tx| fixtures::delete_income_source(tx, kept));
    computer.write(|tx| fixtures::delete_income_source(tx, expired));

    fixtures::expire_tombstone(computer.conn(), "income_sources", &expired_uuid)
        .expect("the tombstone ages");

    let messages = computer.number("SELECT COUNT(*) FROM sync_log WHERE kind = 'tombstone'");
    let removed =
        apply_db::purge_expired_tombstones(computer.conn()).expect("the sweep runs");

    assert_eq!(removed, 1);
    assert_eq!(computer.number("SELECT COUNT(*) FROM sync_tombstone"), 1);
    assert_eq!(computer.list().items.len(), 1);
    assert_eq!(
        computer.number("SELECT COUNT(*) FROM sync_log WHERE kind = 'tombstone'"),
        messages,
        "the sweep deleted a replication message, not just the restorable copy"
    );
}

#[test]
fn a_local_only_profile_reports_that_nothing_is_retained() {
    let computer = Computer::local_only();

    let source = computer.write(|tx| fixtures::insert_income_source(tx, "Salary"));
    computer.write(|tx| fixtures::delete_income_source(tx, source));

    let view = computer.list();

    assert!(
        !view.sync_available,
        "a profile with no capture hook cannot retain a delete and must say so"
    );
    assert!(view.items.is_empty());
    assert_eq!(computer.number("SELECT COUNT(*) FROM sync_tombstone"), 0);
}

#[test]
fn an_unparseable_handle_is_refused_without_touching_the_dataset() {
    for id in [
        "",
        "income_sources",
        "income_sources:zz",
        "sync_log:00000000000000000000000000000000",
        "not_a_table:00000000000000000000000000000000",
    ] {
        let error = restore::TombstoneKey::parse(id).expect_err("the handle must be refused");
        assert_eq!(error_code(&error), "restore_not_found", "for {id:?}");
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
