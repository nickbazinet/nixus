use rusqlite::Connection;

use crate::error::AppError;
use crate::models::{AccountBalanceByType, AssetValueByType, ProjectionInput};

pub fn get_projection_input(conn: &Connection) -> Result<ProjectionInput, AppError> {
    // Account balances grouped by type
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

    // Asset values grouped by type
    let mut stmt = conn.prepare(
        "SELECT asset_type, SUM(value_cents) as total_cents
         FROM passive_assets
         GROUP BY asset_type",
    )?;
    let asset_values = stmt
        .query_map([], |row| {
            Ok(AssetValueByType {
                asset_type: row.get(0)?,
                total_cents: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // Average monthly income
    let (avg_monthly_income_cents, income_month_count): (i64, i64) = conn
        .query_row(
            "SELECT COALESCE(SUM(amount_cents), 0),
                    COUNT(DISTINCT strftime('%Y-%m', date))
             FROM income_entries
             WHERE strftime('%Y-%m', date) < strftime('%Y-%m', 'now')",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
    let avg_monthly_income_cents = if income_month_count > 0 {
        avg_monthly_income_cents / income_month_count
    } else {
        0
    };

    // Average monthly expenses
    let (avg_monthly_expense_cents, expense_month_count): (i64, i64) = conn
        .query_row(
            "SELECT COALESCE(SUM(amount_cents), 0),
                    COUNT(DISTINCT strftime('%Y-%m', date))
             FROM expenses
             WHERE strftime('%Y-%m', date) < strftime('%Y-%m', 'now')",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
    let avg_monthly_expense_cents = if expense_month_count > 0 {
        avg_monthly_expense_cents / expense_month_count
    } else {
        0
    };

    Ok(ProjectionInput {
        account_balances,
        asset_values,
        avg_monthly_income_cents,
        avg_monthly_expense_cents,
        income_month_count,
        expense_month_count,
    })
}
