//! AD-5's restore: a tombstoned row, and everything the schema cascaded away with it, written back
//! as ORDINARY captured changes.
//!
//! # Why it goes through `ActiveDataset::write`
//!
//! A restore is a local edit like any other. Re-inserting the rows inside a captured write makes
//! capture emit the same `field` messages a hand-typed re-creation would, so the restore travels to
//! the other computers as a normal change — there is no "restore message" kind, and no replica has
//! to learn one.
//!
//! # Identity (AD-2)
//!
//! A SURROGATE row comes back under a NEW uuid, because its tombstone dropped the old mapping and
//! the absorbing rule still holds for it (story 13's decision). A DERIVED row must come back under
//! the uuid its key dictates, so the derived identity is re-bound explicitly before the flush and
//! `sync::apply` revives such a row when the re-creation is stamped after the delete.
//!
//! # All or nothing
//!
//! One transaction holds the whole group: the row, the cascaded children captured with it, and any
//! parent that has to be restored first. A natural-key collision therefore restores NOTHING rather
//! than half a group.

use std::collections::HashMap;

use rusqlite::types::Value;
use rusqlite::Connection;
use serde::Serialize;

use crate::db::sync_apply::{self as apply_db, TombstoneRow};
use crate::db::{sync_identity, ActiveDataset};
use crate::error::AppError;

use super::capture;
use super::identity;
use super::registry::{self, MergeKind, RowIdentity};

/// How many deletes the view reads. Large enough that 30 days of ordinary use fits, bounded so one
/// pathological wipe cannot turn the view into an unbounded read.
const RECENTLY_DELETED_LIMIT: i64 = 500;

/// How deep a parent chain a restore will rebuild before it refuses, which bounds the recursion on
/// a tombstone set that names itself.
const MAX_PARENT_DEPTH: usize = 8;

/// What the recently-deleted view shows for one restorable delete.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DeletedItem {
    /// `<table>:<uuid hex>`, which is the only handle the frontend ever holds.
    pub id: String,
    pub table_name: String,
    /// A human label derived from the retained row, never a column name and never an id.
    pub label: String,
    pub deleted_at: String,
    pub days_left: i64,
    /// The rows the schema cascaded away with this one and that come back with it.
    pub child_count: usize,
}

/// The whole view's payload.
///
/// `sync_available` is false for a local-only profile: it installs no capture hook, so no delete
/// was ever recorded and the view has to explain that rather than look broken (AD-12 inherited).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RecentlyDeletedView {
    pub sync_available: bool,
    pub items: Vec<DeletedItem>,
}

/// What a restore brought back, for the audit row and the UI copy.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RestoreOutcome {
    pub table_name: String,
    pub restored_rows: usize,
}

/// A tombstone's handle, parsed from the one string the frontend holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct TombstoneKey {
    pub table: &'static str,
    pub row_uuid: [u8; 16],
}

impl TombstoneKey {
    pub fn parse(id: &str) -> Result<Self, AppError> {
        let (table, uuid) = id.split_once(':').ok_or_else(not_found)?;
        let rule = registry::table(table)
            .filter(|rule| !matches!(rule.class, registry::TableClass::LocalOnly))
            .ok_or_else(not_found)?;
        let row_uuid = decode_hex(uuid)
            .and_then(|bytes| <[u8; 16]>::try_from(bytes.as_slice()).ok())
            .ok_or_else(not_found)?;

        Ok(Self {
            table: rule.table,
            row_uuid,
        })
    }

    fn id(&self) -> String {
        format!("{}:{}", self.table, hex(&self.row_uuid))
    }
}

pub fn list(active: &ActiveDataset) -> Result<RecentlyDeletedView, AppError> {
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
    if active.capture.is_none() {
        return Ok(RecentlyDeletedView {
            sync_available: false,
            items: Vec::new(),
        });
    }

    let tombstones = apply_db::recent_tombstones(conn, RECENTLY_DELETED_LIMIT)?;
    let grouped = group(&tombstones);
    let items = tombstones
        .iter()
        .filter(|tombstone| !grouped.children.contains(&row_key(tombstone)))
        .filter_map(|tombstone| display_item(tombstone, &grouped))
        .collect();

    Ok(RecentlyDeletedView {
        sync_available: true,
        items,
    })
}

/// Brings one tombstone group back, as ordinary captured writes in ONE transaction.
pub fn restore(active: &ActiveDataset, key: &TombstoneKey) -> Result<RestoreOutcome, AppError> {
    let restored = active.write(|tx| {
        let tombstones = apply_db::recent_tombstones(tx, RECENTLY_DELETED_LIMIT)?;
        if !tombstones
            .iter()
            .any(|tombstone| matches(tombstone, key.table, &key.row_uuid))
        {
            return Err(not_found());
        }

        let mut restored = Restored::default();
        restore_row(tx, &tombstones, key.table, &key.row_uuid, 0, &mut restored)?;

        Ok(restored.rows.len())
    })?;

    Ok(RestoreOutcome {
        table_name: key.table.to_string(),
        restored_rows: restored,
    })
}

