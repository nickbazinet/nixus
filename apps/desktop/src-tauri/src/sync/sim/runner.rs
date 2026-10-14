//! The scenario driver: a seeded pseudo-random stream of edits and network faults, a trivial
//! in-memory transport, the final synchronization, and the assertions.
//!
//! Everything is a pure function of `SimConfig`, which is what makes a failure replayable
//! from a single number instead of from a recorded script.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;

use tempfile::TempDir;

use crate::db::sim_tables::{SimCell, SIM_CATEGORY_IDS};
use crate::sync::clock::{Hlc, WallClock};
use crate::sync::sim::engine::{ReplicaEngine, SimError};
use crate::sync::sim::model::{
    fresh_row_uuid, natural_key_uuid, short, Change, Observable, RowUuid, Table,
};
use crate::sync::sim::oracle::Oracle;
use crate::sync::sim::reference::{Mutation, ReferenceEngine};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SimConfig {
    pub seed: u64,
    pub replicas: usize,
    pub steps: usize,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SimOutcome {
    pub ops: usize,
    pub segments: usize,
    pub deliveries: usize,
    pub duplicate_deliveries: usize,
    pub dropped_deliveries: usize,
    pub offline_periods: usize,
    pub deletes: usize,
    /// The three AD-19 faults that are compound actions rather than single ops. Counted
    /// separately because each one silently does nothing when its candidate list is empty,
    /// so without a counter a generator change could turn any of them into a permanent
    /// no-op and `the_fault_model_actually_fires` would stay green.
    pub double_deletes: usize,
    pub concurrent_edit_deletes: usize,
    pub double_balance_sets: usize,
    pub live_rows: usize,
}

/// Reproducible across platforms and carrying no fixture files, the same reason
/// `db::test_dataset` has one of its own.
struct Lcg(u64);

impl Lcg {
    fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }

    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0 >> 11
    }

    fn below(&mut self, limit: u64) -> u64 {
        if limit == 0 {
            return 0;
        }

        self.next() % limit
    }

    fn choose<T: Copy>(&mut self, options: &[T]) -> Option<T> {
        if options.is_empty() {
            return None;
        }

        Some(options[self.below(options.len() as u64) as usize])
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct RowRecord {
    table: Table,
    row: RowUuid,
    /// `None` for a row every replica already had before the chaos started, which is what
    /// makes a conflict on it possible at all: a replica cannot edit a row it has never seen.
    owner: Option<usize>,
    live: bool,
}

const INSTITUTIONS: [&str; 3] = ["Bank", "Credit Union", "Broker"];
const ACCOUNT_TYPES: [&str; 3] = ["chequing", "credit_card", "investment"];
const INCOME_TYPES: [&str; 4] = ["employment", "freelance", "investment", "other"];
const MERCHANTS: [&str; 3] = ["Metro", "Costco", "Uber"];
const DELTA_KIND: &str = "expense_delete";

/// One wall clock, shared by every replica.
///
/// Deliberate: AD-4's drift limit is a property of the clock and is proven in `sync/clock.rs`
/// where a skew can be injected exactly. Letting replicas drift here would make a
/// convergence failure ambiguous between "the merge is wrong" and "a message was refused for
/// skew", which is the opposite of what a seed-replayable simulator is for. Story 24 owns the
/// `clock_skew` state.
fn shared_wall_clock(now_ms: &Arc<AtomicI64>) -> WallClock {
    let reader = Arc::clone(now_ms);

    Arc::new(move || reader.load(Ordering::SeqCst))
}

fn install_id_for(seed: u64, index: usize) -> String {
    let mixed = seed
        .wrapping_mul(0x9E37_79B9_7F4A_7C15)
        .wrapping_add((index as u64 + 1).wrapping_mul(0xD1B5_4A32_D192_ED03))
        | 1;

    format!("{mixed:016x}")
}

struct Driver<E: ReplicaEngine> {
    config: SimConfig,
    rng: Lcg,
    now_ms: Arc<AtomicI64>,
    engines: Vec<E>,
    offline: Vec<bool>,
    holding: Vec<Vec<E::Segment>>,
    published: Vec<(usize, E::Segment)>,
    delivered: Vec<HashSet<usize>>,
    /// Segments a `drop` action withheld. Excluded from every delivery choice until
    /// `synchronize` releases them, so a dropped segment is really withheld rather than
    /// merely unlucky.
    deferred: Vec<HashSet<usize>>,
    oracle: Oracle,
    trace: Vec<String>,
    rows: Vec<RowRecord>,
    parents: HashMap<(Table, RowUuid), RowUuid>,
    buried: Vec<RowRecord>,
    causes: Vec<(RowUuid, RowUuid, i64)>,
    next_ordinal: u64,
    outcome: SimOutcome,
    /// Owns the replicas' directories: dropping the driver is what deletes them, so this is a
    /// lifetime guard rather than something the simulator reads.
    _dirs: Vec<TempDir>,
}

impl<E: ReplicaEngine> Driver<E> {
    fn new<F>(config: &SimConfig, build: F) -> Result<Self, SimError>
    where
        F: Fn(usize, &str, &Path, WallClock) -> Result<E, SimError>,
    {
        let now_ms = Arc::new(AtomicI64::new(1_767_225_600_000));
        let mut engines = Vec::new();
        let mut dirs = Vec::new();

        for index in 0..config.replicas {
            let dir = tempfile::tempdir()
                .map_err(|error| SimError::Model(format!("a temp dir: {error}")))?;
            let db_path = dir.path().join("nixus.db");
            engines.push(build(
                index,
                &install_id_for(config.seed, index),
                &db_path,
                shared_wall_clock(&now_ms),
            )?);
            dirs.push(dir);
        }

        Ok(Self {
            config: *config,
            rng: Lcg::new(config.seed),
            now_ms,
            offline: vec![false; config.replicas],
            holding: vec![Vec::new(); config.replicas],
            delivered: vec![HashSet::new(); config.replicas],
            deferred: vec![HashSet::new(); config.replicas],
            engines,
            published: Vec::new(),
            oracle: Oracle::default(),
            trace: Vec::new(),
            rows: Vec::new(),
            parents: HashMap::new(),
            buried: Vec::new(),
            causes: Vec::new(),
            next_ordinal: 0,
            outcome: SimOutcome::default(),
            _dirs: dirs,
        })
    }

    fn execute(&mut self) -> Result<SimOutcome, String> {
        self.seed_shared_rows().map_err(stringify)?;
        self.chaos().map_err(stringify)?;
        self.synchronize().map_err(stringify)?;
        self.assert_converged()?;
        self.assert_idempotent_reapply()?;
        self.outcome.live_rows = self.rows.iter().filter(|record| record.live).count();

        Ok(self.outcome)
    }

    fn replicas(&self) -> usize {
        self.engines.len()
    }

    fn other_than(&mut self, replica: usize) -> usize {
        let replicas = self.replicas();

        (replica + 1 + self.rng.below(replicas as u64 - 1) as usize) % replicas
    }

    fn write(&mut self, replica: usize, change: Change) -> Result<Hlc, SimError> {
        let hlc = self.engines[replica].local_write(&change)?;
        self.trace.push(format!("r{replica} {}", change.describe()));
        if let Change::Upsert {
            table,
            row,
            parent: Some(parent),
            ..
        } = &change
        {
            self.parents.insert((*table, *row), *parent);
        }
        self.oracle.record(hlc, change);
        self.outcome.ops += 1;

        Ok(hlc)
    }

    fn visible(&self, replica: usize) -> Vec<RowRecord> {
        self.rows
            .iter()
            .filter(|record| record.live && record.owner.is_none_or(|owner| owner == replica))
            .copied()
            .collect()
    }

    fn visible_in(&self, replica: usize, table: Table) -> Vec<RowRecord> {
        self.visible(replica)
            .into_iter()
            .filter(|record| record.table == table)
            .collect()
    }

    fn shared(&self, table: Table) -> Vec<RowRecord> {
        self.rows
            .iter()
            .filter(|record| record.live && record.owner.is_none() && record.table == table)
            .copied()
            .collect()
    }

    fn ordinal(&mut self) -> u64 {
        self.next_ordinal += 1;

        self.next_ordinal
    }

    fn value_for(&mut self, table: Table, column: &'static str) -> SimCell {
        match (table, column) {
            (Table::Accounts, "name") => SimCell::Text(format!("Account {}", self.ordinal())),
            (Table::Accounts, "institution") => SimCell::Text(
                self.rng
                    .choose(&INSTITUTIONS)
                    .expect("the list is not empty")
                    .to_string(),
            ),
            (Table::Accounts, "account_type") => SimCell::Text(
                self.rng
                    .choose(&ACCOUNT_TYPES)
                    .expect("the list is not empty")
                    .to_string(),
            ),
            (Table::IncomeSources, "name") => SimCell::Text(format!("Source {}", self.ordinal())),
            (Table::IncomeSources, "income_type") => SimCell::Text(
                self.rng
                    .choose(&INCOME_TYPES)
                    .expect("the list is not empty")
                    .to_string(),
            ),
            (Table::IncomeEntries, "amount_cents") => {
                SimCell::Int(1 + self.rng.below(500_000) as i64)
            }
            (Table::IncomeEntries, "date") => SimCell::Text(format!(
                "2026-{:02}-{:02}",
                1 + self.rng.below(12),
                1 + self.rng.below(28)
            )),
            (Table::IncomeEntries, "month") => {
                SimCell::Text(format!("2026-{:02}", 1 + self.rng.below(12)))
            }
            (Table::MerchantHints, "merchant") => SimCell::Text(
                self.rng
                    .choose(&MERCHANTS)
                    .expect("the list is not empty")
                    .to_string(),
            ),
            (Table::MerchantHints, "budget_category_id") => {
                SimCell::Int(self.rng.choose(&SIM_CATEGORY_IDS).expect("the list is not empty"))
            }
            (table, column) => unreachable!("no generator for {}.{column}", table.sql()),
        }
    }

    fn all_fields(&mut self, table: Table) -> Vec<(&'static str, SimCell)> {
        table
            .lww_columns()
            .iter()
            .map(|column| (*column, self.value_for(table, column)))
            .collect()
    }

    fn text_of(fields: &[(&'static str, SimCell)], column: &str) -> String {
        match fields.iter().find(|(name, _)| *name == column) {
            Some((_, SimCell::Text(text))) => text.clone(),
            other => unreachable!("{column} must be generated as text, got {other:?}"),
        }
    }

    fn int_of(fields: &[(&'static str, SimCell)], column: &str) -> i64 {
        match fields.iter().find(|(name, _)| *name == column) {
            Some((_, SimCell::Int(number))) => *number,
            other => unreachable!("{column} must be generated as an integer, got {other:?}"),
        }
    }

    fn insert(&mut self, replica: usize, table: Table) -> Result<Option<RowRecord>, SimError> {
        let fields = self.all_fields(table);

        // A natural-key row's identity is a function of its key (AD-2), so two replicas that
        // create "the same" hint independently converge on one row. Everything else gets a
        // fresh identity, owned by its creator until the chaos phase is over.
        let (row, owner) = match table {
            Table::MerchantHints => (
                natural_key_uuid(
                    table,
                    &[
                        Self::text_of(&fields, "merchant").as_bytes(),
                        &Self::int_of(&fields, "budget_category_id").to_be_bytes(),
                    ],
                ),
                None,
            ),
            _ => (fresh_row_uuid(self.ordinal()), Some(replica)),
        };

        let parent = match table.parent() {
            Some((parent_table, _)) => {
                let candidates = self.visible_in(replica, parent_table);
                match self.rng.choose(&candidates) {
                    Some(candidate) => Some(candidate.row),
                    None => return Ok(None),
                }
            }
            None => None,
        };

        self.write(
            replica,
            Change::Upsert {
                table,
                row,
                parent,
                fields,
            },
        )?;

        if table.balance_column().is_some() {
            let cents = self.rng.below(2_000_000) as i64 - 1_000_000;
            self.write(replica, Change::BalanceSet { row, cents })?;
        }

        let record = RowRecord {
            table,
            row,
            owner,
            live: true,
        };
        if !self
            .rows
            .iter()
            .any(|existing| existing.table == table && existing.row == row)
        {
            self.rows.push(record);
        }

        Ok(Some(record))
    }

    /// Re-states the parent on every child edit, not only the first one, because a reordered
    /// delivery can make an edit the first thing a replica ever hears about the row — and a
    /// message that cannot name its parent could not be parked and later resolved (AD-11).
    fn edit(&mut self, replica: usize, record: RowRecord) -> Result<(), SimError> {
        let Some(column) = self.rng.choose(record.table.editable_columns()) else {
            return Ok(());
        };
        let value = self.value_for(record.table, column);
        let parent = self.parents.get(&(record.table, record.row)).copied();

        self.write(
            replica,
            Change::Upsert {
                table: record.table,
                row: record.row,
                parent,
                fields: vec![(column, value)],
            },
        )?;

        Ok(())
    }

    fn delete(&mut self, replica: usize, record: RowRecord) -> Result<(), SimError> {
        self.write(
            replica,
            Change::Tombstone {
                table: record.table,
                row: record.row,
            },
        )?;
        self.bury(record);

        Ok(())
    }

    /// Takes the row out of the generator's live set, together with the children the schema's
    /// cascade will take with it, so no later op targets a row that no longer exists.
    fn bury(&mut self, record: RowRecord) {
        let cascaded: Vec<(Table, RowUuid)> = self
            .rows
            .iter()
            .filter(|child| {
                child.live
                    && child.table.parent().map(|(parent, _)| parent) == Some(record.table)
                    && self.parents.get(&(child.table, child.row)) == Some(&record.row)
            })
            .map(|child| (child.table, child.row))
            .collect();

        for existing in &mut self.rows {
            let targeted = existing.table == record.table && existing.row == record.row;
            if targeted || cascaded.contains(&(existing.table, existing.row)) {
                existing.live = false;
            }
        }

        self.buried.push(record);
        self.outcome.deletes += 1;
    }

    fn publish(&mut self, replica: usize) -> Result<(), SimError> {
        let Some(segment) = self.engines[replica].flush()? else {
            return Ok(());
        };
        self.outcome.segments += 1;

        if self.offline[replica] {
            self.trace.push(format!("r{replica} flush (held offline)"));
            self.holding[replica].push(segment);
        } else {
            self.trace.push(format!("r{replica} publish"));
            self.published.push((replica, segment));
        }

        Ok(())
    }

    fn deliver_index(&mut self, replica: usize, index: usize) -> Result<(), SimError> {
        let (sender, segment) = self.published[index].clone();
        if sender == replica {
            return Ok(());
        }

        self.engines[replica].deliver(&segment)?;
        let first_time = self.delivered[replica].insert(index);
        if first_time {
            self.outcome.deliveries += 1;
        } else {
            self.outcome.duplicate_deliveries += 1;
        }
        self.trace.push(format!(
            "r{replica} deliver #{index} from r{sender}{}",
            if first_time { "" } else { " (duplicate)" }
        ));

        Ok(())
    }

    fn undelivered(&self, replica: usize) -> Vec<usize> {
        (0..self.published.len())
            .filter(|index| {
                self.published[*index].0 != replica
                    && !self.delivered[replica].contains(index)
                    && !self.deferred[replica].contains(index)
            })
            .collect()
    }

    /// The rows every replica holds before anything goes wrong. Without them a replica could
    /// only ever edit rows it created itself, and a conflict needs two editors.
    fn seed_shared_rows(&mut self) -> Result<(), SimError> {
        for table in [
            Table::Accounts,
            Table::Accounts,
            Table::Accounts,
            Table::IncomeSources,
            Table::IncomeSources,
            Table::IncomeEntries,
            Table::IncomeEntries,
            Table::MerchantHints,
        ] {
            if let Some(record) = self.insert(0, table)? {
                for existing in &mut self.rows {
                    if existing.table == record.table && existing.row == record.row {
                        existing.owner = None;
                    }
                }
            }
        }

        self.publish(0)?;
        for replica in 1..self.replicas() {
            for index in 0..self.published.len() {
                self.deliver_index(replica, index)?;
            }
        }

        let accounts: Vec<RowUuid> = self
            .shared(Table::Accounts)
            .into_iter()
            .map(|record| record.row)
            .collect();
        for (ordinal, account) in accounts.into_iter().enumerate() {
            for kind in 0..3u64 {
                self.causes.push((
                    fresh_row_uuid(u64::MAX - (ordinal as u64 * 8 + kind)),
                    account,
                    1_000 * (kind as i64 + 1) - 2_500,
                ));
            }
        }

        Ok(())
    }

    fn chaos(&mut self) -> Result<(), SimError> {
        for _ in 0..self.config.steps {
            // Zero some of the time, so two replicas land on the same millisecond and the
            // install-id tiebreak is exercised instead of being dead code.
            let step = self.rng.below(2) as i64;
            self.now_ms.fetch_add(step, Ordering::SeqCst);
            self.step()?;
        }

        Ok(())
    }

    fn step(&mut self) -> Result<(), SimError> {
        let replicas = self.replicas();
        let replica = self.rng.below(replicas as u64) as usize;

        // STORY 25: restore and clone of a replica are not op variants here. Both are a file
        // swap, and the merge metadata this engine keeps (field clocks, tombstones, balance
        // state, the uuid map) lives in memory until Story 14 puts it in `sync_*` tables — so
        // a swap would silently carry the wrong half and the scenario would prove the opposite
        // of what it claims. The hook is this list plus `ReplicaEngine`: Story 25 adds an
        // `adopt_database` verb and two arms below, and the assertions do not move.
        match self.rng.below(100) {
            0..=14 => self.action_edit(replica)?,
            15..=23 => self.action_insert(replica)?,
            24..=29 => self.action_balance_set(replica)?,
            30..=38 => self.action_balance_delta(replica)?,
            39..=44 => self.action_counter_delta(replica)?,
            45..=48 => self.action_delete(replica)?,
            49..=51 => self.action_double_delete()?,
            52..=55 => self.action_concurrent_edit_and_delete()?,
            56..=58 => self.action_double_balance_set()?,
            59..=61 => self.action_reinsert(replica)?,
            62..=77 => self.publish(replica)?,
            78..=81 => self.action_go_offline(replica),
            82..=85 => self.action_go_online(replica)?,
            86..=94 => self.action_deliver(replica)?,
            95..=97 => self.action_deliver_duplicate(replica)?,
            _ => self.action_drop_delivery(replica),
        }

        Ok(())
    }

    fn action_edit(&mut self, replica: usize) -> Result<(), SimError> {
        let editable: Vec<RowRecord> = self
            .visible(replica)
            .into_iter()
            .filter(|record| !record.table.editable_columns().is_empty())
            .collect();
        let Some(record) = self.rng.choose(&editable) else {
            return Ok(());
        };

        self.edit(replica, record)
    }

    fn action_insert(&mut self, replica: usize) -> Result<(), SimError> {
        let table = self
            .rng
            .choose(&Table::ALL)
            .expect("the table list is not empty");
        self.insert(replica, table)?;

        Ok(())
    }

    fn action_balance_set(&mut self, replica: usize) -> Result<(), SimError> {
        let accounts = self.visible_in(replica, Table::Accounts);
        let Some(record) = self.rng.choose(&accounts) else {
            return Ok(());
        };
        let cents = self.rng.below(2_000_000) as i64 - 1_000_000;

        self.write(
            replica,
            Change::BalanceSet {
                row: record.row,
                cents,
            },
        )
        .map(|_| ())
    }

    /// AD-5's cause-keyed delta. The cause pool is small and shared, so two replicas emit the
    /// same `(cause, kind)` with the same amount — the double-counting case, not a
    /// coincidence to be filtered out.
    fn action_balance_delta(&mut self, replica: usize) -> Result<(), SimError> {
        let accounts = self.visible_in(replica, Table::Accounts);
        let live: Vec<(RowUuid, RowUuid, i64)> = self
            .causes
            .iter()
            .filter(|(_, account, _)| accounts.iter().any(|record| record.row == *account))
            .copied()
            .collect();
        let Some((cause, account, cents)) = self.rng.choose(&live) else {
            return Ok(());
        };

        self.write(
            replica,
            Change::BalanceDelta {
                row: account,
                cause: (cause, DELTA_KIND),
                cents,
            },
        )
        .map(|_| ())
    }

    fn action_counter_delta(&mut self, replica: usize) -> Result<(), SimError> {
        let hints = self.visible_in(replica, Table::MerchantHints);
        let Some(record) = self.rng.choose(&hints) else {
            return Ok(());
        };

        self.write(
            replica,
            Change::CounterDelta {
                table: Table::MerchantHints,
                row: record.row,
                delta: 1,
            },
        )
        .map(|_| ())
    }

    fn action_delete(&mut self, replica: usize) -> Result<(), SimError> {
        let candidates = self.visible(replica);
        let Some(record) = self.rng.choose(&candidates) else {
            return Ok(());
        };

        self.delete(replica, record)
    }

    /// Two replicas delete the same row. It must disappear once, and must not come back.
    fn action_double_delete(&mut self) -> Result<(), SimError> {
        let shared_dead: Vec<RowRecord> = self
            .buried
            .iter()
            .filter(|record| record.owner.is_none())
            .copied()
            .collect();
        let Some(record) = self.rng.choose(&shared_dead) else {
            return Ok(());
        };
        let replica = self.rng.below(self.replicas() as u64) as usize;
        self.outcome.double_deletes += 1;

        self.write(
            replica,
            Change::Tombstone {
                table: record.table,
                row: record.row,
            },
        )
        .map(|_| ())
    }

    fn action_concurrent_edit_and_delete(&mut self) -> Result<(), SimError> {
        let candidates: Vec<RowRecord> = self
            .rows
            .iter()
            .filter(|record| {
                record.live && record.owner.is_none() && !record.table.editable_columns().is_empty()
            })
            .copied()
            .collect();
        let Some(record) = self.rng.choose(&candidates) else {
            return Ok(());
        };

        let editor = self.rng.below(self.replicas() as u64) as usize;
        let deleter = self.other_than(editor);
        self.outcome.concurrent_edit_deletes += 1;
        self.edit(editor, record)?;

        self.delete(deleter, record)
    }

    /// The same absolute value, set on two replicas (AD-5; Story 16 adds the emitter side).
    fn action_double_balance_set(&mut self) -> Result<(), SimError> {
        let accounts = self.shared(Table::Accounts);
        let Some(record) = self.rng.choose(&accounts) else {
            return Ok(());
        };
        let cents = self.rng.below(1_000_000) as i64;
        let first = self.rng.below(self.replicas() as u64) as usize;
        let second = self.other_than(first);
        self.outcome.double_balance_sets += 1;

        self.write(
            first,
            Change::BalanceSet {
                row: record.row,
                cents,
            },
        )?;

        self.write(
            second,
            Change::BalanceSet {
                row: record.row,
                cents,
            },
        )
        .map(|_| ())
    }

    /// Delete, then create again. AD-2 removes the uuid mapping with the tombstone, so the new
    /// row is a new identity — which is why a tombstone can be absorbing without making the
    /// table un-reusable.
    fn action_reinsert(&mut self, replica: usize) -> Result<(), SimError> {
        let candidates: Vec<RowRecord> = self
            .visible(replica)
            .into_iter()
            .filter(|record| record.table != Table::MerchantHints)
            .collect();
        let Some(record) = self.rng.choose(&candidates) else {
            return Ok(());
        };

        self.delete(replica, record)?;
        self.insert(replica, record.table)?;

        Ok(())
    }

    fn action_go_offline(&mut self, replica: usize) {
        if !self.offline[replica] {
            self.offline[replica] = true;
            self.outcome.offline_periods += 1;
            self.trace.push(format!("r{replica} offline"));
        }
    }

    fn action_go_online(&mut self, replica: usize) -> Result<(), SimError> {
        if !self.offline[replica] {
            return Ok(());
        }
        self.offline[replica] = false;
        self.trace.push(format!("r{replica} online"));
        for segment in std::mem::take(&mut self.holding[replica]) {
            self.published.push((replica, segment));
        }

        Ok(())
    }

    fn action_deliver(&mut self, replica: usize) -> Result<(), SimError> {
        if self.offline[replica] {
            return Ok(());
        }
        let waiting = self.undelivered(replica);
        let Some(index) = self.rng.choose(&waiting) else {
            return Ok(());
        };

        self.deliver_index(replica, index)
    }

    fn action_deliver_duplicate(&mut self, replica: usize) -> Result<(), SimError> {
        if self.offline[replica] {
            return Ok(());
        }
        let already: Vec<usize> = self.delivered[replica].iter().copied().collect();
        let Some(index) = self.rng.choose(&already) else {
            return Ok(());
        };

        self.deliver_index(replica, index)
    }

    /// A delivery that does not happen now.
    ///
    /// The transport is durable and its objects immutable (AD-6), so a dropped segment is a
    /// delay, not a loss: `synchronize` redelivers it, the same way re-reading `roster` and
    /// `head/<install>` does in production. A segment lost *forever* is data loss no merge
    /// rule can converge through; `a_replica_missing_a_segment_converges_once_it_arrives`
    /// pins what a replica looks like while it is still behind.
    fn action_drop_delivery(&mut self, replica: usize) {
        let waiting = self.undelivered(replica);
        let Some(index) = self.rng.choose(&waiting) else {
            return;
        };
        self.deferred[replica].insert(index);
        self.outcome.dropped_deliveries += 1;
        self.trace
            .push(format!("r{replica} drop #{index} (redelivered at the end)"));
    }

    fn synchronize(&mut self) -> Result<(), SimError> {
        for replica in 0..self.replicas() {
            self.action_go_online(replica)?;
            self.publish(replica)?;
            self.deferred[replica].clear();
        }

        for (replica, index) in self.shuffled_deliveries() {
            if !self.delivered[replica].contains(&index) {
                self.deliver_index(replica, index)?;
            }
        }

        Ok(())
    }

    fn shuffled_deliveries(&mut self) -> Vec<(usize, usize)> {
        let published = self.published.len();
        let mut pairs: Vec<(usize, usize)> = (0..self.replicas())
            .flat_map(|replica| (0..published).map(move |index| (replica, index)))
            .collect();

        for position in (1..pairs.len()).rev() {
            let other = self.rng.below(position as u64 + 1) as usize;
            pairs.swap(position, other);
        }

        pairs
    }

    fn assert_converged(&mut self) -> Result<(), String> {
        let expected = self.oracle.expected();
        let mut states = Vec::new();

        for replica in 0..self.replicas() {
            let pending = self.engines[replica].pending_count();
            if pending != 0 {
                return Err(format!(
                    "r{replica} still holds {pending} pending message(s) after a full sync"
                ));
            }
            states.push(self.engines[replica].observable().map_err(stringify)?);
        }

        for replica in 1..states.len() {
            if states[replica] != states[0] {
                return Err(format!(
                    "r{replica} diverged from r0:\n{}",
                    difference(&states[0], &states[replica])
                ));
            }
        }

        if states[0] != expected {
            return Err(format!(
                "every replica agrees but disagrees with the {} recorded ops:\n{}",
                self.oracle.len(),
                difference(&expected, &states[0])
            ));
        }

        self.assert_balances_sum(&states[0])?;
        self.assert_deletes_won(&states[0])
    }

    fn assert_balances_sum(&self, state: &Observable) -> Result<(), String> {
        let expected = self.oracle.expected_balances();
        let accounts = state
            .get(&Table::Accounts)
            .ok_or_else(|| "accounts missing from the dump".to_string())?;

        for (row, cells) in accounts {
            let stored = match cells.get("balance_cents") {
                Some(SimCell::Int(cents)) => *cents,
                other => return Err(format!("accounts#{} balance is {other:?}", short(*row))),
            };
            let wanted = expected.get(row).copied().unwrap_or(0);
            if stored != wanted {
                return Err(format!(
                    "accounts#{} holds {stored} but its changes sum to {wanted}",
                    short(*row)
                ));
            }
        }

        Ok(())
    }

    fn assert_deletes_won(&self, state: &Observable) -> Result<(), String> {
        for (table, row) in self.oracle.deleted_rows() {
            if state.get(&table).is_some_and(|rows| rows.contains_key(&row)) {
                return Err(format!(
                    "{}#{} was deleted but survived",
                    table.sql(),
                    short(row)
                ));
            }
        }

        Ok(())
    }

    fn assert_idempotent_reapply(&mut self) -> Result<(), String> {
        let mut before = Vec::new();
        for replica in 0..self.replicas() {
            before.push(self.engines[replica].observable().map_err(stringify)?);
        }

        for (replica, index) in self.shuffled_deliveries() {
            self.deliver_index(replica, index).map_err(stringify)?;
        }

        for (replica, was) in before.iter().enumerate() {
            let after = self.engines[replica].observable().map_err(stringify)?;
            if after != *was {
                return Err(format!(
                    "re-applying every segment changed r{replica}:\n{}",
                    difference(was, &after)
                ));
            }
        }

        Ok(())
    }
}

fn stringify<E: std::fmt::Display>(error: E) -> String {
    error.to_string()
}

fn difference(left: &Observable, right: &Observable) -> String {
    let empty = BTreeMap::new();
    let mut lines = Vec::new();

    for table in Table::ALL {
        let left_rows = left.get(&table).unwrap_or(&empty);
        let right_rows = right.get(&table).unwrap_or(&empty);

        for (row, cells) in left_rows {
            match right_rows.get(row) {
                None => {
                    lines.push(format!("  - {}#{} only on the left", table.sql(), short(*row)))
                }
                Some(other) if other != cells => lines.push(format!(
                    "  ~ {}#{}\n      left  {cells:?}\n      right {other:?}",
                    table.sql(),
                    short(*row)
                )),
                Some(_) => {}
            }
        }
        for row in right_rows.keys() {
            if !left_rows.contains_key(row) {
                lines.push(format!("  + {}#{} only on the right", table.sql(), short(*row)));
            }
        }
    }

    if lines.is_empty() {
        "  (the dumps compare equal; the difference is elsewhere)".to_string()
    } else {
        lines.join("\n")
    }
}

/// Runs one scenario against any engine. Stories 15, 16, 19, 20 and 21 add a second caller
/// here with the real capture/segment/apply pipeline and change nothing else.
pub(crate) fn run_with<E, F>(config: &SimConfig, build: F) -> Result<SimOutcome, String>
where
    E: ReplicaEngine,
    F: Fn(usize, &str, &Path, WallClock) -> Result<E, SimError>,
{
    let mut driver = Driver::new(config, build).map_err(stringify)?;
    match driver.execute() {
        Ok(outcome) => Ok(outcome),
        Err(failure) => Err(report(config, &failure, &driver.trace)),
    }
}

pub(crate) fn run(config: &SimConfig, mutation: Mutation) -> Result<SimOutcome, String> {
    run_with(config, |_, install, db_path, wall| {
        ReferenceEngine::open(install, db_path, wall, mutation)
    })
}

fn report(config: &SimConfig, failure: &str, trace: &[String]) -> String {
    let archived = archive_trace(config, failure, trace)
        .map(|path| path.display().to_string())
        .unwrap_or_else(|| "could not be written".to_string());

    format!(
        "{failure}\n\nseed {} ({} replicas, {} steps)\ntrace: {archived}\nreplay: NIXUS_SIM_SEED={} cargo test sync::sim",
        config.seed, config.replicas, config.steps, config.seed,
    )
}

pub(crate) fn trace_dir() -> PathBuf {
    std::env::var("NIXUS_SIM_TRACE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir().join("nixus-sim-traces"))
}

pub(crate) fn archive_trace(
    config: &SimConfig,
    failure: &str,
    trace: &[String],
) -> Option<PathBuf> {
    let dir = trace_dir();
    std::fs::create_dir_all(&dir).ok()?;
    let path = dir.join(format!("sim-{:016x}.json", config.seed));
    let document = serde_json::json!({
        "seed": config.seed,
        "replicas": config.replicas,
        "steps": config.steps,
        "failure": failure,
        "trace": trace,
    });
    std::fs::write(&path, serde_json::to_vec_pretty(&document).ok()?).ok()?;

    Some(path)
}

/// Replays a scenario from an archived trace file.
///
/// Only the seed and the shape are read: the op list in the file is there for a human, and
/// re-deriving the run instead of replaying the list is what proves it is reproducible rather
/// than merely recorded.
pub(crate) fn replay_trace_file(path: &Path) -> Result<SimOutcome, String> {
    let bytes =
        std::fs::read(path).map_err(|error| format!("reading {}: {error}", path.display()))?;
    let document: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|error| format!("parsing the trace: {error}"))?;

    let number = |key: &str| -> Result<u64, String> {
        document
            .get(key)
            .and_then(serde_json::Value::as_u64)
            .ok_or_else(|| format!("the trace has no {key}"))
    };

    run(
        &SimConfig {
            seed: number("seed")?,
            replicas: number("replicas")? as usize,
            steps: number("steps")? as usize,
        },
        Mutation::None,
    )
}
