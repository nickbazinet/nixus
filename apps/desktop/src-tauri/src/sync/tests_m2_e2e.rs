//! The Milestone-2 proof suite: two computers that keep each other up to date continuously,
//! run end to end over the real capture -> segment -> apply pipeline (AD-19).
//!
//! Re-runnable by name on both platforms:
//!
//! ```text
//! cd apps/desktop/src-tauri && cargo test sync_m2_e2e -- --nocapture
//! ```
//!
//! Every test prints one `PASS sync_m2_e2e:` line with the numbers it measured, so the CI log for
//! macOS and for Windows *is* the report, exactly as Milestone 1's `tests_e2e.rs` does.
//!
//! WHAT IS REAL AND WHAT IS NOT, stated so no one over-reads a green run. REAL: two independent
//! temp app-data directories, each with its own dataset file, install identity and connections;
//! the production `SyncActor`, the real pre-update capture hook, real segment framing and
//! compression, the real apply path on its own connection, the real `sync_*` tables, the real FK
//! cascades, the real guarded swap. **THE CLOUD IS AN IN-PROCESS FAKE** — one shared
//! `FakeObjectStore` with the create-only / `If-Match` / `304` / `412` / `409` / `404` semantics
//! AD-6 relies on — because there is no S3 to point at in CI. The real S3 behaviour of the adapter
//! is proven separately: `infra/sync/owner-object-test.py` exercises conditional writes against the
//! deployed bucket in the `sync-infra` workflow, and the adapter's own error-mapping tests pin how
//! each status becomes a `StoreError`.
//!
//! All data is SYNTHETIC and lives in temp directories this suite creates and drops. Nothing here
//! reads, writes or opens real app data, and nothing makes a network call.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use rusqlite::Connection;

use crate::db::capture_fixtures as fixtures;
use crate::db::test_dataset::{
    seed_heavy_year_into, stamp_text_columns_with_sentinels, SENTINEL_PREFIX,
};
use crate::db::{sim_tables, sync_identity};
use crate::db::account::CashFlowKind;
use crate::sync::bootstrap::{measure_link, CAP2_BUDGET, CAP2_BYTES_PER_SECOND};
use crate::sync::manager::{SyncActor, SyncState, SyncTuning};
use crate::sync::registry::{self, MergeKind, TableClass};
use crate::sync::restore::{self, TombstoneKey};
use crate::sync::test_support::{
    test_computer, ComputerProbe, FakeObjectStore, FakeOp, TestComputer, FAKE_IDENTITY_ID,
    FAKE_OWNER_SUB,
};

type Actor = SyncActor<TestComputer>;

const NOW_MS: i64 = 1_700_000_000_000;

/// Roughly 3x the debug-build figure Milestone 1 measured on a developer machine, so a slow macOS
/// or Windows runner has headroom while an order-of-magnitude regression still fails. Same value
/// as `tests_e2e.rs`, because it is the same measurement.
const NON_NETWORK_CEILING: Duration = Duration::from_millis(2_200);

/// Continuous sync with every interval collapsed: one `tick()` is one whole log cycle, so the
/// scenario is what is under test rather than the wall clock. The intervals themselves are proven
/// in `tests_segment.rs` and `tests_retention.rs`.
fn tuning() -> SyncTuning {
    SyncTuning {
        poll_interval: Duration::from_secs(1),
        settle_window: Duration::ZERO,
        min_upload_interval: Duration::ZERO,
        initial_backoff: Duration::from_secs(10),
        max_backoff: Duration::from_secs(120),
        remote_poll_interval: Duration::ZERO,
        segment_interval: Duration::ZERO,
        tombstone_purge_interval: Duration::from_secs(86_400),
        // Reconcile is driven explicitly by the one proof that is about it; elsewhere a full scan
        // of every travelling table would be noise inside a scenario about replication.
        reconcile_interval: Duration::from_secs(86_400),
        ..SyncTuning::default()
    }
}

/// A computer whose received batches really land in its tables, which is what every row-level
/// convergence claim in this file needs.
fn computer(id: &str, store: Arc<FakeObjectStore>, clock: i64) -> (Actor, ComputerProbe) {
    let (host, probe) = test_computer(id, store, clock);
    let (actor, _status, _events) = SyncActor::new(host.applying_for_real(), tuning());

    (actor, probe)
}

