use chrono::{Local, NaiveDate};
use rusqlite::{params, Connection};

use crate::error::AppError;
use crate::maintenance::defaults::{baseline_for, DEFAULT_TASKS};
use crate::maintenance::display::derive_vehicle_nickname;
use crate::maintenance::evaluator::{
    evaluate_task, is_alert_status, pick_single_urgency_dimension, status_rank, worst_status,
    TaskEvalInput, TaskStatus,
};
use crate::models::{
    AddMaintenanceTaskInput, CreateMaintenanceTaskInput, CreateVehicleInput, LogCustomServiceInput,
    LogCustomServiceResult, LogMaintenanceServiceInput,
    LogServiceResult, MaintenanceAlertSummary, MaintenanceServiceLog, MaintenanceServiceLogEntry,
    MaintenanceTask, MaintenanceTaskWithStatus, MostUrgentTask, UpdateVehicleInput, Vehicle,
    VehicleAlertRow, VehicleWithTasks,
};

fn validate_vehicle_fields(
    make: &Option<String>,
    model: &Option<String>,
    year: &Option<i32>,
    odometer_km: i64,
) -> Result<String, AppError> {
    if odometer_km < 0 {
        return Err(AppError::Validation {
            message: "Odometer must be zero or greater".to_string(),
            field: Some("odometer_km".to_string()),
        });
    }

    if let Some(y) = year {
        if *y < 1900 || *y > 2100 {
            return Err(AppError::Validation {
                message: "Year must be between 1900 and 2100".to_string(),
                field: Some("year".to_string()),
            });
        }
    }

    Ok(derive_vehicle_nickname(make, model, year))
}

fn row_to_vehicle(row: &rusqlite::Row<'_>) -> rusqlite::Result<Vehicle> {
    Ok(Vehicle {
        id: row.get(0)?,
        nickname: row.get(1)?,
        make: row.get(2)?,
        model: row.get(3)?,
        year: row.get(4)?,
        odometer_km: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn row_to_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<MaintenanceTask> {
    Ok(MaintenanceTask {
        id: row.get(0)?,
        vehicle_id: row.get(1)?,
        task_type_key: row.get(2)?,
        interval_km: row.get(3)?,
        interval_months: row.get(4)?,
        last_service_date: row.get(5)?,
        last_service_odometer_km: row.get(6)?,
        custom_task_name: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn is_custom_task_key(task_type_key: &str) -> bool {
    task_type_key.starts_with("custom_")
}

fn generate_custom_task_key() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("custom_{nanos}")
}

pub fn insert_vehicle(conn: &Connection, input: &CreateVehicleInput) -> Result<Vehicle, AppError> {
    let nickname =
        validate_vehicle_fields(&input.make, &input.model, &input.year, input.odometer_km)?;

    conn.execute("BEGIN IMMEDIATE", [])?;

    let result = (|| -> Result<Vehicle, AppError> {
        conn.execute(
            "INSERT INTO vehicles (nickname, make, model, year, odometer_km)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![nickname, input.make, input.model, input.year, input.odometer_km],
        )?;

        let vehicle_id = conn.last_insert_rowid();
        if input.use_default_template {
            seed_default_tasks_for_vehicle(conn, vehicle_id)?;
        } else if let Some(tasks) = input.custom_tasks.as_deref() {
            if !tasks.is_empty() {
                seed_custom_tasks_for_vehicle(conn, vehicle_id, tasks)?;
            }
        }
        get_vehicle_by_id(conn, vehicle_id)
    })();

    match result {
        Ok(vehicle) => {
            conn.execute("COMMIT", [])?;
            Ok(vehicle)
        }
        Err(e) => {
            let _ = conn.execute("ROLLBACK", []);
            Err(e)
        }
    }
}

fn seed_default_tasks_for_vehicle(conn: &Connection, vehicle_id: i64) -> Result<(), AppError> {
    for baseline in DEFAULT_TASKS {
        insert_maintenance_task(
            conn,
            vehicle_id,
            baseline.task_type_key,
            baseline.interval_km,
            baseline.interval_months,
            None,
        )?;
    }
    Ok(())
}

fn seed_custom_tasks_for_vehicle(
    conn: &Connection,
    vehicle_id: i64,
    tasks: &[CreateMaintenanceTaskInput],
) -> Result<(), AppError> {
    if tasks.is_empty() {
        return Err(AppError::Validation {
            message: "Select at least one maintenance task".to_string(),
            field: Some("custom_tasks".to_string()),
        });
    }

    let mut seen = std::collections::HashSet::new();
    for task in tasks {
        if !seen.insert(task.task_type_key.as_str()) {
            return Err(AppError::Validation {
                message: format!("Duplicate task type: {}", task.task_type_key),
                field: Some("custom_tasks".to_string()),
            });
        }

        if baseline_for(&task.task_type_key).is_none() {
            return Err(AppError::Validation {
                message: format!("Unknown maintenance task type: {}", task.task_type_key),
                field: Some("custom_tasks".to_string()),
            });
        }

        if task.interval_km < 0 || task.interval_months < 0 {
            return Err(AppError::Validation {
                message: "Maintenance intervals must be zero or greater".to_string(),
                field: Some("custom_tasks".to_string()),
            });
        }

        if task.interval_km == 0 && task.interval_months == 0 {
            return Err(AppError::Validation {
                message: "At least one interval must be greater than zero".to_string(),
                field: Some("custom_tasks".to_string()),
            });
        }

        insert_maintenance_task(
            conn,
            vehicle_id,
            &task.task_type_key,
            task.interval_km,
            task.interval_months,
            None,
        )?;
    }

    Ok(())
}

fn insert_maintenance_task(
    conn: &Connection,
    vehicle_id: i64,
    task_type_key: &str,
    interval_km: i64,
    interval_months: i64,
    custom_task_name: Option<&str>,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO maintenance_tasks (vehicle_id, task_type_key, interval_km, interval_months, custom_task_name)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            vehicle_id,
            task_type_key,
            interval_km,
            interval_months,
            custom_task_name
        ],
    )?;
    Ok(())
}

pub fn get_all_vehicles(conn: &Connection) -> Result<Vec<Vehicle>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, nickname, make, model, year, odometer_km, created_at, updated_at
         FROM vehicles
         ORDER BY created_at DESC",
    )?;

    let vehicles = stmt
        .query_map([], row_to_vehicle)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(vehicles)
}

pub fn get_vehicle_by_id(conn: &Connection, id: i64) -> Result<Vehicle, AppError> {
    conn.query_row(
        "SELECT id, nickname, make, model, year, odometer_km, created_at, updated_at
         FROM vehicles WHERE id = ?1",
        params![id],
        row_to_vehicle,
    )
    .map_err(|_| AppError::Database {
        message: "Vehicle not found".to_string(),
    })
}

pub fn get_tasks_for_vehicle(conn: &Connection, vehicle_id: i64) -> Result<Vec<MaintenanceTask>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, vehicle_id, task_type_key, interval_km, interval_months,
                last_service_date, last_service_odometer_km, custom_task_name, created_at, updated_at
         FROM maintenance_tasks
         WHERE vehicle_id = ?1
         ORDER BY task_type_key",
    )?;

    let tasks = stmt
        .query_map(params![vehicle_id], row_to_task)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(tasks)
}

pub fn attach_task_status(
    task: &MaintenanceTask,
    vehicle: &Vehicle,
) -> MaintenanceTaskWithStatus {
    let today = Local::now().date_naive();
    let evaluation = evaluate_task(&TaskEvalInput {
        interval_km: task.interval_km,
        interval_months: task.interval_months,
        last_service_date: task.last_service_date.clone(),
        last_service_odometer_km: task.last_service_odometer_km,
        current_odometer_km: vehicle.odometer_km,
        vehicle_created_at: vehicle.created_at.clone(),
        today,
    });

    let (default_interval_km, default_interval_months) = if is_custom_task_key(&task.task_type_key) {
        (task.interval_km, task.interval_months)
    } else {
        baseline_for(&task.task_type_key)
            .map(|b| (b.interval_km, b.interval_months))
            .unwrap_or((0, 0))
    };

    MaintenanceTaskWithStatus {
        id: task.id,
        vehicle_id: task.vehicle_id,
        task_type_key: task.task_type_key.clone(),
        interval_km: task.interval_km,
        interval_months: task.interval_months,
        default_interval_km,
        default_interval_months,
        last_service_date: task.last_service_date.clone(),
        last_service_odometer_km: task.last_service_odometer_km,
        custom_task_name: task.custom_task_name.clone(),
        created_at: task.created_at.clone(),
        updated_at: task.updated_at.clone(),
        status: evaluation.status,
        km_remaining: evaluation.km_remaining,
        days_remaining: evaluation.days_remaining,
        next_due_date: evaluation
            .next_due_date
            .map(|d| d.format("%Y-%m-%d").to_string()),
        next_due_odometer_km: evaluation.next_due_odometer_km,
    }
}

