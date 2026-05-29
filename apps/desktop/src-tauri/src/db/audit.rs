use rusqlite::{params, Connection};

use crate::error::AppError;

pub fn insert_audit_log(
    conn: &Connection,
    entity_type: &str,
    entity_id: i64,
    action: &str,
    old_value: Option<&str>,
    new_value: Option<&str>,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![entity_type, entity_id, action, old_value, new_value],
    )?;
    Ok(())
}
