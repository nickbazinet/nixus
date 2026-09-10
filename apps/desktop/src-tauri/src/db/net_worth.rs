use chrono::{Datelike, NaiveDate};
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

/// A period spans this many calendar months *including* the current one, so 6M on September 10
/// starts April 1 and the seventh month back (March) is out of range. A rolling `-6 months`
/// offset would keep March 15 in view and make 6M indistinguishable from 1Y.
fn period_month_span(period: &str) -> Option<u32> {
    match period {
        "6m" => Some(6),
        "1y" => Some(12),
        _ => None, // "all"
    }
}

fn calendar_window_start(reference: NaiveDate, month_span: u32) -> Option<NaiveDate> {
    let months_back = i32::try_from(month_span).ok()? - 1;
    let month_index = reference.year() * 12 + reference.month0() as i32 - months_back;
    NaiveDate::from_ymd_opt(
        month_index.div_euclid(12),
        month_index.rem_euclid(12) as u32 + 1,
        1,
    )
}

fn period_cutoff(period: &str, reference: NaiveDate) -> Result<Option<String>, AppError> {
    let Some(month_span) = period_month_span(period) else {
        return Ok(None);
    };
    let start = calendar_window_start(reference, month_span).ok_or_else(|| AppError::Database {
        message: format!("Failed to compute {} window from {}", period, reference),
    })?;
    Ok(Some(start.format("%Y-%m-%d").to_string()))
}

fn today(conn: &Connection) -> Result<NaiveDate, AppError> {
    let today: String = conn.query_row("SELECT date('now')", [], |row| row.get(0))?;
    NaiveDate::parse_from_str(&today, "%Y-%m-%d").map_err(|e| AppError::Database {
        message: format!("Failed to parse current date '{}': {}", today, e),
    })
}

fn read_history(
    conn: &Connection,
    period: &str,
    reference: NaiveDate,
) -> Result<Vec<NetWorthSnapshot>, AppError> {
    let cutoff = period_cutoff(period, reference)?;

    let query = match cutoff {
        Some(_) => {
            "SELECT id, total_cents, snapshot_date, breakdown_json, created_at \
             FROM net_worth_snapshots WHERE snapshot_date >= ?1 ORDER BY snapshot_date ASC"
        }
        None => {
            "SELECT id, total_cents, snapshot_date, breakdown_json, created_at \
             FROM net_worth_snapshots ORDER BY snapshot_date ASC"
        }
    };

    let mut stmt = conn.prepare(query)?;
    let map_row = |row: &rusqlite::Row<'_>| {
        Ok(NetWorthSnapshot {
            id: row.get(0)?,
            total_cents: row.get(1)?,
            snapshot_date: row.get(2)?,
            breakdown_json: row.get(3)?,
            created_at: row.get(4)?,
        })
    };

    let snapshots = match cutoff {
        Some(cutoff) => stmt
            .query_map(params![cutoff], map_row)?
            .collect::<Result<Vec<_>, _>>()?,
        None => stmt.query_map([], map_row)?.collect::<Result<Vec<_>, _>>()?,
    };

    Ok(snapshots)
}

