use serde::Serialize;
use tauri::State;

use crate::db::DbState;
use crate::error::AppError;

#[derive(Serialize)]
pub struct OnboardingStatus {
    pub needs_onboarding: bool,
}

#[tauri::command]
pub fn check_onboarding_status(state: State<DbState>) -> Result<OnboardingStatus, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM budget_groups",
        [],
        |row| row.get(0),
    )?;

    Ok(OnboardingStatus {
        needs_onboarding: count == 0,
    })
}
