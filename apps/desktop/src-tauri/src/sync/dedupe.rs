//! The repair for a dataset that two computers have already doubled.
//!
//! Before records that predate sync were adopted (`adopt`), two computers holding the same records
//! each gave every record a random identity, published it, and applied the other's as a new row:
//! every table existed twice, once under each computer's identities. Preventing it again does
//! nothing for the datasets it already happened to — those rows are two different identities now,
//! on every computer and in the cloud, and no rule about identities can make them one.
//!
//! What can be said about such a pair is that it is the same RECORD: the same creation facts
//! (`adopt`), created by two different computers. That is the whole signature, and it is narrow on
//! purpose:
//!
//! - Records the same computer made are never paired, however alike. Three coffees on one day are
//!   three records, and so is anything a person actually entered twice.
//! - Records whose facts differ are never paired. One that was edited in a fact column since is left
//!   for the person, who can tell which one they meant.
//! - A record is only ever paired with one made by ANOTHER computer, and a computer's records are
//!   paired one-to-one: if one holds three and the other two, one of the three stays.
//!
//! Deleting is the ordinary delete (a captured write), so it reaches every other computer as a
//! tombstone, is restorable for 30 days from the recently-deleted view, and is idempotent: running
//! it again, or on the other computer, finds nothing left to pair. No computer decides for the
//! others; each pair keeps the record that is better connected (links to records that still exist),
//! then the more recently edited, then the lower identity — all facts every computer holds.
//!
//! Records that point at a record being removed are first pointed at the one that stays, children
//! are removed before their parents, and the whole repair is ONE write: it either leaves a
//! consistent dataset or changes nothing.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};

use rusqlite::types::Value;
use rusqlite::Connection;
use serde::Serialize;

use crate::db::sync_apply as apply_db;
use crate::db::sync_capture;
use crate::db::sync_dedupe as dedupe_db;
use crate::db::sync_identity::RowUuid;
use crate::db::ActiveDataset;
use crate::error::AppError;

use super::adopt::{self, Remap};
use super::identity;
use super::reconcile;
use super::registry;

/// One record that exists twice, and the one that stays.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Removal {
    pub table: &'static str,
    pub victim: i64,
    pub survivor: i64,
}

/// How many records a table would lose (or lost), and nothing else: AD-16 keeps values out of every
/// report, and there is no value a person needs in order to decide.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TableCount {
    pub table: String,
    pub records: usize,
}

/// What the repair found, or what it removed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DuplicatesView {
    /// `false` for a profile that is not synced: it records no identities, so it has nothing to pair.
    pub sync_available: bool,
    pub total: usize,
    pub tables: Vec<TableCount>,
}

impl DuplicatesView {
    fn of(removals: &[Removal]) -> Self {
        let mut counts: BTreeMap<&'static str, usize> = BTreeMap::new();
        for removal in removals {
            *counts.entry(removal.table).or_default() += 1;
        }

        Self {
            sync_available: true,
            total: removals.len(),
            tables: counts
                .into_iter()
                .map(|(table, records)| TableCount {
                    table: table.to_string(),
                    records,
                })
                .collect(),
        }
    }

    fn unavailable() -> Self {
        Self {
            sync_available: false,
            total: 0,
            tables: Vec::new(),
        }
    }
}

/// Finds the duplicates without touching anything.
pub fn preview(active: &ActiveDataset) -> Result<DuplicatesView, AppError> {
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
    if active.capture.is_none() {
        return Ok(DuplicatesView::unavailable());
    }

    Ok(DuplicatesView::of(&plan(conn)?))
}

