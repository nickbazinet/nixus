use tauri::State;

use crate::db::financial_health as financial_health_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::{FinancialHealthDetail, FinancialHealthSummary};

#[tauri::command(rename_all = "snake_case")]
pub fn get_financial_health_summary(
    state: State<DbState>,
) -> Result<FinancialHealthSummary, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let (figures, evaluation) = financial_health_db::evaluate_financial_health_waterfall(&conn)?;
    Ok(financial_health_db::build_financial_health_summary(
        &figures,
        &evaluation,
    ))
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_financial_health_detail(
    state: State<DbState>,
) -> Result<FinancialHealthDetail, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let (figures, evaluation) = financial_health_db::evaluate_financial_health_waterfall(&conn)?;
    financial_health_db::build_financial_health_detail(&conn, &figures, &evaluation)
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_emergency_fund_target(
    state: State<DbState>,
    months: i64,
) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    financial_health_db::set_emergency_fund_target_months(&conn, months)
}
