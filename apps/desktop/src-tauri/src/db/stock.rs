use rusqlite::{params, Connection, OptionalExtension};

use crate::db::asset::{self as asset_db, STOCK_ASSET_TYPE};
use crate::error::AppError;
use crate::models::{CreateStockAssetInput, PassiveAsset, StockHolding};
use crate::sync::{capture, identity};

/// The currency `passive_assets.value_cents` is always expressed in.
///
/// Resolved through [`base_currency`] on every refresh rather than read once, so the day it stops
/// being a constant — a profile currency — no caller has cached the old answer.
const BASE_CURRENCY: &str = "CAD";

/// 1e-6: the scaling factor of both `quantity_micros` and `fx_rate_to_base_micros`.
const MICROS: i128 = 1_000_000;

const HOLDING_SELECT: &str = "SELECT passive_asset_id, symbol, exchange, currency, quantity_micros, \
     last_price_cents, last_price_at, fx_rate_to_base_micros, created_at, updated_at \
     FROM stock_holdings";

/// The largest `quantity_micros` accepted: 1e9 shares.
///
/// A real ceiling and not a formality. `compute_value_cents` multiplies three scaled integers, and
/// without a bound on the first the product can exceed `i128` — which is a debug-build PANIC, in a
/// function reached from a background refresh. Berkshire's entire float is ~1.5e6 shares, so a
/// billion is far past any holding a person types and far below where the arithmetic strains.
pub const MAX_QUANTITY_MICROS: i64 = 1_000_000_000_000_000;

/// THE value derivation: `quantity × price × fx`, in integer cents.
///
/// `i128` and not `i64`, because the intermediate product is up to three 1e6-scaled factors
/// multiplied together — 10 shares of a $100 stock is already 1e6 × 1e4 × 1e6 = 1e16, and a
/// portfolio-sized holding overflows `i64` long before it overflows a person's net worth. Rounds
/// half away from zero, which is the only rounding that keeps `value` monotone in `quantity`.
///
/// Every step is checked: [`MAX_QUANTITY_MICROS`] keeps honest input far from the ceiling, but a
/// price arriving from a provider is not input this code controls, so saturating beats panicking.
pub fn compute_value_cents(
    quantity_micros: i64,
    last_price_cents: i64,
    fx_rate_to_base_micros: i64,
) -> i64 {
    let scale = MICROS * MICROS;
    let numerator = i128::from(quantity_micros)
        .checked_mul(i128::from(last_price_cents))
        .and_then(|product| product.checked_mul(i128::from(fx_rate_to_base_micros)));

    let Some(numerator) = numerator else {
        tracing::error!(
            "A stock value overflowed and was clamped (quantity_micros {quantity_micros}, \
             price_cents {last_price_cents}, fx_micros {fx_rate_to_base_micros})"
        );
        return if (quantity_micros < 0) ^ (last_price_cents < 0) ^ (fx_rate_to_base_micros < 0) {
            i64::MIN
        } else {
            i64::MAX
        };
    };

    let half = scale / 2;
    let rounded = if numerator >= 0 {
        numerator.saturating_add(half) / scale
    } else {
        numerator.saturating_sub(half) / scale
    };

    rounded.clamp(i128::from(i64::MIN), i128::from(i64::MAX)) as i64
}

/// The FX rate a holding already quoted in the base currency carries: exactly one.
pub const UNIT_FX_MICROS: i64 = 1_000_000;

pub fn base_currency(_conn: &Connection) -> Result<String, AppError> {
    Ok(BASE_CURRENCY.to_string())
}