fn two_computers(cloud: &Arc<FakeObjectStore>) -> (Actor, ComputerProbe, Actor, ComputerProbe) {
    let (first, a) = computer("A", Arc::clone(cloud), NOW_MS);
    let (second, b) = computer("B", Arc::clone(cloud), NOW_MS + 1_000);

    (first, a, second, b)
}

fn report(line: String) {
    println!("PASS sync_m2_e2e: {line}");
}

/// Ticks both computers until neither has anything left to ship and neither has anything parked.
///
/// Bounded rather than `while`: a scenario that does not settle is a defect this suite must fail
/// on, not loop on. Several rounds are needed because one round is one direction of one exchange —
/// a message A sends can only produce B's answer on the round after it lands.
async fn settle(first: &mut Actor, second: &mut Actor, a: &ComputerProbe, b: &ComputerProbe) {
    for _ in 0..12 {
        first.tick().await;
        second.tick().await;
        if a.unshipped() == 0 && b.unshipped() == 0 && parked(a) == 0 && parked(b) == 0 {
            // TWO more full rounds, deliberately: "nothing left to ship" is reached by the LAST
            // computer to tick, and the other one has not polled since. Returning there would
            // compare a dataset that is merely owed its half of the exchange.
            for _ in 0..2 {
                first.tick().await;
                second.tick().await;
            }

            return;
        }
    }

    panic!(
        "the two computers did not settle: A has {} unshipped and {} parked, B has {} and {}",
        a.unshipped(),
        parked(a),
        b.unshipped(),
        parked(b)
    );
}

fn parked(probe: &ComputerProbe) -> i64 {
    probe.read(|conn| {
        conn.query_row("SELECT COUNT(*) FROM sync_pending", [], |row| row.get(0))
            .expect("the parked count reads")
    })
}

fn quarantined(probe: &ComputerProbe) -> i64 {
    probe.read(|conn| {
        conn.query_row("SELECT COUNT(*) FROM sync_quarantine", [], |row| row.get(0))
            .expect("the quarantine count reads")
    })
}

/// One cell of a canonical dump, rendered so two computers can be compared as strings.
type Dump = BTreeMap<String, BTreeMap<String, BTreeMap<&'static str, String>>>;

