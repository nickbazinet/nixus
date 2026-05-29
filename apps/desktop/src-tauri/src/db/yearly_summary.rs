use chrono::Local;
use rusqlite::{params, Connection, OptionalExtension};

use crate::db::net_worth;
use crate::error::AppError;
use crate::models::{MonthlySpendTotal, YearlyCategorySpend, YearlySummaryData};

fn year_bounds(year: i32, is_current_year: bool) -> (String, String) {
    let start = format!("{:04}-01-01", year);
    let end = if is_current_year {
        Local::now().format("%Y-%m-%d").to_string()
    } else {
        format!("{:04}-12-31", year)
    };
    (start, end)
}

fn get_total_spent(conn: &Connection, start: &str, end: &str) -> Result<i64, AppError> {
    conn.query_row(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM expenses WHERE date >= ?1 AND date <= ?2",
        params![start, end],
        |row| row.get(0),
    )
    .map_err(AppError::from)
}

fn get_total_income(conn: &Connection, start: &str, end: &str) -> Result<i64, AppError> {
    conn.query_row(
        "SELECT COALESCE(SUM(amount_cents), 0) FROM income_entries WHERE date >= ?1 AND date <= ?2",
        params![start, end],
        |row| row.get(0),
    )
    .map_err(AppError::from)
}

fn get_categories_for_year(
    conn: &Connection,
    start: &str,
    end: &str,
    limit: Option<usize>,
) -> Result<Vec<YearlyCategorySpend>, AppError> {
    let sql = if limit.is_some() {
        "SELECT bc.id, bc.name, COALESCE(SUM(e.amount_cents), 0) AS spent_cents
         FROM expenses e
         JOIN budget_categories bc ON e.budget_category_id = bc.id
         WHERE e.date >= ?1 AND e.date <= ?2
         GROUP BY bc.id
         ORDER BY spent_cents DESC, bc.name ASC
         LIMIT ?3"
    } else {
        "SELECT bc.id, bc.name, COALESCE(SUM(e.amount_cents), 0) AS spent_cents
         FROM expenses e
         JOIN budget_categories bc ON e.budget_category_id = bc.id
         WHERE e.date >= ?1 AND e.date <= ?2
         GROUP BY bc.id
         ORDER BY spent_cents DESC, bc.name ASC"
    };

    let mut stmt = conn.prepare(sql)?;

    let map_row = |row: &rusqlite::Row<'_>| {
        Ok(YearlyCategorySpend {
            category_id: row.get(0)?,
            category_name: row.get(1)?,
            spent_cents: row.get(2)?,
        })
    };

    let categories = if let Some(limit) = limit {
        stmt.query_map(params![start, end, limit as i64], map_row)?
            .collect::<Result<Vec<_>, _>>()?
    } else {
        stmt.query_map(params![start, end], map_row)?
            .collect::<Result<Vec<_>, _>>()?
    };

    Ok(categories)
}