/// Removes every duplicate, in one captured write, and reports what went.
///
/// A dated copy of the whole dataset is saved into `backup_dir` FIRST, and nothing is removed if
/// that copy cannot be made: a repair that deletes a thousand records is exactly the operation a
/// person must be able to take back, and one restore of the copy does that where a thousand
/// individual restores from the recently-deleted view could not (it lists the newest 500).
///
/// The plan that is carried out is made INSIDE the write, so what is removed is what the
/// transaction saw and not what the check before it saw a moment earlier.
pub fn remove(active: &ActiveDataset, backup_dir: &Path) -> Result<DuplicatesView, AppError> {
    if active.capture.is_none() {
        return Ok(DuplicatesView::unavailable());
    }

    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
    let planned = plan(conn)?;
    if planned.is_empty() {
        return Ok(DuplicatesView::of(&planned));
    }

    save_safety_copy(conn, backup_dir)?;

    active.write(|tx| {
        let removals = plan(tx)?;
        if removals.is_empty() {
            return Ok(DuplicatesView::of(&removals));
        }

        remove_all(tx, &removals)?;

        let view = DuplicatesView::of(&removals);
        let details = serde_json::to_string(&view).unwrap_or_default();
        crate::db::audit::insert_audit_log(
            tx,
            "sync_duplicates",
            0,
            "delete",
            None,
            Some(&details),
        )?;

        Ok(view)
    })
}

/// The dataset as it is right now, in a dated file of its own.
///
/// Checkpointed first for the reason `export_backup` does it: the live file is in WAL mode, and a
/// copy of the main file alone would miss everything the WAL still holds.
fn save_safety_copy(conn: &Connection, backup_dir: &Path) -> Result<PathBuf, AppError> {
    let live = conn
        .path()
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| AppError::File {
            message: "The dataset has no file to save a copy of".to_string(),
        })?;
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;

    crate::db::backup::copy_to_dated_backup(&live, backup_dir)
}

/// Every table that travels, parents before the tables that point at them.
///
/// Derived from the registry's foreign-key edges and not listed by hand, so a table a later
/// migration adds is ordered by what it points at. A cycle (there is none) would be placed as it
/// came rather than looped on.
fn parents_first() -> Vec<&'static str> {
    let tables: Vec<&'static str> = reconcile::travelling()
        .iter()
        .map(|rule| rule.table)
        .collect();
    let mut placed: Vec<&'static str> = Vec::with_capacity(tables.len());
    let mut remaining = tables.clone();

    while !remaining.is_empty() {
        let ready: Vec<&'static str> = remaining
            .iter()
            .copied()
            .filter(|table| {
                registry::EDGES
                    .iter()
                    .filter(|edge| edge.child_table == *table)
                    .all(|edge| {
                        edge.parent_table == *table
                            || placed.contains(&edge.parent_table)
                            || !tables.contains(&edge.parent_table)
                    })
            })
            .collect();

        if ready.is_empty() {
            placed.append(&mut remaining);
            break;
        }

        placed.extend(ready.iter().copied());
        remaining.retain(|table| !ready.contains(table));
    }

    placed
}

/// One record as the repair sees it.
#[derive(Debug, Clone)]
struct Member {
    row_id: i64,
    uuid: RowUuid,
    /// The computer that made it: the one whose stamp is the oldest any of its columns carries.
    creator: String,
    /// The newest stamp any of its columns carries.
    last_edit: String,
    /// How many of its links point at something. A duplicate whose account was deleted by hand has
    /// lost that link, and the other one has not.
    links: usize,
}

/// Which records are one record held twice, and which of each pair stays.
pub(crate) fn plan(conn: &Connection) -> Result<Vec<Removal>, AppError> {
    let mut removals: Vec<Removal> = Vec::new();
    let mut remap = Remap::new();

    for table in parents_first() {
        let mut groups: BTreeMap<Vec<u8>, Vec<Member>> = BTreeMap::new();

        for (row_id, uuid) in dedupe_db::identified_rows(conn, table)? {
            let Ok(uuid) = RowUuid::try_from(uuid.as_slice()) else {
                continue;
            };
            let Some(key) = twin_key(conn, table, row_id, &remap)? else {
                continue;
            };
            let Some((creator, last_edit)) = provenance(conn, table, &uuid)? else {
                continue;
            };

            groups.entry(key).or_default().push(Member {
                row_id,
                uuid,
                creator,
                last_edit,
                links: live_links(conn, table, row_id)?,
            });
        }

        let before = removals.len();
        for members in groups.into_values() {
            pair_up(table, members, &mut removals);
        }
        settle_chains(&mut removals[before..]);

        // Read through by the next tables: the children of two records that are one record have
        // the same facts only once both parents are read as the survivor.
        for removal in &removals[before..] {
            if let (Some(victim), Some(survivor)) = (
                uuid_of(conn, removal.table, removal.victim)?,
                uuid_of(conn, removal.table, removal.survivor)?,
            ) {
                remap.insert((removal.table, victim), survivor);
            }
        }
    }

    Ok(removals)
}

