use tauri::State;

use crate::db::asset as asset_db;
use crate::db::audit as audit_db;
use crate::db::net_worth as net_worth_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::{CreateAssetInput, PassiveAsset, UpdateAssetInput};

#[tauri::command(rename_all = "snake_case")]
pub fn create_asset(
    state: State<DbState>,
    name: String,
    asset_type: String,
    value_cents: i64,
) -> Result<PassiveAsset, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let input = CreateAssetInput {
        name,
        asset_type,
        value_cents,
    };
    let result = asset_db::insert_asset(&conn, &input)?;

    let details = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(&conn, "passive_asset", result.id, "create", None, Some(&details)) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    if let Err(e) = net_worth_db::record_net_worth_snapshot(&conn) {
        tracing::error!("Failed to record snapshot: {}", e);
    }
    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_assets(state: State<DbState>) -> Result<Vec<PassiveAsset>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    asset_db::get_all_assets(&conn)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_asset_value(
    state: State<DbState>,
    id: i64,
    value_cents: i64,
) -> Result<PassiveAsset, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let (old_value, asset) = asset_db::update_asset_value(&conn, id, value_cents)?;

    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "passive_asset",
        id,
        "value_update",
        Some(&old_value.to_string()),
        Some(&value_cents.to_string()),
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    if let Err(e) = net_worth_db::record_net_worth_snapshot(&conn) {
        tracing::error!("Failed to record snapshot: {}", e);
    }

    Ok(asset)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_asset(
    state: State<DbState>,
    id: i64,
    name: String,
    asset_type: String,
) -> Result<PassiveAsset, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let old_json = get_asset_json(&conn, id);

    let input = UpdateAssetInput { name, asset_type };
    let result = asset_db::update_asset(&conn, id, &input)?;

    let new_json = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(&conn, "passive_asset", id, "update", old_json.as_deref(), Some(&new_json)) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_asset(
    state: State<DbState>,
    id: i64,
) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let old_json = get_asset_json(&conn, id);

    asset_db::delete_asset(&conn, id)?;

    if let Err(e) = audit_db::insert_audit_log(&conn, "passive_asset", id, "delete", old_json.as_deref(), None) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    if let Err(e) = net_worth_db::record_net_worth_snapshot(&conn) {
        tracing::error!("Failed to record snapshot: {}", e);
    }
    Ok(())
}

fn get_asset_json(conn: &rusqlite::Connection, id: i64) -> Option<String> {
    conn.query_row(
        "SELECT id, name, asset_type, value_cents, created_at, updated_at FROM passive_assets WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(PassiveAsset {
                id: row.get(0)?,
                name: row.get(1)?,
                asset_type: row.get(2)?,
                value_cents: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        },
    )
    .ok()
    .and_then(|a| serde_json::to_string(&a).ok())
}
