use rusqlite::{params, Connection};

use crate::error::AppError;
use crate::models::{MonthlySpendByCategory, MonthlySpendTotal};

pub fn get_monthly_spend_by_category(
    conn: &Connection,
    months: i32,
) -> Result<Vec<MonthlySpendByCategory>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT strftime('%Y-%m', e.date) AS month,
                bc.id AS category_id,
                bc.name AS category_name,
                SUM(e.amount_cents) AS spent_cents
         FROM expenses e
         JOIN budget_categories bc ON e.budget_category_id = bc.id
         WHERE e.date >= date('now', 'start of month', printf('-%d months', ?1))
         GROUP BY month, bc.id
         ORDER BY month, spent_cents DESC",
    )?;

    let rows = stmt
        .query_map(params![months], |row| {
            Ok(MonthlySpendByCategory {
                month: row.get(0)?,
                category_id: row.get(1)?,
                category_name: row.get(2)?,
                spent_cents: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

pub fn get_monthly_spend_totals(
    conn: &Connection,
    months: i32,
) -> Result<Vec<MonthlySpendTotal>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT strftime('%Y-%m', e.date) AS month,
                SUM(e.amount_cents) AS total_cents
         FROM expenses e
         WHERE e.date >= date('now', 'start of month', printf('-%d months', ?1))
         GROUP BY month
         ORDER BY month",
    )?;

    let rows = stmt
        .query_map(params![months], |row| {
            Ok(MonthlySpendTotal {
                month: row.get(0)?,
                total_cents: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}
