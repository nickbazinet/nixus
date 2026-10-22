//! Records that PREDATE sync get exactly one identity on every computer.
//!
//! The reported bug: after signing in on a second computer every account, asset, expense, income
//! entry, vehicle... showed up twice. The cause is not in the apply path; it is that a row only
//! travels under an identity (`sync_uuid`, AD-2), and a record that was written BEFORE sync was on
//! has none until somebody mints one. Reconcile mints a random UUIDv4 for it (story 22), so two
//! computers that hold the same records and each run reconcile give every record two identities —
//! and each then applies the other's "creation" as a new row.
//!
//! Every earlier two-computer proof wrote its rows through the capture hook, which hands each row
//! an identity at birth, or ran with reconcile switched off. None of them started from what every
//! existing user actually has on the day sync starts: a dataset full of rows no hook ever saw.
//! These tests start there, with the real actor over the in-process fake cloud, and count ROWS —
//! not rows that have an identity, which is the one thing a duplicate lacks.

use std::sync::Arc;
use std::time::Duration;

use crate::db::capture_fixtures::{self as fixtures, PreSyncRecords};
use crate::sync::auth::AccountPin;
use crate::sync::manager::{SyncActor, SyncState, SyncTuning};
use crate::sync::owner::{owner_object_body, OWNER_OBJECT_KEY};
use crate::sync::snapshot::{self, SNAP_LATEST_KEY};
use crate::sync::test_support::{
    syncing_fake, test_computer, ComputerProbe, FakeObjectStore, TestComputer, FAKE_IDENTITY_ID,
    FAKE_OWNER_SUB,
};
use crate::sync::{adopt, dedupe, identity, reconcile};

type Actor = SyncActor<TestComputer>;

const NOW_MS: i64 = 1_700_000_000_000;

/// Enough cycles for a whole reconcile pass on every table (one bounded chunk per cycle) plus the
/// exchanges that follow it. Every cycle here is a `tick()`, because the floors are zero.
const CYCLES: usize = 160;

/// Reconcile is ON, unlike the other two-computer fixtures: it is the thing that gives a
/// pre-existing row its identity, so a proof about pre-existing rows without it proves nothing.
fn tuning() -> SyncTuning {
    SyncTuning {
        poll_interval: Duration::from_secs(1),
        settle_window: Duration::ZERO,
        min_upload_interval: Duration::ZERO,
        remote_poll_interval: Duration::ZERO,
        segment_interval: Duration::ZERO,
        initial_backoff: Duration::from_secs(10),
        max_backoff: Duration::from_secs(120),
        tombstone_purge_interval: Duration::from_secs(86_400),
        reconcile_interval: Duration::ZERO,
        auto_join_interval: Duration::ZERO,
        capability_recheck_interval: Duration::ZERO,
        ..SyncTuning::default()
    }
}

/// A computer whose dataset is prepared BEFORE its actor exists. The actor opens its apply
/// connection at construction, so a file swapped in afterwards would leave it holding the old one.
fn computer_prepared(
    id: &str,
    store: &Arc<FakeObjectStore>,
    clock: i64,
    prepare: impl FnOnce(&ComputerProbe),
) -> (Actor, ComputerProbe) {
    let (host, probe) = test_computer(id, Arc::clone(store), clock);
    prepare(&probe);
    let (actor, _status, _events) = SyncActor::new(host.applying_for_real(), tuning());

    (actor, probe)
}

fn computer(id: &str, store: &Arc<FakeObjectStore>, clock: i64) -> (Actor, ComputerProbe) {
    computer_prepared(id, store, clock, |_| {})
}

/// The records a person has before sync is ever on, written with plain statements.
fn seed(probe: &ComputerProbe) -> PreSyncRecords {
    probe.read(|conn| fixtures::seed_pre_sync_records(conn).expect("the records seed"))
}

