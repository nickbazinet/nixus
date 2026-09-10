use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::datasets;
use crate::db::audit as audit_db;
use crate::db::maintenance as maintenance_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::maintenance::catalog::{self, VehicleCatalogStatus, VehicleMake, VehicleModel};
use crate::maintenance::defaults::DEFAULT_TASKS;
use crate::models::{
    AddMaintenanceTaskInput, CreateMaintenanceTaskInput, CreateVehicleInput,
    DeleteServiceLogResult, LogCustomServiceInput, LogCustomServiceResult,
    LogMaintenanceServiceInput, LogServiceResult, MaintenanceAlertSummary,
    MaintenanceServiceLogEntry, MaintenanceTaskBaseline, MaintenanceTaskWithStatus,
    UpdateServiceLogInput, UpdateServiceLogResult, UpdateVehicleInput, Vehicle, VehicleWithTasks,
};

#[tauri::command(rename_all = "snake_case")]
pub fn get_maintenance_task_baselines() -> Vec<MaintenanceTaskBaseline> {
    DEFAULT_TASKS
        .iter()
        .map(|baseline| MaintenanceTaskBaseline {
            task_type_key: baseline.task_type_key.to_string(),
            interval_km: baseline.interval_km,
            interval_months: baseline.interval_months,
        })
        .collect()
}

