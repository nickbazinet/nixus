//! The SQL the apply path runs (AD-1, AD-11, AD-12): the applied vector, the parked and
//! quarantined worklists, the tombstone record, and the row writes a remote message folds into the
//! user's tables.
//!
//! WHY it lives in `db/`: it is raw SQL, and raw SQL belongs here (project-context rule 1).
//! `sync::apply` owns every decision about WHETHER a message applies; this module owns nothing but
//! the statements that carry it out.
//!
//! EVERY table and column name reaching the `format!`ed statements below is a `&'static str` owned
//! by `sync::registry`, never the string a remote computer put in a message: `sync::apply` resolves
//! the message's names through the registry first and passes the static ones. Values are bound as
//! parameters without exception.
//!
//! An applied message is RECORDED in `sync_log` with its origin `(install, seq, idx)`, which is
//! what makes apply idempotent for the two kinds that are not idempotent by themselves — a counter
//! delta and a balance delta — and is also AD-1 taken literally: the log is replication truth, and
//! that includes what arrived from elsewhere. `segment::cut` filters on this install's own rows
//! with `seq IS NULL`, so a recorded remote message is never re-shipped.

use rusqlite::types::Value;
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppError;

/// One shipped message, in the shape every one of the three worklists stores.
pub struct AppliedMessage<'a> {
    pub install: &'a str,
    pub seq: i64,
    pub idx: i64,
    pub hlc: &'a str,
    pub kind: &'a str,
    pub table_name: &'a str,
    pub row_uuid: &'a [u8],
    pub column_name: Option<&'a str>,
    pub cause_uuid: Option<&'a [u8]>,
    pub payload: Option<&'a [u8]>,
    /// Whether this message has a replication identity worth remembering.
    ///
    /// `false` for AD-9's post-swap replay of this computer's OWN unsent log: those rows are
    /// already in `sync_log` with `seq IS NULL` and must stay there to be shipped, so recording
    /// them again would both duplicate the message and — for a counter or balance delta, whose
    /// value IS the sum of its recorded copies — double-count it.
    pub record: bool,
}