/// A byte copy of `from`'s dataset into `to`, the way a restored backup or a Replace of an older
/// snapshot puts "the same records" on a second computer: same rows, same row ids.
fn clone_dataset(from: &ComputerProbe, to: &ComputerProbe) {
    from.close_live();
    to.close_live();
    std::fs::copy(from.db_path(), to.db_path()).expect("the dataset copies");
    for suffix in ["-wal", "-shm"] {
        let mut sidecar = to.db_path().as_os_str().to_owned();
        sidecar.push(suffix);
        let _ = std::fs::remove_file(sidecar);
    }
    // A copied file carries the source's install id, and two computers appending under one
    // `(install, seq)` space is the collision AD-4 exists to prevent. Production re-mints on every
    // copy (`remint_copied_dataset`); a test that did not would be testing a collision instead.
    to.read(|conn| crate::sync::state::remint_install_on(conn).expect("the copy re-mints"));
}

/// What migration 035 did to every Milestone-1 dataset: `link_state = 'linked'` became
/// `joined_at = now`, whether or not a join had ever completed.
fn as_a_milestone_one_linked_computer(probe: &ComputerProbe) {
    probe.read(|conn| {
        crate::sync::state::ensure_install_on(conn).expect("the install row");
        crate::db::sync_state::set_pin(conn, FAKE_IDENTITY_ID, FAKE_OWNER_SUB).expect("the pin");
        crate::db::sync_state::mark_joined(conn).expect("the backfilled join marker");
    });
}

/// A cloud whose clock agrees with the computers': objects are stamped "now", so AD-13's 90-day
/// retention sweep finds nothing old. The fake's default clock is 0, which would make every object
/// look decades old and let the sweep delete segments and prune computers a real account keeps.
fn new_cloud() -> Arc<FakeObjectStore> {
    let cloud = Arc::new(FakeObjectStore::default());
    cloud.set_clock(NOW_MS);

    cloud
}

fn counts(probe: &ComputerProbe) -> Vec<(&'static str, i64)> {
    probe.read(|conn| fixtures::count_rows_of_pre_sync_tables(conn).expect("the counts read"))
}

fn parked(probe: &ComputerProbe) -> (i64, i64) {
    probe.read(|conn| {
        let count = |table: &str| -> i64 {
            conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .expect("the count reads")
        };

        (count("sync_pending"), count("sync_quarantine"))
    })
}

