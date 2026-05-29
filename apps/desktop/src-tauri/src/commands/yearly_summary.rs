use tauri::State;

use crate::db::yearly_summary as yearly_summary_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::YearlySummaryData;

#[tauri::command(rename_all = "snake_case")]
pub fn get_yearly_summary(
    state: State<DbState>,
    year: i32,
) -> Result<YearlySummaryData, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    yearly_summary_db::get_yearly_summary(&conn, year)
}
