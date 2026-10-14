//! The simulator's own tests: the randomized gate, the deterministic fault cases it would be
//! unlucky to miss, and the proof that it can fail at all.

use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use proptest::prelude::*;
use proptest::test_runner::{Config as ProptestConfig, TestCaseError};
use tempfile::TempDir;

use crate::db::sim_tables::SimCell;
use crate::sync::clock::WallClock;
use crate::sync::sim::engine::{ReplicaEngine, SimError};
use crate::sync::sim::model::{fresh_row_uuid, natural_key_uuid, Change, RowUuid, Table};
use crate::sync::sim::reference::{Mutation, ReferenceEngine};
use crate::sync::sim::runner::{self, SimConfig, SimOutcome};

/// How many seeds one `cargo test` runs. Small by default so the suite stays fast; AD-19's
/// release gate raises it (see the module docs and CONTRIBUTING).
const DEFAULT_SEEDS: u32 = 64;

fn seed_count() -> u32 {
    std::env::var("NIXUS_SIM_SEEDS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(DEFAULT_SEEDS)
}

fn pinned_seed() -> Option<u64> {
    std::env::var("NIXUS_SIM_SEED")
        .ok()
        .and_then(|value| value.parse().ok())
}

/// Everything about a scenario is derived from its seed, so one number is a complete replay
/// instruction and the failure message can print a command instead of a file format.
fn config_for(seed: u64) -> SimConfig {
    SimConfig {
        seed,
        replicas: 2 + (seed % 4) as usize,
        steps: 40 + ((seed >> 7) % 121) as usize,
    }
}

fn proptest_config() -> ProptestConfig {
    ProptestConfig {
        cases: if pinned_seed().is_some() { 1 } else { seed_count() },
        // No regression file: this crate's source tree must stay clean, and a seed is already
        // printed and archived on failure.
        failure_persistence: None,
        ..ProptestConfig::default()
    }
}

fn seeds() -> BoxedStrategy<u64> {
    match pinned_seed() {
        Some(seed) => Just(seed).boxed(),
        None => any::<u64>().boxed(),
    }
}

proptest! {
    #![proptest_config(proptest_config())]

    /// The AD-19 gate: 2–5 replicas over the real schema, with offline edits, reordering,
    /// duplicated delivery and delayed segments, must end up identical to each other and to
    /// the state the op log says they should hold.
    #[test]
    fn replicas_converge_under_offline_edits_reordering_duplication_and_delay(seed in seeds()) {
        if let Err(failure) = runner::run(&config_for(seed), Mutation::None) {
            return Err(TestCaseError::fail(failure));
        }
    }

    /// The same gate against the REAL pipeline (Story 20): the real capture hook, the real
    /// segment bytes and the real apply path on a second connection, with the assertions
    /// unchanged. This is the one that says the product converges; the reference engine above
    /// says the rules it implements do.
    #[test]
    fn the_real_pipeline_converges_under_the_same_faults(seed in seeds()) {
        if let Err(failure) = runner::run_real(&config_for(seed)) {
            return Err(TestCaseError::fail(failure));
        }
    }
}

/// The real pipeline on the seeds the reference engine is pinned on, so a divergence between the
/// two engines is attributable to a seed rather than to a sample size.
///
/// The scenario comparison holds only for a seed on which the real engine performed NO RESTORE.
/// A restore is the one op the reference engine cannot express — its merge state lives in memory
/// and a stripped snapshot file carries none of it, which is the limitation Stories 13, 20 and 23
/// each recorded — so a restored replica holds a different set of rows from that step on and the
/// generator asks the two engines different questions. Clones are implemented by BOTH engines
/// precisely so that the replica COUNT never diverges, which would desynchronize every later
/// choice. The `compared` guard keeps the claim from quietly becoming vacuous.
#[test]
fn the_real_pipeline_agrees_with_the_reference_on_the_pinned_seeds() {
    const SEEDS: [u64; 5] = [0x5EED_0013, 0xA11CE, 0xB0B, 0xC0FFEE, 0xDEADBEEF];

    let mut compared = 0;
    for seed in SEEDS {
        let config = config_for(seed);
        let reference = runner::run(&config, Mutation::None).expect("the reference converges");
        let real = runner::run_real(&config).expect("the real pipeline converges");
        if real.restores > 0 {
            continue;
        }
        compared += 1;

        assert_eq!(
            reference.ops, real.ops,
            "the two engines did not run the same scenario for seed {seed:x}"
        );
        assert_eq!(
            reference.live_rows, real.live_rows,
            "the two engines disagree about how many rows survived seed {seed:x}"
        );
    }

    assert!(
        compared > 0,
        "every pinned seed restored, so the two engines were never actually compared"
    );
}

#[test]
fn one_seed_produces_exactly_the_same_run_twice() {
    let config = config_for(0x5EED_0013);

    let first = runner::run(&config, Mutation::None).expect("the scenario converges");
    let second = runner::run(&config, Mutation::None).expect("the scenario converges again");

    assert_eq!(first, second, "the simulator is not deterministic");
}

/// A simulator that cannot fail proves nothing.
///
/// Whether a given seed *exposes* a given bug depends on the seed — losing de-duplication is
/// invisible until a duplicate lands on a delta, and arrival-order-wins is invisible until
/// two writes to one field are delivered in opposite orders on two replicas. So the
/// randomized gate is required to catch each mutation somewhere, and the three tests after
/// this one pin each failure exactly, with no seed involved.
#[test]
fn a_broken_engine_fails_the_simulator() {
    const SEEDS: [u64; 5] = [0x5EED_0013, 0xA11CE, 0xB0B, 0xC0FFEE, 0xDEADBEEF];

    for mutation in [
        Mutation::NoMessageDedup,
        Mutation::IgnoreTombstones,
        Mutation::ArrivalOrderWins,
    ] {
        let caught = SEEDS
            .into_iter()
            .filter(|seed| runner::run(&config_for(*seed), mutation).is_err())
            .count();

        assert!(
            caught > 0,
            "{mutation:?} was never caught by any of {SEEDS:x?}"
        );
    }

    for seed in SEEDS {
        runner::run(&config_for(seed), Mutation::None)
            .expect("the unmutated engine must pass the same seeds");
    }
}

/// The de-duplication failure, stated so it cannot depend on a seed: the exact scenario
/// `a_duplicated_segment_does_not_double_count_a_delta_or_a_counter` proves correct must go
/// wrong when the engine stops keying deltas by cause and counters by message id.
#[test]
fn an_engine_without_message_dedup_double_counts_a_duplicated_segment() {
    let mut replicas = Replicas::open_with(2, Mutation::NoMessageDedup);
    let account = fresh_row_uuid(8);
    let cause = fresh_row_uuid(9);

    replicas.engines[0]
        .local_write(&new_account(account, "Visa"))
        .expect("the account is created");
    replicas.engines[0]
        .local_write(&Change::BalanceSet {
            row: account,
            cents: 100_000,
        })
        .expect("the balance is set");
    replicas.tick();
    replicas.engines[0]
        .local_write(&Change::BalanceDelta {
            row: account,
            cause: (cause, "expense_delete"),
            cents: -25_000,
        })
        .expect("the delta is emitted");

    let segment = replicas.flush(0);
    for _ in 0..3 {
        replicas.engines[1]
            .deliver(&segment)
            .expect("the duplicate is accepted");
    }

    assert_eq!(
        replicas.cell(1, Table::Accounts, account, "balance_cents"),
        Some(SimCell::Int(25_000)),
        "three deliveries of one delta must triple-count without de-duplication, \
         which is what the correct engine's 75000 is evidence against"
    );
}

#[test]
fn an_engine_that_ignores_tombstones_keeps_a_deleted_row() {
    let mut replicas = Replicas::open_with(2, Mutation::IgnoreTombstones);
    let row = fresh_row_uuid(10);

    replicas.engines[0]
        .local_write(&new_account(row, "Doomed"))
        .expect("the account is created");
    replicas.tick();
    replicas.engines[0]
        .local_write(&Change::Tombstone {
            table: Table::Accounts,
            row,
        })
        .expect("the delete is issued");
    let segment = replicas.flush(0);
    replicas.engines[1].deliver(&segment).expect("it is delivered");

    assert_eq!(
        replicas.rows_in(1, Table::Accounts),
        1,
        "ignoring tombstones must leave the row behind, which is what the \
         delete-wins assertions are evidence against"
    );
}

#[test]
fn an_engine_that_lets_arrival_order_win_diverges() {
    let mut replicas = Replicas::open_with(2, Mutation::ArrivalOrderWins);
    let row = fresh_row_uuid(11);

    replicas.engines[0]
        .local_write(&new_account(row, "Original"))
        .expect("the account is created");
    let creation = replicas.flush(0);
    replicas.engines[1].deliver(&creation).expect("both replicas hold it");

    replicas.tick();
    replicas.engines[0]
        .local_write(&rename_account(row, "From r0"))
        .expect("r0 renames");
    replicas.tick();
    replicas.engines[1]
        .local_write(&rename_account(row, "From r1"))
        .expect("r1 renames later");

    let from_zero = replicas.flush(0);
    let from_one = replicas.flush(1);
    replicas.engines[0].deliver(&from_one).expect("r0 folds r1's rename");
    replicas.engines[1].deliver(&from_zero).expect("r1 folds r0's rename");

    assert_eq!(
        replicas.name_of(0, Table::Accounts, row),
        Some(SimCell::Text("From r1".into()))
    );
    assert_eq!(
        replicas.name_of(1, Table::Accounts, row),
        Some(SimCell::Text("From r0".into())),
        "arrival order must make the two replicas disagree, which is what the \
         no-lost-edits assertion is evidence against"
    );
}

#[test]
fn the_fault_model_actually_fires() {
    let mut totals = SimOutcome::default();

    for seed in 0..12u64 {
        let outcome = runner::run(&config_for(seed * 0x9E37_79B9), Mutation::None)
            .expect("the scenario converges");
        totals.ops += outcome.ops;
        totals.segments += outcome.segments;
        totals.deliveries += outcome.deliveries;
        totals.duplicate_deliveries += outcome.duplicate_deliveries;
        totals.dropped_deliveries += outcome.dropped_deliveries;
        totals.offline_periods += outcome.offline_periods;
        totals.deletes += outcome.deletes;
        totals.double_deletes += outcome.double_deletes;
        totals.concurrent_edit_deletes += outcome.concurrent_edit_deletes;
        totals.double_balance_sets += outcome.double_balance_sets;
        totals.live_rows += outcome.live_rows;
    }

    for (what, count) in [
        ("ops", totals.ops),
        ("segments", totals.segments),
        ("deliveries", totals.deliveries),
        ("duplicate deliveries", totals.duplicate_deliveries),
        ("delayed segments", totals.dropped_deliveries),
        ("offline periods", totals.offline_periods),
        ("deletes", totals.deletes),
        ("double deletes", totals.double_deletes),
        ("concurrent edit-and-delete pairs", totals.concurrent_edit_deletes),
        ("double absolute balance sets", totals.double_balance_sets),
        ("surviving rows", totals.live_rows),
    ] {
        assert!(count > 0, "12 seeds produced no {what}");
    }

    // Restore and clone exist only on the real engine (the reference one keeps its merge state in
    // memory and declines the file swap), so their non-vacuity has to be measured there.
    let mut lifecycle = SimOutcome::default();
    for seed in 0..6u64 {
        let outcome = runner::run_real(&config_for(seed * 0xD1B5_4A32))
            .expect("the real pipeline converges");
        lifecycle.restores += outcome.restores;
        lifecycle.clones += outcome.clones;
    }

    for (what, count) in [("restores", lifecycle.restores), ("clones", lifecycle.clones)] {
        assert!(count > 0, "6 real-pipeline seeds produced no {what}");
    }
}

#[test]
fn a_failing_trace_is_archived_and_replays_from_the_file() {
    let config = config_for(0x7_7ACE_u64);
    let path = runner::archive_trace(&config, "written deliberately by a test", &[])
        .expect("the trace writes");

    assert!(path.starts_with(runner::trace_dir()));
    let replayed = runner::replay_trace_file(&path).expect("the archived scenario replays");
    let directly = runner::run(&config, Mutation::None).expect("the same scenario runs directly");

    assert_eq!(replayed, directly, "a replay must reproduce the run");
    std::fs::remove_file(&path).expect("the trace file is removed");
}

struct Replicas {
    engines: Vec<ReferenceEngine>,
    now_ms: Arc<AtomicI64>,
    _dirs: Vec<TempDir>,
}

impl Replicas {
    fn open(count: usize) -> Self {
        Self::open_with(count, Mutation::None)
    }

    fn open_with(count: usize, mutation: Mutation) -> Self {
        let now_ms = Arc::new(AtomicI64::new(1_767_225_600_000));
        let mut engines = Vec::new();
        let mut dirs = Vec::new();

        for index in 0..count {
            let dir = tempfile::tempdir().expect("a temp dir");
            let reader = Arc::clone(&now_ms);
            let wall: WallClock = Arc::new(move || reader.load(Ordering::SeqCst));
            engines.push(
                ReferenceEngine::open(
                    &format!("{:016x}", 0x0a1b_2c3d_4e5f_0000u64 + index as u64 + 1),
                    &dir.path().join("nixus.db"),
                    wall,
                    mutation,
                )
                .expect("the replica opens"),
            );
            dirs.push(dir);
        }

        Self {
            engines,
            now_ms,
            _dirs: dirs,
        }
    }

    fn tick(&self) {
        self.now_ms.fetch_add(1, Ordering::SeqCst);
    }

    fn flush(&mut self, replica: usize) -> crate::sync::sim::model::Segment {
        self.engines[replica]
            .flush()
            .expect("the flush succeeds")
            .expect("there was something to flush")
    }

    fn name_of(&self, replica: usize, table: Table, row: RowUuid) -> Option<SimCell> {
        self.engines[replica]
            .observable()
            .expect("the dump reads")
            .get(table.sql())?
            .get(&row)?
            .get("name")
            .cloned()
    }

    fn rows_in(&self, replica: usize, table: Table) -> usize {
        self.engines[replica]
            .observable()
            .expect("the dump reads")
            .get(table.sql())
            .map(|rows| rows.len())
            .unwrap_or(0)
    }

    fn cell(&self, replica: usize, table: Table, row: RowUuid, column: &str) -> Option<SimCell> {
        self.engines[replica]
            .observable()
            .expect("the dump reads")
            .get(table.sql())?
            .get(&row)?
            .get(column)
            .cloned()
    }
}

fn new_account(row: RowUuid, name: &str) -> Change {
    Change::Upsert {
        table: Table::Accounts,
        row,
        parent: None,
        fields: vec![
            ("name", SimCell::Text(name.to_string())),
            ("institution", SimCell::Text("Bank".into())),
            ("account_type", SimCell::Text("chequing".into())),
        ],
    }
}

fn rename_account(row: RowUuid, name: &str) -> Change {
    Change::Upsert {
        table: Table::Accounts,
        row,
        parent: None,
        fields: vec![("name", SimCell::Text(name.to_string()))],
    }
}

/// The "dropped segment" case stated deterministically: while a replica is missing the
/// segment that created a row, the edit that follows it is parked (AD-11) and the row is
/// absent — not half-written, not invented from the edit alone. When the segment finally
/// arrives, the later edit still wins.
#[test]
fn a_replica_missing_a_segment_converges_once_it_arrives() {
    let mut replicas = Replicas::open(2);
    let row = fresh_row_uuid(1);

    replicas.engines[0]
        .local_write(&new_account(row, "Original"))
        .expect("the account is created");
    let creation = replicas.flush(0);

    replicas.tick();
    replicas.engines[0]
        .local_write(&rename_account(row, "Renamed"))
        .expect("the account is renamed");
    let rename = replicas.flush(0);

    replicas.engines[1].deliver(&rename).expect("the rename is delivered first");
    assert_eq!(replicas.engines[1].pending_count(), 1);
    assert_eq!(replicas.rows_in(1, Table::Accounts), 0);

    replicas.engines[1]
        .deliver(&creation)
        .expect("the missing segment arrives");

    assert_eq!(replicas.engines[1].pending_count(), 0);
    assert_eq!(
        replicas.name_of(1, Table::Accounts, row),
        Some(SimCell::Text("Renamed".into())),
        "the higher-clock edit must still win after a late delivery"
    );
    assert_eq!(
        replicas.engines[0].observable().expect("r0 dumps"),
        replicas.engines[1].observable().expect("r1 dumps")
    );
}

#[test]
fn a_delete_beats_a_concurrent_edit_on_both_replicas() {
    let mut replicas = Replicas::open(2);
    let row = fresh_row_uuid(2);

    replicas.engines[0]
        .local_write(&new_account(row, "Shared"))
        .expect("the account is created");
    let creation = replicas.flush(0);
    replicas.engines[1].deliver(&creation).expect("both replicas hold it");

    replicas.tick();
    replicas.engines[1]
        .local_write(&rename_account(row, "Edited offline"))
        .expect("r1 edits");
    replicas.tick();
    replicas.engines[0]
        .local_write(&Change::Tombstone {
            table: Table::Accounts,
            row,
        })
        .expect("r0 deletes");

    let edit = replicas.flush(1);
    let tombstone = replicas.flush(0);
    replicas.engines[0].deliver(&edit).expect("the edit arrives after the delete");
    replicas.engines[1]
        .deliver(&tombstone)
        .expect("the delete arrives after the edit");

    for replica in 0..2 {
        assert_eq!(
            replicas.rows_in(replica, Table::Accounts),
            0,
            "r{replica} kept a row a delete had removed"
        );
    }
}

#[test]
fn deleting_the_same_row_twice_is_one_delete() {
    let mut replicas = Replicas::open(2);
    let row = fresh_row_uuid(3);

    replicas.engines[0]
        .local_write(&new_account(row, "Doomed"))
        .expect("the account is created");
    let creation = replicas.flush(0);
    replicas.engines[1].deliver(&creation).expect("both replicas hold it");

    for replica in 0..2 {
        replicas.tick();
        replicas.engines[replica]
            .local_write(&Change::Tombstone {
                table: Table::Accounts,
                row,
            })
            .expect("the delete is issued");
    }

    let first = replicas.flush(0);
    let second = replicas.flush(1);
    replicas.engines[0].deliver(&second).expect("r0 sees r1's delete");
    replicas.engines[1].deliver(&first).expect("r1 sees r0's delete");

    assert_eq!(replicas.rows_in(0, Table::Accounts), 0);
    assert_eq!(
        replicas.engines[0].observable().expect("r0 dumps"),
        replicas.engines[1].observable().expect("r1 dumps")
    );
}

#[test]
fn a_duplicated_segment_does_not_double_count_a_delta_or_a_counter() {
    let mut replicas = Replicas::open(2);
    let account = fresh_row_uuid(4);
    let hint = natural_key_uuid(Table::MerchantHints, &[b"Metro", &1i64.to_be_bytes()]);
    let cause = fresh_row_uuid(5);

    replicas.engines[0]
        .local_write(&new_account(account, "Visa"))
        .expect("the account is created");
    replicas.engines[0]
        .local_write(&Change::BalanceSet {
            row: account,
            cents: 100_000,
        })
        .expect("the balance is set");
    replicas.tick();
    replicas.engines[0]
        .local_write(&Change::BalanceDelta {
            row: account,
            cause: (cause, "expense_delete"),
            cents: -25_000,
        })
        .expect("the delta is emitted");
    replicas.engines[0]
        .local_write(&Change::Upsert {
            table: Table::MerchantHints,
            row: hint,
            parent: None,
            fields: vec![
                ("merchant", SimCell::Text("Metro".into())),
                ("budget_category_id", SimCell::Int(1)),
            ],
        })
        .expect("the hint is created");
    replicas.engines[0]
        .local_write(&Change::CounterDelta {
            table: Table::MerchantHints,
            row: hint,
            delta: 1,
        })
        .expect("the counter is incremented");

    let segment = replicas.flush(0);
    for _ in 0..3 {
        replicas.engines[1].deliver(&segment).expect("the duplicate is harmless");
    }

    assert_eq!(
        replicas.cell(1, Table::Accounts, account, "balance_cents"),
        Some(SimCell::Int(75_000))
    );
    assert_eq!(
        replicas.cell(1, Table::MerchantHints, hint, "usage_count"),
        Some(SimCell::Int(1)),
        "one delta delivered four times is still one increment, and a counter's base is zero \
         (Story 16: the row's creation emits its initial count as its own delta)"
    );
    assert_eq!(
        replicas.engines[0].observable().expect("r0 dumps"),
        replicas.engines[1].observable().expect("r1 dumps")
    );
}

/// AD-2: a row whose schema has a natural key takes its identity from that key, so two
/// replicas that create it independently create one row — the `UNIQUE` constraint in the real
/// schema would otherwise reject the second insert, which is why this is not cosmetic.
#[test]
fn two_replicas_creating_the_same_natural_key_row_converge_on_one_row() {
    let mut replicas = Replicas::open(2);
    let hint = natural_key_uuid(Table::MerchantHints, &[b"Costco", &2i64.to_be_bytes()]);
    let creation = Change::Upsert {
        table: Table::MerchantHints,
        row: hint,
        parent: None,
        fields: vec![
            ("merchant", SimCell::Text("Costco".into())),
            ("budget_category_id", SimCell::Int(2)),
        ],
    };

    for replica in 0..2 {
        replicas.tick();
        replicas.engines[replica]
            .local_write(&creation)
            .expect("each replica creates it on its own");
    }

    let from_zero = replicas.flush(0);
    let from_one = replicas.flush(1);
    replicas.engines[0].deliver(&from_one).expect("r0 folds r1's insert");
    replicas.engines[1].deliver(&from_zero).expect("r1 folds r0's insert");

    for replica in 0..2 {
        assert_eq!(
            replicas.rows_in(replica, Table::MerchantHints),
            1,
            "r{replica} holds a duplicate of a natural-key row"
        );
    }
    assert_eq!(
        replicas.engines[0].observable().expect("r0 dumps"),
        replicas.engines[1].observable().expect("r1 dumps")
    );
}

/// A parent delete removes the children the schema cascades, and a child message that arrives
/// afterwards is dropped rather than resurrecting a row under a parent that is gone (AD-12).
#[test]
fn a_parent_delete_cascades_and_a_late_child_is_dropped() {
    let mut replicas = Replicas::open(2);
    let source = fresh_row_uuid(6);
    let entry = fresh_row_uuid(7);

    replicas.engines[0]
        .local_write(&Change::Upsert {
            table: Table::IncomeSources,
            row: source,
            parent: None,
            fields: vec![
                ("name", SimCell::Text("Employer".into())),
                ("income_type", SimCell::Text("employment".into())),
            ],
        })
        .expect("the source is created");
    let creation = replicas.flush(0);
    replicas.engines[1].deliver(&creation).expect("both replicas hold it");

    replicas.tick();
    replicas.engines[1]
        .local_write(&Change::Upsert {
            table: Table::IncomeEntries,
            row: entry,
            parent: Some(source),
            fields: vec![
                ("amount_cents", SimCell::Int(400_000)),
                ("date", SimCell::Text("2026-03-01".into())),
                ("month", SimCell::Text("2026-03".into())),
            ],
        })
        .expect("r1 adds a child");
    replicas.tick();
    replicas.engines[0]
        .local_write(&Change::Tombstone {
            table: Table::IncomeSources,
            row: source,
        })
        .expect("r0 deletes the parent");

    let child = replicas.flush(1);
    let tombstone = replicas.flush(0);
    replicas.engines[0].deliver(&child).expect("the child arrives after the delete");
    replicas.engines[1]
        .deliver(&tombstone)
        .expect("the delete arrives after the child");

    for replica in 0..2 {
        assert_eq!(replicas.rows_in(replica, Table::IncomeSources), 0);
        assert_eq!(
            replicas.rows_in(replica, Table::IncomeEntries),
            0,
            "r{replica} kept a child of a deleted parent"
        );
        assert_eq!(replicas.engines[replica].pending_count(), 0);
    }
}

/// The seam has to be usable by someone who is not the reference engine, which is only true
/// if the runner never names it. This drives the generic entry point Story 15 will call.
#[test]
fn the_runner_accepts_an_engine_through_the_trait_alone() {
    fn build(
        _index: usize,
        install: &str,
        db_path: &Path,
        wall: WallClock,
    ) -> Result<impl ReplicaEngine, SimError> {
        ReferenceEngine::open(install, db_path, wall, Mutation::None)
    }

    runner::run_with(&config_for(0x5EA3), build).expect("the scenario converges");
}
