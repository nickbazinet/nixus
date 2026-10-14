use rusqlite::Connection;

use crate::error::AppError;
use crate::sync::{capture, identity};

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

// CAPTURE-SANCTIONED (AD-3): every caller reaches this through `ActiveDataset::write`.
//
// `config` is `Natural` (AD-2), so the derived identity is bound HERE rather than left to capture:
// minting a random uuid for a setting would give the same key a different identity on every
// computer and split one setting into several. Capture fails the whole write for a `Natural` row
// with no mapping, which is what makes forgetting this loud rather than silent.
pub fn set(conn: &Connection, key: &str, value: &str) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO config (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )?;
    bind_identity(conn, key)
}

/// Removes a key so `get` reports it as never-set again. Idempotent: deleting an absent key is a
/// no-op, which is what lets a "clear my override" command be safely retried.
// CAPTURE-SANCTIONED (AD-3): every caller reaches this through `ActiveDataset::write`.
pub fn delete(conn: &Connection, key: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM config WHERE key = ?1",
        rusqlite::params![key],
    )?;
    Ok(())
}

/// Binds `config(key)`'s derived identity, for the keys that travel.
///
/// Skipped for a deny-listed key and when nothing is capturing, so neither a local-only profile nor
/// a credential-state setting ever grows a `sync_uuid` row (AD-5, inherited AD-12). Capture applies
/// the same deny list to the row itself, so the two cannot disagree about which keys travel.
fn bind_identity(conn: &Connection, key: &str) -> Result<(), AppError> {
    if !capture::is_capturing() || LOCAL_ONLY_KEYS.contains(&key) {
        return Ok(());
    }

    let row_id: i64 = conn.query_row(
        "SELECT rowid FROM config WHERE key = ?1",
        rusqlite::params![key],
        |row| row.get(0),
    )?;
    let derived = identity::config_key(key);

    let mapping = identity::ensure_derived(conn, "config", row_id, &derived)?;
    if mapping.row_id != row_id {
        tracing::warn!("A config key's identity already belongs to another local row");
    }

    Ok(())
}