/// Every synced row of every travelling table, keyed by the row's UUID rather than by its local
/// integer id, with foreign keys rendered as the parent's UUID.
///
/// UUID space is the only space in which "the two computers hold the same tables" is even
/// expressible: AD-2 keeps machine-local integers out of messages entirely, so a row A created as
/// id 1 is whatever rowid apply happened to give it on B. This is the same canonical shape the
/// convergence simulator's oracle compares (`sync::sim::engine::Observable`) and it reads the rows
/// through the simulator's own dump helper, `db::sim_tables::dump_rows`, so the two gates cannot
/// disagree about what "identical" means. `Excluded` columns are omitted (AD-10: the image bytes
/// arrive on demand and are deliberately not the same on both computers).
fn synced_dump(conn: &Connection) -> Dump {
    let mut dump = Dump::new();
    for rule in registry::TABLES {
        if matches!(rule.class, TableClass::LocalOnly) {
            continue;
        }

        let columns: Vec<&'static str> = registry::columns_of(rule.table)
            .filter(|column| !matches!(column.merge, MergeKind::Excluded))
            .map(|column| column.column)
            .collect();
        let mut rows = BTreeMap::new();

        for (row_id, cells) in
            sim_tables::dump_rows(conn, rule.table, &columns).expect("the table dumps")
        {
            let Some(row_uuid) =
                sync_identity::lookup(conn, rule.table, row_id).expect("the identity reads")
            else {
                continue;
            };

            let mut rendered = BTreeMap::new();
            for (column, cell) in cells {
                let value = match registry::merge_kind(rule.table, column) {
                    // A local integer is meaningless across computers: a foreign key is compared as
                    // the parent's identity and a bare local id is not compared at all.
                    Some(MergeKind::LocalId) => {
                        match registry::fk_parent(rule.table, column) {
                            None => continue,
                            Some(parent) => {
                                let sim_tables::SimCell::Int(parent_id) = cell else {
                                    continue;
                                };
                                match sync_identity::lookup(conn, parent, parent_id)
                                    .expect("the parent identity reads")
                                {
                                    Some(parent_uuid) => hex(&parent_uuid),
                                    None => "<unmapped parent>".to_string(),
                                }
                            }
                        }
                    }
                    _ => match cell {
                        sim_tables::SimCell::Int(number) => number.to_string(),
                        sim_tables::SimCell::Text(text) => text,
                        sim_tables::SimCell::Uuid(bytes) => hex(&bytes),
                    },
                };
                rendered.insert(column, value);
            }
            rows.insert(hex(&row_uuid), rendered);
        }

        dump.insert(rule.table.to_string(), rows);
    }

    dump
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn dumped_rows(dump: &Dump) -> usize {
    dump.values().map(BTreeMap::len).sum()
}

fn account_balance_by_name(probe: &ComputerProbe, name: &str) -> i64 {
    probe.read(|conn| {
        conn.query_row(
            "SELECT balance_cents FROM accounts WHERE name = ?1",
            [name],
            |row| row.get(0),
        )
        .expect("the balance reads by name")
    })
}

/// (1) The beta pass: edits on both computers including while one is offline, single and double
/// deletes, cause-keyed balance deltas and a double absolute set, a 1,000-row import and a
/// concurrent edit against a delete. Afterwards both computers hold IDENTICAL synced tables and
/// the account balance is the sum of the changes that really happened.
#[tokio::test(start_paused = true)]
async fn sync_m2_e2e_a_two_computers_converge_on_every_change_kind() {
    const OPENING: i64 = 100_000;
    const ABSOLUTE_SET: i64 = 50_000;
    const EXPENSE_CENTS: i64 = 2_500;
    const OFFLINE_CENTS: i64 = 7_700;

    let cloud = Arc::new(FakeObjectStore::default());
    let (mut first, a, mut second, b) = two_computers(&cloud);

    let shared_group = a
        .captured(|tx| {
            let group = fixtures::insert_budget_group(tx, "Housing", 0)?;
            let category = fixtures::insert_budget_category(tx, group, "Groceries")?;
            let account = fixtures::insert_account(tx, "Chequing", OPENING)?;
            fixtures::insert_expense_row(tx, category, account, EXPENSE_CENTS)?;
            let source = fixtures::insert_income_source(tx, "Salary")?;
            fixtures::insert_income_entry(tx, source, 400_000, "2026-03-01")?;
            Ok(group)
        })
        .expect("A's opening rows");

    first.enable(None).await.expect("A enables and publishes");
    second.enable(None).await.expect("B bootstraps");
    settle(&mut first, &mut second, &a, &b).await;

    // OFFLINE EDITS: B is never ticked in this phase, so its writes sit in its own unsent log
    // exactly as they would with no network, while A keeps publishing.
    let (offline_category, offline_account) = (local_category_on(&b), local_account_on(&b));
    let offline_expense = b
        .captured(|tx| fixtures::insert_expense_row(tx, offline_category, offline_account, OFFLINE_CENTS))
        .expect("B writes while offline");
    a.captured(|tx| fixtures::rename_budget_group(tx, shared_group, "Housing-renamed-on-a"))
        .expect("A edits while B is away");
    first.tick().await;
    assert!(
        b.unshipped() > 0,
        "B's offline edit must still be owed to the account"
    );

    // A 1,000-row import, in one captured transaction, which is what cuts a full segment.
    a.captured(|tx| fixtures::import_budget_groups(tx, 1_000))
        .expect("the import commits");

    settle(&mut first, &mut second, &a, &b).await;
    assert!(
        b.read(fixtures::count_expenses).expect("the count reads") >= 2,
        "B must hold both its own offline expense and A's"
    );

    // A DOUBLE ABSOLUTE SET: the same value twice, so the second is a no-op rather than a second
    // event. It runs BEFORE the credits on purpose: the fold is `set + the deltas stamped AFTER
    // it`, so a set stamped last would absorb them and the double-delete claim would be invisible.
    let account = local_account_on(&a);
    a.captured(|tx| {
        crate::db::account::update_account_balance(tx, account, ABSOLUTE_SET)?;
        crate::db::account::update_account_balance(tx, account, ABSOLUTE_SET)?;
        Ok(())
    })
    .expect("the two sets commit");

    // DOUBLE DELETE of one row, each computer crediting the account through AD-5's cause key: the
    // key is a pure function of (row, kind), so the credit counts ONCE.
    for probe in [&a, &b] {
        let id = local_expense_on(probe);
        // Both ids are read BEFORE `captured` takes the connection: the probe's lock is not
        // re-entrant, so a lookup inside the closure would deadlock.
        let account_id = local_account_on(probe);
        probe
            .captured(|tx| {
                fixtures::delete_expense_row(tx, id)?;
                crate::db::account::adjust_account_balance(
                    tx,
                    account_id,
                    CashFlowKind::Income,
                    EXPENSE_CENTS,
                    crate::db::account::BalanceCauseRow::new(
                        "expenses",
                        id,
                        crate::sync::capture::BalanceCause::Deleted,
                    ),
                )?;
                Ok(())
            })
            .expect("the delete and its credit commit together");
    }

    // A CONCURRENT EDIT AGAINST A DELETE: A renames the income source while B deletes it.
    // AD-5: the delete wins.
    let (a_income, b_income) = (local_income_on(&a), local_income_on(&b));
    a.captured(|tx| fixtures::replace_income_source(tx, a_income, "Salary-edited"))
        .expect("A edits the income source");
    b.captured(|tx| fixtures::delete_income_source(tx, b_income).map(|_| ()))
        .expect("B deletes the same income source");

    settle(&mut first, &mut second, &a, &b).await;

    a.close_live();
    b.close_live();
    let left = synced_dump(&opened(a.db_path()));
    let right = synced_dump(&opened(b.db_path()));

    assert_eq!(
        left.keys().collect::<Vec<_>>(),
        right.keys().collect::<Vec<_>>(),
        "the two computers must agree on which tables travel"
    );
    for (table, rows) in &left {
        assert_eq!(
            rows,
            right.get(table).expect("the table is in both dumps"),
            "{table} differs between the two computers"
        );
    }
    assert_eq!(parked(&a) + parked(&b), 0, "nothing may be left parked");
    assert_eq!(
        quarantined(&a) + quarantined(&b),
        0,
        "nothing legal may be quarantined"
    );

    let expected = ABSOLUTE_SET + EXPENSE_CENTS;
    assert_eq!(
        account_balance_by_name(&a, "Chequing"),
        expected,
        "A's balance must be the absolute set plus the ONE credit the double delete earned"
    );
    assert_eq!(
        account_balance_by_name(&b, "Chequing"),
        expected,
        "and B must agree to the cent"
    );
    assert_eq!(
        a.read(fixtures::count_expenses).expect("the count reads"),
        1,
        "the double-deleted expense is gone and the offline one survived"
    );
    assert_eq!(
        b.read(fixtures::count_expenses).expect("the count reads"),
        1
    );
    assert_eq!(
        b.read(fixtures::count_income_entries)
            .expect("the count reads"),
        0,
        "AD-5: the delete won over the concurrent edit"
    );

    report(format!(
        "(1) {} synced rows across {} tables identical on both computers after an offline edit, \
         a 1,000-row import, a single and a double delete, a cause-keyed credit, a double \
         absolute set and a concurrent edit/delete; balance {} cents = {} set + {} credited ONCE \
         by two computers deleting one expense, 0 parked, 0 quarantined (offline expense {} \
         survived)",
        dumped_rows(&left),
        left.len(),
        expected,
        ABSOLUTE_SET,
        EXPENSE_CENTS,
        offline_expense,
    ));
}

/// (2) AD-12: a delete is restorable for 30 days, the restore travels to the other computer, and a
/// restore attempted after the window has closed is refused.
#[tokio::test(start_paused = true)]
async fn sync_m2_e2e_b_a_restore_travels_and_an_expired_window_is_refused() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut first, a, mut second, b) = two_computers(&cloud);

    let group = a
        .captured(|tx| fixtures::insert_budget_group(tx, "Restorable", 0))
        .expect("A's row");
    first.enable(None).await.expect("A enables");
    second.enable(None).await.expect("B bootstraps");
    settle(&mut first, &mut second, &a, &b).await;

    a.captured(|tx| fixtures::delete_every_budget_group(tx).map(|_| ()))
        .expect("A deletes it");
    settle(&mut first, &mut second, &a, &b).await;
    assert_eq!(
        b.read(fixtures::count_budget_groups)
            .expect("the count reads"),
        0,
        "the delete reached B"
    );

    let view = a.with_active(restore::list).expect("the list reads");
    assert!(view.sync_available, "a cloud-linked dataset retains deletes");
    let item = view
        .items
        .first()
        .expect("the deleted row is listed")
        .clone();
    assert!(item.days_left > 0, "the window is still open");

    let key = TombstoneKey::parse(&item.id).expect("the handle parses");
    let outcome = a
        .with_active(|active| restore::restore(active, &key))
        .expect("the restore succeeds");
    assert_eq!(outcome.restored_rows, 1);

    settle(&mut first, &mut second, &a, &b).await;
    assert_eq!(
        b.read(fixtures::count_budget_groups).expect("count"),
        1,
        "B sees the row come back"
    );

    // The 30-day window, aged rather than waited out: the table's own CHECK refuses a window that
    // closes before the delete, so the fixture moves BOTH stamps back together.
    a.captured(|tx| fixtures::delete_every_budget_group(tx).map(|_| ()))
        .expect("A deletes it again");
    let aged = a
        .with_active(restore::list)
        .expect("the list reads")
        .items
        .first()
        .expect("listed")
        .clone();
    let aged_key = TombstoneKey::parse(&aged.id).expect("the handle parses");
    a.read(|conn| fixtures::expire_tombstone(conn, "budget_groups", &aged_key.row_uuid))
        .expect("the retained copy is aged past the window");

    let refused = a
        .with_active(|active| restore::restore(active, &aged_key))
        .expect_err("a restore after 30 days is refused");

    assert!(
        matches!(&refused, crate::error::AppError::Sync { code, .. } if code == "restore_not_found"),
        "expected restore_not_found, got {refused}"
    );
    report(format!(
        "(2) delete on A restored on A (group {group}, {} rows, {} days left) and the restore \
         reached B; a delete aged 31 days was refused with {refused}",
        outcome.restored_rows,
        item.days_left,
    ));
}