#[tauri::command(rename_all = "snake_case")]
pub fn create_vehicle(
    state: State<DbState>,
    odometer_km: i64,
    make: Option<String>,
    model: Option<String>,
    year: Option<i32>,
    use_default_template: Option<bool>,
    custom_tasks: Option<Vec<CreateMaintenanceTaskInput>>,
) -> Result<Vehicle, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let input = CreateVehicleInput {
        odometer_km,
        make,
        model,
        year,
        use_default_template: use_default_template.unwrap_or(true),
        custom_tasks,
    };
    let result = maintenance_db::insert_vehicle(&conn, &input)?;

    let details = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "vehicle",
        result.id,
        "create",
        None,
        Some(&details),
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_vehicles(state: State<DbState>) -> Result<Vec<Vehicle>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    maintenance_db::get_all_vehicles(&conn)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_vehicle(state: State<DbState>, id: i64) -> Result<VehicleWithTasks, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    maintenance_db::get_vehicle_with_tasks(&conn, id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_vehicle(
    state: State<DbState>,
    id: i64,
    make: Option<String>,
    model: Option<String>,
    year: Option<i32>,
) -> Result<Vehicle, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let old_json = get_vehicle_json(&conn, id);

    let input = UpdateVehicleInput {
        make,
        model,
        year,
    };
    let result = maintenance_db::update_vehicle(&conn, id, &input)?;

    let new_json = serde_json::to_string(&result).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "vehicle",
        id,
        "update",
        old_json.as_deref(),
        Some(&new_json),
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_vehicle(state: State<DbState>, id: i64) -> Result<(), AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let old_json = get_vehicle_json(&conn, id);

    maintenance_db::delete_vehicle(&conn, id)?;

    if let Err(e) = audit_db::insert_audit_log(
        &conn,
        "vehicle",
        id,
        "delete",
        old_json.as_deref(),
        None,
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_vehicle_odometer(
    state: State<DbState>,
    vehicle_id: i64,
    odometer_km: i64,
) -> Result<VehicleWithTasks, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    maintenance_db::update_vehicle_odometer(&conn, vehicle_id, odometer_km)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_maintenance_task(
    state: State<DbState>,
    task_id: i64,
    interval_km: i64,
    interval_months: i64,
) -> Result<MaintenanceTaskWithStatus, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    maintenance_db::update_maintenance_task_intervals(&conn, task_id, interval_km, interval_months)
}

#[tauri::command(rename_all = "snake_case")]
pub fn add_maintenance_task(
    state: State<DbState>,
    input: AddMaintenanceTaskInput,
) -> Result<MaintenanceTaskWithStatus, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    maintenance_db::add_maintenance_task(&conn, &input)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_service_history(
    state: State<DbState>,
    vehicle_id: i64,
) -> Result<Vec<MaintenanceServiceLogEntry>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    maintenance_db::get_service_history(&conn, vehicle_id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn log_maintenance_service(
    state: State<DbState>,
    input: LogMaintenanceServiceInput,
) -> Result<LogServiceResult, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let result = maintenance_db::log_maintenance_service(&conn, &input)?;

    if result.odometer_updated {
        let old_json = result
            .previous_odometer_km
            .map(|km| serde_json::json!({"odometer_km": km}).to_string());
        let new_json = serde_json::json!({
            "field": "odometer_km",
            "before": result.previous_odometer_km,
            "after": result.new_odometer_km,
            "source": "service_log",
            "task_id": input.task_id,
        })
        .to_string();

        if let Err(e) = audit_db::insert_audit_log(
            &conn,
            "vehicle",
            result.log.vehicle_id,
            "update",
            old_json.as_deref(),
            Some(&new_json),
        ) {
            tracing::error!("Failed to write audit log: {}", e);
        }
    }

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn log_custom_service(
    state: State<DbState>,
    input: LogCustomServiceInput,
) -> Result<LogCustomServiceResult, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    let result = maintenance_db::log_custom_service(&conn, &input)?;

    if result.odometer_updated {
        let old_json = result
            .previous_odometer_km
            .map(|km| serde_json::json!({"odometer_km": km}).to_string());
        let new_json = serde_json::json!({
            "field": "odometer_km",
            "before": result.previous_odometer_km,
            "after": result.new_odometer_km,
            "source": "custom_service_log",
            "custom_service_name": input.custom_service_name.trim(),
        })
        .to_string();

        if let Err(e) = audit_db::insert_audit_log(
            &conn,
            "vehicle",
            result.log.vehicle_id,
            "update",
            old_json.as_deref(),
            Some(&new_json),
        ) {
            tracing::error!("Failed to write audit log: {}", e);
        }
    }

    Ok(result)
}

pub(crate) fn update_service_log_inner(
    conn: &rusqlite::Connection,
    input: &UpdateServiceLogInput,
) -> Result<UpdateServiceLogResult, AppError> {
    let old_json = get_service_log_json(conn, input.log_id);

    let result = maintenance_db::update_service_log(conn, input)?;

    let new_json = serde_json::to_string(&result.log).unwrap_or_default();
    if let Err(e) = audit_db::insert_audit_log(
        conn,
        "maintenance_service_log",
        result.log.id,
        "update",
        old_json.as_deref(),
        Some(&new_json),
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    if result.odometer_updated {
        let odometer_old_json = result
            .previous_odometer_km
            .map(|km| serde_json::json!({"odometer_km": km}).to_string());
        let odometer_new_json = serde_json::json!({
            "field": "odometer_km",
            "before": result.previous_odometer_km,
            "after": result.new_odometer_km,
            "source": "service_log_update",
            "log_id": result.log.id,
        })
        .to_string();

        if let Err(e) = audit_db::insert_audit_log(
            conn,
            "vehicle",
            result.log.vehicle_id,
            "update",
            odometer_old_json.as_deref(),
            Some(&odometer_new_json),
        ) {
            tracing::error!("Failed to write audit log: {}", e);
        }
    }

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_service_log(
    state: State<DbState>,
    input: UpdateServiceLogInput,
) -> Result<UpdateServiceLogResult, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    update_service_log_inner(&conn, &input)
}

pub(crate) fn delete_service_log_inner(
    conn: &rusqlite::Connection,
    log_id: i64,
) -> Result<DeleteServiceLogResult, AppError> {
    let old_json = get_service_log_json(conn, log_id);

    let result = maintenance_db::delete_service_log(conn, log_id)?;

    if let Err(e) = audit_db::insert_audit_log(
        conn,
        "maintenance_service_log",
        log_id,
        "delete",
        old_json.as_deref(),
        None,
    ) {
        tracing::error!("Failed to write audit log: {}", e);
    }

    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
pub fn delete_service_log(
    state: State<DbState>,
    log_id: i64,
) -> Result<DeleteServiceLogResult, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    delete_service_log_inner(&conn, log_id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_maintenance_alert_summary(
    state: State<DbState>,
) -> Result<MaintenanceAlertSummary, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    maintenance_db::get_maintenance_alert_summary(&conn)
}

fn get_vehicle_json(conn: &rusqlite::Connection, id: i64) -> Option<String> {
    maintenance_db::get_vehicle_by_id(conn, id)
        .ok()
        .and_then(|v| serde_json::to_string(&v).ok())
}

fn get_service_log_json(conn: &rusqlite::Connection, id: i64) -> Option<String> {
    maintenance_db::get_service_log_by_id(conn, id)
        .ok()
        .and_then(|log| serde_json::to_string(&log).ok())
}

// The vehicle catalog is dataset-independent NHTSA reference data written by
// lib.rs's background refresh at global_root — these readers must match that
// anchor, or the cache would look permanently empty per non-default dataset.
fn resolve_catalog_root(app: &AppHandle) -> Result<PathBuf, AppError> {
    datasets::global_root(app)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_vehicle_catalog_status(app: AppHandle) -> Result<VehicleCatalogStatus, AppError> {
    let app_data_dir = resolve_catalog_root(&app)?;
    Ok(catalog::get_catalog_status(&app_data_dir))
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_vehicle_makes(app: AppHandle) -> Result<Vec<VehicleMake>, AppError> {
    let app_data_dir = resolve_catalog_root(&app)?;
    Ok(catalog::get_cached_makes(&app_data_dir))
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_vehicle_models(
    app: AppHandle,
    make: String,
    year: i32,
) -> Result<Vec<VehicleModel>, AppError> {
    catalog::validate_catalog_make(&make)?;
    catalog::validate_catalog_year(year)?;
    let app_data_dir = resolve_catalog_root(&app)?;
    catalog::get_or_fetch_models(&app_data_dir, &make, year).await
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use tempfile::TempDir;

    use super::*;
    use crate::models::LogMaintenanceServiceInput;

    const SEED_ODOMETER_KM: i64 = 10_000;

    // Derived from today because the db layer refuses a future service date, which a hardcoded
    // literal eventually becomes on a machine whose clock sits before it.
    fn days_ago(days: u64) -> String {
        chrono::Local::now()
            .date_naive()
            .checked_sub_days(chrono::Days::new(days))
            .expect("date within range")
            .format("%Y-%m-%d")
            .to_string()
    }

    /// A migrated database holding one vehicle and one scheduled log, and **no audit rows**: both
    /// fixture writes go through the db layer, so every audit row a test sees was written by the
    /// command helper under test.
    fn migrated_db_with_a_logged_service() -> (TempDir, Connection, i64, i64) {
        let dir = TempDir::new().expect("temp dir");
        let conn = crate::db::init_db(dir.path()).expect("init_db succeeds");

        let vehicle = maintenance_db::insert_vehicle(
            &conn,
            &CreateVehicleInput {
                odometer_km: SEED_ODOMETER_KM,
                make: Some("Toyota".to_string()),
                model: Some("Camry".to_string()),
                year: Some(2020),
                use_default_template: true,
                custom_tasks: None,
            },
        )
        .expect("the vehicle is created");

        let task_id: i64 = conn
            .query_row(
                "SELECT id FROM maintenance_tasks
                 WHERE vehicle_id = ?1 AND task_type_key = 'engine_oil_filter'",
                [vehicle.id],
                |row| row.get(0),
            )
            .expect("the seeded oil task reads");

        let logged = maintenance_db::log_maintenance_service(
            &conn,
            &LogMaintenanceServiceInput {
                task_id,
                service_date: days_ago(30),
                odometer_km: SEED_ODOMETER_KM,
                notes: Some("Original note".to_string()),
            },
        )
        .expect("the service is logged");

        assert_eq!(
            audit_row_count(&conn),
            0,
            "the fixture must not write audit rows of its own"
        );

        (dir, conn, logged.log.id, vehicle.id)
    }

    fn audit_row_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM audit_log", [], |row| row.get(0))
            .expect("the audit count reads")
    }

    /// The one audit row for `entity_type`/`action`, as `(entity_id, old_value, new_value)`.
    /// Asserting exactly one row is what makes a duplicated or missing write a failure.
    fn audit_row(
        conn: &Connection,
        entity_type: &str,
        action: &str,
    ) -> (i64, Option<String>, Option<String>) {
        let matching: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM audit_log WHERE entity_type = ?1 AND action = ?2",
                [entity_type, action],
                |row| row.get(0),
            )
            .expect("the audit count reads");
        assert_eq!(
            matching, 1,
            "exactly one {entity_type}/{action} audit row is expected"
        );

        conn.query_row(
            "SELECT entity_id, old_value, new_value FROM audit_log
             WHERE entity_type = ?1 AND action = ?2",
            [entity_type, action],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("the audit row reads")
    }

    fn field(value: &str, key: &str) -> serde_json::Value {
        let parsed: serde_json::Value =
            serde_json::from_str(value).expect("the audit value is JSON");
        parsed
            .get(key)
            .unwrap_or_else(|| panic!("the audit value carries {key}"))
            .clone()
    }

    #[test]
    fn updating_a_service_log_audits_the_row_before_and_after_the_edit() {
        let (_dir, conn, log_id, _vehicle_id) = migrated_db_with_a_logged_service();
        let corrected_on = days_ago(20);

        // Below the vehicle's reading on purpose: this edit must produce the log audit row alone.
        update_service_log_inner(
            &conn,
            &UpdateServiceLogInput {
                log_id,
                service_date: corrected_on.clone(),
                odometer_km: 9_500,
                notes: Some("Corrected note".to_string()),
                custom_service_name: None,
            },
        )
        .expect("the edit succeeds");

        let (entity_id, old_value, new_value) =
            audit_row(&conn, "maintenance_service_log", "update");
        let old_value = old_value.expect("the update audit records the row as it was");
        let new_value = new_value.expect("the update audit records the row as saved");

        assert_eq!(entity_id, log_id);
        assert_eq!(field(&old_value, "id"), serde_json::json!(log_id));
        assert_eq!(
            field(&old_value, "odometer_km"),
            serde_json::json!(SEED_ODOMETER_KM)
        );
        assert_eq!(
            field(&old_value, "notes"),
            serde_json::json!("Original note")
        );

        assert_eq!(field(&new_value, "id"), serde_json::json!(log_id));
        assert_eq!(field(&new_value, "odometer_km"), serde_json::json!(9_500));
        assert_eq!(
            field(&new_value, "service_date"),
            serde_json::json!(corrected_on)
        );
        assert_eq!(
            field(&new_value, "notes"),
            serde_json::json!("Corrected note")
        );

        assert_eq!(
            audit_row_count(&conn),
            1,
            "an edit that leaves the odometer alone writes no vehicle audit row"
        );
    }

    #[test]
    fn deleting_a_service_log_audits_the_destroyed_row_and_no_new_value() {
        let (_dir, conn, log_id, _vehicle_id) = migrated_db_with_a_logged_service();

        delete_service_log_inner(&conn, log_id).expect("the delete succeeds");

        let (entity_id, old_value, new_value) =
            audit_row(&conn, "maintenance_service_log", "delete");
        let old_value = old_value.expect("the delete audit records what was destroyed");

        assert_eq!(entity_id, log_id);
        assert_eq!(
            new_value, None,
            "nothing survives a delete to record as the new value"
        );
        assert_eq!(field(&old_value, "id"), serde_json::json!(log_id));
        assert_eq!(
            field(&old_value, "odometer_km"),
            serde_json::json!(SEED_ODOMETER_KM)
        );
        assert_eq!(
            field(&old_value, "notes"),
            serde_json::json!("Original note")
        );
        assert_eq!(audit_row_count(&conn), 1);
    }

    #[test]
    fn an_odometer_advancing_edit_audits_the_vehicle_with_the_service_log_update_source() {
        let (_dir, conn, log_id, vehicle_id) = migrated_db_with_a_logged_service();

        update_service_log_inner(
            &conn,
            &UpdateServiceLogInput {
                log_id,
                service_date: days_ago(20),
                odometer_km: 26_000,
                notes: None,
                custom_service_name: None,
            },
        )
        .expect("the edit succeeds");

        let (entity_id, old_value, new_value) = audit_row(&conn, "vehicle", "update");
        let old_value = old_value.expect("the companion audit records the previous reading");
        let new_value = new_value.expect("the companion audit records the advance");

        assert_eq!(entity_id, vehicle_id);
        assert_eq!(
            field(&old_value, "odometer_km"),
            serde_json::json!(SEED_ODOMETER_KM)
        );
        assert_eq!(
            field(&new_value, "source"),
            serde_json::json!("service_log_update")
        );
        assert_eq!(field(&new_value, "field"), serde_json::json!("odometer_km"));
        assert_eq!(
            field(&new_value, "before"),
            serde_json::json!(SEED_ODOMETER_KM)
        );
        assert_eq!(field(&new_value, "after"), serde_json::json!(26_000));
        assert_eq!(field(&new_value, "log_id"), serde_json::json!(log_id));

        audit_row(&conn, "maintenance_service_log", "update");
        assert_eq!(
            audit_row_count(&conn),
            2,
            "the advance is a companion row, not a replacement for the log audit"
        );
    }
}
