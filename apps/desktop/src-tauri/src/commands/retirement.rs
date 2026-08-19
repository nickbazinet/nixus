use tauri::State;

use crate::db::config;
use crate::db::retirement as retirement_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::RetirementInput;

const RETIREMENT_PENSION_CONFIG_KEY: &str = "retirement_pension_annual_cents";
const RETIREMENT_EMPLOYER_PENSION_CONFIG_KEY: &str = "retirement_employer_pension_annual_cents";
const RETIREMENT_EMPLOYER_PENSION_START_AGE_CONFIG_KEY: &str =
    "retirement_employer_pension_start_age_years";
const RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY: &str = "retirement_pension_tax_rate_percent";
const RETIREMENT_AGE_OVERRIDE_CONFIG_KEY: &str = "retirement_age_override_years";

#[tauri::command(rename_all = "snake_case")]
pub fn get_retirement_input(state: State<DbState>) -> Result<RetirementInput, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    retirement_db::get_retirement_input(&conn)
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_retirement_pension_cents(state: State<DbState>) -> Result<Option<i64>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

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

    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    config::set(&conn, RETIREMENT_PENSION_CONFIG_KEY, &cents.to_string()).map_err(|e| {
        AppError::Database {
            message: e.to_string(),
        }
    })
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_retirement_employer_pension_cents(
    state: State<DbState>,
) -> Result<Option<i64>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    Ok(config::get(&conn, RETIREMENT_EMPLOYER_PENSION_CONFIG_KEY)
        .and_then(|v| v.parse::<i64>().ok()))
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_retirement_employer_pension_cents(
    state: State<DbState>,
    cents: i64,
) -> Result<(), AppError> {
    if cents < 0 {
        return Err(AppError::Validation {
            message: "Pension amount cannot be negative".to_string(),
            field: Some("cents".to_string()),
        });
    }

    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    config::set(
        &conn,
        RETIREMENT_EMPLOYER_PENSION_CONFIG_KEY,
        &cents.to_string(),
    )
    .map_err(|e| AppError::Database {
        message: e.to_string(),
    })
}

/// Extracted from the command body because a `#[tauri::command]` needs a `State<DbState>` that no
/// unit test can build — inlining this check would make the range unreachable from a test.
fn validate_employer_pension_start_age(years: i64) -> Result<(), AppError> {
    if !(18..=100).contains(&years) {
        return Err(AppError::Validation {
            message: "Employer pension start age must be between 18 and 100".to_string(),
            field: Some("years".to_string()),
        });
    }

    Ok(())
}

/// Extracted for the same test-reachability reason as `validate_employer_pension_start_age`.
fn validate_pension_tax_rate_percent(percent: i64) -> Result<(), AppError> {
    if !(0..=100).contains(&percent) {
        return Err(AppError::Validation {
            message: "Pension tax rate must be between 0 and 100".to_string(),
            field: Some("percent".to_string()),
        });
    }

    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_retirement_employer_pension_start_age(
    state: State<DbState>,
) -> Result<Option<i64>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    Ok(config::get(&conn, RETIREMENT_EMPLOYER_PENSION_START_AGE_CONFIG_KEY)
        .and_then(|v| v.parse::<i64>().ok()))
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_retirement_employer_pension_start_age(
    state: State<DbState>,
    years: i64,
) -> Result<(), AppError> {
    validate_employer_pension_start_age(years)?;

    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    config::set(
        &conn,
        RETIREMENT_EMPLOYER_PENSION_START_AGE_CONFIG_KEY,
        &years.to_string(),
    )
    .map_err(|e| AppError::Database {
        message: e.to_string(),
    })
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_retirement_pension_tax_rate_percent(
    state: State<DbState>,
) -> Result<Option<i64>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    Ok(config::get(&conn, RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY)
        .and_then(|v| v.parse::<i64>().ok()))
}

#[tauri::command(rename_all = "snake_case")]
pub fn set_retirement_pension_tax_rate_percent(
    state: State<DbState>,
    percent: i64,
) -> Result<(), AppError> {
    validate_pension_tax_rate_percent(percent)?;

    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    config::set(
        &conn,
        RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY,
        &percent.to_string(),
    )
    .map_err(|e| AppError::Database {
        message: e.to_string(),
    })
}

#[tauri::command(rename_all = "snake_case")]
pub fn clear_retirement_pension_tax_rate_percent(state: State<DbState>) -> Result<(), AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    config::delete(&conn, RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY).map_err(|e| {
        AppError::Database {
            message: e.to_string(),
        }
    })
}

