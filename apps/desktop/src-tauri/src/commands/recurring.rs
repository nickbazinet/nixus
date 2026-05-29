use tauri::State;

use crate::db::audit as audit_db;
use crate::db::recurring as recurring_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::{
    CreateRecurringExpenseTemplateInput, Expense, RecurringExpenseTemplate,
    UpdateRecurringExpenseTemplateInput,
};

#[tauri::command(rename_all = "snake_case")]
pub fn create_recurring_template(
    state: State<DbState>,
    merchant: String,
    amount_cents: i64,
    budget_category_id: i64,
    day_of_month: i32,
) -> Result<RecurringExpenseTemplate, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let input = CreateRecurringExpenseTemplateInput {
        merchant,
        amount_cents,
        budget_category_id,
        day_of_month,
    };
    let result = recurring_db::insert_template(&conn, &input)?;

    let details = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "recurring_template",
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
pub fn get_recurring_templates(
    state: State<DbState>,
) -> Result<Vec<RecurringExpenseTemplate>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    recurring_db::get_all_templates(&conn)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_recurring_template(
    state: State<DbState>,
    id: i64,
    merchant: String,
    amount_cents: i64,
    budget_category_id: i64,
    day_of_month: i32,
    is_active: bool,
) -> Result<RecurringExpenseTemplate, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let old_json = get_template_json(&conn, id);

    let input = UpdateRecurringExpenseTemplateInput {
        merchant,
        amount_cents,
        budget_category_id,
        day_of_month,
        is_active,
    };
    let result = recurring_db::update_template(&conn, id, &input)?;

    let new_json = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "recurring_template",
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
pub fn delete_recurring_template(state: State<DbState>, id: i64) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let old_json = get_template_json(&conn, id);

    recurring_db::delete_template(&conn, id)?;

    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "recurring_template",
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
pub fn apply_recurring_expenses(
    state: State<DbState>,
    year: i32,
    month: u32,
) -> Result<Vec<Expense>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let created = recurring_db::apply_recurring_for_month(&conn, year, month)?;
    audit_created_expenses(&conn, &created);

    Ok(created)
}

/// Runs on app startup in the background to backfill missed recurring expenses.
pub fn apply_due_recurring_expenses(conn: &rusqlite::Connection) -> Result<Vec<Expense>, AppError> {
    let created = recurring_db::apply_due_recurring_expenses(conn)?;
    audit_created_expenses(conn, &created);
    Ok(created)
}

fn audit_created_expenses(conn: &rusqlite::Connection, created: &[Expense]) {
    for expense in created {
        let details = serde_json::to_string(expense).unwrap_or_default();
        if let Err(e) = audit_db::insert_audit_log(
            conn,
            "expense",
            expense.id,
            "create",
            None,
            Some(&details),
        ) {
            tracing::error!("Failed to write audit log: {}", e);
        }
    }
}

fn get_template_json(conn: &rusqlite::Connection, id: i64) -> Option<String> {
    conn.query_row(
        "SELECT id, merchant, amount_cents, budget_category_id, day_of_month, is_active, created_at, updated_at
         FROM recurring_expense_templates WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(RecurringExpenseTemplate {
                id: row.get(0)?,
                merchant: row.get(1)?,
                amount_cents: row.get(2)?,
                budget_category_id: row.get(3)?,
                day_of_month: row.get(4)?,
                is_active: row.get::<_, i64>(5)? != 0,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )
    .ok()
    .and_then(|t| serde_json::to_string(&t).ok())
}
