use std::path::PathBuf;

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tracing::info;

use crate::db::DbState;
use crate::error::AppError;

#[derive(Serialize)]
pub struct BackupResult {
    pub path: String,
}

#[tauri::command]
pub async fn export_backup(app_handle: AppHandle) -> Result<Option<BackupResult>, AppError> {
    let db_state = app_handle.state::<DbState>();

    // Checkpoint WAL to flush all data to main database file
    {
        let conn = db_state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    }

    // Get database file path
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| AppError::File {
            message: format!("Failed to resolve app data dir: {}", e),
        })?;
    let db_path = app_data_dir.join("nkbaz-finance.db");

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

    let db_state = app_handle.state::<DbState>();

    // Get database file path
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| AppError::File {
            message: format!("Failed to resolve app data dir: {}", e),
        })?;
    let db_path = app_data_dir.join("nkbaz-finance.db");
    let pre_restore_path = app_data_dir.join("nkbaz-finance.db.pre-restore");

    // Checkpoint WAL before backup
    {
        let conn = db_state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")?;
    }

    // Create safety copy of current database
    std::fs::copy(&db_path, &pre_restore_path).map_err(|e| AppError::File {
        message: format!("Failed to create safety copy: {}", e),
    })?;

    // Replace database file with backup
    let restore_result = std::fs::copy(&selected_path, &db_path);

    match restore_result {
        Ok(_) => {
            // Reopen connection with restored database
            let mut conn = db_state.0.lock().map_err(|e| AppError::Database {
                message: e.to_string(),
            })?;

            let new_conn = Connection::open(&db_path).map_err(|e| {
                // Restore from safety copy on failure
                let _ = std::fs::copy(&pre_restore_path, &db_path);
                AppError::Database {
                    message: format!("Failed to open restored database: {}", e),
                }
            })?;

            new_conn
                .execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
                .map_err(|e| {
                    let _ = std::fs::copy(&pre_restore_path, &db_path);
                    AppError::Database {
                        message: format!("Failed to configure restored database: {}", e),
                    }
                })?;

            *conn = new_conn;

            // Clean up safety copy
            let _ = std::fs::remove_file(&pre_restore_path);

            // Also clean up WAL/SHM files from the old database
            let wal_path = app_data_dir.join("nkbaz-finance.db-wal");
            let shm_path = app_data_dir.join("nkbaz-finance.db-shm");
            let _ = std::fs::remove_file(&wal_path);
            let _ = std::fs::remove_file(&shm_path);

            info!("Database restored from {}", selected_path.display());
            Ok(true)
        }
        Err(e) => {
            // Restore from safety copy
            let _ = std::fs::copy(&pre_restore_path, &db_path);
            let _ = std::fs::remove_file(&pre_restore_path);
            Err(AppError::File {
                message: format!("Failed to restore database: {}", e),
            })
        }
    }
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
    use tempfile::NamedTempFile;

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
}