/// What this restore has already written, keyed by the identity each row had BEFORE the delete.
///
/// Load-bearing for a group: a surrogate row comes back under a NEW uuid (AD-2), so a child's
/// foreign key — which names the parent's retired uuid — can only be translated through what this
/// run just inserted. Without it a cascaded child would look like an orphan the moment its parent
/// was restored.
#[derive(Default)]
struct Restored {
    rows: HashMap<(&'static str, [u8; 16]), i64>,
}

/// One row and then the rows that were cascaded away with it, depth first.
///
/// Returns the row's local id, which is what a child's foreign key is translated into.
fn restore_row(
    conn: &Connection,
    tombstones: &[TombstoneRow],
    table: &'static str,
    row_uuid: &[u8; 16],
    depth: usize,
    restored: &mut Restored,
) -> Result<i64, AppError> {
    if let Some(row_id) = restored.rows.get(&(table, *row_uuid)) {
        return Ok(*row_id);
    }
    if let Some(row_id) = sync_identity::row_id_for(conn, table, row_uuid)? {
        return Ok(row_id);
    }
    if depth > MAX_PARENT_DEPTH {
        return Err(parent_missing());
    }

    let tombstone = tombstones
        .iter()
        .find(|tombstone| matches(tombstone, table, row_uuid))
        .ok_or_else(parent_missing)?;
    let document = parse_row(tombstone)?;

    let blobs = apply_db::blob_columns(conn, table)?;
    let mut columns: Vec<(&'static str, Value)> = Vec::new();
    let mut balance_cents = None;

    for column in registry::columns_of(table) {
        let stored = document.get(column.column);

        match column.merge {
            MergeKind::Excluded => continue,
            MergeKind::LocalId => {
                let Some(parent) = registry::fk_parent(table, column.column) else {
                    continue;
                };
                let Some(parent_uuid) = parent_reference(stored) else {
                    columns.push((column.column, Value::Null));
                    continue;
                };

                // A parent that is gone too is restored FIRST, in this same transaction: a child
                // whose parent cannot be rebuilt is refused rather than left pointing at nothing.
                let parent_row_id =
                    restore_row(conn, tombstones, parent, &parent_uuid, depth + 1, restored)?;
                columns.push((column.column, Value::Integer(parent_row_id)));
            }
            // AD-5: a balance is not a field. The row is written with the value the retained
            // document holds — money stays `i64` cents — and the same value is published as a
            // `balance_set` below, which is how the other computers learn it.
            MergeKind::Balance => {
                let cents = stored.and_then(serde_json::Value::as_i64).unwrap_or(0);
                balance_cents = Some(cents);
                columns.push((column.column, Value::Integer(cents)));
            }
            MergeKind::Counter => {
                let count = stored.and_then(serde_json::Value::as_i64).unwrap_or(0);
                columns.push((column.column, Value::Integer(count)));
            }
            MergeKind::Lww | MergeKind::Immutable => {
                let Some(stored) = stored else { continue };
                columns.push((
                    column.column,
                    column_value(stored, blobs.iter().any(|name| name == column.column)),
                ));
            }
        }
    }

    let Some(row_id) = apply_db::insert_restored_row(conn, table, &columns)? else {
        return Err(collision());
    };
    restored.rows.insert((table, *row_uuid), row_id);

    bind_identity(conn, table, row_id, row_uuid)?;
    if let Some(cents) = balance_cents {
        capture::emit_balance_set(row_id, cents);
    }

    // The record of the delete goes with the row it described, or the absorbing rule would drop the
    // restored row's own next message (AD-5).
    apply_db::delete_tombstone(conn, table, row_uuid)?;

    for child in cascaded_children(tombstones, table, row_uuid) {
        let child_uuid = <[u8; 16]>::try_from(child.row_uuid.as_slice()).map_err(|_| {
            AppError::Database {
                message: "a retained deleted row carried an unusable identity".to_string(),
            }
        })?;
        let Some(child_rule) = registry::table(&child.table_name) else {
            continue;
        };

        restore_row(
            conn,
            tombstones,
            child_rule.table,
            &child_uuid,
            depth + 1,
            restored,
        )?;
    }

    Ok(row_id)
}

/// AD-2: a derived identity is re-bound to the uuid its key dictates; a surrogate one is left for
/// capture to mint fresh, because its old uuid died with its tombstone.
fn bind_identity(
    conn: &Connection,
    table: &'static str,
    row_id: i64,
    row_uuid: &[u8; 16],
) -> Result<(), AppError> {
    let derived = registry::table(table)
        .and_then(|rule| rule.identity)
        .is_some_and(|identity| matches!(identity, RowIdentity::Natural));
    if !derived || !capture::is_capturing() {
        return Ok(());
    }

    if identity::ensure_derived(conn, table, row_id, row_uuid)?.row_id != row_id {
        return Err(collision());
    }

    Ok(())
}

/// The rows the schema cascaded away with one row: a `Cascade` child whose tombstone names it as
/// its parent and was recorded NO EARLIER than the parent's.
///
/// The stamp comparison is what keeps a child the user deleted on its own out of the group. Capture
/// renders a cascade parent-first and stamps each tombstone as it goes, so a cascaded child's stamp
/// is strictly later; apply records the whole cascade under one stamp; and a child deleted before
/// its parent carries an earlier one and stays its own restorable item.
fn cascaded_children<'a>(
    tombstones: &'a [TombstoneRow],
    table: &'static str,
    row_uuid: &[u8; 16],
) -> Vec<&'a TombstoneRow> {
    let parent_hex = hex(row_uuid);
    let parent_hlc = parent_stamp(tombstones, table, &parent_hex);

