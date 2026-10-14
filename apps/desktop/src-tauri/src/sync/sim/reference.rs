//! The first `ReplicaEngine`: AD-5's merge semantics folded in memory and materialized into
//! the real tables.
//!
//! It is not the production pipeline and is not trying to be. Story 14's `sync_*` tables do
//! not exist yet, so the merge metadata (field clocks, tombstones, balance state, counters,
//! the uuid to integer-id map) lives in `HashMap`s instead of in the dataset. What *is* real
//! is everything the assertions look at: a migrated SQLite file per replica, the schema's own
//! `NOT NULL`, `CHECK`, `UNIQUE` and `ON DELETE CASCADE`, and a hybrid logical clock per
//! install.
//!
//! One property is worth stating because it is a design decision and not an accident: every
//! piece of merge state is keyed (field by `(table, row, column)`, delta by cause, counter by
//! message id, tombstone by row), so folding a message twice cannot change the outcome. That
//! is AD-1's single apply path doing the work — idempotence is structural here, not a
//! de-duplication pass bolted on top. `Mutation::NoMessageDedup` exists to prove the
//! simulator would notice if an engine lost it.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;

use rusqlite::Connection;

use crate::db::sim_tables::{self, SimCell};
use crate::db::test_dataset::migrated_dataset;
use crate::sync::clock::{Clock, Hlc, WallClock};
use crate::sync::sim::balance::BalanceLedger;
use crate::sync::sim::engine::{ReplicaEngine, SimError};
use crate::sync::sim::model::{
    CauseKey, Change, Message, MessageId, Observable, RowUuid, Segment, Table,
};

/// Deliberate breakage, used only by the non-vacuity tests: a simulator that cannot fail is
/// not evidence of anything, so each variant removes one load-bearing rule and the tests
/// assert the run goes red.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Mutation {
    #[default]
    None,
    /// Deltas and counters accumulate per delivery instead of per cause and per message id,
    /// so a duplicated segment is counted twice.
    NoMessageDedup,
    /// Tombstones are dropped on the floor.
    IgnoreTombstones,
    /// Whatever arrived last wins, instead of whatever has the highest clock value.
    ArrivalOrderWins,
}

/// A row's required columns are not all known yet, or its parent has not arrived — AD-11's
/// `sync_pending`, not a failure.
enum Fold {
    Applied,
    Pending,
}

