use tauri::State;
use tracing::{info, warn};

use crate::db::danger_zone as danger_zone_db;
use crate::db::DbState;
use crate::error::AppError;

/// Permanently deletes all user data: finance, vehicles, net worth, chat and audit
/// history. App preferences and stored AI credentials are preserved.
#[tauri::command(rename_all = "snake_case")]
pub fn delete_all_data(state: State<DbState>) -> Result<(), AppError> {
    let mut conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let deleted = danger_zone_db::wipe_all(&mut conn)?;
    info!("Danger Zone wipe complete: {} rows deleted", deleted);

    // Non-fatal: the rows are already gone, this only reclaims disk space.
    if let Err(e) = danger_zone_db::reclaim_space(&conn) {
        warn!("Post-wipe checkpoint/vacuum failed: {}", e);
    }

    Ok(())
}