pub fn get_vehicle_with_tasks(conn: &Connection, id: i64) -> Result<VehicleWithTasks, AppError> {
    let vehicle = get_vehicle_by_id(conn, id)?;
    let tasks = get_tasks_for_vehicle(conn, id)?;
    let tasks_with_status = tasks
        .iter()
        .map(|task| attach_task_status(task, &vehicle))
        .collect();

    Ok(VehicleWithTasks {
        vehicle,
        tasks: tasks_with_status,
    })
}

pub fn update_vehicle(
    conn: &Connection,
    id: i64,
    input: &UpdateVehicleInput,
) -> Result<Vehicle, AppError> {
    let nickname = validate_vehicle_fields(&input.make, &input.model, &input.year, 0)?;

    let rows = conn.execute(
        "UPDATE vehicles
         SET nickname = ?1, make = ?2, model = ?3, year = ?4, updated_at = datetime('now')
         WHERE id = ?5",
        params![nickname, input.make, input.model, input.year, id],
    )?;

    if rows == 0 {
        return Err(AppError::Database {
            message: "Vehicle not found".to_string(),
        });
    }

    get_vehicle_by_id(conn, id)
}

pub fn delete_vehicle(conn: &Connection, id: i64) -> Result<(), AppError> {
    let rows = conn.execute("DELETE FROM vehicles WHERE id = ?1", params![id])?;
    if rows == 0 {
        return Err(AppError::Database {
            message: "Vehicle not found".to_string(),
        });
    }
    Ok(())
}

fn validate_task_intervals(interval_km: i64, interval_months: i64) -> Result<(), AppError> {
    if interval_km < 0 {
        return Err(AppError::Validation {
            message: "Interval km must be zero or greater".to_string(),
            field: Some("interval_km".to_string()),
        });
    }

    if interval_months < 0 {
        return Err(AppError::Validation {
            message: "Interval months must be zero or greater".to_string(),
            field: Some("interval_months".to_string()),
        });
    }

    if interval_km == 0 && interval_months == 0 {
        return Err(AppError::Validation {
            message: "At least one interval must be greater than zero".to_string(),
            field: Some("interval_km".to_string()),
        });
    }

    Ok(())
}

fn get_task_by_id(conn: &Connection, task_id: i64) -> Result<MaintenanceTask, AppError> {
    conn.query_row(
        "SELECT id, vehicle_id, task_type_key, interval_km, interval_months,
                last_service_date, last_service_odometer_km, custom_task_name, created_at, updated_at
         FROM maintenance_tasks WHERE id = ?1",
        params![task_id],
        row_to_task,
    )
    .map_err(|_| AppError::Database {
        message: "Maintenance task not found".to_string(),
    })
}

pub fn update_vehicle_odometer(
    conn: &Connection,
    vehicle_id: i64,
    odometer_km: i64,
) -> Result<VehicleWithTasks, AppError> {
    if odometer_km < 0 {
        return Err(AppError::Validation {
            message: "Odometer must be a non-negative integer".to_string(),
            field: Some("odometer_km".to_string()),
        });
    }

    let rows = conn.execute(
        "UPDATE vehicles
         SET odometer_km = ?1, updated_at = datetime('now')
         WHERE id = ?2",
        params![odometer_km, vehicle_id],
    )?;

    if rows == 0 {
        return Err(AppError::Database {
            message: "Vehicle not found".to_string(),
        });
    }

    get_vehicle_with_tasks(conn, vehicle_id)
}

pub fn add_maintenance_task(
    conn: &Connection,
    input: &AddMaintenanceTaskInput,
) -> Result<MaintenanceTaskWithStatus, AppError> {
    let vehicle = get_vehicle_by_id(conn, input.vehicle_id)?;

    let custom_name = input
        .custom_task_name
        .as_ref()
        .map(|name| name.trim())
        .filter(|name| !name.is_empty());
    let catalog_key = input
        .task_type_key
        .as_ref()
        .map(|key| key.trim())
        .filter(|key| !key.is_empty());

    let (task_type_key, interval_km, interval_months, custom_task_name) =
        match (catalog_key, custom_name) {
            (Some(task_type_key), None) => {
                if is_custom_task_key(task_type_key) {
                    return Err(AppError::Validation {
                        message: "Invalid maintenance task type".to_string(),
                        field: Some("task_type_key".to_string()),
                    });
                }

                let baseline = baseline_for(task_type_key).ok_or_else(|| AppError::Validation {
                    message: format!("Unknown maintenance task type: {task_type_key}"),
                    field: Some("task_type_key".to_string()),
                })?;

                let exists: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM maintenance_tasks
                         WHERE vehicle_id = ?1 AND task_type_key = ?2",
                        params![input.vehicle_id, task_type_key],
                        |row| row.get(0),
                    )
                    .map_err(|e| AppError::Database {
                        message: e.to_string(),
                    })?;

                if exists > 0 {
                    return Err(AppError::Validation {
                        message: "This service is already on the schedule".to_string(),
                        field: Some("task_type_key".to_string()),
                    });
                }

                (
                    task_type_key.to_string(),
                    input.interval_km.unwrap_or(baseline.interval_km),
                    input.interval_months.unwrap_or(baseline.interval_months),
                    None,
                )
            }
            (None, Some(name)) => {
                let interval_km = input.interval_km.unwrap_or(0);
                let interval_months = input.interval_months.unwrap_or(0);
                validate_task_intervals(interval_km, interval_months)?;

                let duplicate_name: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM maintenance_tasks
                         WHERE vehicle_id = ?1
                           AND custom_task_name IS NOT NULL
                           AND lower(trim(custom_task_name)) = lower(trim(?2))",
                        params![input.vehicle_id, name],
                        |row| row.get(0),
                    )
                    .map_err(|e| AppError::Database {
                        message: e.to_string(),
                    })?;

                if duplicate_name > 0 {
                    return Err(AppError::Validation {
                        message: "A service with this name is already on the schedule".to_string(),
                        field: Some("custom_task_name".to_string()),
                    });
                }

                (
                    generate_custom_task_key(),
                    interval_km,
                    interval_months,
                    Some(name.to_string()),
                )
            }
            (Some(_), Some(_)) => {
                return Err(AppError::Validation {
                    message: "Provide either a catalog service or a custom service name".to_string(),
                    field: Some("task_type_key".to_string()),
                });
            }
            (None, None) => {
                return Err(AppError::Validation {
                    message: "Select a service type or enter a custom service name".to_string(),
                    field: Some("task_type_key".to_string()),
                });
            }
        };

    validate_task_intervals(interval_km, interval_months)?;

    insert_maintenance_task(
        conn,
        input.vehicle_id,
        &task_type_key,
        interval_km,
        interval_months,
        custom_task_name.as_deref(),
    )?;

    let task_id = conn.last_insert_rowid();
    let task = get_task_by_id(conn, task_id)?;
    Ok(attach_task_status(&task, &vehicle))
}

pub fn update_maintenance_task_intervals(
    conn: &Connection,
    task_id: i64,
    interval_km: i64,
    interval_months: i64,
) -> Result<MaintenanceTaskWithStatus, AppError> {
    validate_task_intervals(interval_km, interval_months)?;

    let rows = conn.execute(
        "UPDATE maintenance_tasks
         SET interval_km = ?1, interval_months = ?2, updated_at = datetime('now')
         WHERE id = ?3",
        params![interval_km, interval_months, task_id],
    )?;

    if rows == 0 {
        return Err(AppError::Database {
            message: "Maintenance task not found".to_string(),
        });
    }

    let task = get_task_by_id(conn, task_id)?;
    let vehicle = get_vehicle_by_id(conn, task.vehicle_id)?;
    Ok(attach_task_status(&task, &vehicle))
}

