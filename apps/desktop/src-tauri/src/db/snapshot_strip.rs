//! Every statement that shapes a snapshot COPY: what AD-9 keeps out of it, what Story 23 makes it
//! CARRY, and the watermark it ships with.
//!
//! It lives in `db/` because that is where this project keeps SQL; `sync/snapshot.rs` orchestrates
//! the copy and reports the counts. It is separate from `db/projects.rs` because the subject is the
//! snapshot file being prepared, not a project.

use std::collections::BTreeMap;

use rusqlite::{params, Connection};

use crate::error::AppError;

/// The `sync_*` tables a snapshot EMPTIES, named rather than discovered.
///
/// Milestone 1 emptied every `sync\_%` table, and Stories 20 and 22 proved that is wrong: a
/// computer bootstrapped without `sync_uuid` has no identity for the rows the snapshot carried, so
/// every message naming one of them parks forever and the startup reconcile mints fresh identities
/// and republishes the whole dataset. So the list is now a DENY list of the two tables that
/// describe THIS computer rather than the account:
///
/// - `sync_state` holds the install id, the machine fingerprint and the account pin. Carrying it
///   would put two machines in one `(install, seq)` space, which is the hazard AD-4 exists to stop.
/// - `sync_image_blobs` records which full images THIS computer has uploaded (AD-10).
///
/// Everything else travels: `sync_uuid`, `sync_field_state`, `sync_tombstone`,
/// `sync_applied_vector`, `sync_pending` and `sync_quarantine` are the account's merge state, and
/// the watermark below claims the segments that produced them.
pub const STRIPPED_SYNC_TABLES: &[&str] = &["sync_state", "sync_image_blobs"];

/// Message kinds dropped from the carried `sync_log`.
///
/// A `field`'s effect is in the row plus its `sync_field_state` entry and a `tombstone`'s is the
/// `sync_tombstone` row, so neither needs its message once the watermark claims it: nothing at or
/// below the watermark is ever delivered again, so there is no duplicate to recognise.
/// `counter_delta`, `balance_set` and `balance_delta` are NOT dropped — Story 20 made the log the
/// merge state for those two kinds (a counter is the sum of its recorded deltas, a balance is the
/// fold over its recorded messages), so dropping them would make the next re-fold lose every
/// pre-snapshot increment.
const DROPPED_LOG_KINDS: &[&str] = &["field", "tombstone"];

/// How many rows each part of the strip removed, so the caller can report and assert on it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StripCounts {
    pub local_only_tables: Vec<String>,
    pub carried_tables: Vec<String>,
    pub local_only_rows: usize,
    pub log_messages_dropped: usize,
    /// The highest segment the origin install had shipped, which the watermark now claims.
    pub own_head_seq: Option<i64>,
    pub config_keys: usize,
    pub blanked_images: usize,
}

/// LOAD-BEARING, and the reason the strip is not just a `DELETE`: freeing a page does not erase it.
/// Without this, the multi-megabyte image payloads and the local-only rows would still be sitting in
/// the copy's free pages, and the object uploaded to the cloud would carry every byte AD-9 and AD-10
/// say must not travel. `secure_delete` overwrites freed pages with zeros, which also makes them
/// compress away to nothing. It must be set outside a transaction, which is why it is its own call.
///
/// `VACUUM` would reclaim the pages instead, and is deliberately NOT used: it may renumber the
/// rowids of any table without an explicit `INTEGER PRIMARY KEY` (`config`, `sqlite_sequence`),
/// which is the very thing AD-9 forbids.
pub fn enable_secure_delete(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch("PRAGMA secure_delete=ON")?;

    Ok(())
}

