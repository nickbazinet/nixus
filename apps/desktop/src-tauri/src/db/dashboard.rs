use rusqlite::{params, Connection};

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
        "SELECT COALESCE(SUM(bc.target_cents), 0),
                COALESCE(SUM(e_agg.spent), 0)
         FROM budget_categories bc
         LEFT JOIN (
             SELECT budget_category_id, SUM(amount_cents) AS spent
             FROM expenses
             WHERE strftime('%Y', date) = ?1
               AND strftime('%m', date) = ?2
             GROUP BY budget_category_id
         ) e_agg ON e_agg.budget_category_id = bc.id",
        params![year_str, month_str],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    Ok(BudgetSummary {
        total_target_cents,
        total_spent_cents,
        remaining_cents: total_target_cents - total_spent_cents,
        month: format!("{}-{}", year_str, month_str),
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
