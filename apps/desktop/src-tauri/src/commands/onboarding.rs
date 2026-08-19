use serde::Serialize;
use tauri::State;

use crate::db::onboarding as onboarding_db;
use crate::db::DbState;
use crate::error::AppError;

#[derive(Serialize)]
pub struct OnboardingStatus {
    pub needs_onboarding: bool,
    pub setup_incomplete: bool,
}

#[tauri::command(rename_all = "snake_case")]
pub fn check_onboarding_status(state: State<DbState>) -> Result<OnboardingStatus, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let has_data = onboarding_db::has_budget_data(&conn)?;
    let completed = onboarding_db::is_completed(&conn);

    Ok(OnboardingStatus {
        needs_onboarding: !has_data && !completed,
        setup_incomplete: completed && !has_data,
    })
}

#[tauri::command(rename_all = "snake_case")]
pub fn complete_onboarding(state: State<DbState>) -> Result<(), AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    onboarding_db::set_completed(&conn)
}
