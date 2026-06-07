use rusqlite::Connection;

use crate::error::AppError;

/// Returns `(avg_monthly_cents, month_count)` for completed calendar months excluding the current month.
pub fn get_trailing_income_average(conn: &Connection) -> Result<(i64, i64), AppError> {
    let (total_cents, month_count): (i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(amount_cents), 0),
                COUNT(DISTINCT strftime('%Y-%m', date))
         FROM income_entries
         WHERE strftime('%Y-%m', date) < strftime('%Y-%m', 'now')",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    let avg_cents = if month_count > 0 {
        total_cents / month_count
    } else {
        0
    };

    Ok((avg_cents, month_count))
}

/// Returns `(avg_monthly_cents, month_count)` for completed calendar months excluding the current month.
pub fn get_trailing_expense_average(conn: &Connection) -> Result<(i64, i64), AppError> {
    let (total_cents, month_count): (i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(amount_cents), 0),
                COUNT(DISTINCT strftime('%Y-%m', date))
         FROM expenses
         WHERE strftime('%Y-%m', date) < strftime('%Y-%m', 'now')",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    let avg_cents = if month_count > 0 {
        total_cents / month_count
    } else {
        0
    };

    Ok((avg_cents, month_count))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE income_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amount_cents INTEGER NOT NULL,
                date TEXT NOT NULL
            );
            CREATE TABLE expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                amount_cents INTEGER NOT NULL,
                date TEXT NOT NULL
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn trailing_income_average_excludes_current_month() {
        let conn = setup_test_db();
        conn.execute_batch(
            "INSERT INTO income_entries (amount_cents, date) VALUES
             (100000, '2026-01-15'),
             (200000, '2026-02-15'),
             (999999, date('now'));",
        )
        .unwrap();

        let (avg, count) = get_trailing_income_average(&conn).unwrap();
        assert_eq!(count, 2);
        assert_eq!(avg, 150000);
    }

    #[test]
    fn trailing_expense_average_returns_zero_when_no_history() {
        let conn = setup_test_db();
        let (avg, count) = get_trailing_expense_average(&conn).unwrap();
        assert_eq!(count, 0);
        assert_eq!(avg, 0);
    }

    #[test]
    fn trailing_expense_average_divides_by_distinct_months() {
        let conn = setup_test_db();
        conn.execute_batch(
            "INSERT INTO expenses (amount_cents, date) VALUES
             (30000, '2026-01-10'),
             (30000, '2026-01-20'),
             (60000, '2026-02-10');",
        )
        .unwrap();

        let (avg, count) = get_trailing_expense_average(&conn).unwrap();
        assert_eq!(count, 2);
        assert_eq!(avg, 60000);
    }
}
