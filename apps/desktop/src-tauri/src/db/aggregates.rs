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

/// Returns `(avg_monthly_cents, month_count)` for completed calendar months excluding the current
/// month, bounded to the trailing `months` window — unlike the unbounded variants above, this
/// reflects recent spending/income rather than diluting it with the account's full history.
pub fn get_trailing_income_average_windowed(
    conn: &Connection,
    months: i64,
) -> Result<(i64, i64), AppError> {
    let (total_cents, month_count): (i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(amount_cents), 0),
                COUNT(DISTINCT strftime('%Y-%m', date))
         FROM income_entries
         WHERE strftime('%Y-%m', date) < strftime('%Y-%m', 'now')
           AND date >= date('now', 'start of month', printf('-%d months', ?1))",
        rusqlite::params![months],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    let avg_cents = if month_count > 0 {
        total_cents / month_count
    } else {
        0
    };

    Ok((avg_cents, month_count))
}

/// Windowed counterpart to `get_trailing_expense_average` — see `get_trailing_income_average_windowed`.
pub fn get_trailing_expense_average_windowed(
    conn: &Connection,
    months: i64,
) -> Result<(i64, i64), AppError> {
    let (total_cents, month_count): (i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(amount_cents), 0),
                COUNT(DISTINCT strftime('%Y-%m', date))
         FROM expenses
         WHERE strftime('%Y-%m', date) < strftime('%Y-%m', 'now')
           AND date >= date('now', 'start of month', printf('-%d months', ?1))",
        rusqlite::params![months],
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

    #[test]
    fn windowed_expense_average_excludes_months_outside_the_window() {
        let conn = setup_test_db();
        conn.execute_batch(
            "INSERT INTO expenses (amount_cents, date) VALUES
             (10000, '2020-01-10'),
             (100000, '2026-06-10'),
             (100000, '2026-07-10');",
        )
        .unwrap();

        // A 2-month window should pick up only the two recent months, not the 2020 outlier.
        let (avg, count) = get_trailing_expense_average_windowed(&conn, 2).unwrap();
        assert_eq!(count, 2);
        assert_eq!(avg, 100000);
    }

    #[test]
    fn windowed_income_average_excludes_months_outside_the_window() {
        let conn = setup_test_db();
        conn.execute_batch(
            "INSERT INTO income_entries (amount_cents, date) VALUES
             (10000, '2020-01-15'),
             (500000, '2026-07-15');",
        )
        .unwrap();

        let (avg, count) = get_trailing_income_average_windowed(&conn, 2).unwrap();
        assert_eq!(count, 1);
        assert_eq!(avg, 500000);
    }
}
