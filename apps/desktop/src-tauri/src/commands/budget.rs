use tauri::State;

use crate::db::budget as budget_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::{BudgetCategory, BudgetCategoryStatus, BudgetGroup, CreateBudgetCategory, CreateBudgetGroup};

#[tauri::command(rename_all = "snake_case")]
pub fn create_budget_group(
    state: State<DbState>,
    name: String,
) -> Result<BudgetGroup, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let input = CreateBudgetGroup { name };
    budget_db::create_budget_group(&conn, &input)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_budget_groups(state: State<DbState>) -> Result<Vec<BudgetGroup>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    budget_db::get_budget_groups(&conn)
}

#[tauri::command(rename_all = "snake_case")]
pub fn create_budget_category(
    state: State<DbState>,
    group_id: i64,
    name: String,
    target_cents: i64,
) -> Result<BudgetCategory, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let input = CreateBudgetCategory {
        group_id,
        name,
        target_cents,
    };
    budget_db::create_budget_category(&conn, &input)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_budget_categories(
    state: State<DbState>,
    group_id: i64,
) -> Result<Vec<BudgetCategory>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    budget_db::get_budget_categories_by_group(&conn, group_id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_budget_group(
    state: State<DbState>,
    id: i64,
    name: String,
) -> Result<BudgetGroup, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    budget_db::update_budget_group(&conn, id, name)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_budget_category(
    state: State<DbState>,
    id: i64,
    name: Option<String>,
    target_cents: Option<i64>,
) -> Result<BudgetCategory, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    budget_db::update_budget_category(&conn, id, name, target_cents)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_budget_category(
    state: State<DbState>,
    id: i64,
) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    budget_db::delete_budget_category(&conn, id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_budget_status(
    state: State<DbState>,
    year: i32,
    month: i32,
) -> Result<Vec<BudgetCategoryStatus>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    budget_db::get_budget_status(&conn, year, month)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_budget_group(
    state: State<DbState>,
    id: i64,
) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    budget_db::delete_budget_group(&conn, id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_all_budget_categories(
    state: State<DbState>,
) -> Result<Vec<BudgetCategory>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    budget_db::get_all_budget_categories(&conn)
}