#[tauri::command(rename_all = "snake_case")]
pub fn get_retirement_age_override(state: State<DbState>) -> Result<Option<i64>, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

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

    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

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
    fn employer_pension_defaults_to_none_when_unset() {
        let conn = setup_test_db();
        assert_eq!(
            config::get(&conn, RETIREMENT_EMPLOYER_PENSION_CONFIG_KEY),
            None
        );
    }

    #[test]
    fn employer_pension_round_trips_through_config() {
        let conn = setup_test_db();
        config::set(&conn, RETIREMENT_EMPLOYER_PENSION_CONFIG_KEY, "3600000").unwrap();
        assert_eq!(
            config::get(&conn, RETIREMENT_EMPLOYER_PENSION_CONFIG_KEY),
            Some("3600000".to_string())
        );
    }

    #[test]
    fn employer_pension_is_stored_under_a_distinct_key_from_the_government_pension() {
        let conn = setup_test_db();
        config::set(&conn, RETIREMENT_PENSION_CONFIG_KEY, "1954800").unwrap();
        config::set(&conn, RETIREMENT_EMPLOYER_PENSION_CONFIG_KEY, "3600000").unwrap();
        assert_eq!(
            config::get(&conn, RETIREMENT_PENSION_CONFIG_KEY),
            Some("1954800".to_string())
        );
        assert_eq!(
            config::get(&conn, RETIREMENT_EMPLOYER_PENSION_CONFIG_KEY),
            Some("3600000".to_string())
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

    #[test]
    fn employer_pension_start_age_defaults_to_none_when_unset() {
        let conn = setup_test_db();
        assert_eq!(
            config::get(&conn, RETIREMENT_EMPLOYER_PENSION_START_AGE_CONFIG_KEY),
            None
        );
    }

    #[test]
    fn employer_pension_start_age_round_trips_through_config() {
        let conn = setup_test_db();
        config::set(&conn, RETIREMENT_EMPLOYER_PENSION_START_AGE_CONFIG_KEY, "65").unwrap();
        assert_eq!(
            config::get(&conn, RETIREMENT_EMPLOYER_PENSION_START_AGE_CONFIG_KEY),
            Some("65".to_string())
        );
    }

    #[test]
    fn employer_pension_start_age_accepts_the_inclusive_bounds() {
        assert!(validate_employer_pension_start_age(18).is_ok());
        assert!(validate_employer_pension_start_age(65).is_ok());
        assert!(validate_employer_pension_start_age(100).is_ok());
    }

    #[test]
    fn employer_pension_start_age_rejects_values_outside_18_to_100() {
        for years in [-1, 0, 17, 101, 1_000] {
            assert!(
                matches!(
                    validate_employer_pension_start_age(years),
                    Err(AppError::Validation { .. })
                ),
                "expected {years} to be rejected"
            );
        }
    }

    #[test]
    fn pension_tax_rate_defaults_to_none_when_unset() {
        let conn = setup_test_db();
        assert_eq!(config::get(&conn, RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY), None);
    }

    #[test]
    fn pension_tax_rate_round_trips_through_config() {
        let conn = setup_test_db();
        config::set(&conn, RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY, "20").unwrap();
        assert_eq!(
            config::get(&conn, RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY),
            Some("20".to_string())
        );
    }

    #[test]
    fn pension_tax_rate_accepts_the_inclusive_bounds() {
        assert!(validate_pension_tax_rate_percent(0).is_ok());
        assert!(validate_pension_tax_rate_percent(20).is_ok());
        assert!(validate_pension_tax_rate_percent(100).is_ok());
    }

    #[test]
    fn pension_tax_rate_rejects_values_outside_0_to_100() {
        for percent in [-1, 101, 1_000] {
            assert!(
                matches!(
                    validate_pension_tax_rate_percent(percent),
                    Err(AppError::Validation { .. })
                ),
                "expected {percent} to be rejected"
            );
        }
    }

    #[test]
    fn the_two_new_keys_are_distinct_from_every_other_retirement_key() {
        let conn = setup_test_db();
        config::set(&conn, RETIREMENT_PENSION_CONFIG_KEY, "1954800").unwrap();
        config::set(&conn, RETIREMENT_EMPLOYER_PENSION_CONFIG_KEY, "3600000").unwrap();
        config::set(&conn, RETIREMENT_AGE_OVERRIDE_CONFIG_KEY, "47").unwrap();
        config::set(&conn, RETIREMENT_EMPLOYER_PENSION_START_AGE_CONFIG_KEY, "65").unwrap();
        config::set(&conn, RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY, "20").unwrap();

        assert_eq!(
            config::get(&conn, RETIREMENT_EMPLOYER_PENSION_START_AGE_CONFIG_KEY),
            Some("65".to_string())
        );
        assert_eq!(
            config::get(&conn, RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY),
            Some("20".to_string())
        );
        assert_eq!(
            config::get(&conn, RETIREMENT_AGE_OVERRIDE_CONFIG_KEY),
            Some("47".to_string())
        );
        assert_eq!(
            config::get(&conn, RETIREMENT_EMPLOYER_PENSION_CONFIG_KEY),
            Some("3600000".to_string())
        );
        assert_eq!(
            config::get(&conn, RETIREMENT_PENSION_CONFIG_KEY),
            Some("1954800".to_string())
        );
    }

    #[test]
    fn clearing_the_pension_tax_rate_returns_it_to_never_set() {
        let conn = setup_test_db();
        config::set(&conn, RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY, "20").unwrap();
        config::delete(&conn, RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY).unwrap();

        // Not "0" — the client tells auto-estimate apart from a deliberate 0% by absence alone.
        assert_eq!(config::get(&conn, RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY), None);
    }

    #[test]
    fn clearing_an_unset_pension_tax_rate_is_a_no_op() {
        let conn = setup_test_db();
        assert!(config::delete(&conn, RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY).is_ok());
        assert_eq!(config::get(&conn, RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY), None);
    }

    #[test]
    fn clearing_the_pension_tax_rate_leaves_every_other_retirement_key_alone() {
        let conn = setup_test_db();
        config::set(&conn, RETIREMENT_PENSION_CONFIG_KEY, "1954800").unwrap();
        config::set(&conn, RETIREMENT_EMPLOYER_PENSION_CONFIG_KEY, "3600000").unwrap();
        config::set(&conn, RETIREMENT_AGE_OVERRIDE_CONFIG_KEY, "47").unwrap();
        config::set(&conn, RETIREMENT_EMPLOYER_PENSION_START_AGE_CONFIG_KEY, "65").unwrap();
        config::set(&conn, RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY, "20").unwrap();

        config::delete(&conn, RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY).unwrap();

        assert_eq!(config::get(&conn, RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY), None);
        assert_eq!(
            config::get(&conn, RETIREMENT_PENSION_CONFIG_KEY),
            Some("1954800".to_string())
        );
        assert_eq!(
            config::get(&conn, RETIREMENT_EMPLOYER_PENSION_CONFIG_KEY),
            Some("3600000".to_string())
        );
        assert_eq!(
            config::get(&conn, RETIREMENT_AGE_OVERRIDE_CONFIG_KEY),
            Some("47".to_string())
        );
        assert_eq!(
            config::get(&conn, RETIREMENT_EMPLOYER_PENSION_START_AGE_CONFIG_KEY),
            Some("65".to_string())
        );
    }

    #[test]
    fn a_cleared_pension_tax_rate_can_be_set_again() {
        let conn = setup_test_db();
        config::set(&conn, RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY, "20").unwrap();
        config::delete(&conn, RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY).unwrap();
        config::set(&conn, RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY, "35").unwrap();

        assert_eq!(
            config::get(&conn, RETIREMENT_PENSION_TAX_RATE_CONFIG_KEY),
            Some("35".to_string())
        );
    }
}
