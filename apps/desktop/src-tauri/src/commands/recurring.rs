use tauri::State;

use crate::db::audit as audit_db;
use crate::db::recurring as recurring_db;
use crate::db::{ActiveDataset, DbState};
use crate::error::AppError;
use crate::models::{
    CreateRecurringExpenseTemplateInput, Expense, RecurrenceFrequency, RecurringExpenseTemplate,
    UpdateRecurringExpenseTemplateInput,
};

#[tauri::command(rename_all = "snake_case")]
pub fn create_recurring_template(
    state: State<DbState>,
    merchant: String,
    amount_cents: i64,
    budget_category_id: i64,
    day_of_month: i32,
    frequency: Option<RecurrenceFrequency>,
    start_date: Option<String>,
) -> Result<RecurringExpenseTemplate, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let input = CreateRecurringExpenseTemplateInput {
        merchant,
        amount_cents,
        budget_category_id,
        day_of_month,
        frequency: frequency.unwrap_or_default(),
        start_date,
    };
    let result = active.write(|tx| recurring_db::insert_template(tx, &input))?;

    let details = serde_json::to_string(&result).unwrap_or_default();
    audit_db::record(&active, "recurring_template", result.id, "create", None, Some(&details));

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_recurring_templates(
    state: State<DbState>,
) -> Result<Vec<RecurringExpenseTemplate>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    recurring_db::get_all_templates(conn)
}

#[tauri::command(rename_all = "snake_case")]
#[allow(clippy::too_many_arguments)]
pub fn update_recurring_template(
    state: State<DbState>,
    id: i64,
    merchant: String,
    amount_cents: i64,
    budget_category_id: i64,
    day_of_month: i32,
    frequency: Option<RecurrenceFrequency>,
    start_date: Option<String>,
    is_active: bool,
) -> Result<RecurringExpenseTemplate, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let old_json = get_template_json(conn, id);

    let input = UpdateRecurringExpenseTemplateInput {
        merchant,
        amount_cents,
        budget_category_id,
        day_of_month,
        frequency: frequency.unwrap_or_default(),
        start_date,
        is_active,
    };
    let result = active.write(|tx| recurring_db::update_template(tx, id, &input))?;

    let new_json = serde_json::to_string(&result).unwrap_or_default();
    audit_db::record(
        &active,
        "recurring_template",
        id,
        "update",
        old_json.as_deref(),
        Some(&new_json),
    );

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_recurring_template(state: State<DbState>, id: i64) -> Result<(), AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let old_json = get_template_json(conn, id);

    active.write(|tx| recurring_db::delete_template(tx, id))?;

    audit_db::record(&active, "recurring_template", id, "delete", old_json.as_deref(), None);

    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub fn apply_recurring_expenses(
    state: State<DbState>,
    year: i32,
    month: u32,
) -> Result<Vec<Expense>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let created = active.write(|tx| recurring_db::apply_recurring_for_month(tx, year, month))?;
    audit_created_expenses(&active, &created);

    Ok(created)
}

/// Runs on app startup in the background to backfill missed recurring expenses.
pub fn apply_due_recurring_expenses(active: &ActiveDataset) -> Result<Vec<Expense>, AppError> {
    let created = active.write(|tx| recurring_db::apply_due_recurring_expenses(tx))?;

    audit_created_expenses(active, &created);

    Ok(created)
}

fn audit_created_expenses(active: &ActiveDataset, created: &[Expense]) {
    for expense in created {
        let details = serde_json::to_string(expense).unwrap_or_default();
        audit_db::record(active, "expense", expense.id, "create", None, Some(&details));
    }
}

fn get_template_json(conn: &rusqlite::Connection, id: i64) -> Option<String> {
    recurring_db::get_template_by_id(conn, id)
        .ok()
        .and_then(|t| serde_json::to_string(&t).ok())
}
