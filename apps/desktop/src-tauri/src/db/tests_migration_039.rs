//! Migration 039 against a database that already holds 038 rows: `account_id` arrives through
//! `ALTER TABLE ... ADD COLUMN` carrying a `REFERENCES` clause, so this is where the empirical
//! questions get answered — whether the bundled SQLite accepts an added column with a foreign key
//! at all, whether a holding written before the column reads back unlinked, and above all whether
//! the `ON DELETE SET NULL` on an ADDED column is genuinely ENFORCED rather than merely recorded
//! in the schema text. The upgrade path is the one every existing install takes, and running all
//! 39 migrations against an empty file never exercises it.

use rusqlite::Connection;
use tempfile::TempDir;

use crate::db::{open_configured, run_migrations_up_to};

/// The schema as it was before this migration: `stock_holdings` with no account column.
const SCHEMA_BEFORE_039: i64 = 38;

/// A database at schema 38 holding an account and a priced stock holding, closed so the next open
/// is a real launch.
fn seeded_pre_039_database() -> (TempDir, std::path::PathBuf) {
    let dir = TempDir::new().expect("temp dir");
    let path = dir.path().join("nixus.db");

    let conn = Connection::open(&path).expect("the database opens");
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .expect("the pragmas apply");
    run_migrations_up_to(&conn, SCHEMA_BEFORE_039).expect("the pre-039 schema applies");

    conn.execute_batch(
        "INSERT INTO accounts (id, name, institution, account_type, currency, balance_cents)
             VALUES (1, 'Main TFSA', 'Wealthsimple', 'tfsa', 'CAD', 250000);
         INSERT INTO passive_assets (id, name, asset_type, value_cents)
             VALUES (1, 'Shopify', 'stock', 30863);
         INSERT INTO stock_holdings
             (passive_asset_id, symbol, exchange, currency, quantity_micros,
              last_price_cents, last_price_at, fx_rate_to_base_micros)
             VALUES (1, 'SHOP.TO', 'TOR', 'CAD', 2500000, 12345,
                     '2026-10-27 12:00:00', 1000000);",
    )
    .expect("the legacy account and holding seed");

    drop(conn);

    (dir, path)
}

#[test]
fn a_holding_written_before_the_column_reads_back_unlinked_with_its_value_intact() {
    let (_dir, path) = seeded_pre_039_database();
    let conn = open_configured(&path).expect("039 runs on open");

    let (symbol, account_id, value_cents): (String, Option<i64>, i64) = conn
        .query_row(
            "SELECT h.symbol, h.account_id, a.value_cents
             FROM stock_holdings h JOIN passive_assets a ON a.id = h.passive_asset_id",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("the new column exists on the pre-existing row");

    assert_eq!(symbol, "SHOP.TO");
    assert_eq!(account_id, None, "an upgraded holding starts unlinked");
    assert_eq!(
        value_cents, 30_863,
        "the upgrade must not disturb the derived value"
    );
}

/// The migration claims `ON DELETE SET NULL`. On a column added by `ALTER TABLE` that is a claim
/// worth distrusting, so this deletes the parent and checks the child rather than reading schema
/// text back.
#[test]
fn the_added_foreign_key_is_enforced_and_its_set_null_actually_fires() {
    let (_dir, path) = seeded_pre_039_database();
    let conn = open_configured(&path).expect("039 runs on open");

    // Enforced: a link to an account that does not exist is refused outright.
    conn.execute(
        "UPDATE stock_holdings SET account_id = 404 WHERE passive_asset_id = 1",
        [],
    )
    .expect_err("the foreign key on the added column is enforced");

    conn.execute(
        "UPDATE stock_holdings SET account_id = 1 WHERE passive_asset_id = 1",
        [],
    )
    .expect("a real account links");

    conn.execute("DELETE FROM accounts WHERE id = 1", [])
        .expect("deleting the account is allowed rather than restricted");

    let (holdings, account_id): (i64, Option<i64>) = conn
        .query_row(
            "SELECT COUNT(*), MAX(account_id) FROM stock_holdings",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("the holding reads");

    assert_eq!(holdings, 1, "the holding outlives the account it sat in");
    assert_eq!(
        account_id, None,
        "ON DELETE SET NULL fired on a column added by ALTER TABLE"
    );
}

#[test]
fn the_account_lookup_index_exists_for_the_per_account_read() {
    let (_dir, path) = seeded_pre_039_database();
    let conn = open_configured(&path).expect("039 runs on open");

    let indexed: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master
             WHERE type = 'index' AND name = 'idx_stock_holdings_account_id'",
            [],
            |row| row.get(0),
        )
        .expect("the index lookup runs");

    assert!(indexed, "the account_id index is created by the migration");
}