/// (3) AD-3: a write that bypassed `ActiveDataset::write` leaves no message at all, reconcile
/// notices it from the live value and the other computer converges.
#[tokio::test(start_paused = true)]
async fn sync_m2_e2e_c_reconcile_heals_an_unwrapped_write() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut first, a, mut second, b) = two_computers(&cloud);

    let group = a
        .captured(|tx| fixtures::insert_budget_group(tx, "Wrapped", 0))
        .expect("A's row");
    first.enable(None).await.expect("A enables");
    second.enable(None).await.expect("B bootstraps");
    settle(&mut first, &mut second, &a, &b).await;

    // DELIBERATELY UNWRAPPED: a raw statement on the UI connection, outside any
    // `ActiveDataset::write`. The hook observes it and the buffer is discarded, which is the real
    // AD-3 failure mode a migration gap produces.
    a.read(|conn| fixtures::rename_budget_group(conn, group, "Unwrapped-edit"))
        .expect("the raw edit commits");
    let unshipped_after_bypass = a.unshipped();
    first.tick().await;
    second.tick().await;
    assert_eq!(
        unshipped_after_bypass, 0,
        "the bypassing write produced no message, which is why reconcile has to exist"
    );
    assert_eq!(
        b.read(|conn| fixtures::budget_group_name(conn, group))
            .expect("the name reads"),
        Some("Wrapped".to_string()),
        "and B is therefore still showing the stale value"
    );

    let install = a.install_id();
    let report_counts = a
        .read(|conn| {
            crate::sync::reconcile::reconcile_all(
                conn,
                &crate::sync::clock::Clock::new(&install).expect("the clock builds"),
                &install,
            )
        })
        .expect("the reconcile pass runs");

    assert!(
        report_counts.messages() > 0,
        "reconcile must emit the difference it found"
    );
    settle(&mut first, &mut second, &a, &b).await;

    assert_eq!(
        b.read(|conn| fixtures::budget_group_name(conn, group))
            .expect("the name reads"),
        Some("Unwrapped-edit".to_string()),
        "the other computer converged on the value that bypassed capture"
    );
    a.close_live();
    b.close_live();
    assert_eq!(
        synced_dump(&opened(a.db_path())),
        synced_dump(&opened(b.db_path())),
        "and the two computers are identical again"
    );
    report(format!(
        "(3) an unwrapped write produced 0 messages, reconcile emitted {} ({} fields, {} rows) \
         and B converged on the healed value",
        report_counts.messages(),
        report_counts.fields,
        report_counts.rows
    ));
}

