use rusqlite::{params, Connection};

use crate::error::AppError;
use crate::models::{CreateAssetInput, PassiveAsset, StockHolding, UpdateAssetInput};

const VALID_ASSET_TYPES: &[&str] = &["real_estate", "vehicle", "business", "other", "stock"];

/// The asset type whose value is derived from a `stock_holdings` row instead of typed in.
pub const STOCK_ASSET_TYPE: &str = "stock";

/// `passive_assets` columns followed by `stock_holdings` columns, LEFT JOINed so one read answers
/// both "what assets are there" and "which of them are priced holdings".
const ASSET_SELECT: &str = "SELECT a.id, a.name, a.asset_type, a.value_cents, a.created_at, a.updated_at, \
     h.passive_asset_id, h.symbol, h.exchange, h.currency, h.quantity_micros, \
     h.last_price_cents, h.last_price_at, h.fx_rate_to_base_micros, h.created_at, h.updated_at \
     FROM passive_assets a LEFT JOIN stock_holdings h ON h.passive_asset_id = a.id";

pub(crate) fn row_to_asset(row: &rusqlite::Row<'_>) -> rusqlite::Result<PassiveAsset> {
    let holding_id: Option<i64> = row.get(6)?;
    let stock = match holding_id {
        Some(passive_asset_id) => Some(StockHolding {
            passive_asset_id,
            symbol: row.get(7)?,
            exchange: row.get(8)?,
            currency: row.get(9)?,
            quantity_micros: row.get(10)?,
            last_price_cents: row.get(11)?,
            last_price_at: row.get(12)?,
            fx_rate_to_base_micros: row.get(13)?,
            created_at: row.get(14)?,
            updated_at: row.get(15)?,
        }),
        None => None,
    };

    Ok(PassiveAsset {
        id: row.get(0)?,
        name: row.get(1)?,
        asset_type: row.get(2)?,
        value_cents: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
        stock,
    })
}

fn validated_name(name: &str) -> Result<&str, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Validation {
            message: "Asset name is required".to_string(),
            field: Some("name".to_string()),
        });
    }

    Ok(name)
}

fn validated_type(asset_type: &str) -> Result<(), AppError> {
    if !VALID_ASSET_TYPES.contains(&asset_type) {
        return Err(AppError::Validation {
            message: format!("Invalid asset type: {}", asset_type),
            field: Some("asset_type".to_string()),
        });
    }

    Ok(())
}

/// Refuses the generic paths for a stock, whose value is derived and whose type is structural.
///
/// It also guards the AI's `update_asset_value` tool: a model that typed a number onto a holding
/// would have it silently overwritten by the next refresh, which is worse than a refusal.
fn reject_stock(field: &str) -> AppError {
    AppError::Validation {
        message: "A stock asset is managed through its holding, not this field".to_string(),
        field: Some(field.to_string()),
    }
}

fn is_stock(conn: &Connection, id: i64) -> Result<bool, AppError> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM passive_assets WHERE id = ?1 AND asset_type = ?2)",
        params![id, STOCK_ASSET_TYPE],
        |row| row.get(0),
    )
    .map_err(AppError::from)
}

/// CAPTURE-SANCTIONED (AD-3): reached only through `ActiveDataset::write`.
pub fn insert_asset(conn: &Connection, input: &CreateAssetInput) -> Result<PassiveAsset, AppError> {
    let name = validated_name(&input.name)?;
    validated_type(&input.asset_type)?;

    if input.asset_type == STOCK_ASSET_TYPE {
        return Err(reject_stock("asset_type"));
    }

    conn.execute(
        "INSERT INTO passive_assets (name, asset_type, value_cents) VALUES (?1, ?2, ?3)",
        params![name, input.asset_type, input.value_cents],
    )?;

    let id = conn.last_insert_rowid();
    get_asset_by_id(conn, id)
}

pub fn get_all_assets(conn: &Connection) -> Result<Vec<PassiveAsset>, AppError> {
    let mut stmt = conn.prepare(&format!("{ASSET_SELECT} ORDER BY a.name"))?;

    let assets = stmt
        .query_map([], row_to_asset)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(assets)
}

pub fn get_asset_by_id(conn: &Connection, id: i64) -> Result<PassiveAsset, AppError> {
    conn.query_row(
        &format!("{ASSET_SELECT} WHERE a.id = ?1"),
        params![id],
        row_to_asset,
    )
    .map_err(|_| AppError::Database {
        message: "Asset not found".to_string(),
    })
}

/// Returns (old_value_cents, updated PassiveAsset)
/// CAPTURE-SANCTIONED (AD-3): every caller reaches this through `ActiveDataset::write`, the AI chat
/// action path included since Story 18 put `commands/chat.rs` on one captured transaction.
pub fn update_asset_value(
    conn: &Connection,
    id: i64,
    value_cents: i64,
) -> Result<(i64, PassiveAsset), AppError> {
    if is_stock(conn, id)? {
        return Err(reject_stock("value_cents"));
    }

    set_value_cents(conn, id, value_cents)
}

/// The one statement that moves `passive_assets.value_cents`, shared by the hand-typed path above
/// and by `db::stock`'s derived writes.
/// CAPTURE-SANCTIONED (AD-3): reached only through `ActiveDataset::write`.
pub(crate) fn set_value_cents(
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

/// CAPTURE-SANCTIONED (AD-3): reached only through `ActiveDataset::write`.
pub fn update_asset(
    conn: &Connection,
    id: i64,
    input: &UpdateAssetInput,
) -> Result<PassiveAsset, AppError> {
    let name = validated_name(&input.name)?;
    validated_type(&input.asset_type)?;

    // Either direction is a type change the data model cannot honour: a stock without a holding has
    // no price, and a holding whose asset is no longer a stock is unreachable but still cascading.
    if is_stock(conn, id)? != (input.asset_type == STOCK_ASSET_TYPE) {
        return Err(reject_stock("asset_type"));
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

/// CAPTURE-SANCTIONED (AD-3): reached only through `ActiveDataset::write`.
pub fn delete_asset(conn: &Connection, id: i64) -> Result<(), AppError> {
    let rows = conn.execute("DELETE FROM passive_assets WHERE id = ?1", params![id])?;
    if rows == 0 {
        return Err(AppError::Database {
            message: "Asset not found".to_string(),
        });
    }
    Ok(())
}
