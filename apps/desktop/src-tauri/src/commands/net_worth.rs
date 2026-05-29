use tauri::State;

use crate::db::net_worth as net_worth_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::{NetWorthChange, NetWorthCurrent, NetWorthSnapshot, NetWorthSnapshotSummary};

#[tauri::command(rename_all = "snake_case")]
pub fn get_current_net_worth(
    state: State<DbState>,
) -> Result<NetWorthCurrent, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    net_worth_db::get_current_net_worth(&conn)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_recent_net_worth_snapshots(
    state: State<DbState>,
    limit: i32,
) -> Result<Vec<NetWorthSnapshotSummary>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    net_worth_db::get_recent_net_worth_snapshots(&conn, limit)
}

#[tauri::command(rename_all = "snake_case")]
pub fn record_net_worth_snapshot(
    state: State<DbState>,
) -> Result<NetWorthSnapshot, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    net_worth_db::record_net_worth_snapshot(&conn)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_net_worth_history(
    state: State<DbState>,
    period: String,
) -> Result<Vec<NetWorthSnapshot>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    net_worth_db::get_net_worth_history(&conn, &period)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_net_worth_change(
    state: State<DbState>,
    period: String,
) -> Result<NetWorthChange, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    net_worth_db::get_net_worth_change(&conn, &period)
}
