use rusqlite::Connection;

use crate::db::aggregates;
use crate::error::AppError;
use crate::models::{AccountBalanceByType, RetirementInput};

const TRAILING_WINDOW_MONTHS: i64 = 12;

pub fn get_retirement_input(conn: &Connection) -> Result<RetirementInput, AppError> {
    let mut stmt = conn.prepare(
        "SELECT account_type, SUM(balance_cents) as total_cents
         FROM accounts
         GROUP BY account_type",
    )?;
    let account_balances = stmt
        .query_map([], |row| {
            Ok(AccountBalanceByType {
                account_type: row.get(0)?,
                total_cents: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let (avg_monthly_income_cents, income_month_count) =
        aggregates::get_trailing_income_average_windowed(conn, TRAILING_WINDOW_MONTHS)?;
    let (avg_monthly_expense_cents, expense_month_count) =
        aggregates::get_trailing_expense_average_windowed(conn, TRAILING_WINDOW_MONTHS)?;

    Ok(RetirementInput {
        account_balances,
        avg_monthly_income_cents,
        avg_monthly_expense_cents,
        income_month_count,
        expense_month_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_type TEXT NOT NULL,
                balance_cents INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE income_entries (
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
    fn returns_zeroed_averages_with_no_history() {
        let conn = setup_test_db();
        let input = get_retirement_input(&conn).unwrap();
        assert_eq!(input.account_balances.len(), 0);
        assert_eq!(input.avg_monthly_expense_cents, 0);
        assert_eq!(input.expense_month_count, 0);
    }

    #[test]
    fn groups_account_balances_by_type() {
        let conn = setup_test_db();
        conn.execute_batch(
            "INSERT INTO accounts (account_type, balance_cents) VALUES
             ('tfsa', 100000),
             ('tfsa', 50000),
             ('chequing', 20000);",
        )
        .unwrap();

        let input = get_retirement_input(&conn).unwrap();
        let tfsa = input
            .account_balances
            .iter()
            .find(|b| b.account_type == "tfsa")
            .unwrap();
        assert_eq!(tfsa.total_cents, 150000);
    }
}
