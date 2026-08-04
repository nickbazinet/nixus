use std::path::{Path, PathBuf};

use rusqlite::Connection;
use tracing::{error, warn};

use crate::db::open_configured;
use crate::error::AppError;

const SAFETY_COPY_SUFFIX: &str = ".pre-restore";

/// Replaces the database at `db_path` with `backup_path` and leaves `slot` holding a
/// freshly configured connection to the restored file.
///
/// The live connection is *dropped* rather than merely checkpointed: `wal_checkpoint`
/// empties the `-wal` but leaves it and the `-shm` wal-index on disk and mapped into
/// memory. SQLite only unlinks them when the last connection closes cleanly. Overwrite
/// the database file while a stale `-shm` survives and the next connection attaches a
/// wal-index describing the *previous* file's pages, which SQLite reports as
/// "database disk image is malformed".
///
/// On any failure the pre-restore file is put back and `slot` is repointed at it, so the
/// user can keep working without restarting the app.
pub fn restore_from_file(
    slot: &mut Connection,
    db_path: &Path,
    backup_path: &Path,
) -> Result<(), AppError> {
    // Best-effort only: dropping the connection below checkpoints anyway, so a failure
    // here (a corrupt sidecar, for instance) must not block the restore.
    if let Err(e) = slot.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)") {
        warn!("Pre-restore WAL checkpoint failed, continuing: {}", e);
    }

    let safety_path = with_suffix(db_path, SAFETY_COPY_SUFFIX);

    let placeholder = Connection::open_in_memory()?;
    let old = std::mem::replace(slot, placeholder);
    drop(old);

    remove_sidecars(db_path);

    std::fs::copy(db_path, &safety_path).map_err(|e| {
        roll_back(
            slot,
            db_path,
            &safety_path,
            AppError::File {
                message: format!("Failed to create safety copy: {}", e),
            },
        )
    })?;

    std::fs::copy(backup_path, db_path).map_err(|e| {
        roll_back(
            slot,
            db_path,
            &safety_path,
            AppError::File {
                message: format!("Failed to restore database: {}", e),
            },
        )
    })?;

    remove_sidecars(db_path);

    let restored =
        open_configured(db_path).map_err(|e| roll_back(slot, db_path, &safety_path, e))?;
    *slot = restored;

    if let Err(e) = std::fs::remove_file(&safety_path) {
        warn!("Failed to remove safety copy {:?}: {}", safety_path, e);
    }

    Ok(())
}

/// Puts the pre-restore database back and returns `cause` unchanged — the caller needs the
/// original failure, not whatever went wrong while recovering from it.
///
/// `slot` still holds the in-memory placeholder at this point, so reopening a real
/// connection is mandatory: leaving the placeholder would have the app silently reading
/// and writing an empty database.
fn roll_back(
    slot: &mut Connection,
    db_path: &Path,
    safety_path: &Path,
    cause: AppError,
) -> AppError {
    // A failure creating the safety copy leaves nothing to put back, and `db_path` is
    // still untouched in that case.
    if safety_path.exists() {
        if let Err(e) = std::fs::copy(safety_path, db_path) {
            error!("Failed to put the pre-restore database back: {}", e);
        }
    }

    remove_sidecars(db_path);

    match open_configured(db_path) {
        Ok(conn) => *slot = conn,
        Err(e) => error!("Failed to reopen the database after rollback: {}", e),
    }

    if let Err(e) = std::fs::remove_file(safety_path) {
        if e.kind() != std::io::ErrorKind::NotFound {
            warn!("Failed to remove safety copy {:?}: {}", safety_path, e);
        }
    }

    cause
}

fn remove_sidecars(db_path: &Path) {
    for suffix in ["-wal", "-shm"] {
        let sidecar = with_suffix(db_path, suffix);
        if let Err(e) = std::fs::remove_file(&sidecar) {
            if e.kind() != std::io::ErrorKind::NotFound {
                warn!("Failed to remove sidecar {:?}: {}", sidecar, e);
            }
        }
    }
}

