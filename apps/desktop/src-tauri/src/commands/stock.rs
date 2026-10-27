use tauri::State;

use crate::db::audit as audit_db;
use crate::db::net_worth as net_worth_db;
use crate::db::{stock as stock_db, DbState};
use crate::error::AppError;
use crate::models::{CreateStockAssetInput, PassiveAsset, StockRefreshResult, StockSearchResult};
use crate::stock::provider::{PriceProvider, MIN_SEARCH_CHARS};
use crate::stock::refresh;
use crate::stock::yahoo::YahooProvider;

/// The one declaration of the event name. The frontend listener matches this string, so a second
/// literal is how an emit and a listen drift apart silently.
pub const STOCK_PRICES_UPDATED_EVENT: &str = "stock-prices-updated";

/// The before/after pair a quantity edit records, so the history says what the user changed rather
/// than only what it happened to be worth.
#[derive(serde::Serialize)]
struct QuantityAudit {
    quantity_micros: i64,
    value_cents: i64,
}

fn locked(state: &DbState) -> Result<std::sync::MutexGuard<'_, crate::db::ActiveDataset>, AppError> {
    state.0.lock().map_err(|error| AppError::Database {
        message: error.to_string(),
    })
}

/// A short query is an empty list and not an error: the combobox types into this, and a validation
/// error on every first keystroke is noise the user cannot act on.
#[tauri::command(rename_all = "snake_case")]
pub async fn search_stocks(query: String) -> Result<Vec<StockSearchResult>, AppError> {
    let trimmed = query.trim();
    if trimmed.chars().count() < MIN_SEARCH_CHARS {
        return Ok(Vec::new());
    }

    let provider = YahooProvider::new()?;

    provider.search(trimmed).await
}

/// Creates the asset, then prices it in a SECOND step that is allowed to fail.
///
/// The order is what makes the offline case work: the holding is already committed before the
/// network is touched, so a failed quote leaves a saved asset with no price rather than losing the
/// user's input (the "Create offline" row of the matrix).
#[tauri::command(rename_all = "snake_case")]
pub async fn create_stock_asset(
    state: State<'_, DbState>,
    symbol: String,
    name: String,
    exchange: String,
    quantity_micros: i64,
) -> Result<PassiveAsset, AppError> {
    let input = CreateStockAssetInput {
        symbol,
        name,
        exchange,
        quantity_micros,
    };
    // Validated before the insert so a bad input never reaches a transaction, and before the
    // provider so it never costs a request.
    stock_db::normalized_symbol(&input.symbol)?;
    stock_db::validated_quantity(input.quantity_micros)?;

    let created = {
        let active = locked(state.inner())?;
        let created = active.write(|tx| stock_db::insert_stock_asset(tx, &input))?;

        let details = serde_json::to_string(&created).unwrap_or_default();
        audit_db::record(
            &active,
            "passive_asset",
            created.id,
            "create",
            None,
            Some(&details),
        );

        if let Err(error) = active.write(|tx| net_worth_db::record_net_worth_snapshot(tx)) {
            tracing::error!("Failed to record snapshot: {error}");
        }

        created
    };

    match YahooProvider::new() {
        Ok(provider) => {
            if let Err(error) = refresh::refresh_one(&state, &provider, created.id).await {
                tracing::error!("Could not price the new stock holding: {error}");
            }
        }
        Err(error) => tracing::error!("Could not start the price client: {error}"),
    }

    let active = locked(state.inner())?;
    let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;

    crate::db::asset::get_asset_by_id(conn, created.id)
}

#[tauri::command(rename_all = "snake_case")]
pub fn update_stock_quantity(
    state: State<DbState>,
    id: i64,
    quantity_micros: i64,
) -> Result<PassiveAsset, AppError> {
    let active = locked(state.inner())?;

    // Read before the write, because the write is what replaces it.
    let old_quantity_micros = {
        let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
        stock_db::get_holding(conn, id)?
            .map(|holding| holding.quantity_micros)
            .unwrap_or_default()
    };

    let (old_value, asset) = active.write(|tx| stock_db::update_quantity(tx, id, quantity_micros))?;

    // Quantity AND the value it derives, as JSON. The value alone would make "2 shares -> 4
    // shares" and "the price doubled" indistinguishable in the history, and the quantity is the
    // only half of that pair the user actually typed.
    let old_json = serde_json::to_string(&QuantityAudit {
        quantity_micros: old_quantity_micros,
        value_cents: old_value,
    })
    .unwrap_or_default();
    let new_json = serde_json::to_string(&QuantityAudit {
        quantity_micros: asset
            .stock
            .as_ref()
            .map(|holding| holding.quantity_micros)
            .unwrap_or(quantity_micros),
        value_cents: asset.value_cents,
    })
    .unwrap_or_default();

    audit_db::record(
        &active,
        "passive_asset",
        id,
        "quantity_update",
        Some(&old_json),
        Some(&new_json),
    );

    if let Err(error) = active.write(|tx| net_worth_db::record_net_worth_snapshot(tx)) {
        tracing::error!("Failed to record snapshot: {error}");
    }

    Ok(asset)
}

/// Forced, because the user asked: the 15-minute throttle exists to keep STARTUP cheap, and
/// refusing a button press the user just made would read as the button being broken.
#[tauri::command(rename_all = "snake_case")]
pub async fn refresh_stock_prices(
    state: State<'_, DbState>,
) -> Result<Vec<StockRefreshResult>, AppError> {
    let provider = YahooProvider::new()?;

    Ok(refresh::refresh_holdings(&state, &provider, true)
        .await?
        .results)
}

/// The startup pass (spec: never blocks launch, throttled, logged and never surfaced).
///
/// Emits on `priced` and not on `changed`: a re-quote at the same price moves no value but DOES
/// move "as of", and a stale badge the user has to reload to clear is the bug that distinction
/// exists to prevent. The snapshot and the audit row stay gated on `changed`, inside `refresh`.
pub fn spawn_startup_refresh(app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        use tauri::{Emitter, Manager};

        let provider = match YahooProvider::new() {
            Ok(provider) => provider,
            Err(error) => {
                tracing::error!("Startup price refresh could not start: {error}");
                return;
            }
        };

        let state = app_handle.state::<DbState>();
        match refresh::refresh_holdings(&state, &provider, false).await {
            Ok(summary) if summary.priced => {
                tracing::info!(
                    "Startup price refresh priced {} holding(s); values changed: {}",
                    summary.results.iter().filter(|result| result.ok).count(),
                    summary.changed
                );
                let _ = app_handle.emit(STOCK_PRICES_UPDATED_EVENT, ());
            }
            Ok(_) => tracing::info!("Startup price refresh wrote no price"),
            Err(error) => tracing::error!("Startup price refresh failed: {error}"),
        }
    });
}
