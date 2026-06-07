use rusqlite::{params, Connection};

use crate::db::account;
use crate::error::AppError;
use crate::models::{NetWorthBreakdown, NetWorthChange, NetWorthCurrent, NetWorthSnapshot, NetWorthSnapshotSummary};

pub fn get_current_net_worth(conn: &Connection) -> Result<NetWorthCurrent, AppError> {
    let cash_cents: i64 = conn.query_row(
        "SELECT COALESCE(SUM(balance_cents), 0) FROM accounts WHERE account_type IN ('chequing', 'savings')",
        [],
        |row| row.get(0),
    )?;

    let investments_cents: i64 = conn.query_row(
        "SELECT COALESCE(SUM(balance_cents), 0) FROM accounts WHERE account_type IN ('tfsa', 'rrsp', 'fhsa', 'non_registered', 'crypto')",
        [],
        |row| row.get(0),
    )?;

    let assets_cents: i64 = conn.query_row(
        "SELECT COALESCE(SUM(value_cents), 0) FROM passive_assets",
        [],
        |row| row.get(0),
    )?;

    let liabilities_cents = account::get_total_liabilities_cents(conn)?;

    Ok(NetWorthCurrent {
        total_cents: cash_cents + investments_cents + assets_cents - liabilities_cents,
        cash_cents,
        investments_cents,
        assets_cents,
        liabilities_cents,
    })
}

