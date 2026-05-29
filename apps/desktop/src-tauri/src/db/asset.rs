use rusqlite::{params, Connection};

use crate::error::AppError;
use crate::models::{CreateAssetInput, PassiveAsset, UpdateAssetInput};

const VALID_ASSET_TYPES: &[&str] = &["real_estate", "vehicle", "business", "other"];

fn row_to_asset(row: &rusqlite::Row<'_>) -> rusqlite::Result<PassiveAsset> {
    Ok(PassiveAsset {
        id: row.get(0)?,
        name: row.get(1)?,
        asset_type: row.get(2)?,
        value_cents: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

pub fn insert_asset(conn: &Connection, input: &CreateAssetInput) -> Result<PassiveAsset, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation {
            message: "Asset name is required".to_string(),
            field: Some("name".to_string()),
        });
    }

    if !VALID_ASSET_TYPES.contains(&input.asset_type.as_str()) {
        return Err(AppError::Validation {
            message: format!("Invalid asset type: {}", input.asset_type),
            field: Some("asset_type".to_string()),
        });
    }

    conn.execute(
        "INSERT INTO passive_assets (name, asset_type, value_cents) VALUES (?1, ?2, ?3)",
        params![name, input.asset_type, input.value_cents],
    )?;

    let id = conn.last_insert_rowid();
    get_asset_by_id(conn, id)
}

pub fn get_all_assets(conn: &Connection) -> Result<Vec<PassiveAsset>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, asset_type, value_cents, created_at, updated_at FROM passive_assets ORDER BY name",
    )?;

    let assets = stmt
        .query_map([], row_to_asset)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(assets)
}

pub fn get_asset_by_id(conn: &Connection, id: i64) -> Result<PassiveAsset, AppError> {
    conn.query_row(
        "SELECT id, name, asset_type, value_cents, created_at, updated_at FROM passive_assets WHERE id = ?1",
        params![id],
        row_to_asset,
    )
    .map_err(|_| AppError::Database {
        message: "Asset not found".to_string(),
    })
}

/// Returns (old_value_cents, updated PassiveAsset)
pub fn update_asset_value(
    conn: &Connection,
    id: i64,
    value_cents: i64,
) -> Result<(i64, PassiveAsset), AppError> {
    let old_value: i64 = conn
        .query_row(
            "SELECT value_cents FROM passive_assets WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|_| AppError::Database {
            message: "Asset not found".to_string(),
        })?;

    conn.execute(
        "UPDATE passive_assets SET value_cents = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![value_cents, id],
    )?;

    let asset = get_asset_by_id(conn, id)?;
    Ok((old_value, asset))
}

pub fn update_asset(
    conn: &Connection,
    id: i64,
    input: &UpdateAssetInput,
) -> Result<PassiveAsset, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation {
            message: "Asset name is required".to_string(),
            field: Some("name".to_string()),
        });
    }

    if !VALID_ASSET_TYPES.contains(&input.asset_type.as_str()) {
        return Err(AppError::Validation {
            message: format!("Invalid asset type: {}", input.asset_type),
            field: Some("asset_type".to_string()),
        });
    }

    let rows = conn.execute(
        "UPDATE passive_assets SET name = ?1, asset_type = ?2, updated_at = datetime('now') WHERE id = ?3",
        params![name, input.asset_type, id],
    )?;

    if rows == 0 {
        return Err(AppError::Database {
            message: "Asset not found".to_string(),
        });
    }

    get_asset_by_id(conn, id)
}

pub fn delete_asset(conn: &Connection, id: i64) -> Result<(), AppError> {
    let rows = conn.execute("DELETE FROM passive_assets WHERE id = ?1", params![id])?;
    if rows == 0 {
        return Err(AppError::Database {
            message: "Asset not found".to_string(),
        });
    }
    Ok(())
}