/// (4) CAP-2 still holds with the Milestone-2 flow: a new computer bootstraps a heavy year from a
/// log-based snapshot PLUS the tail the publisher has not snapshotted yet, inside the 5 s model.
#[tokio::test(start_paused = true)]
async fn sync_m2_e2e_d_a_new_computer_is_usable_inside_the_cap2_budget() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut first, a, mut second, b) = two_computers(&cloud);
    let shape = seed_heavy_year_into(a.db_path());

    first.enable(None).await.expect("A enables and publishes");
    // A continuous-sync tail on top of the snapshot: this is the M2 shape of the measurement, where
    // M1's was a snapshot alone.
    for name in ["tail-one", "tail-two", "tail-three"] {
        a.write_captured(name);
    }
    first.tick().await;

    let before = cloud.transferred_bytes();
    cloud.throttle_to(CAP2_BYTES_PER_SECOND);
    let counted = Arc::clone(&cloud);
    let (outcome, budget) =
        measure_link(second.enable(None), || counted.transferred_bytes() - before).await;

    outcome.expect("B bootstraps");
    second.tick().await;

    let rows = b.read(|conn| {
        conn.query_row("SELECT COUNT(*) FROM expenses", [], |row| {
            row.get::<_, i64>(0)
        })
        .expect("the bootstrapped dataset answers a real query")
    });

    assert_eq!(rows, shape.expenses as i64, "usable means it answers queries");
    assert!(
        budget.measured <= NON_NETWORK_CEILING,
        "the CPU/disk half took {:?}, over the {:?} ceiling",
        budget.measured,
        NON_NETWORK_CEILING
    );
    assert!(
        budget.within_budget(),
        "over CAP-2's {:?}: {}",
        CAP2_BUDGET,
        budget.breakdown()
    );
    report(format!(
        "(4) a heavy year ({} expenses) plus a 3-message continuous tail: {}",
        shape.expenses,
        budget.breakdown()
    ));
}

