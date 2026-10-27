//! Reconcile (AD-3), driven with DELIBERATELY UNWRAPPED writes: raw statements on the UI
//! connection, outside `ActiveDataset::write`, which is exactly what an unmigrated write site is.
//!
//! The hook is installed on that connection, so a raw statement is still OBSERVED — it lands in the
//! capture buffer and is discarded, because nothing ever flushes it. That is the real failure mode
//! AD-3 names ("changes that never reach `sync_log`"), and it is the one these tests create.
//!
//! Real files, real hook, real segments, real apply: convergence is the only thing that matters
//! about a reconcile message, so nothing here hand-feeds one.

use rusqlite::Connection;
use tempfile::TempDir;

use crate::db::sync_capture::{self, StoredMessage};
use crate::db::{capture_fixtures as fixtures, sync_apply as apply_db, sync_identity, test_dataset};
use crate::db::{ActiveDataset, WriteTx};
use crate::error::AppError;
use crate::models::DatasetKind;

use super::apply::{self, ApplyReport};
use super::capture::Capture;
use super::clock::Clock;
use super::identity;
use super::reconcile::{self, ReconcileReport};
use super::registry;
use super::restore;
use super::segment::{self, SegmentBatch};
use super::state::ensure_install_on;

/// The template every computer in these tests derives a recurring occurrence from.
///
/// A literal and not a real `recurring_expense_templates` row, deliberately: the whole point of the
/// rule under test is that a `field` message says NOTHING about the template it came from, so a
/// replica's decision must not depend on holding it.
const TEMPLATE: [u8; 16] = [0x44; 16];
const PERIOD: &str = "2026-03";

struct Computer {
    _dir: TempDir,
    dataset: ActiveDataset,
    apply: Connection,
    clock: Clock,
    install: String,
}

impl Computer {
    fn open() -> Self {
        Self::build(DatasetKind::CloudLinked)
    }

    fn local_only() -> Self {
        Self::build(DatasetKind::Local)
    }

    fn build(kind: DatasetKind) -> Self {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("nixus.db");
        let conn = test_dataset::migrated_dataset(&db_path);
        let capture = Capture::for_dataset(kind, &conn).expect("capture is built");
        if let Some(capture) = &capture {
            capture.attach(&conn).expect("the hook is installed");
        }

        // The connection reconcile runs on: the hook is per connection, so this one captures
        // nothing by construction (AD-11's apply connection is the same arrangement).
        let apply = crate::db::open_configured(&db_path).expect("the second connection opens");
        let install = ensure_install_on(&conn)
            .expect("the install row reads")
            .install_id;

        Self {
            _dir: dir,
            dataset: ActiveDataset {
                id: Some("reconcile-test".to_string()),
                conn: Some(conn),
                capture,
            },
            clock: Clock::new(&install).expect("the clock builds"),
            install,
            apply,
        }
    }

    fn conn(&self) -> &Connection {
        self.dataset.conn.as_ref().expect("a connection")
    }

