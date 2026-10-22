//! The two `config` keys that carry a wipe across it (story wipe-epoch).
//!
//! Both are LOCAL-ONLY (`db::config::LOCAL_ONLY_KEYS`), which is three properties in one
//! statement: capture never emits a message for them, a snapshot is stripped of them before it is
//! uploaded, and `db::backup::carry_local_only` carries them back when a snapshot is restored over
//! this computer's file. That is exactly what a wipe needs — the epoch this computer runs at is a
//! fact about THIS computer, and it has to survive the one operation that replaces the whole file.
//!
//! They live in `config` rather than in `sync_state` for one reason: `config` is in
//! `danger_zone::PRESERVED_TABLES`, so a wipe cannot delete them. `sync_state` is
//! `WIPE_TABLES[0]` — deleting it IS the Unlinked state (AD-15) — so an epoch kept there would be
//! erased by the very act it exists to record.
//!
//! All of the SQL goes through `db::config`, so there is one `config` reader and one writer.

use rusqlite::Connection;

use crate::db::config;
use crate::error::AppError;

/// How many wipes THIS dataset has adopted, as a decimal string. Absent means none.
pub const WIPE_EPOCH_KEY: &str = "sync_wipe_epoch";

/// The install id this dataset had when a wipe was performed and could not be registered with the
/// cloud yet (offline, signed out, throttled). Absent means there is nothing owed.
///
/// It holds the OLD INSTALL ID rather than a bare flag so that a wipe-then-wipe and a crash in
/// between are never ambiguous: the value names the install whose data the pending event is about,
/// which is the one thing a bare `"1"` could not tell apart from a second wipe of the file the
/// first one produced.
pub const WIPE_PENDING_KEY: &str = "sync_wipe_pending";

/// The epoch this dataset runs at. An absent key is 0 — an account that has never been wiped.
///
/// A value that is not a decimal number is an ERROR and never 0: reading a damaged epoch as "never
/// wiped" is precisely how a computer would decide it had to wipe itself, so the honest answer is a
/// fault the cycle backs off from.
pub fn local_epoch(conn: &Connection) -> Result<u64, AppError> {
    let Some(raw) = config::get(conn, WIPE_EPOCH_KEY) else {
        return Ok(0);
    };

    raw.trim().parse::<u64>().map_err(|_| AppError::Database {
        message: "config.sync_wipe_epoch holds a value that is not a wipe epoch".to_string(),
    })
}

/// Records the epoch this dataset now runs at.
///
/// Monotonic by assertion rather than by hope: every caller is either adopting a cloud epoch that
/// is already greater or storing the one `wipe::register` just minted, so a lower value means a
/// caller got the order wrong and is refused instead of quietly re-opening the window the epoch
/// closes.
pub fn set_local_epoch(conn: &Connection, epoch: u64) -> Result<(), AppError> {
    if epoch < local_epoch(conn)? {
        return Err(AppError::Database {
            message: "a wipe epoch may only ever move forward".to_string(),
        });
    }

    config::set(conn, WIPE_EPOCH_KEY, &epoch.to_string())
}

/// The install id of a wipe this computer performed and has not registered with the cloud yet.
pub fn pending_wipe(conn: &Connection) -> Result<Option<String>, AppError> {
    Ok(config::get(conn, WIPE_PENDING_KEY))
}

/// Records that a wipe happened here and still owes the account its event.
///
/// Written INSIDE the same transaction as `danger_zone::wipe_all`, which is the whole point: there
/// must be no crash window in which the data is gone and the intent to tell the other computers
/// about it is not.
pub fn set_pending_wipe(conn: &Connection, install_id: &str) -> Result<(), AppError> {
    config::set(conn, WIPE_PENDING_KEY, install_id)
}

/// Clears it, once the event has actually been registered. Idempotent.
pub fn clear_pending_wipe(conn: &Connection) -> Result<(), AppError> {
    config::delete(conn, WIPE_PENDING_KEY).map_err(AppError::from)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::run_migrations;

    fn migrated_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch("PRAGMA foreign_keys=ON;")
            .expect("enable fks");
        run_migrations(&conn).expect("run migrations");

        conn
    }

    #[test]
    fn an_absent_epoch_is_zero_and_a_stored_one_round_trips() {
        let conn = migrated_db();

        assert_eq!(local_epoch(&conn).expect("absent reads"), 0);

        set_local_epoch(&conn, 3).expect("the epoch stores");
        assert_eq!(local_epoch(&conn).expect("stored reads"), 3);

        set_local_epoch(&conn, 3).expect("re-storing the same epoch is success");
        set_local_epoch(&conn, 4).expect("moving forward is success");
        assert_eq!(local_epoch(&conn).expect("stored reads"), 4);
    }

    #[test]
    fn an_epoch_may_not_move_backwards() {
        let conn = migrated_db();
        set_local_epoch(&conn, 5).expect("the epoch stores");

        assert!(
            set_local_epoch(&conn, 4).is_err(),
            "a lower epoch would re-open the window the epoch exists to close"
        );
        assert_eq!(local_epoch(&conn).expect("unchanged"), 5);
    }

    #[test]
    fn a_damaged_epoch_is_an_error_rather_than_a_zero() {
        let conn = migrated_db();
        config::set(&conn, WIPE_EPOCH_KEY, "tomorrow").expect("store a damaged value");

        assert!(
            local_epoch(&conn).is_err(),
            "reading a damaged epoch as 0 would make this computer wipe itself"
        );
    }

    #[test]
    fn the_pending_marker_holds_the_old_install_id_and_clears_idempotently() {
        let conn = migrated_db();

        assert_eq!(pending_wipe(&conn).expect("absent reads"), None);

        set_pending_wipe(&conn, "0123456789abcdef").expect("the marker stores");
        assert_eq!(
            pending_wipe(&conn).expect("stored reads").as_deref(),
            Some("0123456789abcdef")
        );

        clear_pending_wipe(&conn).expect("the marker clears");
        clear_pending_wipe(&conn).expect("clearing an absent marker is a no-op");
        assert_eq!(pending_wipe(&conn).expect("absent reads"), None);
    }

    /// Both keys must be deny-listed, or the epoch would travel to every other computer as an
    /// ordinary setting and the pending marker would make THEM register a wipe of their own.
    #[test]
    fn both_keys_are_local_only() {
        for key in [WIPE_EPOCH_KEY, WIPE_PENDING_KEY] {
            assert!(
                config::LOCAL_ONLY_KEYS.contains(&key),
                "{key} must never travel between computers"
            );
        }
    }

    /// `config` survives the wipe, which is what lets the epoch be stored in the same transaction
    /// that empties every data table.
    #[test]
    fn the_epoch_and_the_pending_marker_survive_a_wipe() {
        let conn = migrated_db();
        let tx = rusqlite::Transaction::new_unchecked(
            &conn,
            rusqlite::TransactionBehavior::Immediate,
        )
        .expect("begin");
        crate::db::danger_zone::wipe_all(&tx).expect("the wipe succeeds");
        set_local_epoch(&tx, 2).expect("the epoch stores inside the wipe transaction");
        set_pending_wipe(&tx, "0123456789abcdef").expect("the marker stores with it");
        tx.commit().expect("commit");

        assert_eq!(local_epoch(&conn).expect("reads"), 2);
        assert_eq!(
            pending_wipe(&conn).expect("reads").as_deref(),
            Some("0123456789abcdef")
        );
    }
}
