use tauri::State;

use crate::db::projection as projection_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::ProjectionInput;

#[tauri::command(rename_all = "snake_case")]
pub fn get_projection_input(
    state: State<DbState>,
) -> Result<ProjectionInput, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    projection_db::get_projection_input(&conn)
}
