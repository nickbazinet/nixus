use tauri::State;

use crate::db::config;
use crate::db::retirement as retirement_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::RetirementInput;

const RETIREMENT_PENSION_CONFIG_KEY: &str = "retirement_pension_annual_cents";
const RETIREMENT_AGE_OVERRIDE_CONFIG_KEY: &str = "retirement_age_override_years";

#[tauri::command(rename_all = "snake_case")]
pub fn get_retirement_input(state: State<DbState>) -> Result<RetirementInput, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    retirement_db::get_retirement_input(&conn)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_retirement_pension_cents(state: State<DbState>) -> Result<Option<i64>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    Ok(config::get(&conn, RETIREMENT_PENSION_CONFIG_KEY).and_then(|v| v.parse::<i64>().ok()))
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_retirement_pension_cents(
    state: State<DbState>,
    cents: i64,
) -> Result<(), AppError> {
    if cents < 0 {
        return Err(AppError::Validation {
            message: "Pension amount cannot be negative".to_string(),
            field: Some("cents".to_string()),
        });
    }

    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    config::set(&conn, RETIREMENT_PENSION_CONFIG_KEY, &cents.to_string()).map_err(|e| {
        AppError::Database {
            message: e.to_string(),
        }
    })
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_retirement_age_override(state: State<DbState>) -> Result<Option<i64>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    Ok(config::get(&conn, RETIREMENT_AGE_OVERRIDE_CONFIG_KEY).and_then(|v| v.parse::<i64>().ok()))
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_retirement_age_override(state: State<DbState>, years: i64) -> Result<(), AppError> {
    if !(18..=100).contains(&years) {
        return Err(AppError::Validation {
            message: "Age must be between 18 and 100".to_string(),
            field: Some("years".to_string()),
        });
    }

    let conn = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    config::set(&conn, RETIREMENT_AGE_OVERRIDE_CONFIG_KEY, &years.to_string()).map_err(|e| {
        AppError::Database {
            message: e.to_string(),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn pension_defaults_to_none_when_unset() {
        let conn = setup_test_db();
        assert_eq!(config::get(&conn, RETIREMENT_PENSION_CONFIG_KEY), None);
    }

    #[test]
    fn pension_round_trips_through_config() {
        let conn = setup_test_db();
        config::set(&conn, RETIREMENT_PENSION_CONFIG_KEY, "1954800").unwrap();
        assert_eq!(
            config::get(&conn, RETIREMENT_PENSION_CONFIG_KEY),
            Some("1954800".to_string())
        );
    }

    #[test]
    fn age_override_round_trips_through_config() {
        let conn = setup_test_db();
        config::set(&conn, RETIREMENT_AGE_OVERRIDE_CONFIG_KEY, "47").unwrap();
        assert_eq!(
            config::get(&conn, RETIREMENT_AGE_OVERRIDE_CONFIG_KEY),
            Some("47".to_string())
        );
    }
}
