use rusqlite::Connection;

/// The `config` keys that describe THIS computer's credential state and therefore never
/// travel between computers (AD-5's deny list). Everything else in `config` is the user's
/// own setting and syncs.
///
/// One source of truth for both halves of the round trip: `sync::snapshot` empties them
/// from the copy it uploads, and `db::backup` carries them back from the safety copy when
/// a snapshot is restored over this computer's file.
pub(crate) const LOCAL_ONLY_KEYS: &[&str] = &["ai_configured", "ai_provider", "aws_region"];

pub fn get(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM config WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get(0),
    )
    .ok()
}

pub fn set(conn: &Connection, key: &str, value: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO config (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

/// Removes a key so `get` reports it as never-set again. Idempotent: deleting an absent key is a
/// no-op, which is what lets a "clear my override" command be safely retried.
pub fn delete(conn: &Connection, key: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM config WHERE key = ?1",
        rusqlite::params![key],
    )?;
    Ok(())
}
