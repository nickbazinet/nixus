use rusqlite::Connection;

use crate::db::stock::*;
use crate::error::AppError;
use crate::models::CreateStockAssetInput;
use crate::db::test_dataset::migrated_dataset;
use tempfile::TempDir;

fn dataset() -> (TempDir, Connection) {
    let dir = TempDir::new().expect("temp dir");
    let conn = migrated_dataset(&dir.path().join("nixus.db"));

    (dir, conn)
}

fn create(symbol: &str, quantity_micros: i64) -> CreateStockAssetInput {
    CreateStockAssetInput {
        symbol: symbol.to_string(),
        name: format!("{symbol} Inc."),
        exchange: "NMS".to_string(),
        quantity_micros,
    }
}

#[test]
fn the_value_is_quantity_times_price_times_fx_in_cents() {
    // 2.5 shares at CAD 123.45, no conversion.
    assert_eq!(compute_value_cents(2_500_000, 12_345, UNIT_FX_MICROS), 30_863);
    // The same holding in USD at 1.37 CAD/USD.
    assert_eq!(compute_value_cents(2_500_000, 12_345, 1_370_000), 42_282);
    assert_eq!(compute_value_cents(1_000_000, 0, UNIT_FX_MICROS), 0);
}

#[test]
fn the_value_rounds_half_away_from_zero_rather_than_truncating() {
    // 0.5 of a one-cent share is exactly half a cent.
    assert_eq!(compute_value_cents(500_000, 1, UNIT_FX_MICROS), 1);
    assert_eq!(compute_value_cents(499_999, 1, UNIT_FX_MICROS), 0);
}

/// A share count and a price that would overflow `i64` in the intermediate product, which is
/// precisely the case `i128` exists for.
#[test]
fn a_large_holding_does_not_overflow_the_intermediate_product() {
    let value = compute_value_cents(1_000_000_000_000, 100_000_000, UNIT_FX_MICROS);

    assert_eq!(value, 100_000_000_000_000);
}

#[test]
fn a_fresh_holding_has_no_price_and_a_zero_value() {
    let (_dir, conn) = dataset();

    let asset = insert_stock_asset(&conn, &create("SHOP.TO", 2_500_000)).expect("insert");
    let holding = asset.stock.expect("the holding is joined in");

    assert_eq!(asset.value_cents, 0);
    assert_eq!(holding.symbol, "SHOP.TO");
    assert_eq!(holding.quantity_micros, 2_500_000);
    assert_eq!(
        (
            holding.currency,
            holding.last_price_cents,
            holding.last_price_at,
            holding.fx_rate_to_base_micros
        ),
        (None, None, None, None)
    );
}

#[test]
fn a_lowercase_symbol_is_stored_uppercase_and_an_empty_one_is_refused() {
    let (_dir, conn) = dataset();

    let asset = insert_stock_asset(&conn, &create("shop.to", 1_000_000)).expect("insert");
    assert_eq!(asset.stock.expect("holding").symbol, "SHOP.TO");

    assert!(matches!(
        insert_stock_asset(&conn, &create("   ", 1_000_000)),
        Err(AppError::Validation { .. })
    ));
}

/// The ceiling earning its place: the largest accepted holding at an absurd price must come out as
/// a number, not as a debug-build panic inside a background refresh.
#[test]
fn the_largest_accepted_quantity_cannot_overflow_the_derivation() {
    let value = compute_value_cents(MAX_QUANTITY_MICROS, i64::MAX, UNIT_FX_MICROS);

    assert!(value > 0, "an overflow must clamp, never wrap: {value}");
    assert_eq!(
        compute_value_cents(i64::MAX, i64::MAX, i64::MAX),
        i64::MAX,
        "even inputs the validator would never admit have to return rather than panic"
    );
    assert_eq!(
        compute_value_cents(i64::MIN, i64::MAX, UNIT_FX_MICROS),
        i64::MIN
    );
}

#[test]
fn a_quantity_over_the_ceiling_is_a_validation_error_on_create_and_on_update() {
    let (_dir, conn) = dataset();

    let error = insert_stock_asset(&conn, &create("AAPL", MAX_QUANTITY_MICROS + 1))
        .expect_err("a quantity past the ceiling is refused");
    assert!(matches!(
        error,
        AppError::Validation { field: Some(ref f), .. } if f == "quantity_micros"
    ));

    let asset = insert_stock_asset(&conn, &create("AAPL", MAX_QUANTITY_MICROS))
        .expect("the ceiling itself is accepted");
    assert!(matches!(
        update_quantity(&conn, asset.id, i64::MAX),
        Err(AppError::Validation { .. })
    ));
}

