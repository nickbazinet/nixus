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
//! `sync_field_state` holds ONE ROW PER SYNCED ROW since migration 033, with the per-column
//! `(hlc, content hash)` map packed into a BLOB. AD-5's merge is still per column — every reader
//! and writer below addresses a single column — but a changed row costs one row write instead of
//! one per column, which the AD-19 latency gate measured as the largest remaining cost of capture.
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

/// How wide a content hash is: a raw sha256, not its hex.
pub const CONTENT_HASH_LEN: usize = 32;

/// What one column's merge state is (AD-5): the write that owns it, and the hash of the value it
/// wrote.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColumnState {
    /// Story 13's frozen 33-character encoding.
    pub hlc: String,
    pub content_hash: [u8; CONTENT_HASH_LEN],
}

impl ColumnState {
    /// The install that owns the field, which is AD-4's tiebreak: two writes on the same
    /// `(wall_ms, counter)` are ordered by install id, and the winner has to be remembered.
    ///
    /// Read out of the `hlc` rather than stored beside it, because the frozen encoding
    /// `{ntp64:016x}-{install:016x}` already IS that pair — a second copy would be a second place
    /// to keep correct.
    // Story 20 is the first production caller: apply breaks an exact tie with it.
    #[allow(dead_code)]
    pub fn install(&self) -> &str {
        self.hlc.split_once('-').map_or("", |(_, install)| install)
    }
}

/// The packed per-column map `sync_field_state.columns` holds.
///
/// Fixed width per entry apart from the name, so finding one column is a linear scan over a few
/// hundred bytes with no allocation, and the entries are sorted by name so the same state always
/// produces the same bytes.
mod packed {
    use super::{ColumnState, CONTENT_HASH_LEN};
    use crate::error::AppError;

    /// Story 13's `HLC_ENCODED_LEN`, restated here because this module decodes BYTES and must not
    /// depend on `sync/` (project-context rule 1: `db/` owns the stored form).
    const HLC_LEN: usize = 33;
    const ENTRY_FIXED: usize = 1 + HLC_LEN + CONTENT_HASH_LEN;

    pub fn encode(columns: &[(String, ColumnState)]) -> Vec<u8> {
        let mut sorted: Vec<&(String, ColumnState)> = columns.iter().collect();
        sorted.sort_by(|left, right| left.0.cmp(&right.0));

        let mut encoded = Vec::with_capacity(2 + sorted.len() * (ENTRY_FIXED + 12));
        encoded.extend_from_slice(&(sorted.len() as u16).to_be_bytes());

        for (name, state) in sorted {
            encoded.push(name.len().min(u8::MAX as usize) as u8);
            encoded.extend_from_slice(&name.as_bytes()[..name.len().min(u8::MAX as usize)]);
            encoded.extend_from_slice(state.hlc.as_bytes());
            encoded.extend_from_slice(&state.content_hash);
        }

        encoded
    }

    pub fn decode(encoded: &[u8]) -> Result<Vec<(String, ColumnState)>, AppError> {
        let count = u16::from_be_bytes(
            encoded
                .get(0..2)
                .and_then(|bytes| bytes.try_into().ok())
                .ok_or_else(malformed)?,
        ) as usize;

        let mut cursor = 2;
        let mut columns = Vec::with_capacity(count);

        for _ in 0..count {
            let name_len = *encoded.get(cursor).ok_or_else(malformed)? as usize;
            cursor += 1;

            let name = encoded
                .get(cursor..cursor + name_len)
                .ok_or_else(malformed)?;
            let name = std::str::from_utf8(name).map_err(|_| malformed())?.to_string();
            cursor += name_len;

            let hlc = encoded
                .get(cursor..cursor + HLC_LEN)
                .ok_or_else(malformed)?;
            let hlc = std::str::from_utf8(hlc).map_err(|_| malformed())?.to_string();
            cursor += HLC_LEN;

            let content_hash: [u8; CONTENT_HASH_LEN] = encoded
                .get(cursor..cursor + CONTENT_HASH_LEN)
                .and_then(|bytes| bytes.try_into().ok())
                .ok_or_else(malformed)?;
            cursor += CONTENT_HASH_LEN;

            columns.push((name, ColumnState { hlc, content_hash }));
        }

        if cursor != encoded.len() {
            return Err(malformed());
        }

        Ok(columns)
    }

