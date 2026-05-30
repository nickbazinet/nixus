use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use crate::db::audit as audit_db;
use crate::db::maintenance as maintenance_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::maintenance::catalog::{
    self, VehicleCatalogStatus, VehicleMake, VehicleModel,
};
use crate::maintenance::defaults::DEFAULT_TASKS;
use crate::models::{
    AddMaintenanceTaskInput, CreateMaintenanceTaskInput, CreateVehicleInput, LogCustomServiceInput, LogCustomServiceResult,
    LogMaintenanceServiceInput, LogServiceResult, MaintenanceAlertSummary,
    MaintenanceServiceLogEntry, MaintenanceTaskBaseline, MaintenanceTaskWithStatus,
    UpdateVehicleInput, Vehicle, VehicleWithTasks,
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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    maintenance_db::get_all_vehicles(&conn)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_vehicle(state: State<DbState>, id: i64) -> Result<VehicleWithTasks, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    maintenance_db::update_vehicle_odometer(&conn, vehicle_id, odometer_km)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_maintenance_task(
    state: State<DbState>,
    task_id: i64,
    interval_km: i64,
    interval_months: i64,
) -> Result<MaintenanceTaskWithStatus, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    maintenance_db::update_maintenance_task_intervals(&conn, task_id, interval_km, interval_months)
}

#[tauri::command(rename_all = "snake_case")]
pub fn add_maintenance_task(
    state: State<DbState>,
    input: AddMaintenanceTaskInput,
) -> Result<MaintenanceTaskWithStatus, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    maintenance_db::add_maintenance_task(&conn, &input)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_service_history(
    state: State<DbState>,
    vehicle_id: i64,
) -> Result<Vec<MaintenanceServiceLogEntry>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    maintenance_db::get_service_history(&conn, vehicle_id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn log_maintenance_service(
    state: State<DbState>,
    input: LogMaintenanceServiceInput,
) -> Result<LogServiceResult, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

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
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

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

#[tauri::command(rename_all = "snake_case")]
pub fn get_maintenance_alert_summary(
    state: State<DbState>,
) -> Result<MaintenanceAlertSummary, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    maintenance_db::get_maintenance_alert_summary(&conn)
}

fn get_vehicle_json(conn: &rusqlite::Connection, id: i64) -> Option<String> {
    maintenance_db::get_vehicle_by_id(conn, id)
        .ok()
        .and_then(|v| serde_json::to_string(&v).ok())
}

fn resolve_app_data_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::File {
            message: format!("Failed to resolve app data dir: {}", e),
        })
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_vehicle_catalog_status(app: AppHandle) -> Result<VehicleCatalogStatus, AppError> {
    let app_data_dir = resolve_app_data_dir(&app)?;
    Ok(catalog::get_catalog_status(&app_data_dir))
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_vehicle_makes(app: AppHandle) -> Result<Vec<VehicleMake>, AppError> {
    let app_data_dir = resolve_app_data_dir(&app)?;
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
    let app_data_dir = resolve_app_data_dir(&app)?;
    catalog::get_or_fetch_models(&app_data_dir, &make, year).await
}
