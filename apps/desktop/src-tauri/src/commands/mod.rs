pub mod account;
pub mod asset;
pub mod backup;
pub mod budget;
pub mod chat;
pub mod dashboard;
pub mod expense;
pub mod import;
pub mod income;
pub mod net_worth;
pub mod onboarding;
pub mod projection;
pub mod recurring;
pub mod settings;
pub mod spending_trends;
pub mod yearly_summary;

use serde::Serialize;
use tauri::State;

use crate::db::DbState;
use crate::error::AppError;

#[derive(Serialize)]
pub struct DbStatus {
    pub db_path: String,
    pub wal_mode: bool,
    pub schema_version: i64,
    pub migrations_applied: i64,
}

#[tauri::command]
pub fn get_db_status(state: State<DbState>) -> Result<DbStatus, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let journal_mode: String =
        conn.query_row("PRAGMA journal_mode", [], |row| row.get(0))?;

    let schema_version: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_version",
        [],
        |row| row.get(0),
    )?;

    let migrations_applied: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_version",
        [],
        |row| row.get(0),
    )?;

    Ok(DbStatus {
        db_path: "nkbaz-finance.db".to_string(),
        wal_mode: journal_mode == "wal",
        schema_version,
        migrations_applied,
    })
}