    fn malformed() -> AppError {
        AppError::Database {
            message: "sync_field_state holds a malformed column map".to_string(),
        }
    }
}

/// Records which writes own which columns of ONE row (AD-5), merging them into its packed map.
///
/// One statement pair (read, upsert) per changed ROW rather than one write per changed COLUMN: the
/// columns of a change are always written together, and the per-column row was 7.9 ms of a
/// 1,000-row import (AD-19's latency gate, migration 033).
///
/// Unconditional on purpose: this is the LOCAL capture path, and `Clock::now` is strictly greater
/// than every stamp this install has produced or accepted, so a local write is by construction the
/// newest one. The `hlc >` comparison is [`field_state_accepts`], for `sync::apply` (Story 20),
/// where arrival order and message order genuinely differ.
pub fn upsert_field_states(
    conn: &Connection,
    table_name: &str,
    row_uuid: &[u8],
    updates: &[(String, ColumnState)],
) -> Result<(), AppError> {
    if updates.is_empty() {
        return Ok(());
    }

    let mut columns = read_columns(conn, table_name, row_uuid)?.unwrap_or_default();

    for (column, state) in updates {
        match columns.iter_mut().find(|(name, _)| name == column) {
            Some((_, existing)) => *existing = state.clone(),
            None => columns.push((column.clone(), state.clone())),
        }
    }

    conn.prepare_cached(
        "INSERT INTO sync_field_state (table_name, row_uuid, columns) VALUES (?1, ?2, ?3) \
         ON CONFLICT (table_name, row_uuid) DO UPDATE SET \
             columns = excluded.columns, updated_at = datetime('now')",
    )?
    .execute(params![table_name, row_uuid, packed::encode(&columns)])?;

    Ok(())
}

/// One column's state, or `None` when nothing owns it yet.
// Story 20 is the first production caller; Story 22's reconcile reads it per column too.
#[allow(dead_code)]
pub fn field_state(
    conn: &Connection,
    table_name: &str,
    row_uuid: &[u8],
    column_name: &str,
) -> Result<Option<ColumnState>, AppError> {
    Ok(read_columns(conn, table_name, row_uuid)?.and_then(|columns| {
        columns
            .into_iter()
            .find(|(name, _)| name == column_name)
            .map(|(_, state)| state)
    }))
}

/// AD-5's gate, as one call: does `hlc` beat whatever currently owns the column?
///
/// A column nothing owns accepts anything. The comparison is a plain string comparison because
/// Story 13 froze the encoding to be fixed-width, lowercase and ordered exactly like the clock, so
/// this is the HLC order with the install-id tiebreak included and no decoding at all.
// Story 20 is the first production caller: it is the per-field "apply or drop" decision.
#[allow(dead_code)]
pub fn field_state_accepts(
    conn: &Connection,
    table_name: &str,
    row_uuid: &[u8],
    column_name: &str,
    hlc: &str,
) -> Result<bool, AppError> {
    Ok(field_state(conn, table_name, row_uuid, column_name)?
        .is_none_or(|current| hlc > current.hlc.as_str()))
}

/// Every column a row currently has state for, sorted by name. Story 22's reconcile walks this.
// Story 22 is the first production caller.
#[allow(dead_code)]
pub fn field_state_columns(
    conn: &Connection,
    table_name: &str,
    row_uuid: &[u8],
) -> Result<Vec<(String, ColumnState)>, AppError> {
    Ok(read_columns(conn, table_name, row_uuid)?.unwrap_or_default())
}