fn uuid_of(conn: &Connection, table: &str, row_id: i64) -> Result<Option<RowUuid>, AppError> {
    crate::db::sync_identity::lookup(conn, table, row_id)
}

/// What makes two records of one table the same record, as bytes.
///
/// A table with creation facts uses their digest with the parents read through `remap`. The three
/// natural-key tables are compared by their natural key, expressed in the surviving parent. `None`
/// for a record that cannot be compared (the row is gone, or its parent cannot be named) and for
/// `config`, whose identity is its key on every computer already.
fn twin_key(
    conn: &Connection,
    table: &'static str,
    row_id: i64,
    remap: &Remap,
) -> Result<Option<Vec<u8>>, AppError> {
    if adopt::has_creation_facts(table) {
        return Ok(adopt::digest_through(conn, table, row_id, remap)?.map(|digest| digest.to_vec()));
    }

    let parent_of =
        |parent: &'static str, column: &'static str, values: &[(&'static str, Value)]| {
            let Some(Value::Integer(parent_row)) = value_of(values, column) else {
                return Ok(None);
            };

            Ok::<_, AppError>(
                reconcile::existing_identity(conn, parent, parent_row)?
                    .map(|uuid| remap.get(&(parent, uuid)).copied().unwrap_or(uuid)),
            )
        };

    Ok(match table {
        "maintenance_tasks" => {
            let values =
                apply_db::read_columns(conn, table, row_id, &["vehicle_id", "task_type_key"])?;
            match (
                parent_of("vehicles", "vehicle_id", &values)?,
                value_of(&values, "task_type_key"),
            ) {
                (Some(vehicle), Some(Value::Text(key))) => {
                    Some(identity::maintenance_task(&vehicle, &key).to_vec())
                }
                _ => None,
            }
        }
        "merchant_category_hints" => {
            let values =
                apply_db::read_columns(conn, table, row_id, &["merchant", "budget_category_id"])?;
            match (
                value_of(&values, "merchant"),
                parent_of("budget_categories", "budget_category_id", &values)?,
            ) {
                (Some(Value::Text(merchant)), Some(category)) => {
                    Some(identity::merchant_category_hint(&merchant, &category).to_vec())
                }
                _ => None,
            }
        }
        "project_images" => {
            let values = apply_db::read_columns(conn, table, row_id, &["project_id"])?;
            parent_of("projects", "project_id", &values)?
                .map(|project| identity::project_image(&project).to_vec())
        }
        "stock_holdings" => {
            let values = apply_db::read_columns(conn, table, row_id, &["passive_asset_id"])?;
            parent_of("passive_assets", "passive_asset_id", &values)?
                .map(|asset| identity::stock_holding(&asset).to_vec())
        }
        _ => None,
    })
}

fn value_of(values: &[(&'static str, Value)], column: &str) -> Option<Value> {
    values
        .iter()
        .find(|(name, _)| *name == column)
        .map(|(_, value)| value.clone())
}

/// `(creator, newest stamp)` of a record, from the stamps its columns were accepted under.
///
/// The creator is the install in the OLDEST stamp, which is the stamp the whole row was created
/// under: a later edit only raises individual columns. A record with no stamps is not paired — who
/// made it is the one thing the pairing must not guess.
fn provenance(
    conn: &Connection,
    table: &str,
    uuid: &RowUuid,
) -> Result<Option<(String, String)>, AppError> {
    let stamps: Vec<String> = sync_capture::field_state_columns(conn, table, uuid)?
        .into_iter()
        .map(|(_, state)| state.hlc)
        .collect();

    let (Some(oldest), Some(newest)) = (stamps.iter().min(), stamps.iter().max()) else {
        return Ok(None);
    };
    let Some((_, creator)) = oldest.rsplit_once('-') else {
        return Ok(None);
    };

    Ok(Some((creator.to_string(), newest.clone())))
}

fn live_links(conn: &Connection, table: &'static str, row_id: i64) -> Result<usize, AppError> {
    let columns: Vec<&'static str> = registry::EDGES
        .iter()
        .filter(|edge| edge.child_table == table)
        .map(|edge| edge.child_column)
        .collect();
    if columns.is_empty() {
        return Ok(0);
    }

    Ok(apply_db::read_columns(conn, table, row_id, &columns)?
        .iter()
        .filter(|(_, value)| !matches!(value, Value::Null))
        .count())
}

/// Pairs the records of one comparison group that different computers made, one to one.
///
/// Computers are taken in identity order and each is paired against what has survived so far, so
/// the outcome depends on the records and not on which computer runs the repair.
fn pair_up(table: &'static str, members: Vec<Member>, removals: &mut Vec<Removal>) {
    let mut by_creator: BTreeMap<String, Vec<Member>> = BTreeMap::new();
    for member in members {
        by_creator
            .entry(member.creator.clone())
            .or_default()
            .push(member);
    }
    if by_creator.len() < 2 {
        return;
    }

    let mut computers = by_creator.into_values();
    let mut pool = computers.next().unwrap_or_default();
    pool.sort_by_key(|member| member.uuid);

    for mut records in computers {
        records.sort_by_key(|member| member.uuid);
        let unpaired = records.split_off(pool.len().min(records.len()));

        for (slot, candidate) in pool.iter_mut().zip(records) {
            let (survivor, victim) = better_of(slot.clone(), candidate);
            removals.push(Removal {
                table,
                victim: victim.row_id,
                survivor: survivor.row_id,
            });
            *slot = survivor;
        }

        pool.extend(unpaired);
    }
}

/// The record of a pair that stays: the better connected, then the more recently edited, then the
/// lower identity. Every one of those is a fact all computers hold.
fn better_of(first: Member, second: Member) -> (Member, Member) {
    let rank = |member: &Member| {
        (
            member.links,
            member.last_edit.clone(),
            std::cmp::Reverse(member.uuid),
        )
    };

    if rank(&first) >= rank(&second) {
        (first, second)
    } else {
        (second, first)
    }
}

/// With three computers a record that stayed in one pair can lose the next: its victims then stay
/// with whoever won. Follows every survivor to the end of its chain.
fn settle_chains(removals: &mut [Removal]) {
    let victims: HashMap<i64, i64> = removals
        .iter()
        .map(|removal| (removal.victim, removal.survivor))
        .collect();

    for removal in removals.iter_mut() {
        let mut survivor = removal.survivor;
        let mut hops = 0;
        while let Some(next) = victims.get(&survivor) {
            survivor = *next;
            hops += 1;
            if hops > victims.len() {
                break;
            }
        }
        removal.survivor = survivor;
    }
}

/// Carries a plan out inside the caller's write transaction.
fn remove_all(conn: &Connection, removals: &[Removal]) -> Result<(), AppError> {
    let mut doomed: HashMap<&'static str, HashSet<i64>> = HashMap::new();
    for removal in removals {
        doomed
            .entry(removal.table)
            .or_default()
            .insert(removal.victim);
    }

    // Whatever stays and points at a record that goes is pointed at the one that stays, so the
    // schema's own ON DELETE actions (cascade, set null, restrict) never decide anything here.
    for removal in removals {
        for edge in registry::edges_into(removal.table) {
            for child in
                apply_db::child_row_ids(conn, edge.child_table, edge.child_column, removal.victim)?
            {
                let going = doomed
                    .get(edge.child_table)
                    .is_some_and(|rows| rows.contains(&child));
                if !going {
                    dedupe_db::point_child_at(
                        conn,
                        edge.child_table,
                        edge.child_column,
                        child,
                        removal.survivor,
                    )?;
                }
            }
        }
    }

    for table in parents_first().into_iter().rev() {
        let Some(rows) = doomed.get(table) else {
            continue;
        };
        let mut rows: Vec<i64> = rows.iter().copied().collect();
        rows.sort_unstable();

        for row in rows {
            apply_db::delete_row(conn, table, row)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::capture_fixtures as fixtures;
    use crate::db::sync_capture::ColumnState;
    use crate::db::test_dataset::migrated_dataset;
    use tempfile::TempDir;

    const FIRST_COMPUTER: &str = "08cf8581767ae8a4";
    const SECOND_COMPUTER: &str = "cfbb5d764727f876";

    fn dataset() -> (TempDir, Connection) {
        let dir = TempDir::new().expect("temp dir");
        let conn = migrated_dataset(&dir.path().join("nixus.db"));

        (dir, conn)
    }

    /// Stands in for what a computer's reconcile did before records were adopted: a RANDOM
    /// identity for the row and one stamp, from that computer, on its columns.
    fn made_by(conn: &Connection, computer: &str, table: &'static str, row_id: i64, at: u64) {
        let uuid = identity::uuid_for(conn, table, row_id).expect("a random identity");
        let hlc = format!("{at:016x}-{computer}");
        let columns: Vec<String> = registry::columns_of(table)
            .map(|column| column.column.to_string())
            .collect();
        let states: Vec<(String, ColumnState)> = columns
            .into_iter()
            .map(|column| {
                (
                    column,
                    ColumnState {
                        hlc: hlc.clone(),
                        content_hash: [0; 32],
                    },
                )
            })
            .collect();
        sync_capture::upsert_field_states(conn, table, &uuid, &states).expect("the stamps record");
    }

    fn rows_of(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .expect("the count reads")
    }

    /// Two computers' copies of the same seven records, as the reconcile that predates adoption
    /// left them: each copy under its own random identities.
    fn doubled() -> (TempDir, Connection) {
        let (dir, conn) = dataset();
        fixtures::seed_pre_sync_records(&conn).expect("the first copy seeds");
        let first_copy = fixtures::count_rows_of_pre_sync_tables(&conn).expect("counts");

        // The second copy: every row again, with the links between them pointing at its own rows.
        conn.execute_batch(
            "INSERT INTO budget_groups (name, sort_order, created_at) SELECT name, sort_order, created_at FROM budget_groups;
             INSERT INTO accounts (name, institution, account_type, currency, balance_cents, created_at, updated_at)
                 SELECT name, institution, account_type, currency, balance_cents, created_at, updated_at FROM accounts;
             INSERT INTO budget_categories (group_id, name, target_cents, sort_order, created_at)
                 SELECT group_id + 2, name, target_cents, sort_order, created_at FROM budget_categories;
             INSERT INTO expenses (merchant, amount_cents, budget_category_id, account_id, date, source, created_at)
                 SELECT merchant, amount_cents, budget_category_id + 3, account_id + 4, date, source, created_at FROM expenses;",
        )
        .expect("the second copy inserts");
        for (table, rows) in &first_copy {
            if !["budget_groups", "accounts", "budget_categories", "expenses"].contains(table) {
                continue;
            }
            for row in 1..=*rows {
                made_by(&conn, FIRST_COMPUTER, table_of(table), row, 1_000);
                made_by(&conn, SECOND_COMPUTER, table_of(table), row + *rows, 2_000);
            }
        }

        (dir, conn)
    }

    fn table_of(name: &str) -> &'static str {
        registry::table(name).expect("a registry table").table
    }

    /// `stock_holdings` has no creation facts — its identity IS its parent's (AD-2) — so its twin
    /// key has to be the derived one. Two copies of the same position under two asset rows must
    /// compare as DIFFERENT until the assets themselves are paired, and as the SAME once `remap`
    /// says the second asset is the first; otherwise the holding of a deduplicated asset would
    /// survive as an orphaned twin.
    #[test]
    fn a_stock_holdings_twin_key_is_its_assets_derived_identity() {
        let (_dir, conn) = dataset();
        assert!(
            !adopt::has_creation_facts("stock_holdings"),
            "a natural-key table must not also have creation facts"
        );

        let mut assets = Vec::new();
        for _ in 0..2 {
            let asset = crate::db::stock::insert_stock_asset(
                &conn,
                &crate::models::CreateStockAssetInput {
                    symbol: "SHOP.TO".to_string(),
                    name: "Shopify".to_string(),
                    exchange: "TOR".to_string(),
                    quantity_micros: 2_500_000,
                },
            )
            .expect("a holding inserts")
            .id;
            // Each copy under its own random asset identity, which is the pre-adoption state the
            // pairing exists to clean up.
            made_by(&conn, FIRST_COMPUTER, "passive_assets", asset, 1_000);
            assets.push(asset);
        }

        let empty = Remap::new();
        let first = twin_key(&conn, "stock_holdings", assets[0], &empty)
            .expect("the key computes")
            .expect("a holding with a named asset has a key");
        let second = twin_key(&conn, "stock_holdings", assets[1], &empty)
            .expect("the key computes")
            .expect("a holding with a named asset has a key");

        let first_asset = identity::uuid_for(&conn, "passive_assets", assets[0]).expect("uuid");
        let second_asset = identity::uuid_for(&conn, "passive_assets", assets[1]).expect("uuid");
        assert_eq!(
            first,
            identity::stock_holding(&first_asset).to_vec(),
            "the key is exactly the derived identity"
        );
        assert_ne!(
            first, second,
            "two unpaired assets are two positions, not one"
        );

        // Once the second asset is remapped onto the first, both holdings are the same holding.
        let mut remap = Remap::new();
        remap.insert(("passive_assets", second_asset), first_asset);
        assert_eq!(
            twin_key(&conn, "stock_holdings", assets[1], &remap)
                .expect("the key computes")
                .expect("a key"),
            first,
            "the holding must follow its asset through the pairing"
        );

        // A row that is gone has no key at all, rather than a key built from a missing parent.
        crate::db::asset::delete_asset(&conn, assets[0]).expect("the asset deletes");
        assert_eq!(
            twin_key(&conn, "stock_holdings", assets[0], &empty).expect("the key computes"),
            None
        );
    }

    #[test]
    fn parents_come_before_the_tables_that_point_at_them() {
        let order = parents_first();

        for edge in registry::EDGES {
            let parent = order.iter().position(|table| *table == edge.parent_table);
            let child = order.iter().position(|table| *table == edge.child_table);
            assert!(
                parent < child,
                "{} must be removed after {}",
                edge.parent_table,
                edge.child_table
            );
        }
        assert!(
            order.iter().all(|table| registry::table(table).is_some()),
            "and only tables the registry classifies are ever visited"
        );
    }

    #[test]
    fn records_two_computers_each_made_are_found_and_the_rest_are_left_alone() {
        let (_dir, conn) = doubled();

        let removals = plan(&conn).expect("the plan builds");
        let by_table = DuplicatesView::of(&removals);

        assert_eq!(
            by_table
                .tables
                .iter()
                .map(|t| (t.table.as_str(), t.records))
                .collect::<Vec<_>>(),
            vec![
                ("accounts", 4),
                ("budget_categories", 3),
                ("budget_groups", 2),
                ("expenses", 9)
            ],
            "one of every pair, and only in the tables that were doubled"
        );
    }

    #[test]
    fn removing_them_restores_the_records_and_leaves_every_link_pointing_somewhere() {
        let (_dir, conn) = doubled();
        let removals = plan(&conn).expect("the plan builds");

        remove_all(&conn, &removals).expect("the removal runs");

        assert_eq!(rows_of(&conn, "accounts"), 4);
        assert_eq!(rows_of(&conn, "budget_groups"), 2);
        assert_eq!(rows_of(&conn, "budget_categories"), 3);
        assert_eq!(rows_of(&conn, "expenses"), 9);
        let dangling: i64 = conn
            .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })
            .expect("the check runs");
        assert_eq!(dangling, 0, "nothing points at a record that was removed");
        let unlinked: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM expenses WHERE account_id IS NULL",
                [],
                |row| row.get(0),
            )
            .expect("the count reads");
        assert_eq!(unlinked, 0, "every expense still names its account");
    }

    #[test]
    fn a_second_run_finds_nothing() {
        let (_dir, conn) = doubled();
        remove_all(&conn, &plan(&conn).expect("the plan builds")).expect("the removal runs");

        assert!(plan(&conn).expect("the plan builds").is_empty());
    }

    /// The point of choosing by connection: a duplicate whose account was deleted by hand is the
    /// one that loses, not the one that still knows its account.
    #[test]
    fn the_copy_that_still_knows_its_account_is_the_one_that_stays() {
        let (_dir, conn) = doubled();
        // The first computer's expenses lost their account (the person deleted that copy's accounts).
        conn.execute("UPDATE expenses SET account_id = NULL WHERE id <= 9", [])
            .expect("the links are lost");

        let removals = plan(&conn).expect("the plan builds");
        let expenses: Vec<&Removal> = removals.iter().filter(|r| r.table == "expenses").collect();

        assert_eq!(expenses.len(), 9);
        assert!(
            expenses
                .iter()
                .all(|removal| removal.victim <= 9 && removal.survivor > 9),
            "the nine that lost their account go; the nine that kept it stay"
        );
    }

    /// A person's own repeated records are not a mistake, however alike they are.
    #[test]
    fn identical_records_one_computer_made_are_never_paired() {
        let (_dir, conn) = dataset();
        fixtures::seed_pre_sync_records(&conn).expect("the records seed");
        for row in 1..=9 {
            made_by(&conn, FIRST_COMPUTER, "expenses", row, 1_000);
        }

        assert!(
            plan(&conn).expect("the plan builds").is_empty(),
            "three coffees on one day, all made by one computer, are three coffees"
        );
    }

    /// One edit in a fact column since the copy was made: not the same record any more, so it is
    /// left for the person.
    #[test]
    fn a_record_edited_in_a_fact_since_is_not_paired() {
        let (_dir, conn) = doubled();
        conn.execute("UPDATE accounts SET name = 'Rainy day' WHERE id = 1", [])
            .expect("the rename applies");

        let removals = plan(&conn).expect("the plan builds");

        assert_eq!(
            removals.iter().filter(|r| r.table == "accounts").count(),
            3,
            "three of the four accounts pair; the renamed one does not"
        );
    }

    #[test]
    fn three_computers_leave_one_record_of_each() {
        let (_dir, conn) = dataset();
        fixtures::insert_budget_group(&conn, "Living", 0).expect("a group");
        fixtures::insert_budget_group(&conn, "Living", 0).expect("a group");
        fixtures::insert_budget_group(&conn, "Living", 0).expect("a group");
        conn.execute(
            "UPDATE budget_groups SET created_at = '2026-03-15 21:56:07'",
            [],
        )
        .expect("one creation second");
        for (row, computer) in [
            (1, FIRST_COMPUTER),
            (2, SECOND_COMPUTER),
            (3, "dddddddddddddddd"),
        ] {
            made_by(&conn, computer, "budget_groups", row, 1_000 + row as u64);
        }

        let removals = plan(&conn).expect("the plan builds");
        assert_eq!(removals.len(), 2);
        remove_all(&conn, &removals).expect("the removal runs");

        assert_eq!(rows_of(&conn, "budget_groups"), 1);
    }
}
