use tauri::State;

use crate::commands::income as income_commands;
use crate::db::audit as audit_db;
use crate::db::recurring_transfer as recurring_transfer_db;
use crate::db::{ActiveDataset, DbState};
use crate::error::AppError;
use crate::models::{
    AccountTransfer, CreateRecurringTransferTemplateInput, RecurrenceFrequency,
    RecurringTransferTemplate, UpdateRecurringTransferTemplateInput,
};

#[tauri::command(rename_all = "snake_case")]
pub fn create_recurring_transfer_template(
    state: State<DbState>,
    from_account_id: i64,
    to_account_id: i64,
    amount_cents: i64,
    day_of_month: i32,
    frequency: Option<RecurrenceFrequency>,
    start_date: Option<String>,
) -> Result<RecurringTransferTemplate, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let input = CreateRecurringTransferTemplateInput {
        from_account_id,
        to_account_id,
        amount_cents,
        day_of_month,
        frequency: frequency.unwrap_or_default(),
        start_date,
    };
    let result = active.write(|tx| recurring_transfer_db::insert_template(tx, &input))?;

    let details = serde_json::to_string(&result).unwrap_or_default();
    audit_db::record(
        &active,
        "recurring_transfer_template",
        result.id,
        "create",
        None,
        Some(&details),
    );

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_recurring_transfer_templates(
    state: State<DbState>,
) -> Result<Vec<RecurringTransferTemplate>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    recurring_transfer_db::get_all_templates(conn)
}

#[tauri::command(rename_all = "snake_case")]
#[allow(clippy::too_many_arguments)]
pub fn update_recurring_transfer_template(
    state: State<DbState>,
    id: i64,
    from_account_id: i64,
    to_account_id: i64,
    amount_cents: i64,
    day_of_month: i32,
    frequency: Option<RecurrenceFrequency>,
    start_date: Option<String>,
    is_active: bool,
) -> Result<RecurringTransferTemplate, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let old_json = template_json(conn, id);

    let input = UpdateRecurringTransferTemplateInput {
        from_account_id,
        to_account_id,
        amount_cents,
        day_of_month,
        frequency: frequency.unwrap_or_default(),
        start_date,
        is_active,
    };
    let result = active.write(|tx| recurring_transfer_db::update_template(tx, id, &input))?;

    let new_json = serde_json::to_string(&result).unwrap_or_default();
    audit_db::record(
        &active,
        "recurring_transfer_template",
        id,
        "update",
        old_json.as_deref(),
        Some(&new_json),
    );

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_recurring_transfer_template(state: State<DbState>, id: i64) -> Result<(), AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let old_json = template_json(conn, id);

    active.write(|tx| recurring_transfer_db::delete_template(tx, id))?;

    audit_db::record(
        &active,
        "recurring_transfer_template",
        id,
        "delete",
        old_json.as_deref(),
        None,
    );

    Ok(())
}

/// Runs on app startup in the background to backfill missed recurring transfers.
pub fn apply_due_recurring_transfers(
    active: &ActiveDataset,
) -> Result<Vec<AccountTransfer>, AppError> {
    let applied = active.write(|tx| recurring_transfer_db::apply_due_recurring_transfers(tx))?;

    for transfer in &applied.transfers {
        let details = serde_json::to_string(transfer).unwrap_or_default();
        audit_db::record(
            active,
            "account_transfer",
            transfer.id,
            "create",
            None,
            Some(&details),
        );
    }

    income_commands::record_account_balance_changes(active, &applied.balance_changes);

    Ok(applied.transfers)
}

fn template_json(conn: &rusqlite::Connection, id: i64) -> Option<String> {
    recurring_transfer_db::get_template_by_id(conn, id)
        .ok()
        .and_then(|t| serde_json::to_string(&t).ok())
}
