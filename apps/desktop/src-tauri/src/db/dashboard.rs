use rusqlite::{params, Connection};

use crate::db::aggregates;
use crate::error::AppError;
use crate::models::{BudgetSummary, DashboardBudgetCategory, SpendingByCategory};

pub fn get_budget_summary(
    conn: &Connection,
    year: i32,
    month: i32,
) -> Result<BudgetSummary, AppError> {
    let year_str = format!("{:04}", year);
    let month_str = format!("{:02}", month);

    let (total_target_cents, total_spent_cents): (i64, i64) = conn.query_row(
        "SELECT COALESCE((SELECT SUM(target_cents) FROM budget_categories WHERE deleted_at IS NULL), 0),
                COALESCE((
                    SELECT SUM(amount_cents) FROM expenses
                    WHERE strftime('%Y', date) = ?1
                      AND strftime('%m', date) = ?2
                ), 0)",
        params![year_str, month_str],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    let (average_monthly_income_cents, income_month_count) =
        aggregates::get_trailing_income_average(conn)?;

    Ok(BudgetSummary {
        total_target_cents,
        total_spent_cents,
        remaining_cents: total_target_cents - total_spent_cents,
        month: format!("{}-{}", year_str, month_str),
        average_monthly_income_cents,
        income_month_count,
    })
}

pub fn get_top_budget_categories(
    conn: &Connection,
    year: i32,
    month: i32,
    limit: usize,
) -> Result<Vec<DashboardBudgetCategory>, AppError> {
    let year_str = format!("{:04}", year);
    let month_str = format!("{:02}", month);

    let mut stmt = conn.prepare(
        "SELECT bc.id, bc.name, bg.name AS group_name, bc.target_cents,
                COALESCE(e_agg.spent, 0) AS spent_cents
         FROM budget_categories bc
         JOIN budget_groups bg ON bg.id = bc.group_id
         LEFT JOIN (
             SELECT budget_category_id, SUM(amount_cents) AS spent
             FROM expenses
             WHERE strftime('%Y', date) = ?1
               AND strftime('%m', date) = ?2
             GROUP BY budget_category_id
         ) e_agg ON e_agg.budget_category_id = bc.id
         WHERE bc.deleted_at IS NULL OR COALESCE(e_agg.spent, 0) > 0
         ORDER BY spent_cents DESC
         LIMIT ?3",
    )?;

    let categories = stmt
        .query_map(params![year_str, month_str, limit as i64], |row| {
            let target_cents: i64 = row.get(3)?;
            let spent_cents: i64 = row.get(4)?;
            let percentage = if target_cents > 0 {
                (spent_cents as f64 / target_cents as f64) * 100.0
            } else {
                0.0
            };
            Ok(DashboardBudgetCategory {
                id: row.get(0)?,
                name: row.get(1)?,
                group_name: row.get(2)?,
                target_cents,
                spent_cents,
                percentage,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(categories)
}

pub fn get_spending_breakdown(
    conn: &Connection,
    year: i32,
    month: i32,
) -> Result<Vec<SpendingByCategory>, AppError> {
    let year_str = format!("{:04}", year);
    let month_str = format!("{:02}", month);

    let mut stmt = conn.prepare(
        "SELECT bc.id, bc.name, SUM(e.amount_cents) AS spent
         FROM expenses e
         JOIN budget_categories bc ON e.budget_category_id = bc.id
         WHERE strftime('%Y', e.date) = ?1
           AND strftime('%m', e.date) = ?2
         GROUP BY bc.id
         ORDER BY spent DESC",
    )?;

    let breakdown = stmt
        .query_map(params![year_str, month_str], |row| {
            Ok(SpendingByCategory {
                category_id: row.get(0)?,
                category_name: row.get(1)?,
                spent_cents: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(breakdown)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE budget_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL
            );
            CREATE TABLE budget_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL REFERENCES budget_groups(id),
                name TEXT NOT NULL,
                target_cents INTEGER NOT NULL DEFAULT 0,
                deleted_at TEXT
            );
            CREATE TABLE expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                merchant TEXT NOT NULL,
                amount_cents INTEGER NOT NULL,
                budget_category_id INTEGER NOT NULL REFERENCES budget_categories(id),
                date TEXT NOT NULL
            );
            CREATE TABLE income_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amount_cents INTEGER NOT NULL,
                date TEXT NOT NULL
            );
            INSERT INTO budget_groups (name) VALUES ('Essentials');
            INSERT INTO budget_categories (group_id, name, target_cents)
                VALUES (1, 'Housing', 400000);",
        )
        .unwrap();
        conn
    }

    #[test]
    fn budget_summary_totals_active_targets_and_the_requested_month_spend() {
        // Given a $4,000 target and $1,500 spent in March 2026
        let conn = setup_test_db();
        conn.execute_batch(
            "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date) VALUES
             ('Landlord', 150000, 1, '2026-03-10'),
             ('Landlord', 999999, 1, '2026-04-10');",
        )
        .unwrap();

        // When the March summary is read
        let summary = get_budget_summary(&conn, 2026, 3).unwrap();

        // Then April's expense is excluded and the remainder is target minus spend
        assert_eq!(summary.total_target_cents, 400000);
        assert_eq!(summary.total_spent_cents, 150000);
        assert_eq!(summary.remaining_cents, 250000);
        assert_eq!(summary.month, "2026-03");
    }

    #[test]
    fn budget_summary_averages_income_over_distinct_completed_months() {
        // Given $18,000 of income across six completed months, one of them split over two entries
        let conn = setup_test_db();
        conn.execute_batch(
            "INSERT INTO income_entries (amount_cents, date) VALUES
             (150000, '2020-01-05'),
             (150000, '2020-01-20'),
             (300000, '2020-02-15'),
             (300000, '2020-03-15'),
             (300000, '2020-04-15'),
             (300000, '2020-05-15'),
             (300000, '2020-06-15');",
        )
        .unwrap();

        // When the summary is read
        let summary = get_budget_summary(&conn, 2026, 3).unwrap();

        // Then the divisor is the six distinct months, not the seven rows
        assert_eq!(summary.income_month_count, 6);
        assert_eq!(summary.average_monthly_income_cents, 300000);

        let wire = serde_json::to_value(&summary).unwrap();
        assert_eq!(wire["income_month_count"], 6);
        assert_eq!(wire["average_monthly_income_cents"], 300000);
    }

    #[test]
    fn budget_summary_income_average_excludes_the_current_month() {
        // Given two completed income months plus an outsized entry dated today
        let conn = setup_test_db();
        conn.execute(
            "INSERT INTO income_entries (amount_cents, date) VALUES
             (100000, '2020-01-15'),
             (200000, '2020-02-15'),
             (9999999, date('now'))",
            [],
        )
        .unwrap();

        // When the summary is read
        let summary = get_budget_summary(&conn, 2026, 3).unwrap();

        // Then today's entry moves neither the count nor the average
        assert_eq!(summary.income_month_count, 2);
        assert_eq!(summary.average_monthly_income_cents, 150000);
    }

    #[test]
    fn budget_summary_reports_no_income_history_as_zero() {
        // Given no income entries at all
        let conn = setup_test_db();

        // When the summary is read
        let summary = get_budget_summary(&conn, 2026, 3).unwrap();

        // Then the count is zero, which is what keeps the warning off screen
        assert_eq!(summary.income_month_count, 0);
        assert_eq!(summary.average_monthly_income_cents, 0);
    }
}