    fn write<T>(&self, operation: impl FnOnce(&WriteTx<'_>) -> Result<T, AppError>) -> T {
        self.dataset
            .write(operation)
            .expect("the captured write succeeds")
    }

    /// A write with no `ActiveDataset::write` around it: the unmigrated write site.
    fn unwrapped<T>(&self, operation: impl FnOnce(&Connection) -> Result<T, AppError>) -> T {
        operation(self.conn()).expect("the raw write succeeds")
    }

    fn reconcile(&self) -> ReconcileReport {
        reconcile::reconcile_all(&self.apply, &self.clock, &self.install)
            .expect("the reconcile pass runs")
    }

    fn messages(&self) -> Vec<StoredMessage> {
        sync_capture::unshipped_messages(self.conn()).expect("the log reads")
    }

    /// Everything emitted about one table since the log was last drained.
    fn messages_for(&self, table: &str) -> Vec<StoredMessage> {
        self.messages()
            .into_iter()
            .filter(|message| message.table_name == table)
            .collect()
    }

    /// Drops every message, so a later assertion is about what the NEXT thing did.
    ///
    /// Through the real segment cutter and its shipping mark: the rows have to leave the unshipped
    /// tail the way production empties it, not by a DELETE that would also erase the balance and
    /// counter history apply folds over.
    fn drain(&mut self) -> Vec<SegmentBatch> {
        let mut batches = Vec::new();
        while let Some(batch) = self.try_ship() {
            batches.push(batch);
        }

        batches
    }

    fn try_ship(&mut self) -> Option<SegmentBatch> {
        let schema_version = u32::try_from(crate::db::latest_schema_version()).unwrap_or(u32::MAX);
        let cut = segment::cut(self.conn(), &self.install, schema_version)
            .expect("the cut reads")?;
        segment::mark_shipped(self.conn(), &cut).expect("the rows are marked");

        let verified = segment::read_segment(&cut.object, &cut.install, cut.seq)
            .expect("the segment this build wrote is readable");

        Some(SegmentBatch {
            install: cut.install,
            seq: cut.seq,
            messages: verified.messages,
        })
    }

    fn receive(&self, batch: &SegmentBatch) -> ApplyReport {
        apply::apply_batch(&self.apply, &self.clock, batch).expect("the batch applies")
    }

    fn receive_all(&self, batches: &[SegmentBatch]) {
        for batch in batches {
            self.receive(batch);
        }
    }

    fn uuid_of(&self, table: &str, row_id: i64) -> [u8; 16] {
        sync_identity::lookup(self.conn(), table, row_id)
            .expect("the mapping reads")
            .unwrap_or_else(|| panic!("{table}#{row_id} has no identity"))
    }

    fn row_id_of(&self, table: &str, uuid: &[u8; 16]) -> Option<i64> {
        sync_identity::row_id_for(self.conn(), table, uuid).expect("the mapping reads")
    }

    fn with_conn<T>(&self, read: impl FnOnce(&Connection) -> Result<T, AppError>) -> T {
        read(self.conn()).expect("the read succeeds")
    }

    fn group_name(&self, id: i64) -> Option<String> {
        fixtures::budget_group_name(self.conn(), id).expect("the name reads")
    }

    /// A category and an account both computers agree on, so an expense can reference them.
    fn seed_finance(&mut self) -> (i64, i64) {
        let (category, account) = self.write(|tx| {
            let group = fixtures::insert_budget_group(tx, "Living", 0)?;
            let category = fixtures::insert_budget_category(tx, group, "Groceries")?;
            let account = fixtures::insert_account(tx, "Chequing", 10_000)?;

            Ok((category, account))
        });

        (category, account)
    }
}

/// One generated occurrence, bound to the identity every computer derives for it (AD-2), exactly as
/// `db::recurring::bind_generated_expense_identity` does at the real insert site.
fn generate_occurrence(computer: &Computer, category: i64, account: i64) -> i64 {
    computer.write(|tx| {
        let expense = fixtures::insert_expense_row(tx, category, account, 4_200)?;
        identity::ensure_derived(
            tx,
            "expenses",
            expense,
            &identity::recurring_expense(&TEMPLATE, PERIOD),
        )?;

        Ok(expense)
    })
}

#[test]
fn an_unwrapped_update_of_a_synced_column_emits_the_missing_field() {
    let mut computer = Computer::open();
    let group = computer.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
    computer.drain();

    computer.unwrapped(|conn| fixtures::rename_budget_group(conn, group, "Renamed"));
    assert!(
        computer.messages_for("budget_groups").is_empty(),
        "an unwrapped write produces no message, which is the whole problem AD-3 solves"
    );

    let report = computer.reconcile();
    assert_eq!(report.fields, 1, "one row-level field message: {report:?}");

    let emitted = computer.messages_for("budget_groups");
    assert_eq!(emitted.len(), 1);
    assert_eq!(emitted[0].kind, "field");
    assert_eq!(emitted[0].install, computer.install);

    // Only the column that actually moved travels: the others still hash to their recorded value.
    let cells = super::capture::payload::decode_row(
        emitted[0].payload.as_deref().expect("a field message has a payload"),
    )
    .expect("the payload decodes");
    assert_eq!(
        cells.iter().map(|(name, _)| name.as_str()).collect::<Vec<_>>(),
        vec!["name"]
    );
}

#[test]
fn an_unwrapped_insert_emits_a_creation_message_with_every_column() {
    let mut computer = Computer::open();
    computer.reconcile();
    computer.drain();

    let group = computer.unwrapped(|conn| fixtures::insert_budget_group(conn, "Living", 0));
    assert_eq!(
        sync_identity::lookup(computer.conn(), "budget_groups", group).expect("reads"),
        None,
        "a row nothing captured has no identity yet"
    );

    let report = computer.reconcile();
    assert_eq!(report.fields, 1, "{report:?}");

    let emitted = computer.messages_for("budget_groups");
    assert_eq!(emitted.len(), 1);
    assert_eq!(emitted[0].row_uuid, computer.uuid_of("budget_groups", group));

    // A creation message is the one a replica can build the row from, which is what
    // `apply::is_whole_row` asks of it: every column that travels in a field message.
    let cells = super::capture::payload::decode_row(
        emitted[0].payload.as_deref().expect("a payload"),
    )
    .expect("the payload decodes");
    let expected: Vec<&str> = registry::columns_of("budget_groups")
        .filter(|column| !matches!(column.merge, registry::MergeKind::LocalId))
        .map(|column| column.column)
        .collect();
    for column in expected {
        assert!(
            cells.iter().any(|(name, _)| name == column),
            "the creation message must carry {column}"
        );
    }
}

#[test]
fn an_unwrapped_delete_emits_a_tombstone_that_names_itself_unrestorable() {
    let mut computer = Computer::open();
    let group = computer.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
    let uuid = computer.uuid_of("budget_groups", group);
    computer.drain();

    computer.unwrapped(fixtures::delete_every_budget_group);

    let report = computer.reconcile();
    assert_eq!(report.tombstones, 1, "{report:?}");

    let emitted = computer.messages_for("budget_groups");
    assert_eq!(emitted.len(), 1);
    assert_eq!(emitted[0].kind, "tombstone");
    assert_eq!(emitted[0].row_uuid, uuid);

    // AD-2: the mapping goes with the tombstone, or a reused rowid would inherit the identity.
    assert_eq!(computer.row_id_of("budget_groups", &uuid), None);

    // The row itself is gone, so there is nothing to retain — and the retained document says so
    // rather than pretending to be a row.
    let retained = apply_db::tombstone(computer.conn(), "budget_groups", &uuid)
        .expect("the tombstone reads")
        .expect("a tombstone was recorded");
    assert!(reconcile::is_reconciled_delete(&retained.row_json));

    let view = restore::list(&computer.dataset).expect("the view reads");
    assert!(
        view.items.is_empty(),
        "an item nothing can be restored from must not be offered: {:?}",
        view.items
    );

    let key = restore::TombstoneKey::parse(&format!(
        "budget_groups:{}",
        uuid.iter().map(|byte| format!("{byte:02x}")).collect::<String>()
    ))
    .expect("the handle parses");
    let refused = restore::restore(&computer.dataset, &key).expect_err("a restore must refuse");
    assert!(
        matches!(&refused, AppError::Sync { code, .. } if code == "restore_not_found"),
        "got {refused:?}"
    );
}

#[test]
fn an_unwrapped_balance_change_emits_a_balance_set_and_never_a_field() {
    let mut computer = Computer::open();
    let account = computer.write(|tx| fixtures::insert_account(tx, "Chequing", 10_000));
    computer.drain();

    computer.unwrapped(|conn| {
        fixtures::set_account_balance_directly(conn, account, 7_500, "2026-03-04T00:00:00Z")
    });

    let report = computer.reconcile();
    assert_eq!((report.balances, report.fields), (1, 1), "{report:?}");

    let emitted = computer.messages_for("accounts");
    let kinds: Vec<&str> = emitted.iter().map(|message| message.kind.as_str()).collect();
    assert_eq!(
        kinds.iter().filter(|kind| **kind == "balance_set").count(),
        1,
        "AD-3: a changed balance emits balance_set"
    );
    assert!(
        !kinds.contains(&"balance_delta"),
        "reconcile does not know WHY a balance moved, so it must never invent a cause"
    );

    // The field message beside it is `updated_at`, which the same statement moved — and it must NOT
    // contain `balance_cents`, which AD-5 keeps out of every field message.
    let field = emitted
        .iter()
        .find(|message| message.kind == "field")
        .expect("the statement moved a captured column too");
    let cells = super::capture::payload::decode_row(field.payload.as_deref().expect("a payload"))
        .expect("the payload decodes");
    assert!(cells.iter().all(|(name, _)| name != "balance_cents"));

    // The fold a replica would compute now agrees with the table, which is what "tables are truth"
    // has to mean operationally.
    let uuid = computer.uuid_of("accounts", account);
    assert_eq!(
        apply::balance_value(computer.conn(), "accounts", &uuid).expect("the fold reads"),
        7_500
    );
}

#[test]
fn an_unwrapped_counter_change_emits_the_difference_as_a_delta() {
    let mut computer = Computer::open();
    let (category, _account) = computer.seed_finance();
    let hint = computer.write(|tx| {
        let hint = fixtures::insert_merchant_hint(tx, "Metro", category)?;
        identity::ensure_derived(
            tx,
            "merchant_category_hints",
            hint,
            &identity::merchant_category_hint("Metro", &sync_identity::lookup(
                tx,
                "budget_categories",
                category,
            )?
            .expect("the category has an identity")),
        )?;

        Ok(hint)
    });
    computer.reconcile();
    computer.drain();

    computer.unwrapped(|conn| fixtures::bump_merchant_hint(conn, hint, 4));

    let report = computer.reconcile();
    assert_eq!(report.counters, 1, "{report:?}");

    let emitted = computer.messages_for("merchant_category_hints");
    let delta = emitted
        .iter()
        .find(|message| message.kind == "counter_delta")
        .expect("a counter emits a delta");
    assert_eq!(delta.column_name.as_deref(), Some("usage_count"));

    // The DIFFERENCE and not the value: a counter's value is the sum of its deltas (AD-5), so the
    // fold over the log must now equal what the table holds.
    let uuid = computer.uuid_of("merchant_category_hints", hint);
    assert_eq!(
        apply::counter_total(computer.conn(), "merchant_category_hints", &uuid, "usage_count")
            .expect("the fold reads"),
        5,
        "the row was created at 1 and bumped by 4"
    );
}

#[test]
fn a_deny_listed_config_key_is_never_reconciled_and_every_other_one_is() {
    let mut computer = Computer::open();
    computer.reconcile();
    computer.drain();

    computer.unwrapped(|conn| fixtures::set_config_directly(conn, "ai_provider", "bedrock"));
    computer.unwrapped(|conn| fixtures::set_config_directly(conn, "theme", "dark"));

    computer.reconcile();

    let emitted = computer.messages_for("config");
    assert_eq!(emitted.len(), 1, "exactly the key that is allowed to travel");
    assert_eq!(
        emitted[0].row_uuid,
        identity::config_key("theme"),
        "and it travels under the identity its key derives"
    );

    // AD-5's reason for answering BEFORE any identity: a deny-listed key must not even acquire a
    // `sync_uuid` row, because `config` is `Natural` and that row is machine-independent.
    assert_eq!(
        computer.row_id_of("config", &identity::config_key("ai_provider")),
        None
    );
}

#[test]
fn a_local_only_table_edit_emits_nothing() {
    let mut computer = Computer::open();
    computer.reconcile();
    computer.drain();

    computer.unwrapped(fixtures::touch_local_only_table);

    let report = computer.reconcile();
    assert_eq!(report.messages(), 0, "{report:?}");
    assert!(
        computer.messages().is_empty(),
        "a LocalOnly table never travels (AD-5), so nothing may describe it"
    );
}

#[test]
fn a_local_only_profile_reconciles_nothing_at_all() {
    let computer = Computer::local_only();
    let group = computer.unwrapped(|conn| fixtures::insert_budget_group(conn, "Living", 0));
    assert!(computer.group_name(group).is_some());

    // The guard is the CALLER's (the actor reconciles only after the gate admits the dataset), so
    // what is proven here is the consequence: a local-only profile's dataset never grows a `sync_*`
    // row, and nothing in this file's path would make it.
    assert!(computer.dataset.capture.is_none());
    assert_eq!(
        sync_identity::count(computer.conn()).expect("the mapping count reads"),
        0
    );
    assert!(computer.messages().is_empty());
}

#[test]
fn a_second_reconcile_emits_nothing() {
    let mut computer = Computer::open();
    let group = computer.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
    let (_category, account) = computer.seed_finance();
    computer.drain();

    computer.unwrapped(|conn| fixtures::rename_budget_group(conn, group, "Renamed"));
    computer.unwrapped(|conn| {
        fixtures::set_account_balance_directly(conn, account, 1_234, "2026-03-04T00:00:00Z")
    });

    let first = computer.reconcile();
    assert!(first.messages() > 0, "the first pass has work to do");

    let before = computer.messages().len();
    let second = computer.reconcile();
    assert_eq!(
        (second.messages(), second.deferred),
        (0, 0),
        "reconcile hashes what it just recorded, so it must find nothing: {second:?}"
    );
    assert_eq!(computer.messages().len(), before);
}

#[test]
fn a_replica_converges_on_an_unwrapped_write_once_reconcile_has_run() {
    let mut one = Computer::open();
    let two = Computer::open();

    let group = one.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
    let uuid = one.uuid_of("budget_groups", group);
    let batches = one.drain();
    two.receive_all(&batches);

    let mirrored = two
        .row_id_of("budget_groups", &uuid)
        .expect("the row arrived");
    assert_eq!(two.group_name(mirrored).as_deref(), Some("Living"));

    // The write that bypasses capture, and the proof that it bypasses it: shipping produces nothing
    // at all, so the second computer cannot possibly have heard about it.
    one.unwrapped(|conn| fixtures::rename_budget_group(conn, group, "Renamed"));
    assert!(one.try_ship().is_none());
    assert_eq!(two.group_name(mirrored).as_deref(), Some("Living"));

    one.reconcile();
    let healed = one.drain();
    two.receive_all(&healed);

    assert_eq!(
        two.group_name(mirrored).as_deref(),
        Some("Renamed"),
        "AD-3: a write reconcile found converges like any other"
    );
}

#[test]
fn an_unwrapped_delete_converges_as_a_delete_on_the_other_computer() {
    let mut one = Computer::open();
    let two = Computer::open();

    let group = one.write(|tx| fixtures::insert_budget_group(tx, "Living", 0));
    let uuid = one.uuid_of("budget_groups", group);
    two.receive_all(&one.drain());
    assert!(two.row_id_of("budget_groups", &uuid).is_some());

    one.unwrapped(fixtures::delete_every_budget_group);
    one.reconcile();
    two.receive_all(&one.drain());

    assert_eq!(
        two.row_id_of("budget_groups", &uuid),
        None,
        "the row is gone on both computers"
    );
    assert!(apply_db::tombstone(two.conn(), "budget_groups", &uuid)
        .expect("the tombstone reads")
        .is_some());
}

/// Story 21's OPEN item, closed: a recurring occurrence deleted on one computer and regenerated on
/// another must come back everywhere rather than being dropped as a resurrection (AD-2, AD-5).
#[test]
fn a_regenerated_recurring_occurrence_converges_after_it_was_deleted_elsewhere() {
    let mut one = Computer::open();
    let mut two = Computer::open();

    let (category, account) = one.seed_finance();
    two.receive_all(&one.drain());

    let derived = identity::recurring_expense(&TEMPLATE, PERIOD);
    let occurrence = generate_occurrence(&one, category, account);
    assert_eq!(one.uuid_of("expenses", occurrence), derived);
    two.receive_all(&one.drain());
    assert!(
        two.row_id_of("expenses", &derived).is_some(),
        "the occurrence travelled under its derived identity"
    );

    // The user deletes the occurrence on the first computer; it travels and both agree.
    one.write(|tx| fixtures::delete_expense_row(tx, occurrence));
    two.receive_all(&one.drain());
    assert_eq!(
        fixtures::count_expenses(two.conn()).expect("the count reads"),
        0
    );

    // The second computer's backfill regenerates the same month from the same template, which is a
    // brand-new local row carrying the SAME derived uuid the tombstone claims.
    let two_category = two
        .row_id_of("budget_categories", &one.uuid_of("budget_categories", category))
        .expect("the category arrived");
    let two_account = two
        .row_id_of("accounts", &one.uuid_of("accounts", account))
        .expect("the account arrived");
    let regenerated = generate_occurrence(&two, two_category, two_account);
    assert_eq!(two.uuid_of("expenses", regenerated), derived);

    one.receive_all(&two.drain());

    assert_eq!(
        fixtures::count_expenses(one.conn()).expect("the count reads"),
        1,
        "the regenerated occurrence must not be dropped as a resurrection"
    );
    assert_eq!(
        fixtures::count_expenses(two.conn()).expect("the count reads"),
        1
    );
    assert!(
        apply_db::tombstone(one.conn(), "expenses", &derived)
            .expect("the tombstone reads")
            .is_none(),
        "the revive deletes the tombstone, or the next message about the row would be absorbed"
    );
}

/// The other side of the same rule: delete-wins over a concurrent EDIT is untouched, which is what
/// makes widening the rule to `SurrogateOrTemplate` safe for every hand-entered expense.
#[test]
fn a_partial_edit_is_still_absorbed_by_an_expense_tombstone() {
    let mut one = Computer::open();
    let mut two = Computer::open();

    let (category, account) = one.seed_finance();
    two.receive_all(&one.drain());

    let occurrence = generate_occurrence(&one, category, account);
    let derived = one.uuid_of("expenses", occurrence);
    two.receive_all(&one.drain());

    // The edit is captured BEFORE the delete and shipped AFTER it, so the second computer applies
    // the tombstone first and then an edit stamped later than nothing it has seen.
    let edited = two
        .row_id_of("expenses", &derived)
        .expect("the occurrence arrived");
    two.write(|tx| fixtures::rename_expense_merchant(tx, edited, "Edited"));
    let edit = two.drain();

    one.write(|tx| fixtures::delete_expense_row(tx, occurrence));
    let delete = one.drain();

    two.receive_all(&delete);
    one.receive_all(&edit);

    assert_eq!(
        fixtures::count_expenses(one.conn()).expect("the count reads"),
        0,
        "a partial edit must not revive a deleted row (AD-5: delete wins)"
    );
    assert_eq!(
        fixtures::count_expenses(two.conn()).expect("the count reads"),
        0
    );
}

/// Story 16's trap (c): a natural-key row created before the dataset was linked has no identity, and
/// minting a random one would split one logical row in two. Reconcile derives it instead.
#[test]
fn a_natural_key_row_that_predates_capture_gets_the_identity_its_key_derives() {
    let mut one = Computer::open();
    let two = Computer::open();

    let (category, _account) = one.seed_finance();
    two.receive_all(&one.drain());
    let category_uuid = one.uuid_of("budget_categories", category);

    // Created with the hook bypassed entirely, so nothing bound its identity.
    let hint = one.unwrapped(|conn| fixtures::insert_merchant_hint(conn, "Metro", category));
    one.reconcile();

    assert_eq!(
        one.uuid_of("merchant_category_hints", hint),
        identity::merchant_category_hint("Metro", &category_uuid),
        "the identity is the one the insert site would have derived"
    );

    two.receive_all(&one.drain());
    assert!(
        two.row_id_of(
            "merchant_category_hints",
            &identity::merchant_category_hint("Metro", &category_uuid)
        )
        .is_some(),
        "which is what lets the other computer recognise it as the same hint"
    );
}

/// The same trap as the merchant-hint test above, for the schema's newest natural-key table: a
/// `stock_holdings` row written with the hook bypassed has no mapping, and minting a random uuid
/// for it would give two computers two holdings for one position. Reconcile has the whole row in
/// front of it, so it derives the identity the insert site would have bound.
#[test]
fn a_stock_holding_that_predates_capture_gets_the_identity_its_parent_derives() {
    let mut one = Computer::open();
    let two = Computer::open();

    // Written with the hook bypassed entirely: `bind_holding_identity` short-circuits when nothing
    // is capturing, so neither the asset nor its holding carries an identity at this point.
    let asset = one.unwrapped(|conn| {
        crate::db::stock::insert_stock_asset(
            conn,
            &crate::models::CreateStockAssetInput {
                symbol: "SHOP.TO".to_string(),
                name: "Shopify".to_string(),
                exchange: "TOR".to_string(),
                quantity_micros: 2_500_000,
            },
        )
        .map(|created| created.id)
    });
    assert!(
        sync_identity::lookup(one.conn(), "stock_holdings", asset)
            .expect("the mapping reads")
            .is_none(),
        "the fixture must actually start with no mapping or this proves nothing"
    );

    one.reconcile();

    let asset_uuid = one.uuid_of("passive_assets", asset);
    assert_eq!(
        one.uuid_of("stock_holdings", asset),
        identity::stock_holding(&asset_uuid),
        "the identity is the one the insert site would have derived from its asset"
    );

    two.receive_all(&one.drain());
    let arrived = two
        .row_id_of("stock_holdings", &identity::stock_holding(&asset_uuid))
        .expect("the other computer recognises the holding");
    let (symbol, quantity_micros) = two
        .with_conn(|conn| {
            let holding = crate::db::stock::get_holding(conn, arrived)?
                .expect("the holding materialized");
            Ok((holding.symbol, holding.quantity_micros))
        });
    assert_eq!((symbol.as_str(), quantity_micros), ("SHOP.TO", 2_500_000));
}
