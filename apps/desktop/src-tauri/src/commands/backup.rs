use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tracing::info;

use crate::datasets;
use crate::db::DbState;
use crate::error::AppError;

const DB_FILE_NAME: &str = "nkbaz-finance.db";

#[derive(Serialize)]
pub struct BackupResult {
    pub path: String,
}

fn dataset_db_path(root: &Path, id: &str) -> PathBuf {
    datasets::dataset_dir_from_root(root, id).join(DB_FILE_NAME)
}

// A restore source that lives inside the app data root is only safe when it
// belongs to the active dataset: `source == target` makes the copy truncate the
// live database it is reading from, and any other dataset's file drags another
// profile's data into this one. Files picked from outside the root carry neither
// hazard. Every path must already be canonicalized against the same root.
fn is_restorable_source(
    source: &Path,
    target: &Path,
    global_root: &Path,
    active_dataset_dir: &Path,
) -> bool {
    if source == target {
        return false;
    }
    if !source.starts_with(global_root) {
        return true;
    }
    if !source.starts_with(active_dataset_dir) {
        return false;
    }
    // Default's dataset directory *is* the root, so the check above admits the
    // sibling datasets nested beneath it.
    !(active_dataset_dir == global_root && source.starts_with(global_root.join("datasets")))
}

#[tauri::command]
pub async fn export_backup(app_handle: AppHandle) -> Result<Option<BackupResult>, AppError> {
    let db_state = app_handle.state::<DbState>();
    let root = datasets::global_root(&app_handle)?;

    // The WAL checkpoint and the path resolution share one guard on purpose: the
    // id must come from the same `ActiveDataset` as the connection just flushed,
    // or a dataset switch between the two steps would export a sibling's file.
    let db_path = {
        let active = db_state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
        let id = active.id.as_deref().ok_or(AppError::NotConfigured)?;
        dataset_db_path(&root, id)
    };

    // Show native save dialog
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let default_name = format!("nkbaz-finance-backup-{}.db", today);

    let file_path = app_handle
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter("SQLite Database", &["db"])
        .blocking_save_file();

    let save_path = match file_path {
        Some(p) => p.as_path().map(|p| p.to_path_buf()),
        None => return Ok(None), // User cancelled
    };

    let save_path = match save_path {
        Some(p) => p,
        None => return Ok(None),
    };

    // Copy the database file
    std::fs::copy(&db_path, &save_path).map_err(|e| AppError::File {
        message: format!("Failed to copy database: {}", e),
    })?;

    let path_str = save_path.to_string_lossy().to_string();
    info!("Database backup exported to {}", path_str);

    Ok(Some(BackupResult { path: path_str }))
}

#[tauri::command]
pub async fn import_backup(app_handle: AppHandle) -> Result<bool, AppError> {
    // Show native open dialog
    let file_path = app_handle
        .dialog()
        .file()
        .add_filter("SQLite Database", &["db"])
        .blocking_pick_file();

    let selected_path = match file_path {
        Some(p) => p.as_path().map(|p| p.to_path_buf()),
        None => return Ok(false), // User cancelled
    };

    let selected_path = match selected_path {
        Some(p) => p,
        None => return Ok(false),
    };

    // Validate the backup file
    validate_backup_file(&selected_path)?;

    let root = datasets::global_root(&app_handle)?;
    let root = root.canonicalize().unwrap_or(root);

    let source = selected_path.canonicalize().map_err(|e| AppError::File {
        message: format!("Cannot read backup file: {}", e),
    })?;

    let db_state = app_handle.state::<DbState>();
    let mut active = db_state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    // Same guard as the connection being replaced, for the same reason as
    // `export_backup`: a restore must never be able to overwrite a sibling
    // dataset's database because a switch landed after the path was resolved.
    let active_dir =
        datasets::dataset_dir_from_root(&root, active.id.as_deref().ok_or(AppError::NotConfigured)?);
    let db_path = active_dir.join(DB_FILE_NAME);

    if !is_restorable_source(&source, &db_path, &root, &active_dir) {
        return Err(AppError::File {
            message: "Cannot restore from a file inside another profile's data".to_string(),
        });
    }

    let conn = active.conn.as_mut().ok_or(AppError::NotConfigured)?;

    crate::db::backup::restore_from_file(&mut *conn, &db_path, &source)?;

    info!("Database restored from {}", selected_path.display());

    Ok(true)
}

