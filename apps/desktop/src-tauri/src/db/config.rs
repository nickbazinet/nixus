use rusqlite::Connection;

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