    tombstones
        .iter()
        .filter(|tombstone| {
            parent_of(tombstone).is_some_and(|(parent_table, parent_uuid)| {
                parent_table == table
                    && parent_uuid == parent_hex
                    && parent_hlc
                        .as_ref()
                        .is_some_and(|parent_hlc| &tombstone.hlc >= parent_hlc)
            })
        })
        .collect()
}

/// The parent a tombstone names through a `Cascade` edge, as `(table, uuid hex)`.
fn parent_of(tombstone: &TombstoneRow) -> Option<(&'static str, String)> {
    let rule = registry::table(&tombstone.table_name)?;
    let document = serde_json::from_str::<serde_json::Value>(&tombstone.row_json).ok()?;
    let object = document.as_object()?;

    for column in registry::columns_of(rule.table) {
        if !matches!(column.merge, MergeKind::LocalId) {
            continue;
        }
        let Some(parent) = registry::fk_parent(rule.table, column.column) else {
            continue;
        };
        if !matches!(
            registry::fk_policy(rule.table, column.column),
            Some(registry::FkPolicy::Cascade)
        ) {
            continue;
        }
        if let Some(parent_uuid) = object.get(column.column).and_then(|value| value.as_str()) {
            return Some((parent, parent_uuid.to_string()));
        }
    }

    None
}

type RowKey = (String, Vec<u8>);

/// Which deletes are cascaded children of another delete in the same set, and how many each parent
/// brought with it. A root is everything that is not somebody's child, which is what the view lists.
struct Grouped {
    children: std::collections::HashSet<RowKey>,
    counts: HashMap<RowKey, usize>,
}

fn group(tombstones: &[TombstoneRow]) -> Grouped {
    let mut grouped = Grouped {
        children: std::collections::HashSet::new(),
        counts: HashMap::new(),
    };

    for tombstone in tombstones {
        let Some((parent_table, parent_uuid)) = parent_of(tombstone) else {
            continue;
        };
        let Some(parent_bytes) = decode_hex(&parent_uuid) else {
            continue;
        };
        let deleted_together = tombstones.iter().any(|candidate| {
            candidate.table_name == parent_table
                && candidate.row_uuid == parent_bytes
                && tombstone.hlc >= candidate.hlc
        });
        if !deleted_together {
            continue;
        }

        grouped.children.insert(row_key(tombstone));
        *grouped
            .counts
            .entry((parent_table.to_string(), parent_bytes))
            .or_insert(0) += 1;
    }

    grouped
}

/// The stamp the parent's own tombstone was recorded under.
fn parent_stamp(
    tombstones: &[TombstoneRow],
    table: &'static str,
    parent_uuid: &str,
) -> Option<String> {
    let bytes = decode_hex(parent_uuid)?;

    tombstones
        .iter()
        .find(|candidate| candidate.table_name == table && candidate.row_uuid == bytes)
        .map(|candidate| candidate.hlc.clone())
}

fn row_key(tombstone: &TombstoneRow) -> RowKey {
    (tombstone.table_name.clone(), tombstone.row_uuid.clone())
}

fn display_item(tombstone: &TombstoneRow, grouped: &Grouped) -> Option<DeletedItem> {
    let rule = registry::table(&tombstone.table_name)?;
    let row_uuid = <[u8; 16]>::try_from(tombstone.row_uuid.as_slice()).ok()?;
    let key = TombstoneKey {
        table: rule.table,
        row_uuid,
    };

    Some(DeletedItem {
        id: key.id(),
        table_name: rule.table.to_string(),
        label: label_of(tombstone),
        deleted_at: tombstone.deleted_at.clone(),
        days_left: days_left(&tombstone.purge_after),
        child_count: grouped
            .counts
            .get(&(rule.table.to_string(), tombstone.row_uuid.clone()))
            .copied()
            .unwrap_or(0),
    })
}

