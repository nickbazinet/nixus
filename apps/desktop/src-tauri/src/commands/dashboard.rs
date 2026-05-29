use tauri::State;

use crate::db::dashboard as dashboard_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::{BudgetSummary, DashboardBudgetCategory, SpendingByCategory};

#[tauri::command(rename_all = "snake_case")]
pub fn get_budget_summary(
    state: State<DbState>,
    year: i32,
    month: i32,
) -> Result<BudgetSummary, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    dashboard_db::get_budget_summary(&conn, year, month)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_top_budget_categories(
    state: State<DbState>,
    year: i32,
    month: i32,
    limit: usize,
) -> Result<Vec<DashboardBudgetCategory>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    dashboard_db::get_top_budget_categories(&conn, year, month, limit)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_spending_breakdown(
    state: State<DbState>,
    year: i32,
    month: i32,
) -> Result<Vec<SpendingByCategory>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    dashboard_db::get_spending_breakdown(&conn, year, month)
}