fn row_to_holding(row: &rusqlite::Row<'_>) -> rusqlite::Result<StockHolding> {
    Ok(StockHolding {
        passive_asset_id: row.get(0)?,
        symbol: row.get(1)?,
        exchange: row.get(2)?,
        currency: row.get(3)?,
        quantity_micros: row.get(4)?,
        last_price_cents: row.get(5)?,
        last_price_at: row.get(6)?,
        fx_rate_to_base_micros: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

pub fn normalized_symbol(symbol: &str) -> Result<String, AppError> {
    let symbol = symbol.trim().to_ascii_uppercase();
    if symbol.is_empty() {
        return Err(AppError::Validation {
            message: "A stock symbol is required".to_string(),
            field: Some("symbol".to_string()),
        });
    }

    Ok(symbol)
}

pub fn validated_quantity(quantity_micros: i64) -> Result<i64, AppError> {
    if quantity_micros <= 0 {
        return Err(AppError::Validation {
            message: "Quantity must be greater than zero".to_string(),
            field: Some("quantity_micros".to_string()),
        });
    }

    if quantity_micros > MAX_QUANTITY_MICROS {
        return Err(AppError::Validation {
            message: "That is more shares than Nixus can track".to_string(),
            field: Some("quantity_micros".to_string()),
        });
    }

    Ok(quantity_micros)
}

/// Creates the asset and its holding together, with `value_cents` 0 until a price arrives.
///
/// CAPTURE-SANCTIONED (AD-3): reached only through `ActiveDataset::write`.
pub fn insert_stock_asset(
    conn: &Connection,
    input: &CreateStockAssetInput,
) -> Result<PassiveAsset, AppError> {
    let symbol = normalized_symbol(&input.symbol)?;
    let quantity_micros = validated_quantity(input.quantity_micros)?;
    let name = input.name.trim();
    let name = if name.is_empty() { symbol.as_str() } else { name };

    conn.execute(
        "INSERT INTO passive_assets (name, asset_type, value_cents) VALUES (?1, ?2, 0)",
        params![name, STOCK_ASSET_TYPE],
    )?;
    let asset_id = conn.last_insert_rowid();

    conn.execute(
        "INSERT INTO stock_holdings (passive_asset_id, symbol, exchange, quantity_micros) \
         VALUES (?1, ?2, ?3, ?4)",
        params![asset_id, symbol, input.exchange.trim(), quantity_micros],
    )?;

    bind_holding_identity(conn, asset_id)?;

    asset_db::get_asset_by_id(conn, asset_id)
}

/// Recomputes the value from the CACHED price and FX — never from the network.
///
/// Returns `(old value_cents, updated asset)`. A holding with no price yet stays at 0 rather than
/// guessing, which is what keeps an offline create from inventing a number.
/// CAPTURE-SANCTIONED (AD-3): reached only through `ActiveDataset::write`.
pub fn update_quantity(
    conn: &Connection,
    asset_id: i64,
    quantity_micros: i64,
) -> Result<(i64, PassiveAsset), AppError> {
    let quantity_micros = validated_quantity(quantity_micros)?;

    let rows = conn.execute(
        "UPDATE stock_holdings SET quantity_micros = ?1, updated_at = datetime('now') \
         WHERE passive_asset_id = ?2",
        params![quantity_micros, asset_id],
    )?;
    if rows == 0 {
        return Err(AppError::Validation {
            message: "This asset is not a stock holding".to_string(),
            field: Some("id".to_string()),
        });
    }

    revalue(conn, asset_id)
}

/// One successful quote, as the three columns it sets. Grouped rather than passed as three
/// positional integers-and-a-string, which is how a price and an FX rate get swapped at a call site.
#[derive(Debug, Clone, Copy)]
pub struct PriceWrite<'a> {
    pub last_price_cents: i64,
    pub currency: &'a str,
    pub fx_rate_to_base_micros: i64,
}

/// Writes one successful quote and the value it implies in a single statement pair.
///
/// `last_price_at` is SQLite's own clock rather than an argument, so "as of" can never disagree
/// with when the row was actually written.
/// CAPTURE-SANCTIONED (AD-3): reached only through `ActiveDataset::write`.
pub fn apply_price(
    conn: &Connection,
    asset_id: i64,
    price: &PriceWrite<'_>,
) -> Result<(i64, PassiveAsset), AppError> {
    let rows = conn.execute(
        "UPDATE stock_holdings \
         SET last_price_cents = ?1, currency = ?2, fx_rate_to_base_micros = ?3, \
             last_price_at = datetime('now'), updated_at = datetime('now') \
         WHERE passive_asset_id = ?4",
        params![
            price.last_price_cents,
            price.currency,
            price.fx_rate_to_base_micros,
            asset_id
        ],
    )?;
    if rows == 0 {
        return Err(AppError::Validation {
            message: "This asset is not a stock holding".to_string(),
            field: Some("id".to_string()),
        });
    }

    revalue(conn, asset_id)
}

fn revalue(conn: &Connection, asset_id: i64) -> Result<(i64, PassiveAsset), AppError> {
    let holding = get_holding(conn, asset_id)?.ok_or_else(|| AppError::Validation {
        message: "This asset is not a stock holding".to_string(),
        field: Some("id".to_string()),
    })?;

    let value_cents = match (holding.last_price_cents, holding.fx_rate_to_base_micros) {
        (Some(price), Some(fx)) => compute_value_cents(holding.quantity_micros, price, fx),
        _ => 0,
    };

    asset_db::set_value_cents(conn, asset_id, value_cents)
}

pub fn list_holdings(conn: &Connection) -> Result<Vec<StockHolding>, AppError> {
    let mut stmt = conn.prepare(&format!("{HOLDING_SELECT} ORDER BY passive_asset_id"))?;
    let holdings = stmt
        .query_map([], row_to_holding)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(holdings)
}

pub fn get_holding(conn: &Connection, asset_id: i64) -> Result<Option<StockHolding>, AppError> {
    conn.query_row(
        &format!("{HOLDING_SELECT} WHERE passive_asset_id = ?1"),
        params![asset_id],
        row_to_holding,
    )
    .optional()
    .map_err(AppError::from)
}

/// Binds `stock_holdings`' derived identity: the owning asset's own uuid (AD-2).
///
/// `stock_holdings.passive_asset_id` IS the primary key, so the holding has no identity of its own
/// beyond "the holding behind that asset". Skipped entirely when nothing is capturing, so a
/// local-only profile still writes no `sync_*` row (inherited AD-12).
fn bind_holding_identity(conn: &Connection, asset_id: i64) -> Result<(), AppError> {
    if !capture::is_capturing() {
        return Ok(());
    }

    let asset = identity::existing_uuid_for(conn, "passive_assets", asset_id)?;
    let derived = identity::stock_holding(&asset);

    let mapping = identity::ensure_derived(conn, "stock_holdings", asset_id, &derived)?;
    if mapping.row_id != asset_id {
        tracing::warn!("A stock holding identity already belongs to another local row");
    }

    Ok(())
}