fn validate_service_date(service_date: &str) -> Result<(), AppError> {
    let trimmed = service_date.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation {
            message: "Service date is required".to_string(),
            field: Some("service_date".to_string()),
        });
    }

    let parsed = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d").map_err(|_| AppError::Validation {
        message: "Invalid service date format".to_string(),
        field: Some("service_date".to_string()),
    })?;

    let today = Local::now().date_naive();
    if parsed > today {
        return Err(AppError::Validation {
            message: "Service date cannot be in the future".to_string(),
            field: Some("service_date".to_string()),
        });
    }

    Ok(())
}

fn row_to_service_log(row: &rusqlite::Row<'_>) -> rusqlite::Result<MaintenanceServiceLog> {
    Ok(MaintenanceServiceLog {
        id: row.get(0)?,
        vehicle_id: row.get(1)?,
        task_id: row.get(2)?,
        custom_service_name: row.get(3)?,
        service_date: row.get(4)?,
        odometer_km: row.get(5)?,
        notes: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn get_service_log_by_id(conn: &Connection, id: i64) -> Result<MaintenanceServiceLog, AppError> {
    conn.query_row(
        "SELECT id, vehicle_id, task_id, custom_service_name, service_date, odometer_km, notes, created_at
         FROM maintenance_service_logs WHERE id = ?1",
        params![id],
        row_to_service_log,
    )
    .map_err(|_| AppError::Database {
        message: "Service log not found".to_string(),
    })
}

fn row_to_service_log_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<MaintenanceServiceLogEntry> {
    Ok(MaintenanceServiceLogEntry {
        id: row.get(0)?,
        vehicle_id: row.get(1)?,
        task_id: row.get(2)?,
        task_type_key: row.get(3)?,
        custom_service_name: row.get(4)?,
        service_date: row.get(5)?,
        odometer_km: row.get(6)?,
        notes: row.get(7)?,
        created_at: row.get(8)?,
    })
}

fn service_entry_label(entry: &MaintenanceServiceLogEntry) -> String {
    if let Some(name) = entry.custom_service_name.as_deref() {
        return name.to_string();
    }
    entry
        .task_type_key
        .clone()
        .unwrap_or_else(|| "unknown".to_string())
}

pub fn get_service_history(
    conn: &Connection,
    vehicle_id: i64,
) -> Result<Vec<MaintenanceServiceLogEntry>, AppError> {
    get_vehicle_by_id(conn, vehicle_id)?;

    let mut stmt = conn.prepare(
        "SELECT l.id, l.vehicle_id, l.task_id, t.task_type_key, l.custom_service_name,
                l.service_date, l.odometer_km, l.notes, l.created_at
         FROM maintenance_service_logs l
         LEFT JOIN maintenance_tasks t ON l.task_id = t.id
         WHERE l.vehicle_id = ?1
         ORDER BY l.service_date DESC, l.created_at DESC",
    )?;

    let entries = stmt
        .query_map(params![vehicle_id], row_to_service_log_entry)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(entries)
}

fn build_most_urgent_task(task: &MaintenanceTask, vehicle: &Vehicle) -> MostUrgentTask {
    let today = Local::now().date_naive();
    let evaluation = evaluate_task(&TaskEvalInput {
        interval_km: task.interval_km,
        interval_months: task.interval_months,
        last_service_date: task.last_service_date.clone(),
        last_service_odometer_km: task.last_service_odometer_km,
        current_odometer_km: vehicle.odometer_km,
        vehicle_created_at: vehicle.created_at.clone(),
        today,
    });

    let (km_remaining, days_remaining) = pick_single_urgency_dimension(
        task.interval_km,
        evaluation.km_remaining,
        evaluation.days_remaining,
    );

    MostUrgentTask {
        task_type_key: task.task_type_key.clone(),
        status: evaluation.status,
        days_remaining,
        km_remaining,
    }
}

fn is_more_urgent(candidate: &MostUrgentTask, current: &MostUrgentTask) -> bool {
    let candidate_rank = status_rank(&candidate.status);
    let current_rank = status_rank(&current.status);
    if candidate_rank != current_rank {
        return candidate_rank > current_rank;
    }

    let candidate_remaining = candidate
        .km_remaining
        .or(candidate.days_remaining)
        .unwrap_or(i64::MAX);
    let current_remaining = current
        .km_remaining
        .or(current.days_remaining)
        .unwrap_or(i64::MAX);

    candidate_remaining < current_remaining
}

fn vehicle_alert_sort_key(row: &VehicleAlertRow) -> (u8, i64) {
    let task = &row.most_urgent_task;
    let rank = status_rank(&task.status);
    let remaining = task.km_remaining.or(task.days_remaining).unwrap_or(i64::MAX);
    (rank, remaining)
}

pub fn get_maintenance_alert_summary(conn: &Connection) -> Result<MaintenanceAlertSummary, AppError> {
    let vehicles = get_all_vehicles(conn)?;
    let total_vehicles = vehicles.len() as i64;
    let mut total_alerts = 0i64;
    let mut worst = TaskStatus::Ok;
    let mut alert_rows: Vec<VehicleAlertRow> = Vec::new();

    for vehicle in &vehicles {
        let tasks = get_tasks_for_vehicle(conn, vehicle.id)?;
        let mut alert_count = 0i64;
        let mut most_urgent: Option<MostUrgentTask> = None;

        for task in &tasks {
            let with_status = attach_task_status(task, vehicle);
            if is_alert_status(&with_status.status) {
                total_alerts += 1;
                alert_count += 1;
                let candidate = build_most_urgent_task(task, vehicle);
                most_urgent = Some(match most_urgent {
                    None => candidate,
                    Some(current) if is_more_urgent(&candidate, &current) => candidate,
                    Some(current) => current,
                });
            }
        }

        if alert_count > 0 {
            let most_urgent_task = most_urgent.expect("alert_count > 0 implies most_urgent");
            worst = worst_status(worst, most_urgent_task.status.clone());
            alert_rows.push(VehicleAlertRow {
                vehicle_id: vehicle.id,
                nickname: vehicle.nickname.clone(),
                alert_count,
                most_urgent_task,
            });
        }
    }

    alert_rows.sort_by(|a, b| {
        let (a_rank, a_rem) = vehicle_alert_sort_key(a);
        let (b_rank, b_rem) = vehicle_alert_sort_key(b);
        b_rank
            .cmp(&a_rank)
            .then_with(|| a_rem.cmp(&b_rem))
    });

    let vehicles_with_alerts = alert_rows.len() as i64;
    alert_rows.truncate(2);

    Ok(MaintenanceAlertSummary {
        total_alerts,
        total_vehicles,
        vehicles_with_alerts,
        worst_status: worst,
        vehicles: alert_rows,
    })
}

#[derive(Debug, Clone)]
pub struct MaintenanceStatusFilters {
    pub vehicle_id: Option<i64>,
    pub status_filter: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MaintenanceStatusRow {
    pub vehicle_id: i64,
    pub vehicle_nickname: String,
    pub task_type_key: String,
    pub status: String,
    pub next_due_date: Option<String>,
    pub next_due_odometer_km: Option<i64>,
    pub km_remaining: Option<i64>,
    pub days_remaining: Option<i64>,
    pub current_odometer_km: i64,
}

#[derive(Debug, Clone)]
pub struct MaintenanceHistoryFilters {
    pub vehicle_id: i64,
    pub task_type_key: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MaintenanceHistoryRow {
    pub service_date: String,
    pub service_name: String,
    pub odometer_km: i64,
    pub notes: Option<String>,
}

fn task_status_key(status: &TaskStatus) -> String {
    serde_json::to_string(status)
        .unwrap()
        .trim_matches('"')
        .to_string()
}

fn matches_status_filter(status: &TaskStatus, filter: &str) -> bool {
    match filter {
        "upcoming" => matches!(status, TaskStatus::Upcoming),
        "due" => matches!(status, TaskStatus::Due),
        "overdue" => matches!(status, TaskStatus::Overdue),
        _ => true,
    }
}

pub fn query_maintenance_status(
    conn: &Connection,
    filters: &MaintenanceStatusFilters,
) -> Result<Vec<MaintenanceStatusRow>, AppError> {
    let status_filter = filters.status_filter.as_deref().unwrap_or("all");

    let vehicles = if let Some(id) = filters.vehicle_id {
        match get_vehicle_by_id(conn, id) {
            Ok(vehicle) => vec![vehicle],
            Err(_) => return Ok(vec![]),
        }
    } else {
        get_all_vehicles(conn)?
    };

    if vehicles.is_empty() {
        return Ok(vec![]);
    }

    let mut rows = Vec::new();
    for vehicle in &vehicles {
        let tasks = get_tasks_for_vehicle(conn, vehicle.id)?;
        for task in &tasks {
            let with_status = attach_task_status(task, vehicle);
            if status_filter != "all" && !matches_status_filter(&with_status.status, status_filter) {
                continue;
            }
            rows.push(MaintenanceStatusRow {
                vehicle_id: vehicle.id,
                vehicle_nickname: vehicle.nickname.clone(),
                task_type_key: task.task_type_key.clone(),
                status: task_status_key(&with_status.status),
                next_due_date: with_status.next_due_date,
                next_due_odometer_km: with_status.next_due_odometer_km,
                km_remaining: with_status.km_remaining,
                days_remaining: with_status.days_remaining,
                current_odometer_km: vehicle.odometer_km,
            });
        }
    }

    Ok(rows)
}

pub fn query_maintenance_history(
    conn: &Connection,
    filters: &MaintenanceHistoryFilters,
) -> Result<Vec<MaintenanceHistoryRow>, AppError> {
    if get_vehicle_by_id(conn, filters.vehicle_id).is_err() {
        return Ok(vec![]);
    }

    let limit = filters.limit.unwrap_or(20).clamp(1, 50) as usize;
    let entries = get_service_history(conn, filters.vehicle_id)?;

    let rows = entries
        .into_iter()
        .filter(|entry| {
            filters.task_type_key.as_ref().is_none_or(|key| {
                entry.task_type_key.as_deref() == Some(key.as_str())
            })
        })
        .take(limit)
        .map(|entry| {
            let service_name = service_entry_label(&entry);
            MaintenanceHistoryRow {
                service_date: entry.service_date,
                service_name,
                odometer_km: entry.odometer_km,
                notes: entry.notes,
            }
        })
        .collect();

    Ok(rows)
}

pub fn log_maintenance_service(
    conn: &Connection,
    input: &LogMaintenanceServiceInput,
) -> Result<LogServiceResult, AppError> {
    validate_service_date(&input.service_date)?;

    if input.odometer_km < 0 {
        return Err(AppError::Validation {
            message: "Odometer must be zero or greater".to_string(),
            field: Some("odometer_km".to_string()),
        });
    }

    let task = get_task_by_id(conn, input.task_id)?;
    let vehicle = get_vehicle_by_id(conn, task.vehicle_id)?;

    let notes = input
        .notes
        .as_ref()
        .map(|n| n.trim())
        .filter(|n| !n.is_empty())
        .map(|n| n.to_string());

    let odometer_will_update = input.odometer_km > vehicle.odometer_km;
    let previous_odometer_km = if odometer_will_update {
        Some(vehicle.odometer_km)
    } else {
        None
    };
    let new_odometer_km = if odometer_will_update {
        Some(input.odometer_km)
    } else {
        None
    };

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;

    let result = (|| -> Result<i64, AppError> {
        tx.execute(
            "INSERT INTO maintenance_service_logs (vehicle_id, task_id, custom_service_name, service_date, odometer_km, notes)
             VALUES (?1, ?2, NULL, ?3, ?4, ?5)",
            params![
                task.vehicle_id,
                input.task_id,
                input.service_date.trim(),
                input.odometer_km,
                notes
            ],
        )?;

        let log_id = tx.last_insert_rowid();

        tx.execute(
            "UPDATE maintenance_tasks
             SET last_service_date = ?1, last_service_odometer_km = ?2, updated_at = datetime('now')
             WHERE id = ?3",
            params![input.service_date.trim(), input.odometer_km, input.task_id],
        )?;

        if odometer_will_update {
            tx.execute(
                "UPDATE vehicles
                 SET odometer_km = ?1, updated_at = datetime('now')
                 WHERE id = ?2",
                params![input.odometer_km, task.vehicle_id],
            )?;
        }

        Ok(log_id)
    })();

    match result {
        Ok(log_id) => {
            tx.commit().map_err(|e| AppError::Database {
                message: e.to_string(),
            })?;

            let log = get_service_log_by_id(conn, log_id)?;
            let updated_task = get_task_by_id(conn, input.task_id)?;
            let updated_vehicle = get_vehicle_by_id(conn, task.vehicle_id)?;
            let task_with_status = attach_task_status(&updated_task, &updated_vehicle);

            Ok(LogServiceResult {
                log,
                task: task_with_status,
                odometer_updated: odometer_will_update,
                previous_odometer_km,
                new_odometer_km,
            })
        }
        Err(e) => {
            let _ = tx.rollback();
            Err(e)
        }
    }
}

pub fn log_custom_service(
    conn: &Connection,
    input: &LogCustomServiceInput,
) -> Result<LogCustomServiceResult, AppError> {
    validate_service_date(&input.service_date)?;

    let custom_name = input.custom_service_name.trim();
    if custom_name.is_empty() {
        return Err(AppError::Validation {
            message: "Service name is required".to_string(),
            field: Some("custom_service_name".to_string()),
        });
    }

    if input.odometer_km < 0 {
        return Err(AppError::Validation {
            message: "Odometer must be zero or greater".to_string(),
            field: Some("odometer_km".to_string()),
        });
    }

    let vehicle = get_vehicle_by_id(conn, input.vehicle_id)?;

    let notes = input
        .notes
        .as_ref()
        .map(|n| n.trim())
        .filter(|n| !n.is_empty())
        .map(|n| n.to_string());

    let odometer_will_update = input.odometer_km > vehicle.odometer_km;
    let previous_odometer_km = if odometer_will_update {
        Some(vehicle.odometer_km)
    } else {
        None
    };
    let new_odometer_km = if odometer_will_update {
        Some(input.odometer_km)
    } else {
        None
    };

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;

    let result = (|| -> Result<i64, AppError> {
        tx.execute(
            "INSERT INTO maintenance_service_logs (vehicle_id, task_id, custom_service_name, service_date, odometer_km, notes)
             VALUES (?1, NULL, ?2, ?3, ?4, ?5)",
            params![
                input.vehicle_id,
                custom_name,
                input.service_date.trim(),
                input.odometer_km,
                notes
            ],
        )?;

        let log_id = tx.last_insert_rowid();

        if odometer_will_update {
            tx.execute(
                "UPDATE vehicles
                 SET odometer_km = ?1, updated_at = datetime('now')
                 WHERE id = ?2",
                params![input.odometer_km, input.vehicle_id],
            )?;
        }

        Ok(log_id)
    })();

    match result {
        Ok(log_id) => {
            tx.commit().map_err(|e| AppError::Database {
                message: e.to_string(),
            })?;

            let log = get_service_log_by_id(conn, log_id)?;

            Ok(LogCustomServiceResult {
                log,
                odometer_updated: odometer_will_update,
                previous_odometer_km,
                new_odometer_km,
            })
        }
        Err(e) => {
            let _ = tx.rollback();
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::maintenance::defaults::DEFAULT_TASKS;
    use crate::maintenance::evaluator::TaskStatus;
    use crate::models::AddMaintenanceTaskInput;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(include_str!("../../migrations/018_maintenance_tables.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/019_custom_service_logs.sql"))
            .unwrap();
        conn.execute_batch(include_str!("../../migrations/020_maintenance_custom_tasks.sql"))
            .unwrap();
        conn
    }

    fn sample_create_input(odometer_km: i64) -> CreateVehicleInput {
        CreateVehicleInput {
            odometer_km,
            make: Some("Toyota".to_string()),
            model: Some("Camry".to_string()),
            year: Some(2020),
            use_default_template: true,
            custom_tasks: None,
        }
    }

    #[test]
    fn maintenance_tables_exist_after_migration() {
        let conn = setup_test_db();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('vehicles', 'maintenance_tasks', 'maintenance_service_logs')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 3);
    }

    #[test]
    fn create_vehicle_seeds_fifteen_tasks() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(12_000)).unwrap();

        let task_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM maintenance_tasks WHERE vehicle_id = ?1",
                params![vehicle.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(task_count, DEFAULT_TASKS.len() as i64);

        for baseline in DEFAULT_TASKS {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM maintenance_tasks
                     WHERE vehicle_id = ?1 AND task_type_key = ?2
                       AND interval_km = ?3 AND interval_months = ?4",
                    params![
                        vehicle.id,
                        baseline.task_type_key,
                        baseline.interval_km,
                        baseline.interval_months
                    ],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(exists, 1, "missing task {}", baseline.task_type_key);
        }
    }

    #[test]
    fn create_vehicle_with_empty_custom_template_has_no_tasks() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(
            &conn,
            &CreateVehicleInput {
                odometer_km: 12_000,
                make: Some("Toyota".to_string()),
                model: Some("Camry".to_string()),
                year: Some(2020),
                use_default_template: false,
                custom_tasks: None,
            },
        )
        .unwrap();

        let task_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM maintenance_tasks WHERE vehicle_id = ?1",
                params![vehicle.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(task_count, 0);
    }

    #[test]
    fn add_maintenance_task_adds_task_with_baseline_intervals() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(
            &conn,
            &CreateVehicleInput {
                odometer_km: 12_000,
                make: None,
                model: None,
                year: None,
                use_default_template: false,
                custom_tasks: None,
            },
        )
        .unwrap();

        let task = add_maintenance_task(
            &conn,
            &AddMaintenanceTaskInput {
                vehicle_id: vehicle.id,
                task_type_key: Some("engine_oil_filter".to_string()),
                custom_task_name: None,
                interval_km: None,
                interval_months: None,
            },
        )
        .unwrap();

        assert_eq!(task.task_type_key, "engine_oil_filter");
        assert_eq!(task.interval_km, 8_000);
        assert_eq!(task.interval_months, 6);
    }

    #[test]
    fn add_custom_maintenance_task_stores_name_and_intervals() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(
            &conn,
            &CreateVehicleInput {
                odometer_km: 12_000,
                make: None,
                model: None,
                year: None,
                use_default_template: false,
                custom_tasks: None,
            },
        )
        .unwrap();

        let task = add_maintenance_task(
            &conn,
            &AddMaintenanceTaskInput {
                vehicle_id: vehicle.id,
                task_type_key: None,
                custom_task_name: Some("Timing belt".to_string()),
                interval_km: Some(120_000),
                interval_months: Some(96),
            },
        )
        .unwrap();

        assert!(task.task_type_key.starts_with("custom_"));
        assert_eq!(task.custom_task_name.as_deref(), Some("Timing belt"));
        assert_eq!(task.interval_km, 120_000);
        assert_eq!(task.interval_months, 96);
    }

    #[test]
    fn add_maintenance_task_rejects_duplicate_task_type() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(12_000)).unwrap();

        let err = add_maintenance_task(
            &conn,
            &AddMaintenanceTaskInput {
                vehicle_id: vehicle.id,
                task_type_key: Some("engine_oil_filter".to_string()),
                custom_task_name: None,
                interval_km: None,
                interval_months: None,
            },
        )
        .unwrap_err();

        match err {
            AppError::Validation { field, .. } => {
                assert_eq!(field, Some("task_type_key".to_string()))
            }
            other => panic!("expected validation error, got {:?}", other),
        }
    }

    #[test]
    fn create_vehicle_with_custom_template_seeds_selected_tasks_only() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(
            &conn,
            &CreateVehicleInput {
                odometer_km: 12_000,
                make: Some("Toyota".to_string()),
                model: Some("Camry".to_string()),
                year: Some(2020),
                use_default_template: false,
                custom_tasks: Some(vec![
                    CreateMaintenanceTaskInput {
                        task_type_key: "engine_oil_filter".to_string(),
                        interval_km: 8_000,
                        interval_months: 6,
                    },
                    CreateMaintenanceTaskInput {
                        task_type_key: "brake_fluid".to_string(),
                        interval_km: 40_000,
                        interval_months: 24,
                    },
                ]),
            },
        )
        .unwrap();

        let task_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM maintenance_tasks WHERE vehicle_id = ?1",
                params![vehicle.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(task_count, 2);
    }

    #[test]
    fn get_all_vehicles_sorted_newest_first() {
        let conn = setup_test_db();

        let older = insert_vehicle(&conn, &sample_create_input(1_000)).unwrap();
        conn.execute(
            "UPDATE vehicles SET created_at = '2020-01-01 00:00:00' WHERE id = ?1",
            params![older.id],
        )
        .unwrap();

        let newer = insert_vehicle(&conn, &sample_create_input(2_000)).unwrap();
        conn.execute(
            "UPDATE vehicles SET created_at = '2021-01-01 00:00:00' WHERE id = ?1",
            params![newer.id],
        )
        .unwrap();

        let vehicles = get_all_vehicles(&conn).unwrap();
        assert_eq!(vehicles.len(), 2);
        assert_eq!(vehicles[0].id, newer.id);
        assert_eq!(vehicles[1].id, older.id);
    }

    #[test]
    fn get_vehicle_with_tasks_includes_evaluated_status_fields() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(5_000)).unwrap();

        let result = get_vehicle_with_tasks(&conn, vehicle.id).unwrap();
        assert_eq!(result.tasks.len(), DEFAULT_TASKS.len());

        for task in &result.tasks {
            assert!(
                task.interval_km > 0 || task.interval_months > 0,
                "task {} has no interval",
                task.task_type_key
            );
            // status serializes as snake_case via TaskStatus
            let status_json = serde_json::to_string(&task.status).unwrap();
            assert!(
                status_json == "\"ok\""
                    || status_json == "\"upcoming\""
                    || status_json == "\"due\""
                    || status_json == "\"overdue\""
            );
        }

        let oil = result
            .tasks
            .iter()
            .find(|t| t.task_type_key == "engine_oil_filter")
            .unwrap();
        assert_eq!(oil.next_due_odometer_km, Some(13_000));
        assert_eq!(oil.km_remaining, Some(8_000));
        assert_eq!(oil.status, TaskStatus::Ok);
    }

    #[test]
    fn create_vehicle_without_metadata_uses_default_label() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(
            &conn,
            &CreateVehicleInput {
                odometer_km: 0,
                make: None,
                model: None,
                year: None,
                use_default_template: true,
                custom_tasks: None,
            },
        )
        .unwrap();

        assert_eq!(vehicle.nickname, "Vehicle");
    }

    #[test]
    fn validation_rejects_negative_odometer() {
        let conn = setup_test_db();
        let err = insert_vehicle(
            &conn,
            &CreateVehicleInput {
                odometer_km: -1,
                make: None,
                model: None,
                year: None,
                use_default_template: true,
                custom_tasks: None,
            },
        )
        .unwrap_err();

        match err {
            AppError::Validation { field, .. } => {
                assert_eq!(field, Some("odometer_km".to_string()))
            }
            other => panic!("expected validation error, got {:?}", other),
        }
    }

    #[test]
    fn validation_rejects_invalid_year() {
        let conn = setup_test_db();
        let err = insert_vehicle(
            &conn,
            &CreateVehicleInput {
                odometer_km: 0,
                make: None,
                model: None,
                year: Some(1800),
                use_default_template: true,
                custom_tasks: None,
            },
        )
        .unwrap_err();

        match err {
            AppError::Validation { field, .. } => assert_eq!(field, Some("year".to_string())),
            other => panic!("expected validation error, got {:?}", other),
        }
    }

    #[test]
    fn update_vehicle_changes_metadata_not_odometer() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(10_000)).unwrap();

        let updated = update_vehicle(
            &conn,
            vehicle.id,
            &UpdateVehicleInput {
                make: Some("Honda".to_string()),
                model: Some("Civic".to_string()),
                year: Some(2022),
            },
        )
        .unwrap();

        assert_eq!(updated.nickname, "2022 Honda Civic");
        assert_eq!(updated.odometer_km, 10_000);
    }

    #[test]
    fn delete_vehicle_cascades_tasks() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(1_000)).unwrap();
        let task_id: i64 = conn
            .query_row(
                "SELECT id FROM maintenance_tasks WHERE vehicle_id = ?1 LIMIT 1",
                params![vehicle.id],
                |row| row.get(0),
            )
            .unwrap();

        conn.execute(
            "INSERT INTO maintenance_service_logs (vehicle_id, task_id, custom_service_name, service_date, odometer_km)
             VALUES (?1, ?2, NULL, '2026-01-01', 1000)",
            params![vehicle.id, task_id],
        )
        .unwrap();

        delete_vehicle(&conn, vehicle.id).unwrap();

        let vehicle_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM vehicles", [], |row| row.get(0))
            .unwrap();
        let task_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM maintenance_tasks", [], |row| row.get(0))
            .unwrap();
        let log_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM maintenance_service_logs",
                [],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(vehicle_count, 0);
        assert_eq!(task_count, 0);
        assert_eq!(log_count, 0);
    }

    #[test]
    fn get_vehicle_by_id_not_found() {
        let conn = setup_test_db();
        let err = get_vehicle_by_id(&conn, 999).unwrap_err();
        match err {
            AppError::Database { message } => assert!(message.contains("not found")),
            other => panic!("expected not found, got {:?}", other),
        }
    }

    #[test]
    fn delete_vehicle_not_found() {
        let conn = setup_test_db();
        let err = delete_vehicle(&conn, 999).unwrap_err();
        match err {
            AppError::Database { message } => assert!(message.contains("not found")),
            other => panic!("expected not found, got {:?}", other),
        }
    }

    #[test]
    fn update_maintenance_task_intervals_valid_update() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(5_000)).unwrap();
        let oil_task_id: i64 = conn
            .query_row(
                "SELECT id FROM maintenance_tasks
                 WHERE vehicle_id = ?1 AND task_type_key = 'engine_oil_filter'",
                params![vehicle.id],
                |row| row.get(0),
            )
            .unwrap();

        let updated = update_maintenance_task_intervals(&conn, oil_task_id, 10_000, 12).unwrap();

        assert_eq!(updated.interval_km, 10_000);
        assert_eq!(updated.interval_months, 12);
        assert_eq!(updated.default_interval_km, 8_000);
        assert_eq!(updated.default_interval_months, 6);
        assert_eq!(updated.next_due_odometer_km, Some(15_000));
        assert_eq!(updated.km_remaining, Some(10_000));
    }

    #[test]
    fn update_maintenance_task_intervals_rejects_both_zero() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(1_000)).unwrap();
        let task_id: i64 = conn
            .query_row(
                "SELECT id FROM maintenance_tasks WHERE vehicle_id = ?1 LIMIT 1",
                params![vehicle.id],
                |row| row.get(0),
            )
            .unwrap();

        let err = update_maintenance_task_intervals(&conn, task_id, 0, 0).unwrap_err();
        match err {
            AppError::Validation { field, .. } => {
                assert_eq!(field, Some("interval_km".to_string()))
            }
            other => panic!("expected validation error, got {:?}", other),
        }
    }

    #[test]
    fn update_maintenance_task_intervals_not_found() {
        let conn = setup_test_db();
        let err = update_maintenance_task_intervals(&conn, 999, 5_000, 6).unwrap_err();
        match err {
            AppError::Database { message } => assert!(message.contains("not found")),
            other => panic!("expected not found, got {:?}", other),
        }
    }

    #[test]
    fn update_vehicle_odometer_persists_value() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(5_000)).unwrap();

        let result = update_vehicle_odometer(&conn, vehicle.id, 52_300).unwrap();

        assert_eq!(result.vehicle.odometer_km, 52_300);
        assert_eq!(result.tasks.len(), DEFAULT_TASKS.len());

        let stored = get_vehicle_by_id(&conn, vehicle.id).unwrap();
        assert_eq!(stored.odometer_km, 52_300);
    }

    #[test]
    fn update_vehicle_odometer_rejects_negative() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(1_000)).unwrap();

        let err = update_vehicle_odometer(&conn, vehicle.id, -1).unwrap_err();
        match err {
            AppError::Validation { field, .. } => {
                assert_eq!(field, Some("odometer_km".to_string()))
            }
            other => panic!("expected validation error, got {:?}", other),
        }
    }

    #[test]
    fn update_vehicle_odometer_not_found() {
        let conn = setup_test_db();
        let err = update_vehicle_odometer(&conn, 999, 10_000).unwrap_err();
        match err {
            AppError::Database { message } => assert!(message.contains("not found")),
            other => panic!("expected not found, got {:?}", other),
        }
    }

    #[test]
    fn update_vehicle_odometer_recalculates_task_status_at_threshold() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(5_000)).unwrap();
        let oil_task_id: i64 = conn
            .query_row(
                "SELECT id FROM maintenance_tasks
                 WHERE vehicle_id = ?1 AND task_type_key = 'engine_oil_filter'",
                params![vehicle.id],
                |row| row.get(0),
            )
            .unwrap();
        let today = Local::now().date_naive().format("%Y-%m-%d").to_string();
        log_maintenance_service(
            &conn,
            &sample_log_input(oil_task_id, &today, 5_000),
        )
        .unwrap();

        let before = get_vehicle_with_tasks(&conn, vehicle.id).unwrap();
        let oil_before = before
            .tasks
            .iter()
            .find(|t| t.task_type_key == "engine_oil_filter")
            .unwrap();
        assert_eq!(oil_before.status, TaskStatus::Ok);
        assert_eq!(oil_before.km_remaining, Some(8_000));

        let after = update_vehicle_odometer(&conn, vehicle.id, 12_500).unwrap();
        let oil_after = after
            .tasks
            .iter()
            .find(|t| t.task_type_key == "engine_oil_filter")
            .unwrap();
        assert_eq!(oil_after.status, TaskStatus::Upcoming);
        assert_eq!(oil_after.km_remaining, Some(500));
    }

    fn sample_log_input(task_id: i64, service_date: &str, odometer_km: i64) -> LogMaintenanceServiceInput {
        LogMaintenanceServiceInput {
            task_id,
            service_date: service_date.to_string(),
            odometer_km,
            notes: None,
        }
    }

    #[test]
    fn log_maintenance_service_updates_task_anchors_and_inserts_log() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(5_000)).unwrap();
        let oil_task_id: i64 = conn
            .query_row(
                "SELECT id FROM maintenance_tasks
                 WHERE vehicle_id = ?1 AND task_type_key = 'engine_oil_filter'",
                params![vehicle.id],
                |row| row.get(0),
            )
            .unwrap();

        let today = Local::now().date_naive().format("%Y-%m-%d").to_string();
        let result = log_maintenance_service(
            &conn,
            &sample_log_input(oil_task_id, &today, 5_000),
        )
        .unwrap();

        assert_eq!(result.log.vehicle_id, vehicle.id);
        assert_eq!(result.log.task_id, Some(oil_task_id));
        assert_eq!(result.log.service_date, today);
        assert_eq!(result.log.odometer_km, 5_000);
        assert!(!result.odometer_updated);

        let task = get_task_by_id(&conn, oil_task_id).unwrap();
        assert_eq!(task.last_service_date, Some(today));
        assert_eq!(task.last_service_odometer_km, Some(5_000));

        let log_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM maintenance_service_logs WHERE task_id = ?1",
                params![oil_task_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(log_count, 1);

        assert_eq!(result.task.status, TaskStatus::Ok);
        assert_eq!(result.task.next_due_odometer_km, Some(13_000));
    }

    #[test]
    fn log_maintenance_service_auto_updates_odometer_when_higher() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(5_000)).unwrap();
        let task_id: i64 = conn
            .query_row(
                "SELECT id FROM maintenance_tasks WHERE vehicle_id = ?1 LIMIT 1",
                params![vehicle.id],
                |row| row.get(0),
            )
            .unwrap();

        let today = Local::now().date_naive().format("%Y-%m-%d").to_string();
        let result = log_maintenance_service(
            &conn,
            &sample_log_input(task_id, &today, 52_300),
        )
        .unwrap();

        assert!(result.odometer_updated);
        assert_eq!(result.previous_odometer_km, Some(5_000));
        assert_eq!(result.new_odometer_km, Some(52_300));

        let stored = get_vehicle_by_id(&conn, vehicle.id).unwrap();
        assert_eq!(stored.odometer_km, 52_300);
    }

    #[test]
    fn log_maintenance_service_does_not_update_odometer_when_lower_or_equal() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(10_000)).unwrap();
        let task_id: i64 = conn
            .query_row(
                "SELECT id FROM maintenance_tasks WHERE vehicle_id = ?1 LIMIT 1",
                params![vehicle.id],
                |row| row.get(0),
            )
            .unwrap();

        let today = Local::now().date_naive().format("%Y-%m-%d").to_string();
        let result = log_maintenance_service(
            &conn,
            &sample_log_input(task_id, &today, 8_000),
        )
        .unwrap();

        assert!(!result.odometer_updated);
        assert!(result.previous_odometer_km.is_none());
        assert!(result.new_odometer_km.is_none());

        let stored = get_vehicle_by_id(&conn, vehicle.id).unwrap();
        assert_eq!(stored.odometer_km, 10_000);
    }

    #[test]
    fn log_maintenance_service_recalculates_status_from_overdue_to_ok() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(10_000)).unwrap();
        conn.execute(
            "UPDATE maintenance_tasks
             SET last_service_odometer_km = 1000, last_service_date = '2026-01-01'
             WHERE vehicle_id = ?1 AND task_type_key = 'engine_oil_filter'",
            params![vehicle.id],
        )
        .unwrap();

        let before = get_vehicle_with_tasks(&conn, vehicle.id).unwrap();
        let oil_before = before
            .tasks
            .iter()
            .find(|t| t.task_type_key == "engine_oil_filter")
            .unwrap();
        assert_eq!(oil_before.status, TaskStatus::Overdue);

        let today = Local::now().date_naive().format("%Y-%m-%d").to_string();
        let result = log_maintenance_service(
            &conn,
            &sample_log_input(oil_before.id, &today, 10_000),
        )
        .unwrap();

        assert_eq!(result.task.status, TaskStatus::Ok);
        assert_eq!(result.task.km_remaining, Some(8_000));
    }

    #[test]
    fn get_service_history_returns_entries_newest_first_with_task_type_key() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(5_000)).unwrap();
        let oil_task_id: i64 = conn
            .query_row(
                "SELECT id FROM maintenance_tasks
                 WHERE vehicle_id = ?1 AND task_type_key = 'engine_oil_filter'",
                params![vehicle.id],
                |row| row.get(0),
            )
            .unwrap();
        let brake_task_id: i64 = conn
            .query_row(
                "SELECT id FROM maintenance_tasks
                 WHERE vehicle_id = ?1 AND task_type_key = 'brake_fluid'",
                params![vehicle.id],
                |row| row.get(0),
            )
            .unwrap();

        log_maintenance_service(
            &conn,
            &LogMaintenanceServiceInput {
                task_id: oil_task_id,
                service_date: "2026-01-15".to_string(),
                odometer_km: 5_000,
                notes: Some("First oil change".to_string()),
            },
        )
        .unwrap();

        log_maintenance_service(
            &conn,
            &LogMaintenanceServiceInput {
                task_id: brake_task_id,
                service_date: "2026-03-20".to_string(),
                odometer_km: 6_000,
                notes: None,
            },
        )
        .unwrap();

        let history = get_service_history(&conn, vehicle.id).unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].service_date, "2026-03-20");
        assert_eq!(history[0].task_type_key.as_deref(), Some("brake_fluid"));
        assert_eq!(history[1].service_date, "2026-01-15");
        assert_eq!(history[1].task_type_key.as_deref(), Some("engine_oil_filter"));
        assert_eq!(history[1].notes, Some("First oil change".to_string()));
    }

    #[test]
    fn get_service_history_empty_for_vehicle_with_no_logs() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(1_000)).unwrap();

        let history = get_service_history(&conn, vehicle.id).unwrap();
        assert!(history.is_empty());
    }

    #[test]
    fn get_service_history_not_found_for_missing_vehicle() {
        let conn = setup_test_db();
        let err = get_service_history(&conn, 999).unwrap_err();
        match err {
            AppError::Database { message } => assert!(message.contains("not found")),
            other => panic!("expected not found, got {:?}", other),
        }
    }

    #[test]
    fn log_maintenance_service_rejects_future_date() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(1_000)).unwrap();
        let task_id: i64 = conn
            .query_row(
                "SELECT id FROM maintenance_tasks WHERE vehicle_id = ?1 LIMIT 1",
                params![vehicle.id],
                |row| row.get(0),
            )
            .unwrap();

        let err = log_maintenance_service(
            &conn,
            &sample_log_input(task_id, "2099-01-01", 1_000),
        )
        .unwrap_err();

        match err {
            AppError::Validation { field, .. } => {
                assert_eq!(field, Some("service_date".to_string()))
            }
            other => panic!("expected validation error, got {:?}", other),
        }
    }

    #[test]
    fn get_maintenance_alert_summary_empty_db() {
        let conn = setup_test_db();
        let summary = get_maintenance_alert_summary(&conn).unwrap();

        assert_eq!(summary.total_alerts, 0);
        assert_eq!(summary.total_vehicles, 0);
        assert_eq!(summary.vehicles_with_alerts, 0);
        assert_eq!(summary.worst_status, TaskStatus::Ok);
        assert!(summary.vehicles.is_empty());
    }

    #[test]
    fn get_maintenance_alert_summary_vehicle_with_upcoming_task() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(10_000)).unwrap();
        let oil_task_id: i64 = conn
            .query_row(
                "SELECT id FROM maintenance_tasks
                 WHERE vehicle_id = ?1 AND task_type_key = 'engine_oil_filter'",
                params![vehicle.id],
                |row| row.get(0),
            )
            .unwrap();
        let today = Local::now().date_naive().format("%Y-%m-%d").to_string();
        log_maintenance_service(
            &conn,
            &sample_log_input(oil_task_id, &today, 10_000),
        )
        .unwrap();
        update_vehicle_odometer(&conn, vehicle.id, 17_600).unwrap();

        let summary = get_maintenance_alert_summary(&conn).unwrap();

        assert_eq!(summary.total_vehicles, 1);
        assert!(summary.total_alerts >= 1);
        assert_eq!(summary.vehicles_with_alerts, 1);
        assert_eq!(summary.worst_status, TaskStatus::Upcoming);
        assert_eq!(summary.vehicles.len(), 1);
        assert_eq!(summary.vehicles[0].vehicle_id, vehicle.id);
        assert_eq!(summary.vehicles[0].nickname, "2020 Toyota Camry");
        assert!(summary.vehicles[0].alert_count >= 1);

        let urgent = &summary.vehicles[0].most_urgent_task;
        assert_eq!(urgent.task_type_key, "engine_oil_filter");
        assert_eq!(urgent.status, TaskStatus::Upcoming);
        assert_eq!(urgent.km_remaining, Some(400));
        assert!(urgent.days_remaining.is_none());
    }

    #[test]
    fn maintenance_data_survives_backup_copy_roundtrip() {
        use std::fs;
        use tempfile::NamedTempFile;

        let source = NamedTempFile::new().unwrap();
        let vehicle_id;
        let logged_task_type_key;
        let logged_odometer_km;

        {
            let conn = Connection::open(source.path()).unwrap();
            conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
            conn.execute_batch(include_str!("../../migrations/018_maintenance_tables.sql"))
                .unwrap();
            conn.execute_batch(include_str!("../../migrations/019_custom_service_logs.sql"))
                .unwrap();
            conn.execute_batch(include_str!("../../migrations/020_maintenance_custom_tasks.sql"))
                .unwrap();

            let vehicle =
                insert_vehicle(&conn, &sample_create_input(42_000)).unwrap();
            vehicle_id = vehicle.id;

            let task_id: i64 = conn
                .query_row(
                    "SELECT id FROM maintenance_tasks WHERE vehicle_id = ?1 AND task_type_key = 'engine_oil_filter'",
                    params![vehicle.id],
                    |row| row.get(0),
                )
                .unwrap();

            let log = log_maintenance_service(
                &conn,
                &sample_log_input(task_id, "2026-01-15", 42_000),
            )
            .unwrap();
            logged_task_type_key = "engine_oil_filter".to_string();
            logged_odometer_km = log.log.odometer_km;

            conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
                .unwrap();
        }

        let backup = NamedTempFile::new().unwrap();
        fs::copy(source.path(), backup.path()).unwrap();

        let restored = Connection::open(backup.path()).unwrap();

        let vehicle_count: i64 = restored
            .query_row("SELECT COUNT(*) FROM vehicles", [], |row| row.get(0))
            .unwrap();
        assert_eq!(vehicle_count, 1);

        let task_count: i64 = restored
            .query_row("SELECT COUNT(*) FROM maintenance_tasks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(task_count, DEFAULT_TASKS.len() as i64);

        let log_count: i64 = restored
            .query_row(
                "SELECT COUNT(*) FROM maintenance_service_logs",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(log_count, 1);

        let nickname: String = restored
            .query_row(
                "SELECT nickname FROM vehicles WHERE id = ?1",
                params![vehicle_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(nickname, "2020 Toyota Camry");

        let (task_type_key, odometer_km): (String, i64) = restored
            .query_row(
                "SELECT t.task_type_key, l.odometer_km
                 FROM maintenance_service_logs l
                 JOIN maintenance_tasks t ON t.id = l.task_id
                 WHERE l.vehicle_id = ?1",
                params![vehicle_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(task_type_key, logged_task_type_key);
        assert_eq!(odometer_km, logged_odometer_km);
    }

    #[test]
    fn query_maintenance_status_returns_evaluated_status() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(5_000)).unwrap();

        let rows = query_maintenance_status(
            &conn,
            &MaintenanceStatusFilters {
                vehicle_id: Some(vehicle.id),
                status_filter: None,
            },
        )
        .unwrap();

        assert_eq!(rows.len(), DEFAULT_TASKS.len());
        let oil = rows
            .iter()
            .find(|r| r.task_type_key == "engine_oil_filter")
            .unwrap();
        assert_eq!(oil.vehicle_nickname, "2020 Toyota Camry");
        assert_eq!(oil.status, "ok");
        assert_eq!(oil.next_due_odometer_km, Some(13_000));
        assert_eq!(oil.km_remaining, Some(8_000));
        assert_eq!(oil.current_odometer_km, 5_000);
    }

    #[test]
    fn query_maintenance_status_filters_by_overdue() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(10_000)).unwrap();
        conn.execute(
            "UPDATE maintenance_tasks
             SET last_service_odometer_km = 1000, last_service_date = '2026-01-01'
             WHERE vehicle_id = ?1 AND task_type_key = 'engine_oil_filter'",
            params![vehicle.id],
        )
        .unwrap();

        let rows = query_maintenance_status(
            &conn,
            &MaintenanceStatusFilters {
                vehicle_id: Some(vehicle.id),
                status_filter: Some("overdue".to_string()),
            },
        )
        .unwrap();

        assert!(!rows.is_empty());
        assert!(rows.iter().all(|r| r.status == "overdue"));
        assert!(
            rows.iter()
                .any(|r| r.task_type_key == "engine_oil_filter")
        );
    }

    #[test]
    fn query_maintenance_history_returns_logs_newest_first() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(5_000)).unwrap();
        let oil_task_id: i64 = conn
            .query_row(
                "SELECT id FROM maintenance_tasks
                 WHERE vehicle_id = ?1 AND task_type_key = 'engine_oil_filter'",
                params![vehicle.id],
                |row| row.get(0),
            )
            .unwrap();
        let brake_task_id: i64 = conn
            .query_row(
                "SELECT id FROM maintenance_tasks
                 WHERE vehicle_id = ?1 AND task_type_key = 'brake_fluid'",
                params![vehicle.id],
                |row| row.get(0),
            )
            .unwrap();

        log_maintenance_service(
            &conn,
            &LogMaintenanceServiceInput {
                task_id: oil_task_id,
                service_date: "2026-01-15".to_string(),
                odometer_km: 5_000,
                notes: Some("Oil change".to_string()),
            },
        )
        .unwrap();

        log_maintenance_service(
            &conn,
            &LogMaintenanceServiceInput {
                task_id: brake_task_id,
                service_date: "2026-03-20".to_string(),
                odometer_km: 6_000,
                notes: None,
            },
        )
        .unwrap();

        let rows = query_maintenance_history(
            &conn,
            &MaintenanceHistoryFilters {
                vehicle_id: vehicle.id,
                task_type_key: None,
                limit: None,
            },
        )
        .unwrap();

        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].service_date, "2026-03-20");
        assert_eq!(rows[0].service_name, "brake_fluid");
        assert_eq!(rows[1].service_date, "2026-01-15");
        assert_eq!(rows[1].service_name, "engine_oil_filter");
        assert_eq!(rows[1].notes, Some("Oil change".to_string()));
    }

    #[test]
    fn query_maintenance_status_empty_when_no_vehicles() {
        let conn = setup_test_db();

        let rows = query_maintenance_status(
            &conn,
            &MaintenanceStatusFilters {
                vehicle_id: None,
                status_filter: None,
            },
        )
        .unwrap();

        assert!(rows.is_empty());
    }

    #[test]
    fn query_maintenance_history_filters_by_task_type_key() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(5_000)).unwrap();
        let oil_task_id: i64 = conn
            .query_row(
                "SELECT id FROM maintenance_tasks
                 WHERE vehicle_id = ?1 AND task_type_key = 'engine_oil_filter'",
                params![vehicle.id],
                |row| row.get(0),
            )
            .unwrap();
        let brake_task_id: i64 = conn
            .query_row(
                "SELECT id FROM maintenance_tasks
                 WHERE vehicle_id = ?1 AND task_type_key = 'brake_fluid'",
                params![vehicle.id],
                |row| row.get(0),
            )
            .unwrap();

        log_maintenance_service(
            &conn,
            &sample_log_input(oil_task_id, "2026-01-15", 5_000),
        )
        .unwrap();
        log_maintenance_service(
            &conn,
            &sample_log_input(brake_task_id, "2026-03-20", 6_000),
        )
        .unwrap();

        let rows = query_maintenance_history(
            &conn,
            &MaintenanceHistoryFilters {
                vehicle_id: vehicle.id,
                task_type_key: Some("engine_oil_filter".to_string()),
                limit: None,
            },
        )
        .unwrap();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].service_name, "engine_oil_filter");
    }

    #[test]
    fn log_custom_service_inserts_history_without_updating_tasks() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(12_000)).unwrap();
        let oil_before = conn
            .query_row(
                "SELECT last_service_date FROM maintenance_tasks
                 WHERE vehicle_id = ?1 AND task_type_key = 'engine_oil_filter'",
                params![vehicle.id],
                |row| row.get::<_, Option<String>>(0),
            )
            .unwrap();

        let result = log_custom_service(
            &conn,
            &LogCustomServiceInput {
                vehicle_id: vehicle.id,
                custom_service_name: "AC recharge".to_string(),
                service_date: "2026-02-10".to_string(),
                odometer_km: 12_500,
                notes: Some("Summer prep".to_string()),
            },
        )
        .unwrap();

        assert!(result.odometer_updated);
        assert_eq!(result.new_odometer_km, Some(12_500));
        assert_eq!(result.log.custom_service_name.as_deref(), Some("AC recharge"));
        assert!(result.log.task_id.is_none());

        let oil_after: Option<String> = conn
            .query_row(
                "SELECT last_service_date FROM maintenance_tasks
                 WHERE vehicle_id = ?1 AND task_type_key = 'engine_oil_filter'",
                params![vehicle.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(oil_after, oil_before);

        let history = get_service_history(&conn, vehicle.id).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].custom_service_name.as_deref(), Some("AC recharge"));
        assert!(history[0].task_type_key.is_none());
    }

    #[test]
    fn log_custom_service_rejects_blank_name() {
        let conn = setup_test_db();
        let vehicle = insert_vehicle(&conn, &sample_create_input(1_000)).unwrap();

        let err = log_custom_service(
            &conn,
            &LogCustomServiceInput {
                vehicle_id: vehicle.id,
                custom_service_name: "   ".to_string(),
                service_date: "2026-01-01".to_string(),
                odometer_km: 1_000,
                notes: None,
            },
        )
        .unwrap_err();

        match err {
            AppError::Validation { field, .. } => {
                assert_eq!(field, Some("custom_service_name".to_string()))
            }
            other => panic!("expected validation error, got {:?}", other),
        }
    }
}