type FieldKey = (Table, RowUuid, &'static str);

pub(crate) struct ReferenceEngine {
    install: String,
    clock: Clock,
    conn: Connection,
    mutation: Mutation,

    seq: u64,
    outbox: Vec<Message>,
    seen: HashSet<MessageId>,
    pending: Vec<Message>,

    ids: HashMap<(Table, RowUuid), i64>,
    fields: HashMap<FieldKey, (Hlc, SimCell)>,
    parents: HashMap<(Table, RowUuid), RowUuid>,
    tombstones: HashSet<(Table, RowUuid)>,
    balances: HashMap<RowUuid, BalanceLedger<CauseKey>>,
    counters: HashMap<(Table, RowUuid), HashMap<MessageId, i64>>,
    unkeyed_ordinal: u64,
}

impl ReferenceEngine {
    pub(crate) fn open(
        install_id: &str,
        db_path: &Path,
        wall: WallClock,
        mutation: Mutation,
    ) -> Result<Self, SimError> {
        let conn = migrated_dataset(db_path);
        conn.execute_batch("PRAGMA foreign_keys = ON")?;
        sim_tables::seed_shared_base(&conn)?;

        Ok(Self {
            install: install_id.to_string(),
            clock: Clock::with_wall_clock(install_id, wall)?,
            conn,
            mutation,
            seq: 0,
            outbox: Vec::new(),
            seen: HashSet::new(),
            pending: Vec::new(),
            ids: HashMap::new(),
            fields: HashMap::new(),
            parents: HashMap::new(),
            tombstones: HashSet::new(),
            balances: HashMap::new(),
            counters: HashMap::new(),
            unkeyed_ordinal: 0,
        })
    }

    fn fold(&mut self, message: &Message) -> Result<Fold, SimError> {
        match &message.change {
            Change::Upsert {
                table,
                row,
                parent,
                fields,
            } => self.fold_upsert(message, *table, *row, *parent, fields),
            Change::Tombstone { table, row } => {
                if self.mutation == Mutation::IgnoreTombstones {
                    return Ok(Fold::Applied);
                }
                self.remove_row(*table, *row)?;
                Ok(Fold::Applied)
            }
            Change::BalanceSet { row, cents } => {
                let force = self.mutation == Mutation::ArrivalOrderWins;
                self.balances
                    .entry(*row)
                    .or_default()
                    .observe_set(message.hlc, *cents, force);
                self.materialize_balance(*row)?;
                Ok(Fold::Applied)
            }
            Change::BalanceDelta { row, cause, cents } => {
                let key = self.delta_key(*cause);
                self.balances
                    .entry(*row)
                    .or_default()
                    .observe_delta(message.hlc, key, *cents);
                self.materialize_balance(*row)?;
                Ok(Fold::Applied)
            }
            Change::CounterDelta { table, row, delta } => {
                let key = self.counter_key(&message.id);
                self.counters
                    .entry((*table, *row))
                    .or_default()
                    .insert(key, *delta);
                if self.ids.contains_key(&(*table, *row)) {
                    self.materialize_row(*table, *row)?;
                }
                Ok(Fold::Applied)
            }
        }
    }

    fn fold_upsert(
        &mut self,
        message: &Message,
        table: Table,
        row: RowUuid,
        parent: Option<RowUuid>,
        fields: &[(&'static str, SimCell)],
    ) -> Result<Fold, SimError> {
        if self.tombstones.contains(&(table, row)) {
            return Ok(Fold::Applied);
        }

        if let (Some(parent_row), Some((parent_table, _))) = (parent, table.parent()) {
            // AD-12: a child message addressed to a tombstoned parent is dropped, not parked
            // — parking it would wait forever for a row that is never coming back.
            if self.tombstones.contains(&(parent_table, parent_row)) {
                return Ok(Fold::Applied);
            }
            if !self.ids.contains_key(&(parent_table, parent_row)) {
                return Ok(Fold::Pending);
            }
            self.parents.insert((table, row), parent_row);
        }

        for (column, value) in fields {
            let key = (table, row, *column);
            let newer = match self.fields.get(&key) {
                None => true,
                Some((stored, _)) => self.wins(&message.hlc, stored),
            };
            if newer {
                self.fields.insert(key, (message.hlc, value.clone()));
            }
        }

        if !table
            .lww_columns()
            .iter()
            .all(|column| self.fields.contains_key(&(table, row, *column)))
        {
            return Ok(Fold::Pending);
        }

        self.materialize_row(table, row)?;

        Ok(Fold::Applied)
    }

    /// `>` normally, "always" under `ArrivalOrderWins`.
    fn wins(&self, candidate: &Hlc, stored: &Hlc) -> bool {
        self.mutation == Mutation::ArrivalOrderWins || candidate > stored
    }

    fn delta_key(&mut self, cause: CauseKey) -> CauseKey {
        match self.mutation {
            Mutation::NoMessageDedup => {
                self.unkeyed_ordinal += 1;
                (crate::sync::sim::model::fresh_row_uuid(self.unkeyed_ordinal), cause.1)
            }
            _ => cause,
        }
    }

    fn counter_key(&mut self, id: &MessageId) -> MessageId {
        match self.mutation {
            Mutation::NoMessageDedup => {
                self.unkeyed_ordinal += 1;
                MessageId {
                    install: id.install.clone(),
                    seq: id.seq,
                    idx: self.unkeyed_ordinal as u32,
                }
            }
            _ => id.clone(),
        }
    }

    fn materialize_row(&mut self, table: Table, row: RowUuid) -> Result<(), SimError> {
        let mut columns: Vec<(&'static str, SimCell)> = table
            .lww_columns()
            .iter()
            .map(|column| {
                self.fields
                    .get(&(table, row, *column))
                    .map(|(_, value)| (*column, value.clone()))
                    .ok_or_else(|| SimError::Model(format!("{}.{column} unknown", table.sql())))
            })
            .collect::<Result<_, _>>()?;

        if let Some(column) = table.counter_column() {
            columns.push((column, SimCell::Int(self.counter_of(table, row))));
        }

        match self.ids.get(&(table, row)).copied() {
            Some(id) => sim_tables::update_row(&self.conn, table.sql(), id, &columns)?,
            None => {
                if let Some((parent_table, foreign_key)) = table.parent() {
                    let parent_row = self
                        .parents
                        .get(&(table, row))
                        .copied()
                        .ok_or_else(|| SimError::Model("a child with no parent".into()))?;
                    let parent_id = self
                        .ids
                        .get(&(parent_table, parent_row))
                        .copied()
                        .ok_or_else(|| SimError::Model("a child before its parent".into()))?;
                    columns.push((foreign_key, SimCell::Int(parent_id)));
                }

                let id = sim_tables::insert_row(&self.conn, table.sql(), &columns)?;
                self.ids.insert((table, row), id);
            }
        }

        if table.balance_column().is_some() {
            self.materialize_balance(row)?;
        }

        Ok(())
    }

    fn materialize_balance(&mut self, row: RowUuid) -> Result<(), SimError> {
        let Some(id) = self.ids.get(&(Table::Accounts, row)).copied() else {
            return Ok(());
        };
        let column = Table::Accounts
            .balance_column()
            .ok_or_else(|| SimError::Model("accounts has no balance column".into()))?;

        sim_tables::update_row(
            &self.conn,
            Table::Accounts.sql(),
            id,
            &[(column, SimCell::Int(self.balance_of(row)))],
        )?;

        Ok(())
    }

    fn balance_of(&self, row: RowUuid) -> i64 {
        self.balances.get(&row).map(BalanceLedger::value).unwrap_or(0)
    }

    /// AD-5: a counter's value is the sum of its deltas, base zero — the row's creation emits the
    /// initial count as its first delta (Story 16), so the schema default is not part of the rule.
    fn counter_of(&self, table: Table, row: RowUuid) -> i64 {
        self.counters
            .get(&(table, row))
            .map(|deltas| deltas.values().sum::<i64>())
            .unwrap_or(0)
    }

    /// AD-12: deleting a parent lets the schema's `ON DELETE CASCADE` run, and each cascaded
    /// child becomes its own tombstone so a later message addressed to it is dropped rather
    /// than resurrecting it.
    fn remove_row(&mut self, table: Table, row: RowUuid) -> Result<(), SimError> {
        self.tombstones.insert((table, row));

        let cascaded: Vec<(Table, RowUuid)> = self
            .parents
            .iter()
            .filter(|((child_table, _), parent_row)| {
                child_table.parent().map(|(parent, _)| parent) == Some(table) && **parent_row == row
            })
            .map(|((child_table, child_row), _)| (*child_table, *child_row))
            .collect();

        if let Some(id) = self.ids.remove(&(table, row)) {
            sim_tables::delete_row(&self.conn, table.sql(), id)?;
        }

        self.forget(table, row);
        for (child_table, child_row) in cascaded {
            self.tombstones.insert((child_table, child_row));
            self.ids.remove(&(child_table, child_row));
            self.forget(child_table, child_row);
        }

        Ok(())
    }

    /// Drops the merge state of a tombstoned row, except its balance: AD-12 keeps a delta
    /// addressed to a deleted account against the retained row, and nothing observable reads
    /// it, so throwing it away would be a silent decision rather than a visible one.
    fn forget(&mut self, table: Table, row: RowUuid) {
        self.fields
            .retain(|(stored_table, stored_row, _), _| *stored_table != table || *stored_row != row);
        self.parents.remove(&(table, row));
        self.counters.remove(&(table, row));
    }

    fn retry_pending(&mut self) -> Result<(), SimError> {
        loop {
            let queued = std::mem::take(&mut self.pending);
            let before = queued.len();
            let mut still_pending = Vec::new();

            for message in queued {
                match self.fold(&message)? {
                    Fold::Applied => {}
                    Fold::Pending => still_pending.push(message),
                }
            }

            let progressed = still_pending.len() < before;
            self.pending = still_pending;
            if !progressed {
                return Ok(());
            }
        }
    }
}

impl ReplicaEngine for ReferenceEngine {
    type Segment = Segment;

    fn local_write(&mut self, change: &Change) -> Result<Hlc, SimError> {
        let message = Message {
            id: MessageId {
                install: self.install.clone(),
                seq: self.seq,
                idx: self.outbox.len() as u32,
            },
            hlc: self.clock.now(),
            change: change.clone(),
        };

        match self.fold(&message)? {
            Fold::Applied => {}
            Fold::Pending => {
                return Err(SimError::Model(format!(
                    "a local write could not be applied locally: {}",
                    message.change.describe()
                )))
            }
        }
        self.seen.insert(message.id.clone());
        self.outbox.push(message.clone());
        self.retry_pending()?;

        Ok(message.hlc)
    }

    fn flush(&mut self) -> Result<Option<Self::Segment>, SimError> {
        if self.outbox.is_empty() {
            return Ok(None);
        }

        let segment = Segment {
            install: self.install.clone(),
            seq: self.seq,
            messages: std::mem::take(&mut self.outbox),
        };
        self.seq += 1;

        Ok(Some(segment))
    }

    fn deliver(&mut self, segment: &Self::Segment) -> Result<(), SimError> {
        for message in &segment.messages {
            if self.mutation != Mutation::NoMessageDedup && !self.seen.insert(message.id.clone()) {
                continue;
            }

            self.clock.observe(&message.hlc)?;
            match self.fold(message)? {
                Fold::Applied => {}
                Fold::Pending => self.pending.push(message.clone()),
            }
        }
        self.retry_pending()?;

        Ok(())
    }

    fn observable(&self) -> Result<Observable, SimError> {
        let mut uuid_of: HashMap<(Table, i64), RowUuid> = HashMap::new();
        for ((table, row), id) in &self.ids {
            uuid_of.insert((*table, *id), *row);
        }

        let mut observable = Observable::new();
        for table in Table::ALL {
            let columns = table.observable_columns();
            let foreign_key = table.parent().map(|(_, fk)| fk);
            let mut rows = BTreeMap::new();

            for (id, cells) in sim_tables::dump_table(&self.conn, table.sql(), &columns)? {
                let row = *uuid_of.get(&(table, id)).ok_or_else(|| {
                    SimError::Model(format!("{}#{id} has no uuid mapping", table.sql()))
                })?;

                let mut translated = BTreeMap::new();
                for (column, cell) in cells {
                    let value = match (foreign_key, &cell) {
                        (Some(fk), SimCell::Int(parent_id)) if fk == column => {
                            let (parent_table, _) = table.parent().ok_or_else(|| {
                                SimError::Model(format!("{}has no parent", table.sql()))
                            })?;
                            SimCell::Uuid(*uuid_of.get(&(parent_table, *parent_id)).ok_or_else(
                                || {
                                    SimError::Model(format!(
                                        "{}#{parent_id} has no uuid mapping",
                                        parent_table.sql()
                                    ))
                                },
                            )?)
                        }
                        _ => cell,
                    };
                    translated.insert(column, value);
                }
                rows.insert(row, translated);
            }

            observable.insert(table, rows);
        }

        Ok(observable)
    }

    fn pending_count(&self) -> usize {
        self.pending.len()
    }
}
