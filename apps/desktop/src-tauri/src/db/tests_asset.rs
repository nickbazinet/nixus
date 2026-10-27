use rusqlite::Connection;

use crate::db::asset::*;
use crate::error::AppError;
use crate::models::{CreateAssetInput, UpdateAssetInput};
use crate::db::test_dataset::migrated_dataset;
use tempfile::TempDir;

fn dataset() -> (TempDir, Connection) {
    let dir = TempDir::new().expect("temp dir");
    let conn = migrated_dataset(&dir.path().join("nixus.db"));

    (dir, conn)
}

fn create_input(asset_type: &str) -> CreateAssetInput {
    CreateAssetInput {
        name: "Thing".to_string(),
        asset_type: asset_type.to_string(),
        value_cents: 100,
    }
}

#[test]
fn a_non_stock_asset_reads_back_with_no_holding() {
    let (_dir, conn) = dataset();

    let asset = insert_asset(&conn, &create_input("real_estate")).expect("insert");

    assert!(asset.stock.is_none());
    assert_eq!(get_all_assets(&conn).expect("read").len(), 1);
}

#[test]
fn create_asset_refuses_the_stock_type() {
    let (_dir, conn) = dataset();

    let error = insert_asset(&conn, &create_input(STOCK_ASSET_TYPE))
        .expect_err("the generic create path must refuse a stock");

    assert!(matches!(
        error,
        AppError::Validation { field: Some(ref f), .. } if f == "asset_type"
    ));
}

#[test]
fn update_asset_value_refuses_a_stock_and_still_accepts_a_plain_asset() {
    let (_dir, conn) = dataset();
    let plain = insert_asset(&conn, &create_input("vehicle")).expect("insert");
    let stock = crate::db::stock::insert_stock_asset(
        &conn,
        &crate::models::CreateStockAssetInput {
            symbol: "SHOP.TO".to_string(),
            name: "Shopify".to_string(),
            exchange: "TOR".to_string(),
            quantity_micros: 2_500_000,
        },
    )
    .expect("stock insert");

    let error = update_asset_value(&conn, stock.id, 999)
        .expect_err("the AI's value tool must not reach a stock");
    assert!(matches!(
        error,
        AppError::Validation { field: Some(ref f), .. } if f == "value_cents"
    ));

    let (old, updated) = update_asset_value(&conn, plain.id, 999).expect("a plain asset still updates");
    assert_eq!((old, updated.value_cents), (100, 999));
}

#[test]
fn update_asset_refuses_a_type_change_in_either_direction() {
    let (_dir, conn) = dataset();
    let plain = insert_asset(&conn, &create_input("vehicle")).expect("insert");
    let stock = crate::db::stock::insert_stock_asset(
        &conn,
        &crate::models::CreateStockAssetInput {
            symbol: "AAPL".to_string(),
            name: "Apple".to_string(),
            exchange: "NMS".to_string(),
            quantity_micros: 1_000_000,
        },
    )
    .expect("stock insert");

    let into_stock = UpdateAssetInput {
        name: "Thing".to_string(),
        asset_type: STOCK_ASSET_TYPE.to_string(),
    };
    assert!(matches!(
        update_asset(&conn, plain.id, &into_stock),
        Err(AppError::Validation { .. })
    ));

    let out_of_stock = UpdateAssetInput {
        name: "Apple".to_string(),
        asset_type: "other".to_string(),
    };
    assert!(matches!(
        update_asset(&conn, stock.id, &out_of_stock),
        Err(AppError::Validation { .. })
    ));

    let renamed = update_asset(
        &conn,
        stock.id,
        &UpdateAssetInput {
            name: "Apple Inc.".to_string(),
            asset_type: STOCK_ASSET_TYPE.to_string(),
        },
    )
    .expect("a stock may still be renamed");
    assert_eq!(renamed.name, "Apple Inc.");
    assert!(renamed.stock.is_some());
}

#[test]
fn deleting_a_stock_asset_cascades_its_holding_away() {
    let (_dir, conn) = dataset();
    let stock = crate::db::stock::insert_stock_asset(
        &conn,
        &crate::models::CreateStockAssetInput {
            symbol: "AAPL".to_string(),
            name: "Apple".to_string(),
            exchange: "NMS".to_string(),
            quantity_micros: 1_000_000,
        },
    )
    .expect("stock insert");

    delete_asset(&conn, stock.id).expect("delete");

    let holdings: i64 = conn
        .query_row("SELECT COUNT(*) FROM stock_holdings", [], |row| row.get(0))
        .expect("count");
    assert_eq!(holdings, 0);
}
