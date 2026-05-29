use tauri::State;

use crate::db::audit as audit_db;
use crate::db::income as income_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::{
    CreateIncomeEntryInput, CreateIncomeSourceInput, IncomeEntry, IncomeSource,
    IncomeSourceWithLastEntry, IncomeTotal, UpdateIncomeEntryInput, UpdateIncomeSourceInput,
};

#[tauri::command(rename_all = "snake_case")]
pub fn create_income_source(
    state: State<DbState>,
    name: String,
    income_type: String,
) -> Result<IncomeSource, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let input = CreateIncomeSourceInput { name, income_type };
    let result = income_db::insert_income_source(&conn, &input)?;

    let details = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "income_source",
        result.id,
        "create",
        None,
        Some(&details),
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_income_sources(
    state: State<DbState>,
) -> Result<Vec<IncomeSourceWithLastEntry>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    income_db::get_all_income_sources(&conn)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_income_source(
    state: State<DbState>,
    id: i64,
    name: String,
    income_type: String,
) -> Result<IncomeSource, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let old_json = get_source_json(&conn, id);

    let input = UpdateIncomeSourceInput { name, income_type };
    let result = income_db::update_income_source(&conn, id, &input)?;

    let new_json = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "income_source",
        id,
        "update",
        old_json.as_deref(),
        Some(&new_json),
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_income_source(state: State<DbState>, id: i64) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let old_json = get_source_json(&conn, id);

    income_db::delete_income_source(&conn, id)?;

    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "income_source",
        id,
        "delete",
        old_json.as_deref(),
        None,
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub fn create_income_entry(
    state: State<DbState>,
    source_id: i64,
    amount_cents: i64,
    date: String,
) -> Result<IncomeEntry, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let input = CreateIncomeEntryInput {
        source_id,
        amount_cents,
        date,
    };
    let result = income_db::insert_income_entry(&conn, &input)?;

    let new_json = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "income_entry",
        result.id,
        "create",
        None,
        Some(&new_json),
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_income_entry(
    state: State<DbState>,
    id: i64,
    source_id: i64,
    amount_cents: i64,
    date: String,
) -> Result<IncomeEntry, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let old_json = get_entry_json(&conn, id);

    let input = UpdateIncomeEntryInput { source_id, amount_cents, date };
    let result = income_db::update_income_entry(&conn, id, &input)?;

    let new_json = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "income_entry",
        id,
        "update",
        old_json.as_deref(),
        Some(&new_json),
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_income_entry(state: State<DbState>, id: i64) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let old_json = get_entry_json(&conn, id);

    income_db::delete_income_entry(&conn, id)?;

    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "income_entry",
        id,
        "delete",
        old_json.as_deref(),
        None,
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_income_entries(
    state: State<DbState>,
    source_id: Option<i64>,
) -> Result<Vec<IncomeEntry>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    income_db::get_income_entries(&conn, source_id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_income_entries_by_month(
    state: State<DbState>,
    year: i32,
    month: u32,
) -> Result<Vec<IncomeEntry>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    income_db::get_income_entries_by_month(&conn, year, month)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_income_total(
    state: State<DbState>,
    year: i32,
    month: u32,
) -> Result<IncomeTotal, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    income_db::get_income_total(&conn, year, month)
}

fn get_source_json(conn: &rusqlite::Connection, id: i64) -> Option<String> {
    conn.query_row(
        "SELECT id, name, income_type, created_at, updated_at FROM income_sources WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(IncomeSource {
                id: row.get(0)?,
                name: row.get(1)?,
                income_type: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    )
    .ok()
    .and_then(|s| serde_json::to_string(&s).ok())
}

fn get_entry_json(conn: &rusqlite::Connection, id: i64) -> Option<String> {
    conn.query_row(
        "SELECT e.id, e.source_id, s.name, s.income_type, e.amount_cents, e.date, e.month, e.created_at, e.updated_at
         FROM income_entries e
         JOIN income_sources s ON s.id = e.source_id
         WHERE e.id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(IncomeEntry {
                id: row.get(0)?,
                source_id: row.get(1)?,
                source_name: row.get(2)?,
                income_type: row.get(3)?,
                amount_cents: row.get(4)?,
                date: row.get(5)?,
                month: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        },
    )
    .ok()
    .and_then(|e| serde_json::to_string(&e).ok())
}