pub fn validate_backup_file(path: &PathBuf) -> Result<(), AppError> {
    // Check file exists and is readable
    if !path.exists() {
        return Err(AppError::File {
            message: "Invalid backup file".to_string(),
        });
    }

    // Try to open as SQLite database
    let conn = Connection::open(path).map_err(|_| AppError::File {
        message: "Invalid backup file".to_string(),
    })?;

    // Run integrity check
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|_| AppError::File {
            message: "Invalid backup file".to_string(),
        })?;

    if integrity != "ok" {
        return Err(AppError::File {
            message: "Invalid backup file".to_string(),
        });
    }

    // Verify it has expected tables
    let has_budget_groups: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='budget_groups'",
            [],
            |row| row.get(0),
        )
        .map_err(|_| AppError::File {
            message: "Invalid backup file".to_string(),
        })?;

    if !has_budget_groups {
        return Err(AppError::File {
            message: "Invalid backup file".to_string(),
        });
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::{NamedTempFile, TempDir};

    fn create_valid_test_db() -> NamedTempFile {
        let tmp = NamedTempFile::new().unwrap();
        let conn = Connection::open(tmp.path()).unwrap();
        conn.execute_batch(
            "CREATE TABLE budget_groups (id INTEGER PRIMARY KEY, name TEXT);
             CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at TEXT);"
        ).unwrap();
        tmp
    }

    #[test]
    fn test_integrity_check_passes_on_valid_sqlite_db() {
        let tmp = create_valid_test_db();
        let result = validate_backup_file(&tmp.path().to_path_buf());
        assert!(result.is_ok());
    }

    #[test]
    fn test_integrity_check_fails_on_non_sqlite_file() {
        let mut tmp = NamedTempFile::new().unwrap();
        tmp.write_all(b"this is not a sqlite database").unwrap();
        let result = validate_backup_file(&tmp.path().to_path_buf());
        assert!(result.is_err());
    }

    #[test]
    fn test_integrity_check_fails_on_truncated_file() {
        let mut tmp = NamedTempFile::new().unwrap();
        // Write partial SQLite header
        tmp.write_all(b"SQLite format 3\0").unwrap();
        tmp.write_all(&[0u8; 50]).unwrap();
        let result = validate_backup_file(&tmp.path().to_path_buf());
        assert!(result.is_err());
    }

    #[test]
    fn test_integrity_check_fails_on_db_without_expected_tables() {
        let tmp = NamedTempFile::new().unwrap();
        let conn = Connection::open(tmp.path()).unwrap();
        conn.execute_batch("CREATE TABLE some_other_table (id INTEGER PRIMARY KEY);")
            .unwrap();
        let result = validate_backup_file(&tmp.path().to_path_buf());
        assert!(result.is_err());
    }

    #[test]
    fn test_backup_copy_produces_identical_file() {
        let tmp = create_valid_test_db();
        let dest = NamedTempFile::new().unwrap();
        std::fs::copy(tmp.path(), dest.path()).unwrap();

        let original = std::fs::read(tmp.path()).unwrap();
        let copied = std::fs::read(dest.path()).unwrap();
        assert_eq!(original, copied);
    }

    #[test]
    fn default_dataset_backs_up_the_database_at_the_root() {
        let root = Path::new("/app-data");

        assert_eq!(
            dataset_db_path(root, "default"),
            root.join("nkbaz-finance.db")
        );
    }

    #[test]
    fn non_default_dataset_backs_up_its_own_nested_database() {
        let root = Path::new("/app-data");

        assert_eq!(
            dataset_db_path(root, "profile-b"),
            root.join("datasets").join("profile-b").join("nkbaz-finance.db")
        );
    }

    // Two ids, one root: the paths must not collide, or an export while B is
    // active could hand back A's database.
    #[test]
    fn two_datasets_never_resolve_to_the_same_database_file() {
        let root = Path::new("/app-data");

        assert_ne!(
            dataset_db_path(root, "default"),
            dataset_db_path(root, "profile-b")
        );
        assert_ne!(
            dataset_db_path(root, "profile-a"),
            dataset_db_path(root, "profile-b")
        );
    }

    // Pins the one literal this module and `init_db` must agree on: if either
    // side renames the database file, the backup target stops existing.
    #[test]
    fn dataset_db_path_matches_the_file_init_db_creates() {
        let root = TempDir::new().unwrap();

        for id in ["default", "profile-b"] {
            let dir = datasets::dataset_dir_from_root(root.path(), id);
            drop(crate::db::init_db(&dir).unwrap());

            assert!(dataset_db_path(root.path(), id).is_file(), "id {}", id);
        }
    }

    #[test]
    fn restoring_a_dataset_over_itself_is_rejected() {
        let root = Path::new("/app-data");
        let active_dir = datasets::dataset_dir_from_root(root, "profile-b");
        let target = active_dir.join(DB_FILE_NAME);

        assert!(!is_restorable_source(&target, &target, root, &active_dir));
    }

    #[test]
    fn restoring_from_a_sibling_dataset_is_rejected() {
        let root = Path::new("/app-data");

        let active_dir = datasets::dataset_dir_from_root(root, "profile-b");
        let sibling = dataset_db_path(root, "profile-a");
        assert!(!is_restorable_source(
            &sibling,
            &active_dir.join(DB_FILE_NAME),
            root,
            &active_dir
        ));
        assert!(!is_restorable_source(
            &dataset_db_path(root, "default"),
            &active_dir.join(DB_FILE_NAME),
            root,
            &active_dir
        ));

        // Default's dataset dir is the root, so its siblings sit *inside* it.
        let default_dir = datasets::dataset_dir_from_root(root, "default");
        assert!(!is_restorable_source(
            &sibling,
            &default_dir.join(DB_FILE_NAME),
            root,
            &default_dir
        ));
    }

    #[test]
    fn restoring_from_a_file_in_the_active_dataset_directory_is_allowed() {
        let root = Path::new("/app-data");
        let active_dir = datasets::dataset_dir_from_root(root, "profile-b");

        assert!(is_restorable_source(
            &active_dir.join("manual-backup.db"),
            &active_dir.join(DB_FILE_NAME),
            root,
            &active_dir
        ));
    }

    #[test]
    fn restoring_from_a_backup_outside_the_app_data_root_is_allowed() {
        let root = Path::new("/app-data");
        let active_dir = datasets::dataset_dir_from_root(root, "profile-b");

        assert!(is_restorable_source(
            Path::new("/Users/someone/Documents/nkbaz-finance-backup.db"),
            &active_dir.join(DB_FILE_NAME),
            root,
            &active_dir
        ));
    }
}
