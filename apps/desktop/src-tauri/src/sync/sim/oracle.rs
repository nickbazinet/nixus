//! The expected state, computed from the op log alone.
//!
//! The point of computing it here rather than reading it off a replica is that the op log
//! carries no delivery order, no segment boundary and no network fault: if the oracle and
//! every replica agree, then no reordering, duplication or offline period changed the
//! outcome. "All replicas are identical" on its own would also be satisfied by all of them
//! being identically wrong.

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::db::sim_tables::SimCell;
use crate::sync::clock::Hlc;
use crate::sync::sim::model::{CauseKey, Change, Observable, RowUuid, Table};

#[derive(Debug, Default)]
pub(crate) struct Oracle {
    log: Vec<(Hlc, Change)>,
}

impl Oracle {
    pub(crate) fn record(&mut self, hlc: Hlc, change: Change) {
        self.log.push((hlc, change));
    }

    pub(crate) fn len(&self) -> usize {
        self.log.len()
    }

    fn tombstoned(&self) -> HashSet<(Table, RowUuid)> {
        self.log
            .iter()
            .filter_map(|(_, change)| match change {
                Change::Tombstone { table, row } => Some((*table, *row)),
                _ => None,
            })
            .collect()
    }

    fn parents(&self) -> HashMap<(Table, RowUuid), RowUuid> {
        let mut parents = HashMap::new();
        for (_, change) in &self.log {
            if let Change::Upsert {
                table,
                row,
                parent: Some(parent),
                ..
            } = change
            {
                parents.insert((*table, *row), *parent);
            }
        }

        parents
    }

    /// The winning value of every last-write-wins field: the one written by the message with
    /// the highest clock value, install id breaking an exact tie (AD-5, AD-4).
    fn winning_fields(&self) -> HashMap<(Table, RowUuid, &'static str), (Hlc, SimCell)> {
        let mut winners: HashMap<(Table, RowUuid, &'static str), (Hlc, SimCell)> = HashMap::new();
        for (hlc, change) in &self.log {
            if let Change::Upsert {
                table, row, fields, ..
            } = change
            {
                for (column, value) in fields {
                    let key = (*table, *row, *column);
                    match winners.get(&key) {
                        Some((stored, _)) if stored >= hlc => {}
                        _ => {
                            winners.insert(key, (*hlc, value.clone()));
                        }
                    }
                }
            }
        }

        winners
    }

    fn balances(&self) -> HashMap<RowUuid, i64> {
        let mut sets: HashMap<RowUuid, (Hlc, i64)> = HashMap::new();
        let mut deltas: HashMap<RowUuid, BTreeMap<CauseKey, (Hlc, i64)>> = HashMap::new();

        for (hlc, change) in &self.log {
            match change {
                Change::BalanceSet { row, cents } => match sets.get(row) {
                    Some((stored, _)) if stored >= hlc => {}
                    _ => {
                        sets.insert(*row, (*hlc, *cents));
                    }
                },
                Change::BalanceDelta { row, cause, cents } => {
                    let slot = deltas.entry(*row).or_default();
                    match slot.get(cause) {
                        Some((stored, _)) if stored <= hlc => {}
                        _ => {
                            slot.insert(*cause, (*hlc, *cents));
                        }
                    }
                }
                _ => {}
            }
        }

        let mut balances = HashMap::new();
        for row in sets.keys().chain(deltas.keys()).copied().collect::<HashSet<_>>() {
            let set = sets.get(&row);
            let base = set.map(|(_, cents)| *cents).unwrap_or(0);
            let later: i64 = deltas
                .get(&row)
                .map(|row_deltas| {
                    row_deltas
                        .values()
                        .filter(|(hlc, _)| set.is_none_or(|(set_hlc, _)| hlc > set_hlc))
                        .map(|(_, cents)| *cents)
                        .sum()
                })
                .unwrap_or(0);
            balances.insert(row, base + later);
        }

        balances
    }

    fn counters(&self) -> HashMap<(Table, RowUuid), i64> {
        let mut counters: HashMap<(Table, RowUuid), i64> = HashMap::new();
        for (_, change) in &self.log {
            if let Change::CounterDelta { table, row, delta } = change {
                *counters.entry((*table, *row)).or_insert(0) += delta;
            }
        }

        counters
    }

    /// Every row that was ever created and has not been deleted, directly or through its
    /// parent (AD-12 cascade), with each of its fields at its winning value.
    pub(crate) fn expected(&self) -> Observable {
        let tombstoned = self.tombstoned();
        let parents = self.parents();
        let fields = self.winning_fields();
        let balances = self.balances();
        let counters = self.counters();

        let created: HashSet<(Table, RowUuid)> = self
            .log
            .iter()
            .filter_map(|(_, change)| match change {
                Change::Upsert { table, row, .. } => Some((*table, *row)),
                _ => None,
            })
            .collect();

        let mut expected = Observable::new();
        for table in Table::ALL {
            expected.insert(table, BTreeMap::new());
        }

        for (table, row) in created {
            if tombstoned.contains(&(table, row)) {
                continue;
            }
            if let (Some(parent), Some((parent_table, _))) =
                (parents.get(&(table, row)), table.parent())
            {
                if tombstoned.contains(&(parent_table, *parent)) {
                    continue;
                }
            }

            let mut cells = BTreeMap::new();
            for column in table.lww_columns() {
                if let Some((_, value)) = fields.get(&(table, row, *column)) {
                    cells.insert(*column, value.clone());
                }
            }
            if let (Some(foreign_key), Some(parent)) =
                (table.parent().map(|(_, fk)| fk), parents.get(&(table, row)))
            {
                cells.insert(foreign_key, SimCell::Uuid(*parent));
            }
            if let Some(column) = table.counter_column() {
                cells.insert(
                    column,
                    SimCell::Int(counters.get(&(table, row)).copied().unwrap_or(0)),
                );
            }
            if let Some(column) = table.balance_column() {
                cells.insert(
                    column,
                    SimCell::Int(balances.get(&row).copied().unwrap_or(0)),
                );
            }

            expected
                .get_mut(&table)
                .expect("every table was seeded above")
                .insert(row, cells);
        }

        expected
    }

    /// The balance each account must hold, stated as "the sum of its changes" so the
    /// assertion reads like the property rather than like the implementation.
    pub(crate) fn expected_balances(&self) -> HashMap<RowUuid, i64> {
        self.balances()
    }

    /// Rows a delete was issued for. Issued twice or concurrently with an edit makes no
    /// difference: the row must be gone from every replica exactly once.
    pub(crate) fn deleted_rows(&self) -> HashSet<(Table, RowUuid)> {
        self.tombstoned()
    }
}
