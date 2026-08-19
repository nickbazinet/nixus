use tauri::{AppHandle, State};
use tracing::{info, warn};

use crate::datasets;
use crate::db::danger_zone as danger_zone_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::profile_store;

/// Permanently deletes all user data: finance, vehicles, net worth, chat and audit
/// history, plus the stored user profile. App preferences and stored AI credentials
/// are preserved.
#[tauri::command(rename_all = "snake_case")]
pub fn delete_all_data(app: AppHandle, state: State<DbState>) -> Result<(), AppError> {
    let mut active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_mut().ok_or(AppError::NotConfigured)?;

    let deleted = danger_zone_db::wipe_all(&mut *conn)?;
    info!("Danger Zone wipe complete: {} rows deleted", deleted);

    // Non-fatal: the rows are already gone, this only reclaims disk space.
    if let Err(e) = danger_zone_db::reclaim_space(&conn) {
        warn!("Post-wipe checkpoint/vacuum failed: {}", e);
    }

    // AD-13: profiles are dataset-independent, so the deletion target is
    // global_root, not active_dataset_dir — otherwise profile PII could survive
    // a "delete all data" run from a non-default dataset (NFR4).
    let app_data_dir = datasets::global_root(&app)?;

    // Fatal, unlike reclaim_space: a failure here means profile PII is still on
    // disk after the user asked for everything to be deleted (NFR4).
    profile_store::delete_all_profiles(&profile_store::profiles_dir(&app_data_dir))?;

    Ok(())
}