/// (5) AD-15: a wipe unlinks THIS computer and nothing else — no request reaches the cloud and the
/// other computer keeps syncing as if nothing happened.
#[tokio::test(start_paused = true)]
async fn sync_m2_e2e_e_a_wipe_unlinks_only_this_computer() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut first, a, mut second, b) = two_computers(&cloud);

    a.captured(|tx| fixtures::insert_budget_group(tx, "Before-the-wipe", 0))
        .expect("A's row");
    first.enable(None).await.expect("A enables");
    second.enable(None).await.expect("B bootstraps");
    settle(&mut first, &mut second, &a, &b).await;

    let writes_before = cloud.calls_of(FakeOp::PutImmutable)
        + cloud.calls_of(FakeOp::PutIfAbsent)
        + cloud.calls_of(FakeOp::PutIfMatch)
        + cloud.calls_of(FakeOp::Delete);
    let keys_before = cloud.keys();

    // The wipe exactly as `commands::danger_zone::delete_all_data` performs it: through the
    // detached seam, so the hook produces no tombstone and no log row to ship.
    let deleted = a
        .with_active(|active| active.write_uncaptured(crate::db::danger_zone::wipe_all))
        .expect("the wipe succeeds");
    first.tick().await;

    assert!(deleted > 0, "the wipe deleted nothing");
    let writes_after = cloud.calls_of(FakeOp::PutImmutable)
        + cloud.calls_of(FakeOp::PutIfAbsent)
        + cloud.calls_of(FakeOp::PutIfMatch)
        + cloud.calls_of(FakeOp::Delete);
    assert_eq!(
        writes_after, writes_before,
        "AD-15: a wipe writes and deletes nothing in the cloud"
    );
    assert_eq!(
        cloud.keys(),
        keys_before,
        "so every object the account relies on is still there, byte for byte the same set"
    );
    assert_eq!(a.unshipped(), 0, "there is nothing to cut: nothing was captured");

    // The other computer is untouched and still syncing.
    assert_eq!(
        b.read(fixtures::count_budget_groups).expect("count"),
        1,
        "B still holds what the account knows"
    );
    b.captured(|tx| fixtures::insert_budget_group(tx, "After-the-wipe", 1))
        .expect("B keeps writing");
    second.tick().await;
    assert_eq!(b.unshipped(), 0, "and B's own cycle still ships");
    assert_eq!(
        b.read(fixtures::count_budget_groups).expect("count"),
        2,
        "B's own write landed"
    );

    report(format!(
        "(5) a wipe deleted {deleted} local rows with 0 cloud writes or deletes and {} cloud \
         keys unchanged, while the other computer kept its rows and shipped its next write",
        keys_before.len(),
    ));
}