#[test]
fn a_non_positive_quantity_is_refused_on_create_and_on_update() {
    let (_dir, conn) = dataset();

    assert!(matches!(
        insert_stock_asset(&conn, &create("AAPL", 0)),
        Err(AppError::Validation { .. })
    ));

    let asset = insert_stock_asset(&conn, &create("AAPL", 1_000_000)).expect("insert");
    assert!(matches!(
        update_quantity(&conn, asset.id, -1),
        Err(AppError::Validation { .. })
    ));
}

#[test]
fn applying_a_price_derives_the_value_and_a_quantity_change_re_derives_it() {
    let (_dir, conn) = dataset();
    let asset = insert_stock_asset(&conn, &create("SHOP.TO", 2_500_000)).expect("insert");

    let (old, priced) =
        apply_price(&conn, asset.id, &PriceWrite { last_price_cents: 12_345, currency: "CAD", fx_rate_to_base_micros: UNIT_FX_MICROS }).expect("price applies");
    assert_eq!((old, priced.value_cents), (0, 30_863));
    let holding = priced.stock.expect("holding");
    assert_eq!(holding.currency.as_deref(), Some("CAD"));
    assert!(holding.last_price_at.is_some());

    let (old, doubled) = update_quantity(&conn, asset.id, 5_000_000).expect("quantity updates");
    assert_eq!((old, doubled.value_cents), (30_863, 61_725));
}

/// Edge-case matrix: "Quantity update, price NULL -> value stays 0".
#[test]
fn a_quantity_change_on_an_unpriced_holding_leaves_the_value_at_zero() {
    let (_dir, conn) = dataset();
    let asset = insert_stock_asset(&conn, &create("AAPL", 1_000_000)).expect("insert");

    let (old, updated) = update_quantity(&conn, asset.id, 9_000_000).expect("quantity updates");

    assert_eq!((old, updated.value_cents), (0, 0));
    assert_eq!(updated.stock.expect("holding").quantity_micros, 9_000_000);
}

#[test]
fn the_quantity_and_price_paths_refuse_an_asset_that_is_not_a_holding() {
    let (_dir, conn) = dataset();
    conn.execute(
        "INSERT INTO passive_assets (name, asset_type, value_cents) VALUES ('House', 'real_estate', 1)",
        [],
    )
    .expect("a plain asset");
    let plain: i64 = conn
        .query_row("SELECT id FROM passive_assets", [], |row| row.get(0))
        .expect("id");

    assert!(matches!(
        update_quantity(&conn, plain, 1_000_000),
        Err(AppError::Validation { .. })
    ));
    assert!(matches!(
        apply_price(&conn, plain, &PriceWrite { last_price_cents: 1, currency: "CAD", fx_rate_to_base_micros: UNIT_FX_MICROS }),
        Err(AppError::Validation { .. })
    ));
}

#[test]
fn list_holdings_returns_every_holding_in_asset_order() {
    let (_dir, conn) = dataset();
    insert_stock_asset(&conn, &create("AAPL", 1_000_000)).expect("insert");
    insert_stock_asset(&conn, &create("SHOP.TO", 2_000_000)).expect("insert");

    let symbols: Vec<String> = list_holdings(&conn)
        .expect("read")
        .into_iter()
        .map(|holding| holding.symbol)
        .collect();

    assert_eq!(symbols, vec!["AAPL", "SHOP.TO"]);
}

#[test]
fn the_base_currency_is_resolved_rather_than_assumed_by_callers() {
    let (_dir, conn) = dataset();

    assert_eq!(base_currency(&conn).expect("resolved"), "CAD");
}

#[test]
fn the_schema_refuses_a_non_positive_quantity_by_its_own_named_guard() {
    let (_dir, conn) = dataset();
    conn.execute(
        "INSERT INTO passive_assets (name, asset_type, value_cents) VALUES ('S', 'stock', 0)",
        [],
    )
    .expect("asset");

    let error = conn
        .execute(
            "INSERT INTO stock_holdings (passive_asset_id, symbol, exchange, quantity_micros) \
             VALUES (1, 'AAPL', 'NMS', 0)",
            [],
        )
        .expect_err("the CHECK must fire")
        .to_string();

    assert!(
        error.contains("stock_holdings_quantity_positive"),
        "the guard must be named in the failure: {error}"
    );
}
