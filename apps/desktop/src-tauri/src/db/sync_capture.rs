//! The SQL the capture hook writes (AD-3, AD-5): the replication log and the per-field merge
//! state.
//!
//! WHY it lives in `db/`: it is raw SQL, and raw SQL belongs here (project-context rule 1).
//! `sync::capture` owns every decision about WHICH message a change becomes; this module owns
//! nothing but the statements that persist them.
//!
//! Every statement runs on the connection it is handed, which during a captured write is the
//! transaction `ActiveDataset::write` opened — that is what makes "the row changed" and "the
//! message exists" one fact instead of two (AD-3).
//!
//! Both writers use CACHED prepared statements. A 1,000-row import writes thousands of messages
//! inside one transaction, so re-parsing the statement per message is measurable. A multi-row
//! `VALUES` form was measured as well and is only about 4% faster at the SQL level — what costs is
//! the row plus its indexes — so it is not used: it would need an owned copy of every value.

use rusqlite::{params, Connection};

use crate::error::AppError;

/// One row of `sync_log`, in the shape migration 032 defines.
///
/// Borrowed: the flush resolves a whole batch before it writes any of it (the two-pass flush in
/// `sync::capture`), so the values already live in owned storage there and copying them again per
/// message is thousands of allocations for nothing.
pub struct LoggedMessage<'a> {
    /// 16 lowercase hex characters (AD-4).
    pub install: &'a str,
    /// Story 13's frozen 33-character encoding.
    pub hlc: &'a str,
    /// One of the five kinds migration 032 closes by CHECK.
    pub kind: &'a str,
    pub table_name: &'a str,
    pub row_uuid: &'a [u8],
    /// Present exactly for `field` and `counter_delta`.
    pub column_name: Option<&'a str>,
    /// Present exactly for `balance_delta`.
    pub cause_uuid: Option<&'a [u8]>,
    pub payload: Option<&'a [u8]>,
}

/// Appends a message to the unshipped tail. `seq`/`idx` stay NULL until Story 19 cuts a segment.
///
/// `prepare_cached` and not `execute`: a 1,000-row import writes thousands of these inside one
/// transaction, and re-parsing the statement every time was measurable. A multi-row `VALUES` form
/// was measured too and is only 4% faster at the SQL level — the cost is the row and its two
/// indexes, not the statement — while costing an owned copy of every value, so it is not used.
pub fn append(conn: &Connection, message: &LoggedMessage<'_>) -> Result<(), AppError> {
    conn.prepare_cached(
        "INSERT INTO sync_log (install, hlc, kind, table_name, row_uuid, column_name, cause_uuid, payload) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?
    .execute(params![
        message.install,
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

/// Records which write currently owns a field (AD-5).
///
/// Unconditional on purpose: this is the LOCAL capture path, and `Clock::now` is strictly greater
/// than every stamp this install has produced or accepted, so a local write is by construction the
/// newest one. The `hlc >` comparison belongs to `sync::apply` (Story 20), where arrival order and
/// message order genuinely differ.
pub fn upsert_field_state(
    conn: &Connection,
    table_name: &str,
    row_uuid: &[u8],
    column_name: &str,
    hlc: &str,
    install: &str,
    content_hash: &str,
) -> Result<(), AppError> {
    conn.prepare_cached(
        "INSERT INTO sync_field_state (table_name, row_uuid, column_name, hlc, install, content_hash) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
         ON CONFLICT (table_name, row_uuid, column_name) DO UPDATE SET \
             hlc = excluded.hlc, install = excluded.install, content_hash = excluded.content_hash",
    )?
    .execute(params![
        table_name,
        row_uuid,
        column_name,
        hlc,
        install,
        content_hash
    ])?;

    Ok(())
}

/// Drops the merge state of a row that no longer exists.
///
/// A tombstone is absorbing per row uuid and AD-2 removes the identity mapping with it, so a
/// re-insert is a NEW identity: the old row's field state can never be consulted again, and
/// leaving it would make reconcile (Story 22) compare hashes for a row that is gone.
pub fn forget_field_state(
    conn: &Connection,
    table_name: &str,
    row_uuid: &[u8],
) -> Result<usize, AppError> {
    Ok(conn
        .prepare_cached("DELETE FROM sync_field_state WHERE table_name = ?1 AND row_uuid = ?2")?
        .execute(params![table_name, row_uuid])?)
}

/// A `sync_log` row as a test reads it back.
#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StoredMessage {
    pub install: String,
    pub hlc: String,
    pub kind: String,
    pub table_name: String,
    pub row_uuid: Vec<u8>,
    pub column_name: Option<String>,
    pub cause_uuid: Option<Vec<u8>>,
    pub payload: Option<Vec<u8>>,
}

/// The whole log in insertion order. `#[cfg(test)]` because production never reads the log this
/// way: Story 19 reads the unshipped tail through its own partial index.
#[cfg(test)]
pub(crate) fn all_messages(conn: &Connection) -> Result<Vec<StoredMessage>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT install, hlc, kind, table_name, row_uuid, column_name, cause_uuid, payload \
         FROM sync_log ORDER BY id",
    )?;

    let rows = stmt
        .query_map([], |row| {
            Ok(StoredMessage {
                install: row.get(0)?,
                hlc: row.get(1)?,
                kind: row.get(2)?,
                table_name: row.get(3)?,
                row_uuid: row.get(4)?,
                column_name: row.get(5)?,
                cause_uuid: row.get(6)?,
                payload: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

/// `(hlc, install, content_hash)` for one field, or `None` when nothing owns it yet.
#[cfg(test)]
pub(crate) fn field_state(
    conn: &Connection,
    table_name: &str,
    row_uuid: &[u8],
    column_name: &str,
) -> Result<Option<(String, String, String)>, AppError> {
    use rusqlite::OptionalExtension;

    Ok(conn
        .query_row(
            "SELECT hlc, install, content_hash FROM sync_field_state \
             WHERE table_name = ?1 AND row_uuid = ?2 AND column_name = ?3",
            params![table_name, row_uuid, column_name],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?)
}

#[cfg(test)]
pub(crate) fn field_state_count(conn: &Connection) -> Result<i64, AppError> {
    Ok(conn.query_row("SELECT COUNT(*) FROM sync_field_state", [], |row| row.get(0))?)
}

/// A table's columns in the order SQLite stores them, which is the order the pre-update hook
/// indexes its values by (AD-3): the hook is handed `i` and nothing else, so the names have to be
/// resolved from the schema before the hook can run at all.
pub fn table_columns(conn: &Connection, table_name: &str) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare("SELECT name FROM pragma_table_info(?1) ORDER BY cid")?;

    let names = stmt
        .query_map([table_name], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(names)
}

/// Whether the table has a rowid.
///
/// A probe rather than a parse of `sqlite_master.sql`: `WITHOUT ROWID` can be written in any case
/// and with any spacing, while `SELECT rowid` either compiles or does not. It matters because the
/// pre-update hook's row id is MEANINGLESS for a `WITHOUT ROWID` table, and keying an identity by
/// it would silently alias rows (`sync/capture.rs` refuses instead).
pub fn table_has_rowid(conn: &Connection, table_name: &str) -> Result<bool, AppError> {
    // The name comes from `sync::registry`'s `&'static str` list, never from input, and a
    // table name cannot be bound as a parameter.
    Ok(conn
        .prepare(&format!("SELECT rowid FROM \"{table_name}\" LIMIT 0"))
        .is_ok())
}