/// (6) AD-11 / CAP-7: a computer on an older build parks a newer-schema segment, keeps working
/// locally, and applies it after the update.
#[tokio::test(start_paused = true)]
async fn sync_m2_e2e_f_an_old_build_parks_newer_messages_until_it_updates() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut first, a, mut second, b) = two_computers(&cloud);

    first.enable(None).await.expect("A enables");
    second.enable(None).await.expect("B bootstraps");
    settle(&mut first, &mut second, &a, &b).await;

    let current = b.schema_version();
    b.set_schema_version(current - 1);
    a.write_captured("from-the-newer-build");
    first.tick().await;
    second.tick().await;

    assert!(
        !b.rows().contains(&"from-the-newer-build".to_string()),
        "an old build must not apply a message it cannot read"
    );
    assert_eq!(
        second.status().state,
        SyncState::UpdateNeeded,
        "and it must say so rather than fail silently"
    );
    assert_eq!(
        quarantined(&b),
        0,
        "a parked segment is neither dropped nor poison"
    );
    b.write_captured("still-working-locally");
    second.tick().await;
    assert!(
        b.rows().contains(&"still-working-locally".to_string()),
        "AD-16: sync never blocks local use"
    );

    b.set_schema_version(current);
    settle(&mut first, &mut second, &a, &b).await;

    assert!(
        b.rows().contains(&"from-the-newer-build".to_string()),
        "after the update the parked segment applies"
    );
    assert!(
        a.rows().contains(&"still-working-locally".to_string()),
        "and what the old build wrote meanwhile still reached the other computer"
    );
    report(format!(
        "(6) a build at schema {} parked a segment requiring {}, stayed update_needed, kept \
         writing locally, then applied it after the update with 0 quarantined",
        current - 1,
        current
    ));
}

/// (7) Inherited AD-12: a local-only dataset runs NO sync code — no store call, no capture hook
/// and not one row in any `sync_*` table, no matter how much the user does.
#[tokio::test(start_paused = true)]
async fn sync_m2_e2e_g_a_local_only_dataset_runs_no_sync_code() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (host, probe) = test_computer("A", Arc::clone(&cloud), NOW_MS);
    let (mut actor, _status, _events) = SyncActor::new(host.local_only(), tuning());

    let fault = actor
        .enable(None)
        .await
        .expect_err("a local profile cannot sync");
    assert_eq!(fault.code(), "local_only");

    assert!(
        probe.read(|conn| crate::sync::capture::Capture::for_dataset(
            crate::models::DatasetKind::Local,
            conn
        ))
        .expect("the capture decision is made")
        .is_none(),
        "a local-only dataset installs no hook at all"
    );

    probe.write_row("one");
    probe
        .read(|conn| fixtures::insert_account(conn, "Local-only", 1_234))
        .expect("the local app writes as it always did");
    for _ in 0..4 {
        actor.tick().await;
    }

    let sync_rows: i64 = probe.read(|conn| {
        let mut total = 0;
        for table in ["sync_log", "sync_uuid", "sync_field_state", "sync_tombstone"] {
            total += conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("the count reads");
        }
        total
    });

    assert_eq!(cloud.calls(), 0, "not one store call, ever");
    assert_eq!(sync_rows, 0, "and not one sync bookkeeping row");
    assert_eq!(actor.diagnostics().uploads, 0);
    report(format!(
        "(7) a local-only dataset refused with {} and made 0 store calls and 0 sync rows across \
         2 writes and 4 ticks",
        fault.code()
    ));
}