fn read_columns(
    conn: &Connection,
    table_name: &str,
    row_uuid: &[u8],
) -> Result<Option<Vec<(String, ColumnState)>>, AppError> {
    use rusqlite::OptionalExtension;

    let packed: Option<Vec<u8>> = conn
        .prepare_cached(
            "SELECT columns FROM sync_field_state WHERE table_name = ?1 AND row_uuid = ?2",
        )?
        .query_row(params![table_name, row_uuid], |row| row.get(0))
        .optional()?;

    packed.map(|bytes| packed::decode(&bytes)).transpose()
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

/// The messages that have NOT been shipped yet, in insertion order.
///
/// What a test means by "what was just emitted": shipping marks a row with its `(seq, idx)` and
/// leaves it in the log — story 19 needs the history for the balance and counter folds — so the
/// whole log is not the same question.
#[cfg(test)]
pub(crate) fn unshipped_messages(conn: &Connection) -> Result<Vec<StoredMessage>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT install, hlc, kind, table_name, row_uuid, column_name, cause_uuid, payload \
         FROM sync_log WHERE seq IS NULL ORDER BY id",
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

/// Drops the merge state of a row that no longer exists.
///
/// A tombstone is absorbing per row uuid and AD-2 removes the identity mapping with it, so a
/// re-insert is a NEW identity: the old row's state can never be consulted again, and leaving it
/// would make reconcile (Story 22) compare hashes for a row that is gone.
pub fn forget_field_state(
    conn: &Connection,
    table_name: &str,
    row_uuid: &[u8],
) -> Result<usize, AppError> {
    Ok(conn
        .prepare_cached("DELETE FROM sync_field_state WHERE table_name = ?1 AND row_uuid = ?2")?
        .execute(params![table_name, row_uuid])?)
}

/// Drops the log rows that were never shipped, keeping every shipped one.
///
/// The one caller is an EXPLICIT CAP-5 "take the cloud copy" (replace, or answering the
/// remote-changed prompt with `load_remote`): the user chose to discard this computer's data, so
/// publishing its unsent changes over the copy they chose would partially undo that choice. The
/// discarded rows are not lost — the displaced file is kept as a dated backup. Shipped rows
/// (`seq IS NOT NULL`) STAY because `next_seq` is derived from them, and reusing a sequence
/// number would alias a message other computers already hold.
pub fn discard_unsent(conn: &Connection) -> Result<usize, AppError> {
    Ok(conn.execute("DELETE FROM sync_log WHERE seq IS NULL", [])?)
}

#[cfg(test)]
pub(crate) fn field_state_row_count(conn: &Connection) -> Result<i64, AppError> {
    Ok(conn.query_row("SELECT COUNT(*) FROM sync_field_state", [], |row| row.get(0))?)
}

/// How many COLUMNS have state across the whole database, which is what the per-column tests
/// counted before migration 033 collapsed the rows.
#[cfg(test)]
pub(crate) fn field_state_column_count(conn: &Connection) -> Result<usize, AppError> {
    let mut stmt = conn.prepare("SELECT columns FROM sync_field_state")?;
    let rows = stmt
        .query_map([], |row| row.get::<_, Vec<u8>>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    rows.iter()
        .map(|bytes| packed::decode(bytes).map(|columns| columns.len()))
        .sum()
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

#[cfg(test)]
mod tests {
    use super::*;

    fn state(hlc: &str, fill: u8) -> ColumnState {
        ColumnState {
            hlc: hlc.to_string(),
            content_hash: [fill; CONTENT_HASH_LEN],
        }
    }

    #[test]
    fn the_packed_map_round_trips_and_is_deterministic() {
        let columns = vec![
            ("sort_order".to_string(), state("0000000000000002-0123456789abcdef", 2)),
            ("name".to_string(), state("0000000000000001-0123456789abcdef", 1)),
        ];
        let encoded = packed::encode(&columns);

        let decoded = packed::decode(&encoded).expect("it decodes");
        assert_eq!(
            decoded
                .iter()
                .map(|(name, _)| name.as_str())
                .collect::<Vec<_>>(),
            vec!["name", "sort_order"],
            "sorted by name, so the same state always produces the same bytes"
        );
        assert_eq!(decoded[0].1, columns[1].1);
        assert_eq!(decoded[1].1, columns[0].1);

        let shuffled = vec![columns[1].clone(), columns[0].clone()];
        assert_eq!(packed::encode(&shuffled), encoded);
        assert_eq!(packed::encode(&[]), vec![0, 0]);
        assert_eq!(packed::decode(&[0, 0]).expect("empty decodes"), vec![]);
    }

    #[test]
    fn a_truncated_map_is_refused_rather_than_read_past_its_end() {
        let encoded = packed::encode(&[("name".to_string(), state("0000000000000001-0123456789abcdef", 1))]);

        for cut in 1..encoded.len() {
            assert!(
                packed::decode(&encoded[..cut]).is_err(),
                "a map cut at {cut} bytes must be refused"
            );
        }
        assert!(packed::decode(&[]).is_err());
    }

    #[test]
    fn an_entrys_install_is_the_second_half_of_its_hlc() {
        assert_eq!(
            state("0000000000000001-0123456789abcdef", 1).install(),
            "0123456789abcdef",
            "AD-4's tiebreak is already in the frozen encoding"
        );
    }
}
