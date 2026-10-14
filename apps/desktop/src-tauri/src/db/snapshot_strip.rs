//! Every statement that empties a snapshot COPY of what AD-9 and AD-15 keep out of it.
//!
//! It lives in `db/` because that is where this project keeps SQL; `sync/snapshot.rs` orchestrates
//! the copy and reports the counts. It is separate from `db/projects.rs` because the subject is the
//! snapshot file being prepared, not a project.

use rusqlite::Connection;

use crate::error::AppError;

/// How many rows each part of the strip removed, so the caller can report and assert on it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StripCounts {
    pub local_only_tables: Vec<String>,
    pub local_only_rows: usize,
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

/// Empties the local-only tables, the denied `config` keys and the project image payloads, in one
/// transaction.
///
/// `schema_version` is deliberately NOT emptied even though AD-5 classifies it `LocalOnly`. That
/// classification is about which rows become replication messages; a snapshot is a database FILE,
/// and one restored without its version row would have every migration re-applied over populated
/// tables the first time it was opened.
pub fn strip_local_only(conn: &Connection, config_keys: &[&str]) -> Result<StripCounts, AppError> {
    let tx = conn.unchecked_transaction()?;
    let mut counts = StripCounts::default();

    // Discovered from the copy's own schema rather than listed here: `sync_log` and the rest of the
    // Milestone-2 tables do not exist yet, and a hard-coded list would either fail on the missing
    // ones now or silently miss the new ones later (AD-15 names them all `sync_*`).
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
        // The name comes from `sqlite_master`, never from user input, and is quoted regardless.
        counts.local_only_rows += tx.execute(&format!("DELETE FROM \"{name}\""), [])?;
        counts.local_only_tables.push(name);
    }

    for key in config_keys {
        counts.config_keys += tx.execute("DELETE FROM config WHERE key = ?1", [key])?;
    }

    counts.blanked_images = crate::db::projects::blank_project_image_bytes(&tx)?;

    tx.commit()?;

    Ok(counts)
}
