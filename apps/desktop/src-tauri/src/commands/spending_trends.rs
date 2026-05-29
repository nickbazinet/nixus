use tauri::State;

use crate::db::spending_trends as spending_trends_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::SpendingTrendsData;

#[tauri::command(rename_all = "snake_case")]
pub fn get_spending_trends(
    state: State<DbState>,
    months: i32,
) -> Result<SpendingTrendsData, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let by_category = spending_trends_db::get_monthly_spend_by_category(&conn, months)?;
    let totals = spending_trends_db::get_monthly_spend_totals(&conn, months)?;

    Ok(SpendingTrendsData {
        by_category,
        totals,
    })
}