fn compute_change(history: &[NetWorthSnapshot]) -> NetWorthChange {
    let [first, .., last] = history else {
        return NetWorthChange {
            absolute_change_cents: 0,
            percentage_change: 0.0,
            direction: "flat".to_string(),
        };
    };

    let diff = last.total_cents - first.total_cents;

    let percentage = if first.total_cents != 0 {
        (diff as f64 / first.total_cents as f64) * 100.0
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

    NetWorthChange {
        absolute_change_cents: diff,
        percentage_change: percentage,
        direction: direction.to_string(),
    }
}

pub fn get_net_worth_history(
    conn: &Connection,
    period: &str,
) -> Result<Vec<NetWorthSnapshot>, AppError> {
    read_history(conn, period, today(conn)?)
}

pub fn get_net_worth_change(
    conn: &Connection,
    period: &str,
) -> Result<NetWorthChange, AppError> {
    Ok(compute_change(&get_net_worth_history(conn, period)?))
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

    const SEPTEMBER_10: &str = "2026-09-10";

    fn reference(date: &str) -> NaiveDate {
        NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap()
    }

    fn seed_snapshots(conn: &Connection, dates: &[&str]) {
        for (index, date) in dates.iter().enumerate() {
            conn.execute(
                "INSERT INTO net_worth_snapshots (total_cents, snapshot_date, breakdown_json) VALUES (?1, ?2, '{}')",
                params![1000 * (index as i64 + 1), date],
            )
            .unwrap();
        }
    }

    fn dates_in(conn: &Connection, period: &str, today: &str) -> Vec<String> {
        read_history(conn, period, reference(today))
            .unwrap()
            .into_iter()
            .map(|snapshot| snapshot.snapshot_date)
            .collect()
    }

    #[test]
    fn six_month_window_excludes_the_seventh_calendar_month() {
        // Given a snapshot in the seventh calendar month back and a September reference date
        let conn = setup_test_db();
        seed_snapshots(&conn, &["2026-03-15", "2026-04-01", "2026-09-05"]);

        // When 6M history is read
        let dates = dates_in(&conn, "6m", SEPTEMBER_10);

        // Then March is out of range and the window starts no earlier than April 1
        assert_eq!(dates, vec!["2026-04-01", "2026-09-05"]);
    }

    #[test]
    fn six_month_window_includes_the_first_day_of_the_sixth_month_back() {
        // Given a snapshot exactly on the window boundary
        let conn = setup_test_db();
        seed_snapshots(&conn, &["2026-03-31", "2026-04-01"]);

        // When 6M history is read
        let dates = dates_in(&conn, "6m", SEPTEMBER_10);

        // Then the boundary day is included and the day before it is not
        assert_eq!(dates, vec!["2026-04-01"]);
    }

    #[test]
    fn six_month_window_includes_the_current_month() {
        // Given a snapshot dated later in the reference month than the reference day
        let conn = setup_test_db();
        seed_snapshots(&conn, &["2026-09-30"]);

        // When 6M and 1Y history are read
        // Then both include it
        assert_eq!(dates_in(&conn, "6m", SEPTEMBER_10), vec!["2026-09-30"]);
        assert_eq!(dates_in(&conn, "1y", SEPTEMBER_10), vec!["2026-09-30"]);
    }

    #[test]
    fn one_year_window_keeps_the_month_six_month_drops() {
        // Given a March snapshot plus one just outside the twelve-month window
        let conn = setup_test_db();
        seed_snapshots(&conn, &["2025-09-30", "2025-10-01", "2026-03-15"]);

        // When 1Y history is read
        let dates = dates_in(&conn, "1y", SEPTEMBER_10);

        // Then March survives and the window starts at October 1 of the prior year
        assert_eq!(dates, vec!["2025-10-01", "2026-03-15"]);
    }

    #[test]
    fn all_period_applies_no_cutoff() {
        // Given snapshots spanning several years
        let conn = setup_test_db();
        seed_snapshots(&conn, &["2019-01-01", "2026-03-15", "2026-09-05"]);

        // When ALL history is read
        let dates = dates_in(&conn, "all", SEPTEMBER_10);

        // Then every snapshot is returned in ascending order
        assert_eq!(dates, vec!["2019-01-01", "2026-03-15", "2026-09-05"]);
    }

    #[test]
    fn window_start_crosses_the_year_boundary() {
        // Given a February reference date, where the window start falls in the previous year
        assert_eq!(
            period_cutoff("6m", reference("2026-02-14")).unwrap(),
            Some("2025-09-01".to_string())
        );
        assert_eq!(
            period_cutoff("1y", reference("2026-01-31")).unwrap(),
            Some("2025-02-01".to_string())
        );
        assert_eq!(period_cutoff("all", reference(SEPTEMBER_10)).unwrap(), None);
    }

    #[test]
    fn change_uses_the_same_window_as_history() {
        // Given a March snapshot far below the April-onward values
        let conn = setup_test_db();
        conn.execute(
            "INSERT INTO net_worth_snapshots (total_cents, snapshot_date, breakdown_json) VALUES (100000, '2026-03-15', '{}')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO net_worth_snapshots (total_cents, snapshot_date, breakdown_json) VALUES (200000, '2026-04-01', '{}')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO net_worth_snapshots (total_cents, snapshot_date, breakdown_json) VALUES (250000, '2026-09-05', '{}')",
            [],
        )
        .unwrap();

        // When the change is computed over each window
        let six_month = compute_change(&read_history(&conn, "6m", reference(SEPTEMBER_10)).unwrap());
        let one_year = compute_change(&read_history(&conn, "1y", reference(SEPTEMBER_10)).unwrap());

        // Then 6M is measured from April, not from the excluded March snapshot
        assert_eq!(six_month.absolute_change_cents, 50000);
        assert_eq!(one_year.absolute_change_cents, 150000);
    }
}
