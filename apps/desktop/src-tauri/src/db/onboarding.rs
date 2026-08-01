use rusqlite::Connection;

use crate::db::config;
use crate::error::AppError;

const ONBOARDING_COMPLETED_CONFIG_KEY: &str = "onboarding_completed";

pub fn has_budget_data(conn: &Connection) -> Result<bool, AppError> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM budget_groups", [], |row| row.get(0))?;
    Ok(count > 0)
}

pub fn is_completed(conn: &Connection) -> bool {
    config::get(conn, ONBOARDING_COMPLETED_CONFIG_KEY).as_deref() == Some("true")
}

pub fn set_completed(conn: &Connection) -> Result<(), AppError> {
    config::set(conn, ONBOARDING_COMPLETED_CONFIG_KEY, "true").map_err(AppError::from)
}
