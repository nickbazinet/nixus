use rusqlite::Connection;

use crate::db::aggregates;
use crate::error::AppError;
use crate::models::{AccountBalanceByType, RetirementInput};

const TRAILING_WINDOW_MONTHS: i64 = 12;

pub fn get_retirement_input(conn: &Connection) -> Result<RetirementInput, AppError> {
    // `balance_cents` excludes held stocks, so a fully invested account would count as $0. Holdings
    // fold into their linked account's type; unlinked ones are non-registered. Physical assets stay out.
    let mut stmt = conn.prepare(
        "SELECT account_type, SUM(cents) as total_cents
         FROM (
             SELECT account_type, balance_cents AS cents FROM accounts
             UNION ALL
             SELECT COALESCE(ac.account_type, 'non_registered'), a.value_cents
             FROM stock_holdings h
             JOIN passive_assets a ON a.id = h.passive_asset_id
             LEFT JOIN accounts ac ON ac.id = h.account_id
         )
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
            );
            CREATE TABLE passive_assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                asset_type TEXT NOT NULL,
                value_cents INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE stock_holdings (
                passive_asset_id INTEGER PRIMARY KEY,
                account_id INTEGER
            );",
        )
        .unwrap();
        conn
    }

    fn balance_for(input: &RetirementInput, account_type: &str) -> Option<i64> {
        input
            .account_balances
            .iter()
            .find(|b| b.account_type == account_type)
            .map(|b| b.total_cents)
    }

    #[test]
    fn adds_linked_stock_value_to_its_account_type() {
        let conn = setup_test_db();
        conn.execute_batch(
            "INSERT INTO accounts (id, account_type, balance_cents) VALUES (1, 'tfsa', 0);
             INSERT INTO passive_assets (id, asset_type, value_cents) VALUES (10, 'stock', 2500000);
             INSERT INTO stock_holdings (passive_asset_id, account_id) VALUES (10, 1);",
        )
        .unwrap();

        let input = get_retirement_input(&conn).unwrap();
        assert_eq!(balance_for(&input, "tfsa"), Some(2_500_000));
    }

    #[test]
    fn counts_unlinked_stock_as_non_registered() {
        let conn = setup_test_db();
        conn.execute_batch(
            "INSERT INTO passive_assets (id, asset_type, value_cents) VALUES (10, 'stock', 700000);
             INSERT INTO stock_holdings (passive_asset_id, account_id) VALUES (10, NULL);",
        )
        .unwrap();

        let input = get_retirement_input(&conn).unwrap();
        assert_eq!(balance_for(&input, "non_registered"), Some(700_000));
    }

    #[test]
    fn excludes_physical_assets() {
        let conn = setup_test_db();
        conn.execute_batch(
            "INSERT INTO passive_assets (asset_type, value_cents) VALUES
             ('real_estate', 50000000), ('vehicle', 2000000), ('business', 1000000), ('other', 5000);",
        )
        .unwrap();

        let input = get_retirement_input(&conn).unwrap();
        assert!(input.account_balances.is_empty());
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
