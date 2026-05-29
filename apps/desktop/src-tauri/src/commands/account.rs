use tauri::State;

use crate::db::account as account_db;
use crate::db::audit as audit_db;
use crate::db::net_worth as net_worth_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::{Account, CreateAccountInput, UpdateAccountInput};

#[tauri::command(rename_all = "snake_case")]
pub fn create_account(
    state: State<DbState>,
    name: String,
    institution: String,
    account_type: String,
    currency: String,
) -> Result<Account, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let input = CreateAccountInput {
        name,
        institution,
        account_type,
        currency,
    };
    let result = account_db::insert_account(&conn, &input)?;

    let details = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(&conn, "account", result.id, "create", None, Some(&details)) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    if let Err(e) = net_worth_db::record_net_worth_snapshot(&conn) {
        tracing::error!("Failed to record snapshot: {}", e);
    }
    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_accounts(state: State<DbState>) -> Result<Vec<Account>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    account_db::get_all_accounts(&conn)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_account_balance(
    state: State<DbState>,
    id: i64,
    balance_cents: i64,
) -> Result<Account, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let (old_balance, account) = account_db::update_account_balance(&conn, id, balance_cents)?;

    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "account",
        id,
        "balance_update",
        Some(&old_balance.to_string()),
        Some(&balance_cents.to_string()),
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    if let Err(e) = net_worth_db::record_net_worth_snapshot(&conn) {
        tracing::error!("Failed to record snapshot: {}", e);
    }

    Ok(account)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_account(
    state: State<DbState>,
    id: i64,
    name: String,
    institution: String,
    account_type: String,
    currency: String,
) -> Result<Account, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let old_json = get_account_json(&conn, id);

    let input = UpdateAccountInput {
        name,
        institution,
        account_type,
        currency,
    };
    let result = account_db::update_account(&conn, id, &input)?;

    let new_json = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(&conn, "account", id, "update", old_json.as_deref(), Some(&new_json)) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_account(
    state: State<DbState>,
    id: i64,
) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let old_json = get_account_json(&conn, id);

    account_db::delete_account(&conn, id)?;

    if let Err(e) = audit_db::insert_audit_log(&conn, "account", id, "delete", old_json.as_deref(), None) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    if let Err(e) = net_worth_db::record_net_worth_snapshot(&conn) {
        tracing::error!("Failed to record snapshot: {}", e);
    }
    Ok(())
}

fn get_account_json(conn: &rusqlite::Connection, id: i64) -> Option<String> {
    conn.query_row(
        "SELECT id, name, institution, account_type, currency, balance_cents, created_at, updated_at FROM accounts WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                institution: row.get(2)?,
                account_type: row.get(3)?,
                currency: row.get(4)?,
                balance_cents: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )
    .ok()
    .and_then(|a| serde_json::to_string(&a).ok())
}