/// Appends to the file name rather than replacing the extension, so `nkbaz-finance.db`
/// yields `nkbaz-finance.db-wal` — the exact names SQLite uses.
fn with_suffix(db_path: &Path, suffix: &str) -> PathBuf {
    let mut name = db_path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{run_migrations, MIGRATIONS};
    use tempfile::TempDir;

    fn latest_version() -> i64 {
        MIGRATIONS
            .last()
            .map(|(version, _)| *version)
            .expect("migrations are not empty")
    }

    fn open_live_db(path: &Path) -> Connection {
        let conn = Connection::open(path).expect("open file db");
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .expect("set pragmas");
        run_migrations(&conn).expect("run migrations");
        conn
    }

    fn open_db_at_version(path: &Path, max_version: i64) -> Connection {
        let conn = Connection::open(path).expect("open file db");
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .expect("set pragmas");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            )",
        )
        .expect("create schema_version");

        for (version, sql) in MIGRATIONS.iter().filter(|(v, _)| *v <= max_version) {
            conn.execute_batch(sql).expect("apply migration");
            conn.execute(
                "INSERT INTO schema_version (version, applied_at) VALUES (?1, datetime('now'))",
                rusqlite::params![version],
            )
            .expect("record migration");
        }

        conn
    }

    fn seed_marker(conn: &Connection, marker: &str) {
        conn.execute(
            "INSERT INTO budget_groups (id, name) VALUES (1, ?1)",
            [marker],
        )
        .expect("seed budget group");
    }

    fn read_marker(conn: &Connection) -> String {
        conn.query_row("SELECT name FROM budget_groups WHERE id = 1", [], |r| {
            r.get(0)
        })
        .expect("read budget group")
    }

    #[test]
    fn restore_replaces_data_and_cleans_up() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("nkbaz-finance.db");
        let backup_path = dir.path().join("backup.db");

        let mut slot = open_live_db(&db_path);
        seed_marker(&slot, "live");

        {
            let backup = open_live_db(&backup_path);
            seed_marker(&backup, "backup");
        }

        restore_from_file(&mut slot, &db_path, &backup_path).expect("restore succeeds");

        assert_eq!(read_marker(&slot), "backup");
        assert!(
            !with_suffix(&db_path, SAFETY_COPY_SUFFIX).exists(),
            "safety copy must be deleted on success"
        );
    }

    /// Regression test for "database disk image is malformed": sidecars left behind by the
    /// previous database must never reach the reopened connection.
    #[test]
    fn restore_succeeds_with_stale_sidecars_present() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("nkbaz-finance.db");
        let backup_path = dir.path().join("backup.db");

        let mut slot = open_live_db(&db_path);
        seed_marker(&slot, "live");

        {
            let backup = open_live_db(&backup_path);
            seed_marker(&backup, "backup");
        }

        std::fs::write(with_suffix(&db_path, "-wal"), b"bogus wal contents")
            .expect("write bogus wal");
        std::fs::write(with_suffix(&db_path, "-shm"), b"bogus shm contents")
            .expect("write bogus shm");

        restore_from_file(&mut slot, &db_path, &backup_path).expect("restore succeeds");

        assert_eq!(read_marker(&slot), "backup");
    }

    #[test]
    fn restore_forward_migrates_older_backup() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("nkbaz-finance.db");
        let backup_path = dir.path().join("backup-v18.db");

        let mut slot = open_live_db(&db_path);
        seed_marker(&slot, "live");

        {
            let backup = open_db_at_version(&backup_path, 18);
            seed_marker(&backup, "backup");
            let version: i64 = backup
                .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
                .expect("read backup schema version");
            assert_eq!(version, 18, "fixture must start at v18");
        }

        restore_from_file(&mut slot, &db_path, &backup_path).expect("restore succeeds");

        let version: i64 = slot
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .expect("read restored schema version");
        assert_eq!(version, latest_version());
        assert_eq!(read_marker(&slot), "backup");
    }

    #[test]
    fn restore_rolls_back_when_backup_is_unreadable() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("nkbaz-finance.db");
        let missing_path = dir.path().join("does-not-exist.db");

        let mut slot = open_live_db(&db_path);
        seed_marker(&slot, "live");

        let err = restore_from_file(&mut slot, &db_path, &missing_path)
            .expect_err("restore must fail");
        assert!(matches!(err, AppError::File { .. }), "got {:?}", err);

        assert_eq!(read_marker(&slot), "live");
        assert!(
            !with_suffix(&db_path, SAFETY_COPY_SUFFIX).exists(),
            "safety copy must be deleted on failure"
        );
    }

    #[test]
    fn restore_leaves_working_connection_when_restored_file_is_invalid() {
        let dir = TempDir::new().expect("temp dir");
        let db_path = dir.path().join("nkbaz-finance.db");
        let garbage_path = dir.path().join("garbage.db");
        std::fs::write(&garbage_path, b"this is not a sqlite database at all")
            .expect("write garbage file");

        let mut slot = open_live_db(&db_path);
        seed_marker(&slot, "live");

        let err = restore_from_file(&mut slot, &db_path, &garbage_path)
            .expect_err("restore must fail");
        assert!(matches!(err, AppError::Database { .. }), "got {:?}", err);

        assert_eq!(read_marker(&slot), "live");
        assert!(
            !with_suffix(&db_path, SAFETY_COPY_SUFFIX).exists(),
            "safety copy must be deleted on failure"
        );
    }
}
