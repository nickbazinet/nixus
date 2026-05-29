use tauri::State;

use crate::db::audit as audit_db;
use crate::db::expense as expense_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::{CreateExpenseInput, Expense, UpdateExpenseInput};

#[tauri::command(rename_all = "snake_case")]
pub fn create_expense(
    state: State<DbState>,
    merchant: String,
    amount_cents: i64,
    budget_category_id: i64,
    date: String,
) -> Result<Expense, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let input = CreateExpenseInput {
        merchant,
        amount_cents,
        budget_category_id,
        date,
    };
    let expense = expense_db::insert_expense(&conn, &input)?;

    let details = serde_json::to_string(&expense).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(&conn, "expense", expense.id, "create", None, Some(&details)) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(expense)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_expenses(
    state: State<DbState>,
    year: i32,
    month: u32,
) -> Result<Vec<Expense>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    expense_db::get_expenses_by_month(&conn, year, month)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_expense(
    state: State<DbState>,
    id: i64,
    merchant: String,
    amount_cents: i64,
    budget_category_id: i64,
    date: String,
) -> Result<Expense, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    // Fetch old value before update
    let old_json = get_expense_json(&conn, id);

    let input = UpdateExpenseInput {
        merchant,
        amount_cents,
        budget_category_id,
        date,
    };
    let expense = expense_db::update_expense(&conn, id, &input)?;

    let new_json = serde_json::to_string(&expense).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(&conn, "expense", id, "update", old_json.as_deref(), Some(&new_json)) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(expense)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_expense(
    state: State<DbState>,
    id: i64,
) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    // Fetch old value before delete
    let old_json = get_expense_json(&conn, id);

    expense_db::delete_expense(&conn, id)?;

    if let Err(e) = audit_db::insert_audit_log(&conn, "expense", id, "delete", old_json.as_deref(), None) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(())
}

fn get_expense_json(conn: &rusqlite::Connection, id: i64) -> Option<String> {
    conn.query_row(
        "SELECT id, merchant, amount_cents, budget_category_id, date, source, created_at FROM expenses WHERE id = ?1",
        rusqlite::params![id],
        |row| {
            Ok(Expense {
                id: row.get(0)?,
                merchant: row.get(1)?,
                amount_cents: row.get(2)?,
                budget_category_id: row.get(3)?,
                date: row.get(4)?,
                source: row.get(5)?,
                created_at: row.get(6)?,
            })
        },
    )
    .ok()
    .and_then(|e| serde_json::to_string(&e).ok())
}
