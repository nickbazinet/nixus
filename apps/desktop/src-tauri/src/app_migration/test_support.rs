//! Fixtures shared by this module's test files.

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use tempfile::TempDir;

use super::{migrate_from_legacy_identity, MigrationOutcome};
use crate::datasets::LEGACY_DB_FILE_NAME;
use crate::error::AppError;

/// The directory name the new root is created under in every fixture. Only its
/// *siblinghood* with the legacy root matters, which `legacy_beside` derives.
pub(super) const NEW_ROOT_DIR: &str = "org.nixusapp.nixus";

pub(super) fn legacy_beside(root: &Path) -> PathBuf {
    crate::datasets::legacy_root_beside(root).expect("the fixture root has a parent")
}

/// A parent directory plus the not-yet-existing new root inside it, which is the
/// state `.setup()` actually hands the migration on a first launch.
pub(super) fn fixture_root() -> (TempDir, PathBuf) {
    let parent = TempDir::new().expect("temp dir");
    let root = parent.path().join(NEW_ROOT_DIR);
    (parent, root)
}

/// A real WAL-mode database with one readable marker row, so a lost checkpoint or
/// a truncated rename is visible as missing data rather than as a missing file.
pub(super) fn seed_legacy_db(dir: &Path, marker: &str) -> PathBuf {
    std::fs::create_dir_all(dir).expect("dataset dir");
    let path = dir.join(LEGACY_DB_FILE_NAME);
    let conn = Connection::open(&path).expect("open");
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE marker (value TEXT);",
    )
    .expect("schema");
    conn.execute("INSERT INTO marker (value) VALUES (?1)", [marker])
        .expect("seed");
    conn.close().expect("close");
    path
}

pub(super) fn marker(db_path: &Path) -> String {
    let conn = Connection::open(db_path).expect("open");
    let value = conn
        .query_row("SELECT value FROM marker", [], |row| row.get(0))
        .expect("marker readable");
    conn.close().expect("close");
    value
}

pub(super) fn row_count(db_path: &Path) -> i64 {
    let conn = Connection::open(db_path).expect("open");
    let count = conn
        .query_row("SELECT COUNT(*) FROM marker", [], |row| row.get(0))
        .expect("count readable");
    conn.close().expect("close");
    count
}

/// Drives the migration exactly as `.setup()` does: the legacy root is always the
/// sibling derived from the new root, never a hand-picked path.
pub(super) fn migrate(root: &Path) -> Result<MigrationOutcome, AppError> {
    migrate_from_legacy_identity(root, Some(&legacy_beside(root)))
}