/// The columns a human recognises a deleted row by, in the order they are preferred.
const LABEL_COLUMNS: &[&str] = &[
    "name",
    "merchant",
    "title",
    "description",
    "source_name",
    "task_type_key",
    "make",
    "key",
    "date",
];

/// A label built from the retained row itself, so the view names what was deleted without this
/// module knowing anything about the domains it lists.
fn label_of(tombstone: &TombstoneRow) -> String {
    let Ok(serde_json::Value::Object(row)) =
        serde_json::from_str::<serde_json::Value>(&tombstone.row_json)
    else {
        return String::new();
    };

    let mut parts = Vec::new();
    for column in LABEL_COLUMNS {
        if let Some(text) = row.get(*column).and_then(|value| match value {
            serde_json::Value::String(text) if !text.is_empty() => Some(text.clone()),
            serde_json::Value::Number(number) => Some(number.to_string()),
            _ => None,
        }) {
            parts.push(text);
            break;
        }
    }
    if let Some(cents) = row.get("amount_cents").and_then(serde_json::Value::as_i64) {
        parts.push(format_cents(cents));
    }

    parts.join(" · ")
}

/// Money is `i64` cents everywhere (project-context rule), including in a label: the rendering is a
/// division by 100 and never a float.
fn format_cents(cents: i64) -> String {
    let sign = if cents < 0 { "-" } else { "" };
    let absolute = cents.unsigned_abs();

    format!("{sign}{}.{:02}", absolute / 100, absolute % 100)
}

/// Whole days left before the retention window closes, floored at zero.
fn days_left(purge_after: &str) -> i64 {
    let parsed = chrono::NaiveDateTime::parse_from_str(purge_after, "%Y-%m-%d %H:%M:%S")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(purge_after, "%Y-%m-%dT%H:%M:%S"));
    let Ok(purge_after) = parsed else {
        return 0;
    };

    (purge_after - chrono::Utc::now().naive_utc())
        .num_days()
        .max(0)
}

type RowDocument = serde_json::Map<String, serde_json::Value>;

fn parse_row(tombstone: &TombstoneRow) -> Result<RowDocument, AppError> {
    match serde_json::from_str::<serde_json::Value>(&tombstone.row_json) {
        Ok(serde_json::Value::Object(row)) => Ok(row),
        _ => Err(AppError::Sync {
            code: "restore_not_found".to_string(),
            message: "The deleted item cannot be read any more.".to_string(),
            recoverable: false,
        }),
    }
}

fn parent_reference(stored: Option<&serde_json::Value>) -> Option<[u8; 16]> {
    let hex = stored?.as_str()?;

    <[u8; 16]>::try_from(decode_hex(hex)?.as_slice()).ok()
}

/// A JSON scalar as the value the column holds. A `BLOB` column's bytes travel as hex, so they are
/// decoded back rather than stored as the text of themselves.
fn column_value(stored: &serde_json::Value, is_blob: bool) -> Value {
    match stored {
        serde_json::Value::Null => Value::Null,
        serde_json::Value::Bool(flag) => Value::Integer(i64::from(*flag)),
        serde_json::Value::Number(number) => number
            .as_i64()
            .map(Value::Integer)
            .or_else(|| number.as_f64().map(Value::Real))
            .unwrap_or(Value::Null),
        serde_json::Value::String(text) => match is_blob.then(|| decode_hex(text)).flatten() {
            Some(bytes) => Value::Blob(bytes),
            None => Value::Text(text.clone()),
        },
        other => Value::Text(other.to_string()),
    }
}

fn matches(tombstone: &TombstoneRow, table: &str, row_uuid: &[u8; 16]) -> bool {
    tombstone.table_name == table && tombstone.row_uuid == row_uuid
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn decode_hex(text: &str) -> Option<Vec<u8>> {
    if !text.is_ascii() || !text.len().is_multiple_of(2) {
        return None;
    }

    (0..text.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(text.get(at..at + 2)?, 16).ok())
        .collect()
}

fn not_found() -> AppError {
    AppError::Sync {
        code: "restore_not_found".to_string(),
        message: "That deleted item is no longer restorable.".to_string(),
        recoverable: false,
    }
}

fn parent_missing() -> AppError {
    AppError::Sync {
        code: "restore_parent_missing".to_string(),
        message: "What this item belonged to is gone and cannot be restored with it.".to_string(),
        recoverable: false,
    }
}

fn collision() -> AppError {
    AppError::Sync {
        code: "restore_conflict".to_string(),
        message: "Something with the same key exists again, so nothing was restored.".to_string(),
        recoverable: false,
    }
}
