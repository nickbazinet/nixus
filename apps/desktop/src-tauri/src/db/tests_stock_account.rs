use std::sync::{Arc, Mutex};

use tempfile::TempDir;

use crate::db::test_dataset::migrated_dataset;
use crate::db::{stock as stock_db, ActiveDataset, DbState};
use crate::models::CreateStockAssetInput;

/// Exercises the account link through `ActiveDataset::write` rather than a bare `Connection`.
///
/// The db-level tests use a plain connection, which skips the capture-sanctioned path (AD-3) every
/// real caller goes through — so only a test shaped like this one can catch a link that works in
/// isolation but is never recorded for sync.
fn state() -> (TempDir, Arc<DbState>) {
    let dir = TempDir::new().expect("temp dir");
    let conn = migrated_dataset(&dir.path().join("nixus.db"));

    (
        dir,
        Arc::new(DbState(Mutex::new(ActiveDataset {
            id: Some("default".to_string()),
            conn: Some(conn),
            capture: None,
        }))),
    )
}

fn create_account(state: &DbState, name: &str, account_type: &str, currency: &str) -> i64 {
    let active = state.0.lock().expect("the dataset lock");
    active
        .write(|tx| {
            tx.execute(
                "INSERT INTO accounts (name, institution, account_type, currency, balance_cents) \
                 VALUES (?1, 'Bank', ?2, ?3, 50000)",
                rusqlite::params![name, account_type, currency],
            )?;
            Ok(tx.last_insert_rowid())
        })
        .expect("the account is created")
}

#[test]
fn a_holding_links_through_the_captured_write_path_and_reads_back_from_get_assets() {
    let (_dir, state) = state();
    let account = create_account(&state, "Main TFSA", "tfsa", "CAD");

    let active = state.0.lock().expect("the dataset lock");
    let asset = active
        .write(|tx| {
            stock_db::insert_stock_asset(
                tx,
                &CreateStockAssetInput {
                    symbol: "SHOP.TO".to_string(),
                    name: "Shopify".to_string(),
                    exchange: "TOR".to_string(),
                    quantity_micros: 2_500_000,
                    account_id: None,
                },
            )
        })
        .expect("the holding is created");

    let linked = active
        .write(|tx| stock_db::update_account(tx, asset.id, Some(account)))
        .expect("the link is written");
    assert_eq!(linked.stock.expect("holding").account_id, Some(account));

    // The Accounts page reads the link out of `get_assets`, not a per-account query, so that is the
    // read that has to carry it.
    let conn = active.conn.as_ref().expect("a selected dataset");
    let all = crate::db::asset::get_all_assets(conn).expect("assets read");
    let holding = all
        .iter()
        .find(|item| item.id == asset.id)
        .and_then(|item| item.stock.as_ref())
        .expect("the holding is joined into the asset list");
    assert_eq!(holding.account_id, Some(account));
}

#[test]
fn deleting_the_linked_account_through_the_captured_path_leaves_the_asset_intact() {
    let (_dir, state) = state();
    let account = create_account(&state, "Main TFSA", "tfsa", "CAD");

    let active = state.0.lock().expect("the dataset lock");
    let asset = active
        .write(|tx| {
            stock_db::insert_stock_asset(
                tx,
                &CreateStockAssetInput {
                    symbol: "SHOP.TO".to_string(),
                    name: "Shopify".to_string(),
                    exchange: "TOR".to_string(),
                    quantity_micros: 2_500_000,
                    account_id: Some(account),
                },
            )
        })
        .expect("the holding is created");

    active
        .write(|tx| crate::db::account::delete_account(tx, account))
        .expect("the account deletes rather than being blocked by the link");

    let conn = active.conn.as_ref().expect("a selected dataset");
    let holding = stock_db::get_holding(conn, asset.id)
        .expect("read")
        .expect("the holding outlives its account");
    assert_eq!(holding.account_id, None);
}