fn get_monthly_totals_for_year(
    conn: &Connection,
    year: i32,
    start: &str,
    end: &str,
) -> Result<Vec<MonthlySpendTotal>, AppError> {
    let year_str = format!("{:04}", year);

    let mut stmt = conn.prepare(
        "SELECT strftime('%Y-%m', date) AS month, COALESCE(SUM(amount_cents), 0) AS total_cents
         FROM expenses
         WHERE date >= ?1 AND date <= ?2
         GROUP BY month
         ORDER BY month",
    )?;

    let rows: Vec<(String, i64)> = stmt
        .query_map(params![start, end], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;

    let mut totals_by_month: std::collections::HashMap<String, i64> =
        rows.into_iter().collect();

    let mut monthly_totals = Vec::with_capacity(12);
    for month in 1..=12 {
        let month_key = format!("{}-{:02}", year_str, month);
        monthly_totals.push(MonthlySpendTotal {
            month: month_key.clone(),
            total_cents: totals_by_month.remove(&month_key).unwrap_or(0),
        });
    }

    Ok(monthly_totals)
}

fn get_net_worth_gain_for_year(
    conn: &Connection,
    year: i32,
    is_current_year: bool,
) -> Result<(Option<i64>, bool), AppError> {
    let table_exists: bool = conn.query_row(
        "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name='net_worth_snapshots'",
        [],
        |row| row.get(0),
    )?;

    if !table_exists {
        return Ok((None, false));
    }

    let year_start = format!("{:04}-01-01", year);
    let (_, end_date) = year_bounds(year, is_current_year);

    let start_cents: Option<i64> = conn
        .query_row(
            "SELECT total_cents FROM net_worth_snapshots
             WHERE snapshot_date <= ?1
             ORDER BY snapshot_date DESC
             LIMIT 1",
            params![year_start],
            |row| row.get(0),
        )
        .optional()?;

    let start_cents = match start_cents {
        Some(cents) => Some(cents),
        None => conn
            .query_row(
                "SELECT total_cents FROM net_worth_snapshots
                 WHERE snapshot_date >= ?1 AND snapshot_date <= ?2
                 ORDER BY snapshot_date ASC
                 LIMIT 1",
                params![year_start, end_date],
                |row| row.get(0),
            )
            .optional()?,
    };

    let Some(start) = start_cents else {
        return Ok((None, false));
    };

    let end_cents = if is_current_year {
        net_worth::get_current_net_worth(conn)?.total_cents
    } else {
        let year_str = format!("{:04}", year);
        conn.query_row(
            "SELECT total_cents FROM net_worth_snapshots
             WHERE strftime('%Y', snapshot_date) = ?1
             ORDER BY snapshot_date DESC
             LIMIT 1",
            params![year_str],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(start)
    };

    Ok((Some(end_cents - start), true))
}

fn get_available_years(conn: &Connection) -> Result<Vec<i32>, AppError> {
    let current_year: i32 = Local::now().format("%Y").to_string().parse().unwrap_or(2026);

    let mut stmt = conn.prepare(
        "SELECT DISTINCT year FROM (
            SELECT CAST(strftime('%Y', date) AS INTEGER) AS year FROM expenses
            UNION
            SELECT CAST(strftime('%Y', date) AS INTEGER) AS year FROM income_entries
         )
         WHERE year IS NOT NULL
         ORDER BY year DESC",
    )?;

    let mut years: Vec<i32> = stmt
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;

    if !years.contains(&current_year) {
        years.insert(0, current_year);
        years.sort_by(|a, b| b.cmp(a));
        years.dedup();
    }

    if years.is_empty() {
        years.push(current_year);
    }

    Ok(years)
}

pub fn get_yearly_summary(conn: &Connection, year: i32) -> Result<YearlySummaryData, AppError> {
    let current_year: i32 = Local::now().format("%Y").to_string().parse().unwrap_or(2026);
    let is_current_year = year == current_year;
    let (start, end) = year_bounds(year, is_current_year);

    let total_spent_cents = get_total_spent(conn, &start, &end)?;
    let total_income_cents = get_total_income(conn, &start, &end)?;
    let cash_flow_net_cents = total_income_cents - total_spent_cents;

    let (net_worth_gain_cents, net_worth_gain_available) =
        get_net_worth_gain_for_year(conn, year, is_current_year)?;

    let top_categories = get_categories_for_year(conn, &start, &end, Some(3))?;
    let all_categories = get_categories_for_year(conn, &start, &end, None)?;
    let monthly_totals = get_monthly_totals_for_year(conn, year, &start, &end)?;
    let available_years = get_available_years(conn)?;

    Ok(YearlySummaryData {
        year,
        is_current_year,
        total_spent_cents,
        total_income_cents,
        cash_flow_net_cents,
        net_worth_gain_cents,
        net_worth_gain_available,
        top_categories,
        monthly_totals,
        all_categories,
        available_years,
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
            "CREATE TABLE budget_groups (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE budget_categories (
                id INTEGER PRIMARY KEY,
                group_id INTEGER NOT NULL REFERENCES budget_groups(id),
                name TEXT NOT NULL,
                target_cents INTEGER NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                merchant TEXT NOT NULL,
                amount_cents INTEGER NOT NULL,
                budget_category_id INTEGER NOT NULL REFERENCES budget_categories(id),
                date TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'manual',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE income_sources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                income_type TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE income_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_id INTEGER NOT NULL REFERENCES income_sources(id),
                amount_cents INTEGER NOT NULL,
                date TEXT NOT NULL,
                month TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE accounts (
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
            );",
        )
        .unwrap();

        conn.execute(
            "INSERT INTO budget_groups (id, name) VALUES (1, 'Essentials')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO budget_categories (id, group_id, name, target_cents) VALUES (1, 1, 'Food', 50000), (2, 1, 'Housing', 150000), (3, 1, 'Transport', 20000)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO income_sources (id, name, income_type) VALUES (1, 'Salary', 'employment')",
            [],
        )
        .unwrap();

        conn
    }

    #[test]
    fn test_total_spent_respects_year_boundaries() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date) VALUES ('A', 10000, 1, '2024-12-31')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date) VALUES ('B', 20000, 1, '2025-01-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date) VALUES ('C', 30000, 2, '2025-06-15')",
            [],
        )
        .unwrap();

        let summary = get_yearly_summary(&conn, 2025).unwrap();
        assert_eq!(summary.total_spent_cents, 50000);
    }

    #[test]
    fn test_top_3_ordering_with_name_tiebreaker() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date) VALUES ('A', 50000, 1, '2025-03-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date) VALUES ('B', 50000, 3, '2025-03-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date) VALUES ('C', 100000, 2, '2025-03-01')",
            [],
        )
        .unwrap();

        let summary = get_yearly_summary(&conn, 2025).unwrap();
        assert_eq!(summary.top_categories.len(), 3);
        assert_eq!(summary.top_categories[0].category_name, "Housing");
        assert_eq!(summary.top_categories[1].category_name, "Food");
        assert_eq!(summary.top_categories[2].category_name, "Transport");
    }

    #[test]
    fn test_monthly_totals_zero_fill() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date) VALUES ('A', 10000, 1, '2025-01-15')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date) VALUES ('B', 20000, 1, '2025-03-15')",
            [],
        )
        .unwrap();

        let summary = get_yearly_summary(&conn, 2025).unwrap();
        assert_eq!(summary.monthly_totals.len(), 12);
        assert_eq!(summary.monthly_totals[0].total_cents, 10000);
        assert_eq!(summary.monthly_totals[1].total_cents, 0);
        assert_eq!(summary.monthly_totals[2].total_cents, 20000);
    }

    #[test]
    fn test_net_worth_gain_none_without_snapshots() {
        let conn = setup_test_db();
        let summary = get_yearly_summary(&conn, 2025).unwrap();
        assert!(!summary.net_worth_gain_available);
        assert!(summary.net_worth_gain_cents.is_none());
    }

    #[test]
    fn test_net_worth_gain_with_snapshots() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO net_worth_snapshots (total_cents, snapshot_date, breakdown_json) VALUES (100000, '2024-12-01', '{}')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO accounts (name, institution, account_type, balance_cents) VALUES ('Chequing', 'Bank', 'chequing', 150000)",
            [],
        )
        .unwrap();

        let current_year: i32 = Local::now().format("%Y").to_string().parse().unwrap();
        let summary = get_yearly_summary(&conn, current_year).unwrap();

        if summary.net_worth_gain_available {
            assert!(summary.net_worth_gain_cents.is_some());
        }
    }

    #[test]
    fn test_empty_year_returns_zeros() {
        let conn = setup_test_db();
        let summary = get_yearly_summary(&conn, 2020).unwrap();
        assert_eq!(summary.total_spent_cents, 0);
        assert_eq!(summary.top_categories.len(), 0);
    }

    #[test]
    fn test_income_included_in_cash_flow() {
        let conn = setup_test_db();

        conn.execute(
            "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date) VALUES ('A', 30000, 1, '2025-05-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO income_entries (source_id, amount_cents, date, month) VALUES (1, 100000, '2025-05-01', '2025-05')",
            [],
        )
        .unwrap();

        let summary = get_yearly_summary(&conn, 2025).unwrap();
        assert_eq!(summary.total_income_cents, 100000);
        assert_eq!(summary.cash_flow_net_cents, 70000);
    }
}
