use tauri::State;

use crate::commands::income as income_commands;
use crate::db::audit as audit_db;
use crate::db::recurring_income as recurring_income_db;
use crate::db::{ActiveDataset, DbState};
use crate::error::AppError;
use crate::models::{
    CreateRecurringIncomeTemplateInput, IncomeEntry, RecurringIncomeTemplate,
    UpdateRecurringIncomeTemplateInput,
};

#[tauri::command(rename_all = "snake_case")]
pub fn create_recurring_income_template(
    state: State<DbState>,
    source_id: i64,
    amount_cents: i64,
    day_of_month: i32,
    account_id: Option<i64>,
) -> Result<RecurringIncomeTemplate, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let input = CreateRecurringIncomeTemplateInput {
        source_id,
        amount_cents,
        day_of_month,
        account_id,
    };
    let result = active.write(|tx| recurring_income_db::insert_template(tx, &input))?;

    let details = serde_json::to_string(&result).unwrap_or_default();
    audit_db::record(
        &active,
        "recurring_income_template",
        result.id,
        "create",
        None,
        Some(&details),
    );

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_recurring_income_templates(
    state: State<DbState>,
) -> Result<Vec<RecurringIncomeTemplate>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    recurring_income_db::get_all_templates(conn)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_recurring_income_template(
    state: State<DbState>,
    id: i64,
    source_id: i64,
    amount_cents: i64,
    day_of_month: i32,
    account_id: Option<i64>,
    is_active: bool,
) -> Result<RecurringIncomeTemplate, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let old_json = template_json(conn, id);

    let input = UpdateRecurringIncomeTemplateInput {
        source_id,
        amount_cents,
        day_of_month,
        account_id,
        is_active,
    };
    let result = active.write(|tx| recurring_income_db::update_template(tx, id, &input))?;

    let new_json = serde_json::to_string(&result).unwrap_or_default();
    audit_db::record(
        &active,
        "recurring_income_template",
        id,
        "update",
        old_json.as_deref(),
        Some(&new_json),
    );

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_recurring_income_template(state: State<DbState>, id: i64) -> Result<(), AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let old_json = template_json(conn, id);

    active.write(|tx| recurring_income_db::delete_template(tx, id))?;

    audit_db::record(&active, "recurring_income_template", id, "delete", old_json.as_deref(), None);

    Ok(())
}

/// Runs on app startup in the background to backfill missed recurring income.
pub fn apply_due_recurring_income(
    active: &ActiveDataset,
) -> Result<Vec<IncomeEntry>, AppError> {
    let applied = active.write(|tx| recurring_income_db::apply_due_recurring_income(tx))?;

    for entry in &applied.entries {
        let details = serde_json::to_string(entry).unwrap_or_default();
        audit_db::record(active, "income_entry", entry.id, "create", None, Some(&details));
    }

    // Backfilled income moves linked account balances exactly like a manual entry, so it goes
    // through the same audit + net-worth snapshot path.
    income_commands::record_account_balance_changes(active, &applied.balance_changes);

    Ok(applied.entries)
}

fn template_json(conn: &rusqlite::Connection, id: i64) -> Option<String> {
    recurring_income_db::get_template_by_id(conn, id)
        .ok()
        .and_then(|t| serde_json::to_string(&t).ok())
}