/// Empties the two local-only `sync_*` tables, compacts the log, seeds the watermark with the
/// origin's own shipped head, and removes the denied `config` keys and the project image payloads —
/// all in one transaction.
///
/// `schema_version` is deliberately NOT emptied even though AD-5 classifies it `LocalOnly`. That
/// classification is about which rows become replication messages; a snapshot is a database FILE,
/// and one restored without its version row would have every migration re-applied over populated
/// tables the first time it was opened.
pub fn strip_local_only(conn: &Connection, config_keys: &[&str]) -> Result<StripCounts, AppError> {
    let tx = conn.unchecked_transaction()?;

    // Claimed BEFORE anything is deleted: dropping the `field` rows below would lower `MAX(seq)`
    // and the watermark would then claim less than the file actually holds.
    let mut counts = StripCounts {
        own_head_seq: claim_own_head(&tx)?,
        log_messages_dropped: tx.execute(
            "DELETE FROM sync_log WHERE seq IS NULL OR kind IN (?1, ?2)",
            params![DROPPED_LOG_KINDS[0], DROPPED_LOG_KINDS[1]],
        )?,
        ..StripCounts::default()
    };

    // Discovered from the copy's own schema rather than listed here, so a later `sync_*` table is
    // classified by the deny list above instead of being silently forgotten (AD-15 names them all
    // `sync_*`).
    let names: Vec<String> = {
        let mut tables = tx.prepare(
            "SELECT name FROM sqlite_master
             WHERE type = 'table' AND name LIKE 'sync\\_%' ESCAPE '\\' ORDER BY name",
        )?;
        let found = tables
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<_, _>>()?;
        found
    };

    for name in names {
        if STRIPPED_SYNC_TABLES.contains(&name.as_str()) {
            // The name comes from `sqlite_master`, never from user input, and is quoted regardless.
            counts.local_only_rows += tx.execute(&format!("DELETE FROM \"{name}\""), [])?;
            counts.local_only_tables.push(name);
        } else {
            counts.carried_tables.push(name);
        }
    }

    for key in config_keys {
        counts.config_keys += tx.execute("DELETE FROM config WHERE key = ?1", [key])?;
    }

    counts.blanked_images = crate::db::projects::blank_project_image_bytes(&tx)?;

    tx.commit()?;

    Ok(counts)
}

/// Writes the origin install's own shipped head into `sync_applied_vector`.
///
/// AD-9 says a snapshot's watermark is "the copy's own `sync_applied_vector`, never read
/// separately". That vector records what the origin applied from OTHER installs; its own shipped
/// messages are in the file too and are claimed by nothing. Without this row a bootstrapped
/// computer would re-download the origin's entire log just to recognise every message as a
/// duplicate, and a retention sweep could never drop the origin's own segments.
fn claim_own_head(tx: &Connection) -> Result<Option<i64>, AppError> {
    let install: Option<String> = tx
        .query_row("SELECT install_id FROM sync_state WHERE id = 1", [], |row| {
            row.get(0)
        })
        .ok();
    let Some(install) = install else {
        return Ok(None);
    };

    let head: Option<i64> = tx.query_row(
        "SELECT MAX(seq) FROM sync_log WHERE install = ?1 AND seq IS NOT NULL",
        params![&install],
        |row| row.get(0),
    )?;
    let Some(head) = head else {
        return Ok(None);
    };

    let offset: i64 = tx.query_row(
        "SELECT COUNT(*) FROM sync_log WHERE install = ?1 AND seq = ?2",
        params![&install, head],
        |row| row.get(0),
    )?;

    tx.execute(
        "INSERT INTO sync_applied_vector (install, seq, applied_offset)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(install) DO UPDATE SET
             seq = MAX(seq, excluded.seq),
             applied_offset = excluded.applied_offset",
        params![&install, head, offset],
    )?;

    Ok(Some(head))
}

/// The watermark a snapshot ships with: every install and the highest segment of it the file holds.
pub fn read_watermark(conn: &Connection) -> Result<BTreeMap<String, i64>, AppError> {
    let mut statement = conn.prepare("SELECT install, seq FROM sync_applied_vector")?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?
        .collect::<Result<BTreeMap<String, i64>, _>>()?;

    Ok(rows)
}

/// How much of the log is NOT covered by `watermark` — AD-9's "the tail exceeds 2 MB or 5,000
/// messages" trigger, measured locally.
///
/// Story 20 records every applied remote message in `sync_log` under its origin `(install, seq)`,
/// and capture writes every local one, so the local log is a complete statement of the tail and the
/// trigger needs no request to evaluate.
pub fn tail_since_watermark(
    conn: &Connection,
    watermark: &BTreeMap<String, i64>,
) -> Result<(u64, u64), AppError> {
    let mut statement = conn.prepare(
        "SELECT install, COALESCE(seq, -1), COUNT(*), COALESCE(SUM(LENGTH(payload)), 0)
         FROM sync_log GROUP BY install, COALESCE(seq, -1)",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut messages = 0u64;
    let mut bytes = 0u64;
    for (install, seq, count, payload_bytes) in rows {
        let covered = watermark
            .get(&install)
            .is_some_and(|claimed| seq >= 0 && seq <= *claimed);
        if !covered {
            messages += count.max(0) as u64;
            bytes += payload_bytes.max(0) as u64;
        }
    }

    Ok((messages, bytes))
}