/// (8) AD-16's redaction, re-proven on a dataset that has been through the whole Milestone-2 flow:
/// the support document carries counts, states, timings and codes, and not one byte of what is in
/// the database — including the payloads the new `sync_log` / `sync_pending` / `sync_quarantine`
/// tables now hold.
#[tokio::test(start_paused = true)]
async fn sync_m2_e2e_h_the_diagnostics_export_carries_no_value_from_the_m2_flow() {
    let cloud = Arc::new(FakeObjectStore::default());
    let (mut first, a, mut second, b) = two_computers(&cloud);
    let shape = seed_heavy_year_into(a.db_path());
    let stamp = a.read(stamp_text_columns_with_sentinels);

    assert!(
        stamp.stamped.len() >= 20,
        "the proof is only as wide as the columns it stamped: {:?}",
        stamp.stamped
    );

    first.enable(None).await.expect("A enables");
    second.enable(None).await.expect("B bootstraps");
    a.write_captured(&format!("{SENTINEL_PREFIX}-captured-edit"));
    settle(&mut first, &mut second, &a, &b).await;

    // The control: the sentinel must really be inside the M2 tables this proof is extended to, or
    // "no sentinel in the export" would be true of an export of nothing.
    let payload_hits: i64 = a.read(|conn| {
        conn.query_row(
            "SELECT COUNT(*) FROM sync_log WHERE instr(hex(payload), ?1) > 0",
            [hex(SENTINEL_PREFIX.as_bytes()).to_uppercase()],
            |row| row.get(0),
        )
        .expect("the payload scan reads")
    });
    assert!(
        payload_hits > 0,
        "a stamped value must be inside a sync_log payload for this to prove anything"
    );

    let diagnostics = first.diagnostics();
    let rendered = crate::commands::sync::diagnostics_json(
        &diagnostics,
        &crate::commands::sync::ExportEnvironment {
            app_version: "0.1.6".to_string(),
            os: std::env::consts::OS,
            arch: std::env::consts::ARCH,
            generated_ms: 1_760_000_000_000,
        },
    )
    .expect("the document renders");

    assert!(
        !rendered.contains(SENTINEL_PREFIX),
        "a stamped value reached the export: {rendered}"
    );
    assert!(
        !rendered.contains(&diagnostics.dataset_id),
        "the dataset id is an identifier, not a count, a state, a timing or a code"
    );
    for identifier in [FAKE_IDENTITY_ID, FAKE_OWNER_SUB, a.install_id().as_str()] {
        assert!(
            !rendered.contains(identifier),
            "{identifier} is an identifier and must be omitted"
        );
    }
    let parsed: serde_json::Value = serde_json::from_str(&rendered).expect("valid JSON");
    assert_eq!(parsed["export_version"], 1);

    report(format!(
        "(8) {} stamped text columns and {} sentinel-bearing sync_log payloads over a heavy year \
         ({} expenses) produced a {} B report with 0 sentinels and 0 identifiers",
        stamp.stamped.len(),
        payload_hits,
        shape.expenses,
        rendered.len()
    ));
}

fn opened(db_path: &std::path::Path) -> Connection {
    crate::db::open_configured(db_path).expect("the dataset opens")
}

/// The local integer id of the shared expense ON THIS computer.
///
/// Addressed by its amount and not by a row id, because AD-2 keeps local ids out of messages: the
/// row A created as id 1 is whatever rowid apply gave it on B, so "the same row on both computers"
/// has to be looked up on each.
fn local_expense_on(probe: &ComputerProbe) -> i64 {
    probe.read(|conn| {
        conn.query_row(
            "SELECT id FROM expenses WHERE amount_cents = 2500",
            [],
            |row| row.get(0),
        )
        .expect("the shared expense is there")
    })
}

fn local_category_on(probe: &ComputerProbe) -> i64 {
    probe.read(|conn| {
        conn.query_row(
            "SELECT id FROM budget_categories WHERE name = 'Groceries'",
            [],
            |row| row.get(0),
        )
        .expect("the shared category is there")
    })
}

fn local_account_on(probe: &ComputerProbe) -> i64 {
    probe.read(|conn| {
        conn.query_row("SELECT id FROM accounts WHERE name = 'Chequing'", [], |row| {
            row.get(0)
        })
        .expect("the shared account is there")
    })
}

fn local_income_on(probe: &ComputerProbe) -> i64 {
    probe.read(|conn| {
        conn.query_row("SELECT id FROM income_sources LIMIT 1", [], |row| row.get(0))
            .expect("the shared income source is there")
    })
}