/// Records a message as applied. The `(install, seq, idx)` UNIQUE of `sync_log` is AD-4's message
/// identity, so a second attempt is a constraint failure rather than a second fold.
pub fn record_applied(conn: &Connection, message: &AppliedMessage<'_>) -> Result<(), AppError> {
    if !message.record {
        return Ok(());
    }

    conn.prepare_cached(
        "INSERT INTO sync_log (install, seq, idx, hlc, kind, table_name, row_uuid, column_name, cause_uuid, payload) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )?
    .execute(params![
        message.install,
        message.seq,
        message.idx,
        message.hlc,
        message.kind,
        message.table_name,
        message.row_uuid,
        message.column_name,
        message.cause_uuid,
        message.payload,
    ])?;

    Ok(())
}

/// Whether this exact message has already been dealt with — applied, parked or quarantined.
///
/// All three count: re-folding an applied delta would double it, and re-parking a parked message
/// would either fail its UNIQUE or queue it twice.
pub fn is_recorded(
    conn: &Connection,
    install: &str,
    seq: i64,
    idx: i64,
) -> Result<bool, AppError> {
    let found: Option<i64> = conn
        .prepare_cached(
            "SELECT 1 FROM sync_log WHERE install = ?1 AND seq = ?2 AND idx = ?3 \
             UNION ALL SELECT 1 FROM sync_pending WHERE install = ?1 AND seq = ?2 AND idx = ?3 \
             UNION ALL SELECT 1 FROM sync_quarantine WHERE install = ?1 AND seq = ?2 AND idx = ?3 \
             LIMIT 1",
        )?
        .query_row(params![install, seq, idx], |row| row.get(0))
        .optional()?;

    Ok(found.is_some())
}

/// How far this computer has applied one origin install (AD-11): the last fully applied `seq` and
/// the number of messages it held.
pub fn applied_position(conn: &Connection, install: &str) -> Result<Option<(i64, i64)>, AppError> {
    let position = conn
        .prepare_cached("SELECT seq, applied_offset FROM sync_applied_vector WHERE install = ?1")?
        .query_row([install], |row| Ok((row.get(0)?, row.get(1)?)))
        .optional()?;

    Ok(position)
}

/// Advances the vector, never backwards.
///
/// Monotonic because the caller is the apply transaction and a replayed segment would otherwise
/// rewind a watermark AD-9 reads as a snapshot's own position.
pub fn advance_applied_vector(
    conn: &Connection,
    install: &str,
    seq: i64,
    applied_offset: i64,
) -> Result<(), AppError> {
    conn.prepare_cached(
        "INSERT INTO sync_applied_vector (install, seq, applied_offset, updated_at) \
         VALUES (?1, ?2, ?3, datetime('now')) \
         ON CONFLICT(install) DO UPDATE SET \
           applied_offset = CASE WHEN excluded.seq > sync_applied_vector.seq THEN excluded.applied_offset \
                                 ELSE MAX(sync_applied_vector.applied_offset, excluded.applied_offset) END, \
           seq = MAX(sync_applied_vector.seq, excluded.seq), \
           updated_at = excluded.updated_at",
    )?
    .execute(params![install, seq, applied_offset])?;

    Ok(())
}

/// A stored message of one row, with its payload still encoded: decoding belongs to `sync::`, which
/// owns the payload format.
pub struct LoggedValue {
    pub hlc: String,
    pub kind: String,
    pub cause_uuid: Option<Vec<u8>>,
    pub payload: Option<Vec<u8>>,
}

/// Every balance message known for one account, local and remote alike.
///
/// This IS the balance merge state (AD-5): a balance has no single owning write, so there is
/// nothing to keep in `sync_field_state` and the fold over these rows is the value. Served by
/// `idx_sync_log_row`.
pub fn balance_messages(
    conn: &Connection,
    table: &str,
    row_uuid: &[u8],
) -> Result<Vec<LoggedValue>, AppError> {
    let mut statement = conn.prepare_cached(
        "SELECT hlc, kind, cause_uuid, payload FROM sync_log \
         WHERE table_name = ?1 AND row_uuid = ?2 AND kind IN ('balance_set', 'balance_delta') \
         ORDER BY hlc, id",
    )?;
    let rows = statement
        .query_map(params![table, row_uuid], |row| {
            Ok(LoggedValue {
                hlc: row.get(0)?,
                kind: row.get(1)?,
                cause_uuid: row.get(2)?,
                payload: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

/// Every counter delta known for one column. AD-5: a counter's value is the sum of its deltas, base
/// zero (Story 16), and each delta is identified by its message id, which `sync_log` already keys.
pub fn counter_deltas(
    conn: &Connection,
    table: &str,
    row_uuid: &[u8],
    column: &str,
) -> Result<Vec<Vec<u8>>, AppError> {
    let mut statement = conn.prepare_cached(
        "SELECT payload FROM sync_log \
         WHERE table_name = ?1 AND row_uuid = ?2 AND column_name = ?3 AND kind = 'counter_delta'",
    )?;
    let rows = statement
        .query_map(params![table, row_uuid, column], |row| {
            row.get::<_, Option<Vec<u8>>>(0)
        })?
        .filter_map(Result::transpose)
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

/// A deleted row, kept whole for 30 days (AD-5).
pub struct TombstoneRow {
    pub table_name: String,
    pub row_uuid: Vec<u8>,
    pub hlc: String,
    pub install: String,
    pub row_json: String,
    pub deleted_at: String,
    pub purge_after: String,
}

pub fn tombstone(
    conn: &Connection,
    table: &str,
    row_uuid: &[u8],
) -> Result<Option<TombstoneRow>, AppError> {
    let row = conn
        .prepare_cached(
            "SELECT table_name, row_uuid, hlc, install, row_json, deleted_at, purge_after \
             FROM sync_tombstone WHERE table_name = ?1 AND row_uuid = ?2",
        )?
        .query_row(params![table, row_uuid], read_tombstone)
        .optional()?;

    Ok(row)
}

/// The restorable deletes, newest first. Story 21's recently-deleted view reads this.
pub fn recent_tombstones(conn: &Connection, limit: i64) -> Result<Vec<TombstoneRow>, AppError> {
    let mut statement = conn.prepare(
        "SELECT table_name, row_uuid, hlc, install, row_json, deleted_at, purge_after \
         FROM sync_tombstone WHERE purge_after > datetime('now') \
         ORDER BY deleted_at DESC, table_name, row_uuid LIMIT ?1",
    )?;
    let rows = statement
        .query_map([limit], read_tombstone)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

/// Drops a tombstone, which is what a restore does to the row it brought back: the record of the
/// delete has to go, or the absorbing rule (AD-5) would drop the restored row's own next message.
pub fn delete_tombstone(conn: &Connection, table: &str, row_uuid: &[u8]) -> Result<(), AppError> {
    conn.prepare_cached("DELETE FROM sync_tombstone WHERE table_name = ?1 AND row_uuid = ?2")?
        .execute(params![table, row_uuid])?;

    Ok(())
}

/// AD-5's retention: a tombstone older than its `purge_after` stops being restorable and is
/// removed. The delete MESSAGE in `sync_log` is deliberately untouched — it is replication truth
/// and other computers may still be owed it; only the restorable copy of the row expires.
pub fn purge_expired_tombstones(conn: &Connection) -> Result<usize, AppError> {
    let removed = conn
        .prepare_cached("DELETE FROM sync_tombstone WHERE purge_after <= datetime('now')")?
        .execute([])?;

    Ok(removed)
}

fn read_tombstone(row: &rusqlite::Row<'_>) -> rusqlite::Result<TombstoneRow> {
    Ok(TombstoneRow {
        table_name: row.get(0)?,
        row_uuid: row.get(1)?,
        hlc: row.get(2)?,
        install: row.get(3)?,
        row_json: row.get(4)?,
        deleted_at: row.get(5)?,
        purge_after: row.get(6)?,
    })
}

/// Records a delete. The LOWEST `hlc` wins a second tombstone for the same row, so two computers
/// deleting one row agree on when it died whatever order the two messages arrive in.
pub fn record_tombstone(
    conn: &Connection,
    table: &str,
    row_uuid: &[u8],
    hlc: &str,
    install: &str,
    row_json: &str,
    retention_days: u32,
) -> Result<(), AppError> {
    conn.prepare_cached(
        "INSERT INTO sync_tombstone (table_name, row_uuid, hlc, install, row_json, purge_after) \
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now', ?6)) \
         ON CONFLICT(table_name, row_uuid) DO UPDATE SET \
           row_json = CASE WHEN excluded.hlc < sync_tombstone.hlc THEN excluded.row_json ELSE sync_tombstone.row_json END, \
           install = CASE WHEN excluded.hlc < sync_tombstone.hlc THEN excluded.install ELSE sync_tombstone.install END, \
           hlc = MIN(sync_tombstone.hlc, excluded.hlc)",
    )?
    .execute(params![
        table,
        row_uuid,
        hlc,
        install,
        row_json,
        format!("+{retention_days} days"),
    ])?;

    Ok(())
}

/// Rewrites the retained copy of a deleted row (AD-12: a balance delta addressed to a tombstoned
/// account is added to the row kept in `sync_tombstone` rather than lost).
pub fn set_tombstone_row_json(
    conn: &Connection,
    table: &str,
    row_uuid: &[u8],
    row_json: &str,
) -> Result<(), AppError> {
    conn.prepare_cached(
        "UPDATE sync_tombstone SET row_json = ?3 WHERE table_name = ?1 AND row_uuid = ?2",
    )?
    .execute(params![table, row_uuid, row_json])?;

    Ok(())
}

/// A message waiting for a row to arrive (AD-11).
pub struct ParkedMessage {
    pub id: i64,
    pub install: String,
    pub seq: i64,
    pub idx: i64,
    pub hlc: String,
    pub kind: String,
    pub table_name: String,
    pub row_uuid: Vec<u8>,
    pub column_name: Option<String>,
    pub cause_uuid: Option<Vec<u8>>,
    pub payload: Option<Vec<u8>>,
}

/// Parks a message. `OR IGNORE` because a re-delivered segment must not park the same message
/// twice (AD-6: duplicate delivery is expected, not exceptional).
pub fn park(
    conn: &Connection,
    message: &AppliedMessage<'_>,
    waiting_on_table: &str,
    waiting_on_uuid: &[u8],
) -> Result<(), AppError> {
    if !message.record {
        return Ok(());
    }

    conn.prepare_cached(
        "INSERT OR IGNORE INTO sync_pending \
         (install, seq, idx, hlc, kind, table_name, row_uuid, column_name, cause_uuid, payload, waiting_on_table, waiting_on_uuid) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
    )?
    .execute(params![
        message.install,
        message.seq,
        message.idx,
        message.hlc,
        message.kind,
        message.table_name,
        message.row_uuid,
        message.column_name,
        message.cause_uuid,
        message.payload,
        waiting_on_table,
        waiting_on_uuid,
    ])?;

    Ok(())
}

pub fn parked(conn: &Connection) -> Result<Vec<ParkedMessage>, AppError> {
    read_parked(
        conn,
        "SELECT id, install, seq, idx, hlc, kind, table_name, row_uuid, column_name, cause_uuid, payload \
         FROM sync_pending ORDER BY id",
        params![],
    )
}

/// Parked longer than the give-up window, which is the bound AD-11 asks for on the parking queue.
pub fn parked_before(conn: &Connection, days: u32) -> Result<Vec<ParkedMessage>, AppError> {
    read_parked(
        conn,
        "SELECT id, install, seq, idx, hlc, kind, table_name, row_uuid, column_name, cause_uuid, payload \
         FROM sync_pending WHERE received_at < datetime('now', ?1) ORDER BY id",
        params![format!("-{days} days")],
    )
}

fn read_parked(
    conn: &Connection,
    sql: &str,
    bound: &[&dyn rusqlite::ToSql],
) -> Result<Vec<ParkedMessage>, AppError> {
    let mut statement = conn.prepare_cached(sql)?;
    let rows = statement
        .query_map(bound, |row| {
            Ok(ParkedMessage {
                id: row.get(0)?,
                install: row.get(1)?,
                seq: row.get(2)?,
                idx: row.get(3)?,
                hlc: row.get(4)?,
                kind: row.get(5)?,
                table_name: row.get(6)?,
                row_uuid: row.get(7)?,
                column_name: row.get(8)?,
                cause_uuid: row.get(9)?,
                payload: row.get(10)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

pub fn forget_parked(conn: &Connection, id: i64) -> Result<(), AppError> {
    conn.prepare_cached("DELETE FROM sync_pending WHERE id = ?1")?
        .execute([id])?;

    Ok(())
}

// Story 20's simulator engine and tests ask how much is parked; production reports counts through
// `ApplyReport` instead.
#[cfg_attr(not(test), allow(dead_code))]
pub fn parked_count(conn: &Connection) -> Result<i64, AppError> {
    let count = conn
        .prepare_cached("SELECT COUNT(*) FROM sync_pending")?
        .query_row([], |row| row.get(0))?;

    Ok(count)
}

/// How many messages are quarantined. A count, so AD-16's diagnostics can report that the queue is
/// not empty without naming a table, a row or a value.
pub fn quarantined_count(conn: &Connection) -> Result<i64, AppError> {
    let count = conn
        .prepare_cached("SELECT COUNT(*) FROM sync_quarantine")?
        .query_row([], |row| row.get(0))?;

    Ok(count)
}

/// Seeds both worklists with the given number of rows, so a diagnostics test can assert the counts
/// come from the DATASET rather than from the actor's memory.
///
/// Raw statements and not the real `park`/`quarantine`: arranging real parked messages would take a
/// whole segment each, and what is under test is the read path.
#[cfg(test)]
pub fn seed_worklists(conn: &Connection, pending: usize, quarantined: usize) {
    const INSTALL: &str = "0123456789abcdef";
    let hlc = format!("{:016x}-{INSTALL}", 1u64);

    for idx in 0..pending {
        conn.execute(
            "INSERT INTO sync_pending \
             (install, seq, idx, hlc, kind, table_name, row_uuid, waiting_on_table, waiting_on_uuid) \
             VALUES (?1, 0, ?2, ?3, 'field', 'accounts', ?4, 'accounts', ?4)",
            rusqlite::params![INSTALL, idx as i64, &hlc, [idx as u8; 16]],
        )
        .expect("a pending row seeds");
    }

    for idx in 0..quarantined {
        conn.execute(
            "INSERT INTO sync_quarantine \
             (install, seq, idx, hlc, kind, table_name, row_uuid, reason) \
             VALUES (?1, 1, ?2, ?3, 'field', 'accounts', ?4, 'unknown_column')",
            rusqlite::params![INSTALL, idx as i64, &hlc, [idx as u8; 16]],
        )
        .expect("a quarantine row seeds");
    }
}

/// Quarantines a message with a reason code — never a rendered error and never a value (AD-16).
pub fn quarantine(
    conn: &Connection,
    message: &AppliedMessage<'_>,
    reason: &str,
    schema_version: Option<u32>,
) -> Result<(), AppError> {
    if !message.record {
        return Ok(());
    }

    conn.prepare_cached(
        "INSERT OR IGNORE INTO sync_quarantine \
         (install, seq, idx, hlc, kind, table_name, row_uuid, column_name, cause_uuid, payload, reason, schema_version) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
    )?
    .execute(params![
        message.install,
        message.seq,
        message.idx,
        message.hlc,
        message.kind,
        message.table_name,
        message.row_uuid,
        message.column_name,
        message.cause_uuid,
        message.payload,
        reason,
        schema_version,
    ])?;

    Ok(())
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn quarantine_reasons(conn: &Connection) -> Result<Vec<(String, String)>, AppError> {
    let mut statement =
        conn.prepare("SELECT table_name, reason FROM sync_quarantine ORDER BY id")?;
    let rows = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

// --------------------------------------------------------------------------------------------
// The row writes
// --------------------------------------------------------------------------------------------

/// Inserts a row and returns its machine-local id.
///
/// Addressed by `_rowid_` rather than by `id` everywhere below: not every synced table calls its
/// key `id` (`config` does not), and `_rowid_` is the column the capture hook's row id already
/// means, so one spelling covers every travelling table.
pub fn insert_row(
    conn: &Connection,
    table: &'static str,
    columns: &[(&'static str, Value)],
) -> Result<i64, AppError> {
    execute_insert(conn, table, columns)?.map_err(AppError::from)
}

fn execute_insert(
    conn: &Connection,
    table: &'static str,
    columns: &[(&'static str, Value)],
) -> Result<rusqlite::Result<i64>, AppError> {
    if columns.is_empty() {
        return Err(AppError::Database {
            message: format!("a remote {table} row named no column to insert"),
        });
    }

    let names = columns
        .iter()
        .map(|(name, _)| *name)
        .collect::<Vec<_>>()
        .join(", ");
    let placeholders = (1..=columns.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ");
    let values: Vec<&dyn rusqlite::ToSql> = columns
        .iter()
        .map(|(_, value)| value as &dyn rusqlite::ToSql)
        .collect();

    let executed = conn
        .prepare_cached(&format!("INSERT INTO {table} ({names}) VALUES ({placeholders})"))?
        .execute(values.as_slice());

    Ok(executed.map(|_| conn.last_insert_rowid()))
}

/// Inserts a restored row, answering `None` when the schema REFUSES it on a constraint.
///
/// The refusal is read off SQLite's own error code rather than its message: a natural key the user
/// has since re-created is the one restore failure that is not a bug, and story 21 turns it into a
/// typed error the UI can explain instead of a database string.
pub fn insert_restored_row(
    conn: &Connection,
    table: &'static str,
    columns: &[(&'static str, Value)],
) -> Result<Option<i64>, AppError> {
    match execute_insert(conn, table, columns)? {
        Ok(row_id) => Ok(Some(row_id)),
        Err(rusqlite::Error::SqliteFailure(failure, _))
            if failure.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            Ok(None)
        }
        Err(error) => Err(AppError::from(error)),
    }
}

/// The columns the live schema declares as `BLOB`, so a restore can turn the hex a tombstone
/// carries back into bytes instead of storing the text of it.
pub fn blob_columns(conn: &Connection, table: &'static str) -> Result<Vec<String>, AppError> {
    let mut statement =
        conn.prepare_cached("SELECT name FROM pragma_table_info(?1) WHERE UPPER(type) = 'BLOB'")?;
    let names = statement
        .query_map([table], |row| row.get(0))?
        .collect::<Result<Vec<String>, _>>()?;

    Ok(names)
}

pub fn update_row(
    conn: &Connection,
    table: &'static str,
    row_id: i64,
    columns: &[(&'static str, Value)],
) -> Result<(), AppError> {
    if columns.is_empty() {
        return Ok(());
    }

    let assignments = columns
        .iter()
        .enumerate()
        .map(|(index, (name, _))| format!("{name} = ?{}", index + 1))
        .collect::<Vec<_>>()
        .join(", ");
    let mut values: Vec<&dyn rusqlite::ToSql> = columns
        .iter()
        .map(|(_, value)| value as &dyn rusqlite::ToSql)
        .collect();
    values.push(&row_id);

    conn.prepare_cached(&format!(
        "UPDATE {table} SET {assignments} WHERE _rowid_ = ?{}",
        columns.len() + 1
    ))?
    .execute(values.as_slice())?;

    Ok(())
}

/// Deletes by local id with `foreign_keys = ON`, so the schema's own `ON DELETE CASCADE` and
/// `SET NULL` run locally — the real behaviour AD-12 relies on rather than a replayed one.
pub fn delete_row(conn: &Connection, table: &'static str, row_id: i64) -> Result<(), AppError> {
    conn.prepare_cached(&format!("DELETE FROM {table} WHERE _rowid_ = ?1"))?
        .execute([row_id])?;

    Ok(())
}
/// The local ids of the rows that point at `parent_row_id` through one foreign key.
pub fn child_row_ids(
    conn: &Connection,
    child_table: &'static str,
    child_column: &'static str,
    parent_row_id: i64,
) -> Result<Vec<i64>, AppError> {
    let mut statement = conn.prepare_cached(&format!(
        "SELECT _rowid_ FROM {child_table} WHERE {child_column} = ?1 ORDER BY _rowid_"
    ))?;
    let ids = statement
        .query_map([parent_row_id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(ids)
}

/// One row of a table, as `(column, value)`, for the JSON a cascaded child's tombstone has to carry
/// when the local `ON DELETE CASCADE` — not a message — is what removed it.
pub fn read_columns(
    conn: &Connection,
    table: &'static str,
    row_id: i64,
    columns: &[&'static str],
) -> Result<Vec<(&'static str, Value)>, AppError> {
    if columns.is_empty() {
        return Ok(Vec::new());
    }

    let selected = columns.join(", ");
    let row = conn
        .prepare_cached(&format!("SELECT {selected} FROM {table} WHERE _rowid_ = ?1"))?
        .query_row([row_id], |row| {
            let mut values = Vec::with_capacity(columns.len());
            for (offset, column) in columns.iter().enumerate() {
                values.push((*column, row.get::<_, Value>(offset)?));
            }

            Ok(values)
        })
        .optional()?;

    Ok(row.unwrap_or_default())
}