pub fn get_recent_net_worth_snapshots(
    conn: &Connection,
    limit: i32,
) -> Result<Vec<NetWorthSnapshotSummary>, AppError> {
    let table_exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='net_worth_snapshots'",
        [],
        |row| row.get(0),
    )?;

    if !table_exists {
        return Ok(vec![]);
    }

    let mut stmt = conn.prepare(
        "SELECT total_cents, snapshot_date FROM net_worth_snapshots ORDER BY snapshot_date DESC LIMIT ?1",
    )?;

    let snapshots = stmt
        .query_map(params![limit], |row| {
            Ok(NetWorthSnapshotSummary {
                total_cents: row.get(0)?,
                snapshot_date: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut result = snapshots;
    result.reverse();
    Ok(result)
}

fn map_account_type_to_category(account_type: &str) -> &str {
    match account_type {
        "chequing" | "savings" => "cash",
        "crypto" => "crypto",
        "tfsa" => "tfsa",
        "rrsp" => "rrsp",
        "fhsa" => "fhsa",
        "non_registered" => "non_registered",
        _ => "other",
    }
}

fn map_asset_type_to_category(asset_type: &str) -> &str {
    match asset_type {
        "real_estate" => "housing",
        "vehicle" => "vehicles",
        "business" => "business",
        _ => "other",
    }
}

pub fn record_net_worth_snapshot(conn: &Connection) -> Result<NetWorthSnapshot, AppError> {
    let mut breakdown = NetWorthBreakdown {
        cash_cents: 0,
        crypto_cents: 0,
        housing_cents: 0,
        tfsa_cents: 0,
        rrsp_cents: 0,
        fhsa_cents: 0,
        non_registered_cents: 0,
        business_cents: 0,
        vehicles_cents: 0,
        other_cents: 0,
    };

    // Aggregate accounts by type
    let mut stmt = conn.prepare("SELECT account_type, balance_cents FROM accounts")?;
    let accounts = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;

    for account in accounts {
        let (account_type, balance_cents) = account?;
        if account::is_liability_account_type(&account_type) {
            continue;
        }
        match map_account_type_to_category(&account_type) {
            "cash" => breakdown.cash_cents += balance_cents,
            "crypto" => breakdown.crypto_cents += balance_cents,
            "tfsa" => breakdown.tfsa_cents += balance_cents,
            "rrsp" => breakdown.rrsp_cents += balance_cents,
            "fhsa" => breakdown.fhsa_cents += balance_cents,
            "non_registered" => breakdown.non_registered_cents += balance_cents,
            _ => breakdown.other_cents += balance_cents,
        }
    }

    // Aggregate passive assets by type
    let mut stmt = conn.prepare("SELECT asset_type, value_cents FROM passive_assets")?;
    let assets = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;

    for asset in assets {
        let (asset_type, value_cents) = asset?;
        match map_asset_type_to_category(&asset_type) {
            "housing" => breakdown.housing_cents += value_cents,
            "vehicles" => breakdown.vehicles_cents += value_cents,
            "business" => breakdown.business_cents += value_cents,
            _ => breakdown.other_cents += value_cents,
        }
    }

    let liabilities_cents = account::get_total_liabilities_cents(conn)?;

    let total_cents = breakdown.cash_cents
        + breakdown.crypto_cents
        + breakdown.housing_cents
        + breakdown.tfsa_cents
        + breakdown.rrsp_cents
        + breakdown.fhsa_cents
        + breakdown.non_registered_cents
        + breakdown.business_cents
        + breakdown.vehicles_cents
        + breakdown.other_cents
        - liabilities_cents;

    let breakdown_json = serde_json::to_string(&breakdown).map_err(|e| AppError::Database {
        message: format!("Failed to serialize breakdown: {}", e),
    })?;

    let today: String = conn.query_row("SELECT date('now')", [], |row| row.get(0))?;

    // Upsert: update if exists for today, else insert
    let existing_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM net_worth_snapshots WHERE snapshot_date = ?1",
            params![today],
            |row| row.get(0),
        )
        .ok();

    if let Some(id) = existing_id {
        conn.execute(
            "UPDATE net_worth_snapshots SET total_cents = ?1, breakdown_json = ?2 WHERE id = ?3",
            params![total_cents, breakdown_json, id],
        )?;
    } else {
        conn.execute(
            "INSERT INTO net_worth_snapshots (total_cents, snapshot_date, breakdown_json) VALUES (?1, ?2, ?3)",
            params![total_cents, today, breakdown_json],
        )?;
    }

    let snapshot = conn.query_row(
        "SELECT id, total_cents, snapshot_date, breakdown_json, created_at FROM net_worth_snapshots WHERE snapshot_date = ?1",
        params![today],
        |row| {
            Ok(NetWorthSnapshot {
                id: row.get(0)?,
                total_cents: row.get(1)?,
                snapshot_date: row.get(2)?,
                breakdown_json: row.get(3)?,
                created_at: row.get(4)?,
            })
        },
    )?;

    Ok(snapshot)
}

pub fn get_net_worth_history(
    conn: &Connection,
    period: &str,
) -> Result<Vec<NetWorthSnapshot>, AppError> {
    let date_filter = match period {
        "6m" => Some("-6 months"),
        "1y" => Some("-12 months"),
        _ => None, // "all"
    };

    let (query, use_param) = match date_filter {
        Some(offset) => (
            format!(
                "SELECT id, total_cents, snapshot_date, breakdown_json, created_at \
                 FROM net_worth_snapshots WHERE snapshot_date >= date('now', '{}') \
                 ORDER BY snapshot_date ASC",
                offset
            ),
            false,
        ),
        None => (
            "SELECT id, total_cents, snapshot_date, breakdown_json, created_at \
             FROM net_worth_snapshots ORDER BY snapshot_date ASC"
                .to_string(),
            false,
        ),
    };
    let _ = use_param;

    let mut stmt = conn.prepare(&query)?;
    let snapshots = stmt
        .query_map([], |row| {
            Ok(NetWorthSnapshot {
                id: row.get(0)?,
                total_cents: row.get(1)?,
                snapshot_date: row.get(2)?,
                breakdown_json: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(snapshots)
}

pub fn get_net_worth_change(
    conn: &Connection,
    period: &str,
) -> Result<NetWorthChange, AppError> {
    let history = get_net_worth_history(conn, period)?;

    if history.len() < 2 {
        return Ok(NetWorthChange {
            absolute_change_cents: 0,
            percentage_change: 0.0,
            direction: "flat".to_string(),
        });
    }

    let first = history.first().unwrap().total_cents;
    let last = history.last().unwrap().total_cents;
    let diff = last - first;

    let percentage = if first != 0 {
        (diff as f64 / first as f64) * 100.0
    } else {
        0.0
    };

    let direction = if diff > 0 {
        "up"
    } else if diff < 0 {
        "down"
    } else {
        "flat"
    };

    Ok(NetWorthChange {
        absolute_change_cents: diff,
        percentage_change: percentage,
        direction: direction.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();

        conn.execute_batch(
            "CREATE TABLE accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                institution TEXT NOT NULL,
                account_type TEXT NOT NULL,
                currency TEXT NOT NULL DEFAULT 'CAD',
                balance_cents INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE passive_assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                asset_type TEXT NOT NULL,
                value_cents INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE net_worth_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                total_cents INTEGER NOT NULL,
                snapshot_date TEXT NOT NULL,
                breakdown_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX idx_net_worth_snapshots_date ON net_worth_snapshots(snapshot_date);",
        )
        .unwrap();

        conn
    }

    #[test]
    fn test_map_account_type_to_category() {
        assert_eq!(map_account_type_to_category("chequing"), "cash");
        assert_eq!(map_account_type_to_category("savings"), "cash");
        assert_eq!(map_account_type_to_category("crypto"), "crypto");
        assert_eq!(map_account_type_to_category("tfsa"), "tfsa");
        assert_eq!(map_account_type_to_category("rrsp"), "rrsp");
        assert_eq!(map_account_type_to_category("fhsa"), "fhsa");
        assert_eq!(map_account_type_to_category("non_registered"), "non_registered");
        assert_eq!(map_account_type_to_category("unknown"), "other");
    }

    #[test]
    fn test_map_asset_type_to_category() {
        assert_eq!(map_asset_type_to_category("real_estate"), "housing");
        assert_eq!(map_asset_type_to_category("vehicle"), "vehicles");
        assert_eq!(map_asset_type_to_category("business"), "business");
        assert_eq!(map_asset_type_to_category("other"), "other");
    }

    #[test]
    fn test_snapshot_total_equals_sum() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO accounts (name, institution, account_type, balance_cents) VALUES ('Chequing', 'Bank', 'chequing', 100000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO accounts (name, institution, account_type, balance_cents) VALUES ('TFSA', 'Bank', 'tfsa', 200000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO passive_assets (name, asset_type, value_cents) VALUES ('House', 'real_estate', 50000000)",
            [],
        ).unwrap();

        let snapshot = record_net_worth_snapshot(&conn).unwrap();
        assert_eq!(snapshot.total_cents, 100000 + 200000 + 50000000);
    }

    #[test]
    fn test_breakdown_json_contains_correct_values() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO accounts (name, institution, account_type, balance_cents) VALUES ('Chequing', 'Bank', 'chequing', 150000)",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO passive_assets (name, asset_type, value_cents) VALUES ('Car', 'vehicle', 2500000)",
            [],
        ).unwrap();

        let snapshot = record_net_worth_snapshot(&conn).unwrap();
        let breakdown: NetWorthBreakdown = serde_json::from_str(&snapshot.breakdown_json).unwrap();
        assert_eq!(breakdown.cash_cents, 150000);
        assert_eq!(breakdown.vehicles_cents, 2500000);
        assert_eq!(breakdown.housing_cents, 0);
    }

    #[test]
    fn test_same_day_deduplication() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO accounts (name, institution, account_type, balance_cents) VALUES ('Chequing', 'Bank', 'chequing', 100000)",
            [],
        ).unwrap();

        let snap1 = record_net_worth_snapshot(&conn).unwrap();

        // Update balance and record again
        conn.execute("UPDATE accounts SET balance_cents = 200000 WHERE id = 1", []).unwrap();
        let snap2 = record_net_worth_snapshot(&conn).unwrap();

        // Same ID = updated, not duplicated
        assert_eq!(snap1.id, snap2.id);
        assert_eq!(snap2.total_cents, 200000);

        // Only one snapshot exists
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM net_worth_snapshots", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_empty_accounts_produces_zero_snapshot() {
        let conn = setup_test_db();
        let snapshot = record_net_worth_snapshot(&conn).unwrap();
        assert_eq!(snapshot.total_cents, 0);

        let breakdown: NetWorthBreakdown = serde_json::from_str(&snapshot.breakdown_json).unwrap();
        assert_eq!(breakdown.cash_cents, 0);
        assert_eq!(breakdown.crypto_cents, 0);
        assert_eq!(breakdown.housing_cents, 0);
    }

    #[test]
    fn liabilities_reduce_current_net_worth() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO accounts (name, institution, account_type, balance_cents) VALUES ('Chequing', 'Bank', 'chequing', 500000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO accounts (name, institution, account_type, balance_cents) VALUES ('Visa', 'Bank', 'credit_card', 200000)",
            [],
        )
        .unwrap();

        let nw = get_current_net_worth(&conn).unwrap();
        assert_eq!(nw.liabilities_cents, 200000);
        assert_eq!(nw.total_cents, 300000);
    }

    #[test]
    fn snapshot_subtracts_liabilities_and_excludes_them_from_breakdown() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO accounts (name, institution, account_type, balance_cents) VALUES ('Chequing', 'Bank', 'chequing', 500000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO accounts (name, institution, account_type, balance_cents) VALUES ('Visa', 'Bank', 'credit_card', 200000)",
            [],
        )
        .unwrap();

        let snapshot = record_net_worth_snapshot(&conn).unwrap();
        assert_eq!(snapshot.total_cents, 300000);

        let breakdown: NetWorthBreakdown = serde_json::from_str(&snapshot.breakdown_json).unwrap();
        assert_eq!(breakdown.cash_cents, 500000);
        assert_eq!(breakdown.other_cents, 0);
    }
}