/// Fails with the tables that hold the wrong number of rows, named, because "expected 4, got 8" is
/// the whole story of this bug and the table is what tells it.
fn assert_each_record_once(label: &str, probe: &ComputerProbe, shape: &PreSyncRecords) {
    let expected: Vec<(&'static str, i64)> = shape.per_table().to_vec();
    let actual = counts(probe);
    let wrong: Vec<String> = expected
        .iter()
        .zip(actual.iter())
        .filter(|(want, got)| want != got)
        .map(|(want, got)| format!("{}: expected {}, found {}", want.0, want.1, got.1))
        .collect();

    assert!(
        wrong.is_empty(),
        "{label} does not hold each record exactly once: {wrong:?}"
    );
}

/// Both computers cycle until neither has anything left to say, then a few more rounds so the last
/// message either one sent has been received by the other.
async fn exchange(first: &mut Actor, second: &mut Actor) {
    for _ in 0..CYCLES {
        first.tick().await;
        second.tick().await;
    }
}

fn milestone_one_pointer(cloud: &FakeObjectStore) {
    // A Milestone-1 `snap/LATEST`: no `watermark` key at all, so it names a snapshot written before
    // row identities travelled. Hand-built, because this build cannot produce one any more.
    let body = format!(
        "{{\"created_ms\":{NOW_MS},\"hash\":\"{}\",\"schema_version\":34,\"snap_id\":\"{}\",\"v\":1}}",
        "c".repeat(64),
        "a".repeat(64)
    );
    cloud.seed(SNAP_LATEST_KEY, body.into_bytes());
}

// ------------------------------------------------------------------------------------------
// 1. The general case: ANY user whose records predate sync, signing in on a second computer.
// ------------------------------------------------------------------------------------------

/// The first computer already had records when sync came on; a second, empty computer signs in a
/// moment later. This is the "log in on another computer" flow for every user who did not start
/// with an empty app, and it is the one no earlier proof exercised.
#[tokio::test(start_paused = true)]
async fn a_second_computer_signing_in_right_after_the_first_never_doubles_its_records() {
    let cloud = new_cloud();
    let (mut first, a) = computer("A", &cloud, NOW_MS);
    let shape = seed(&a);

    first.auto_start_now().await;

    let (mut second, b) = computer("B", &cloud, NOW_MS + 60_000);
    second.auto_start_now().await;

    exchange(&mut first, &mut second).await;

    assert_each_record_once("the first computer", &a, &shape);
    assert_each_record_once("the second computer", &b, &shape);
    assert_eq!(
        parked(&a),
        (0, 0),
        "nothing is left waiting on the first computer"
    );
    assert_eq!(
        parked(&b),
        (0, 0),
        "nothing is left waiting on the second computer"
    );
}

/// The same, but the second computer signs in only after the first has finished giving every one of
/// its records an identity and has shipped all of them. The second computer then restores a
/// snapshot AND applies a tail that describes every record in it.
#[tokio::test(start_paused = true)]
async fn a_second_computer_signing_in_after_the_first_has_shipped_everything_never_doubles_it() {
    let cloud = new_cloud();
    let (mut first, a) = computer("A", &cloud, NOW_MS);
    let shape = seed(&a);

    first.auto_start_now().await;
    for _ in 0..CYCLES {
        first.tick().await;
    }

    let (mut second, b) = computer("B", &cloud, NOW_MS + 600_000);
    second.auto_start_now().await;

    exchange(&mut first, &mut second).await;

    assert_each_record_once("the first computer", &a, &shape);
    assert_each_record_once("the second computer", &b, &shape);
    assert_eq!(parked(&b), (0, 0));
}

// ------------------------------------------------------------------------------------------
// 2. The reported incident: two computers that already hold the SAME records, both "joined".
// ------------------------------------------------------------------------------------------

/// Two Milestone-1 computers: one restored the other's snapshot, so they hold byte-identical
/// records and neither has an identity for any of them. Migration 035 marks both joined. The first
/// to run this build gives its records identities and publishes them; the second must adopt those
/// identities for the records it already holds instead of minting its own.
#[tokio::test(start_paused = true)]
async fn two_milestone_one_computers_holding_the_same_records_do_not_double_them() {
    let cloud = new_cloud();
    let (mut first, a) = computer("A", &cloud, NOW_MS);
    let shape = seed(&a);
    let (mut second, b) = computer_prepared("B", &cloud, NOW_MS + 600_000, |probe| {
        clone_dataset(&a, probe);
        as_a_milestone_one_linked_computer(probe);
    });
    as_a_milestone_one_linked_computer(&a);

    // The account as Milestone 1 left it: bound to its owner, with an identity-less pointer.
    // `A`'s own first run creates the owner object; the pointer is then rewound to Milestone 1.
    first.auto_start_now().await;
    milestone_one_pointer(&cloud);

    // The first computer updates and runs for a good while before the second one does.
    for _ in 0..CYCLES {
        first.tick().await;
    }
    second.auto_start_now().await;

    exchange(&mut first, &mut second).await;

    assert_each_record_once("the computer that updated first", &a, &shape);
    assert_each_record_once("the computer that updated second", &b, &shape);
    assert_eq!(parked(&a), (0, 0));
    assert_eq!(parked(&b), (0, 0));
}

/// The race: both computers update within the same minute, so neither has seen the other's
/// identities when it starts giving its own records some.
#[tokio::test(start_paused = true)]
async fn two_milestone_one_computers_updating_at_the_same_time_do_not_double_their_records() {
    let cloud = new_cloud();
    let (mut first, a) = computer("A", &cloud, NOW_MS);
    let shape = seed(&a);
    let (mut second, b) = computer_prepared("B", &cloud, NOW_MS + 1_000, |probe| {
        clone_dataset(&a, probe);
        as_a_milestone_one_linked_computer(probe);
    });
    as_a_milestone_one_linked_computer(&a);

    first.auto_start_now().await;
    milestone_one_pointer(&cloud);
    second.auto_start_now().await;

    exchange(&mut first, &mut second).await;

    assert_each_record_once("the first computer", &a, &shape);
    assert_each_record_once("the second computer", &b, &shape);
}

// ------------------------------------------------------------------------------------------
// 2b. The same records, touched by the person before sync has done anything about them.
// ------------------------------------------------------------------------------------------

fn merchant_of(probe: &ComputerProbe, row_id_with_amount: i64) -> Vec<String> {
    probe.read(|conn| {
        let mut statement = conn
            .prepare("SELECT merchant FROM expenses WHERE amount_cents = ?1 ORDER BY merchant")
            .expect("the statement prepares");
        statement
            .query_map([row_id_with_amount], |row| row.get::<_, String>(0))
            .expect("the query runs")
            .collect::<Result<Vec<_>, _>>()
            .expect("the rows collect")
    })
}

/// The person opens the app on the second computer and edits a record BEFORE sync has done anything
/// about it. The capture hook sees the edit after it ran, so the record must be adopted as it was
/// before — the state the first computer holds — or the edit would split it in two.
#[tokio::test(start_paused = true)]
async fn a_record_edited_before_it_was_adopted_is_still_the_same_record_everywhere() {
    let cloud = new_cloud();
    let (mut first, a) = computer("A", &cloud, NOW_MS);
    let shape = seed(&a);
    let (mut second, b) = computer_prepared("B", &cloud, NOW_MS + 600_000, |probe| {
        clone_dataset(&a, probe);
        as_a_milestone_one_linked_computer(probe);
    });
    as_a_milestone_one_linked_computer(&a);

    first.auto_start_now().await;
    milestone_one_pointer(&cloud);
    for _ in 0..CYCLES {
        first.tick().await;
    }

    // Through the real hook, on a computer whose sync has not run yet: expense 2 is the 6,120 one.
    b.captured(|tx| fixtures::rename_expense_merchant(tx, 2, "Metro Plus"))
        .expect("the edit commits");

    second.auto_start_now().await;
    exchange(&mut first, &mut second).await;

    assert_each_record_once("the first computer", &a, &shape);
    assert_each_record_once("the second computer", &b, &shape);
    assert_eq!(
        merchant_of(&a, 6_120),
        vec!["Metro Plus".to_string()],
        "the edit reached the SAME record on the other computer"
    );
    assert_eq!(merchant_of(&b, 6_120), vec!["Metro Plus".to_string()]);
}

/// An entry the app generated from a recurring template is named by `(template, month)` on every
/// computer. Editing one before sync has done anything about it must name it the same way, or the
/// edit would travel with a different identity from the one reconcile gives the unedited entry.
#[tokio::test(start_paused = true)]
async fn an_entry_generated_from_a_template_keeps_its_shared_identity_when_edited_first() {
    let cloud = new_cloud();
    let (mut first, a) = computer("A", &cloud, NOW_MS);
    let shape = seed(&a);
    let (mut second, b) = computer_prepared("B", &cloud, NOW_MS + 600_000, |probe| {
        clone_dataset(&a, probe);
        as_a_milestone_one_linked_computer(probe);
    });
    as_a_milestone_one_linked_computer(&a);

    first.auto_start_now().await;
    milestone_one_pointer(&cloud);
    for _ in 0..CYCLES {
        first.tick().await;
    }

    // Income entry 4 is the one generated from the template.
    b.captured(|tx| fixtures::set_income_amount(tx, 4, 455_000).map(|_| ()))
        .expect("the edit commits");

    second.auto_start_now().await;
    exchange(&mut first, &mut second).await;

    assert_each_record_once("the first computer", &a, &shape);
    assert_each_record_once("the second computer", &b, &shape);
    for (label, probe) in [("the first computer", &a), ("the second computer", &b)] {
        let amounts: Vec<i64> = probe.read(|conn| {
            conn.prepare("SELECT amount_cents FROM income_entries WHERE month = '2026-06'")
                .expect("the statement prepares")
                .query_map([], |row| row.get(0))
                .expect("the query runs")
                .collect::<Result<Vec<_>, _>>()
                .expect("the rows collect")
        });
        assert_eq!(
            amounts,
            vec![455_000],
            "{label} holds the edited entry, once"
        );
    }
}

/// A new expense that points at a record from before sync: the record it points at must be named
/// the way every computer names it, or the new expense would arrive pointing at a second copy.
#[tokio::test(start_paused = true)]
async fn a_new_record_pointing_at_one_from_before_sync_points_at_the_same_one_everywhere() {
    let cloud = new_cloud();
    let (mut first, a) = computer("A", &cloud, NOW_MS);
    let shape = seed(&a);
    let (mut second, b) = computer_prepared("B", &cloud, NOW_MS + 600_000, |probe| {
        clone_dataset(&a, probe);
        as_a_milestone_one_linked_computer(probe);
    });
    as_a_milestone_one_linked_computer(&a);

    first.auto_start_now().await;
    milestone_one_pointer(&cloud);
    for _ in 0..CYCLES {
        first.tick().await;
    }

    // Category 1 and account 2 both predate sync; the expense is new.
    b.captured(|tx| fixtures::insert_expense_row(tx, 1, 2, 7_777))
        .expect("the expense commits");

    second.auto_start_now().await;
    exchange(&mut first, &mut second).await;

    let mut expected = shape.per_table().to_vec();
    expected
        .iter_mut()
        .filter(|(table, _)| *table == "expenses")
        .for_each(|(_, rows)| *rows += 1);
    for (label, probe) in [("the first computer", &a), ("the second computer", &b)] {
        assert_eq!(
            counts(probe),
            expected,
            "{label} holds one new expense and nothing else new"
        );
    }

    let account_of_new_expense = |probe: &ComputerProbe| -> String {
        probe.read(|conn| {
            conn.query_row(
                "SELECT a.name FROM expenses e JOIN accounts a ON a.id = e.account_id \
                 WHERE e.amount_cents = 7777",
                [],
                |row| row.get(0),
            )
            .expect("the new expense points at an account")
        })
    };
    assert_eq!(account_of_new_expense(&a), "Emergency");
    assert_eq!(account_of_new_expense(&b), "Emergency");
}

/// Changing a setting of a record whose identity is DERIVED from its parent's (a vehicle's
/// maintenance task is named by its vehicle and its kind): the parent is a record from before sync,
/// and has to be named the way every computer names it or the task would hang off a second vehicle.
#[tokio::test(start_paused = true)]
async fn a_change_beneath_a_record_from_before_sync_lands_on_the_same_record_everywhere() {
    let cloud = new_cloud();
    let (mut first, a) = computer("A", &cloud, NOW_MS);
    let shape = seed(&a);
    let (mut second, b) = computer_prepared("B", &cloud, NOW_MS + 600_000, |probe| {
        clone_dataset(&a, probe);
        as_a_milestone_one_linked_computer(probe);
    });
    as_a_milestone_one_linked_computer(&a);

    first.auto_start_now().await;
    milestone_one_pointer(&cloud);
    for _ in 0..CYCLES {
        first.tick().await;
    }

    // Task 1 is the Accord's oil change, on vehicle 1.
    b.captured(|tx| {
        crate::db::maintenance::update_maintenance_task_intervals(tx, 1, 12_000, 12).map(|_| ())
    })
    .expect("the change commits");

    second.auto_start_now().await;
    exchange(&mut first, &mut second).await;

    assert_each_record_once("the first computer", &a, &shape);
    assert_each_record_once("the second computer", &b, &shape);
    for (label, probe) in [("the first computer", &a), ("the second computer", &b)] {
        let interval: i64 = probe.read(|conn| {
            conn.query_row(
                "SELECT t.interval_km FROM maintenance_tasks t \
                 JOIN vehicles v ON v.id = t.vehicle_id \
                 WHERE v.nickname = 'Accord' AND t.task_type_key = 'oil_change'",
                [],
                |row| row.get(0),
            )
            .expect("the task reads")
        });
        assert_eq!(
            interval, 12_000,
            "{label} has the new interval on the original task"
        );
    }
}

/// A snapshot published by a build that did not settle first holds records with no identity. A
/// computer that restores one has to settle them before it applies the tail, or the tail — which
/// names every record — would create a second copy of each.
#[tokio::test(start_paused = true)]
async fn a_snapshot_whose_records_have_no_identity_is_settled_before_the_tail_is_applied() {
    let cloud = new_cloud();
    let (mut first, a) = computer("A", &cloud, NOW_MS);
    let shape = seed(&a);
    as_a_milestone_one_linked_computer(&a);

    // The account as an older build left it: a snapshot of A's records exactly as they are, with no
    // identity on any of them.
    a.close_live();
    cloud.seed(
        OWNER_OBJECT_KEY,
        owner_object_body(&AccountPin::new(FAKE_IDENTITY_ID, FAKE_OWNER_SUB), NOW_MS),
    );
    let unsettled = snapshot::build_snapshot(
        a.db_path(),
        u32::try_from(crate::db::latest_schema_version()).expect("the version fits"),
    )
    .await
    .expect("the snapshot builds");
    snapshot::upload_snapshot(&syncing_fake(Arc::clone(&cloud)), &unsettled, None, NOW_MS, 0)
        .await
        .expect("the snapshot publishes");

    // A, on this build, settles, describes every record in its log and ships it.
    first.auto_start_now().await;
    for _ in 0..CYCLES {
        first.tick().await;
    }

    // A new computer signs in: restores the identity-less snapshot, then receives all of that.
    let (mut second, b) = computer("B", &cloud, NOW_MS + 600_000);
    second.auto_start_now().await;
    exchange(&mut first, &mut second).await;

    assert_each_record_once("the first computer", &a, &shape);
    assert_each_record_once("the second computer", &b, &shape);
    assert_eq!(parked(&b), (0, 0));
}

// ------------------------------------------------------------------------------------------
// 2c. A dataset the bug already doubled.
// ------------------------------------------------------------------------------------------

/// What this build's predecessors did the first time they looked at a record that predates sync:
/// a RANDOM identity. Pre-binding them on a computer is how a test stands for one.
fn as_the_build_that_minted_random_identities(probe: &ComputerProbe) {
    probe.read(|conn| {
        for rule in reconcile::travelling() {
            if !adopt::has_creation_facts(rule.table) {
                continue;
            }
            let ids = crate::db::sync_reconcile::live_row_ids(conn, rule.table, 0, usize::MAX >> 1)
                .expect("the rows read");
            for row_id in ids {
                identity::uuid_for(conn, rule.table, row_id).expect("a random identity");
            }
        }
    });
}

/// The reported state, reproduced and then repaired: two computers that each gave the same records
/// their own random identities and so hold every record twice. One click on ONE computer removes
/// the second copy everywhere, and nothing else.
#[tokio::test(start_paused = true)]
async fn a_dataset_the_bug_already_doubled_is_repaired_from_one_computer_everywhere() {
    let cloud = new_cloud();
    let (mut first, a) = computer("A", &cloud, NOW_MS);
    let shape = seed(&a);
    let (mut second, b) = computer_prepared("B", &cloud, NOW_MS + 600_000, |probe| {
        clone_dataset(&a, probe);
        as_a_milestone_one_linked_computer(probe);
        as_the_build_that_minted_random_identities(probe);
    });
    as_a_milestone_one_linked_computer(&a);
    as_the_build_that_minted_random_identities(&a);

    first.auto_start_now().await;
    milestone_one_pointer(&cloud);
    second.auto_start_now().await;
    exchange(&mut first, &mut second).await;

    // Non-vacuous: the state really is the reported one.
    let doubled = |probe: &ComputerProbe| -> Vec<(&'static str, i64)> {
        shape
            .per_table()
            .iter()
            .map(|(table, rows)| (*table, rows * 2))
            .collect::<Vec<_>>()
            .into_iter()
            .zip(counts(probe))
            .map(|((table, want), (_, found))| (table, found - want))
            .collect()
    };
    assert!(
        doubled(&a)
            .iter()
            .filter(|(table, _)| *table != "maintenance_tasks")
            .all(|(_, gap)| *gap == 0),
        "every table holds its records twice before the repair: {:?}",
        counts(&a)
    );

    let removed = a
        .with_active(|active| dedupe::remove(active, a.backup_dir()))
        .expect("the repair runs on one computer");
    assert!(removed.total > 0 && removed.sync_available, "{removed:?}");

    // The copy exists, and it is the dataset as it was BEFORE anything was removed.
    let copies = a.dated_backups();
    assert_eq!(
        copies.len(),
        1,
        "one dated copy is saved before the removal: {copies:?}"
    );
    let before_the_repair = rusqlite::Connection::open_with_flags(
        &copies[0],
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .expect("the copy opens");
    let expenses_in_copy: i64 = before_the_repair
        .query_row("SELECT COUNT(*) FROM expenses", [], |row| row.get(0))
        .expect("the copy answers");
    assert_eq!(
        expenses_in_copy,
        shape.expenses * 2,
        "the copy still holds every record twice, so restoring it undoes the repair"
    );

    exchange(&mut first, &mut second).await;

    assert_each_record_once("the computer that ran the repair", &a, &shape);
    assert_each_record_once("the computer that did not", &b, &shape);
    assert_eq!(parked(&a), (0, 0));
    assert_eq!(parked(&b), (0, 0));

    // Nothing is left to find, from either side, and running it again changes nothing.
    for probe in [&a, &b] {
        let again = probe
            .with_active(dedupe::preview)
            .expect("the preview runs");
        assert_eq!(again.total, 0, "{again:?}");
    }
    let rerun = b
        .with_active(|active| dedupe::remove(active, b.backup_dir()))
        .expect("the repair is safe to run on the other computer too");
    assert_eq!(rerun.total, 0);
    exchange(&mut first, &mut second).await;
    assert_each_record_once("the first computer after the second repair", &a, &shape);
    assert_each_record_once("the second computer after its own repair", &b, &shape);
}

/// The action log is the other half of the incident: neither computer could ever create the other's
/// audit entries (they failed on a NOT NULL column and sat parked), so each kept only its own copy
/// of every entry under its own random identity. Once the fix lets them through, each computer
/// receives the other's copies, and the repair has to leave every entry exactly once.
#[tokio::test(start_paused = true)]
async fn audit_entries_the_old_build_left_under_two_identities_drain_and_are_repaired() {
    let cloud = new_cloud();
    let (mut first, a) = computer("A", &cloud, NOW_MS);
    a.read(|conn| fixtures::seed_pre_sync_audit_entries(conn, 6).expect("the entries seed"));
    let (mut second, b) = computer_prepared("B", &cloud, NOW_MS + 600_000, |probe| {
        clone_dataset(&a, probe);
        as_a_milestone_one_linked_computer(probe);
        as_the_build_that_minted_random_identities(probe);
    });
    as_a_milestone_one_linked_computer(&a);
    as_the_build_that_minted_random_identities(&a);

    first.auto_start_now().await;
    milestone_one_pointer(&cloud);
    second.auto_start_now().await;
    exchange(&mut first, &mut second).await;

    let entries = |probe: &ComputerProbe| {
        probe
            .read(|conn| fixtures::count_audit_entries_of(conn, "import").expect("the count reads"))
    };
    for (label, probe) in [("A", &a), ("B", &b)] {
        assert_eq!(
            parked(probe),
            (0, 0),
            "{label}: nothing is left waiting for a row that never comes"
        );
        assert_eq!(
            entries(probe),
            12,
            "{label} now holds each entry twice, once per computer"
        );
    }

    // Deleting an audit entry is a local prune (it never travels), so each computer runs the repair.
    for probe in [&a, &b] {
        let removed = probe
            .with_active(|active| dedupe::remove(active, probe.backup_dir()))
            .expect("the repair runs");
        assert_eq!(removed.total, 6, "{removed:?}");
    }
    exchange(&mut first, &mut second).await;

    for (label, probe) in [("A", &a), ("B", &b)] {
        assert_eq!(entries(probe), 6, "{label} holds each entry once");
        assert_eq!(parked(probe), (0, 0));
    }
}

/// A repair that deletes a thousand records must be undoable, so it refuses to run without its
/// safety copy: if the copy cannot be written, nothing is removed.
#[tokio::test(start_paused = true)]
async fn the_repair_removes_nothing_when_its_safety_copy_cannot_be_saved() {
    let cloud = new_cloud();
    let (mut first, a) = computer("A", &cloud, NOW_MS);
    let shape = seed(&a);
    let (mut second, _b) = computer_prepared("B", &cloud, NOW_MS + 600_000, |probe| {
        clone_dataset(&a, probe);
        as_a_milestone_one_linked_computer(probe);
        as_the_build_that_minted_random_identities(probe);
    });
    as_a_milestone_one_linked_computer(&a);
    as_the_build_that_minted_random_identities(&a);
    first.auto_start_now().await;
    milestone_one_pointer(&cloud);
    second.auto_start_now().await;
    exchange(&mut first, &mut second).await;
    let doubled = counts(&a);

    // A FILE where the backup directory has to be: the copy cannot be created.
    let blocked = a.backup_dir().to_path_buf();
    std::fs::write(&blocked, b"not a directory").expect("the obstacle is written");

    let outcome = a.with_active(|active| dedupe::remove(active, &blocked));

    assert!(
        outcome.is_err(),
        "the repair must refuse without its copy: {outcome:?}"
    );
    assert_eq!(counts(&a), doubled, "and it removed nothing");
    assert_ne!(
        counts(&a),
        shape.per_table().to_vec(),
        "(the dataset really was doubled)"
    );
}

// ------------------------------------------------------------------------------------------
// 3. What must NOT change: the question CAP-5 asks, and a lone computer's own records.
// ------------------------------------------------------------------------------------------

/// A computer that holds records of its own and has never joined is ASKED, exactly as before. The
/// fix may not turn that question into a silent merge in either direction.
#[tokio::test(start_paused = true)]
async fn a_computer_with_its_own_records_that_never_joined_is_still_asked() {
    let cloud = new_cloud();
    let (mut first, a) = computer("A", &cloud, NOW_MS);
    seed(&a);
    first.auto_start_now().await;
    for _ in 0..CYCLES {
        first.tick().await;
    }

    let (mut second, b) = computer("B", &cloud, NOW_MS + 600_000);
    let shape = seed(&b);
    second.auto_start_now().await;

    assert_eq!(second.status().state, SyncState::LinkChoiceRequired);
    assert_each_record_once("the computer that was asked", &b, &shape);
}

/// One computer, records from before sync: giving them identities must not change what it holds.
#[tokio::test(start_paused = true)]
async fn a_lone_computer_keeps_exactly_the_records_it_had_when_sync_gives_them_identities() {
    let cloud = new_cloud();
    let (mut only, a) = computer("A", &cloud, NOW_MS);
    let shape = seed(&a);

    only.auto_start_now().await;
    for _ in 0..CYCLES {
        only.tick().await;
    }

    assert_each_record_once("the only computer", &a, &shape);
    assert_eq!(parked(&a), (0, 0));
}
