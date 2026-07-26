use std::collections::HashMap;

use rusqlite::{params, Connection};

use crate::error::AppError;
use crate::models::{CategoryCompareRow, MonthlySpendByCategory, MonthlySpendTotal};

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

pub fn get_category_targets(conn: &Connection) -> Result<HashMap<i64, i64>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, target_cents FROM budget_categories WHERE deleted_at IS NULL",
    )?;

    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows.into_iter().collect())
}

pub fn classify_status(avg_cents: i64, target_cents: Option<i64>) -> String {
    let Some(target) = target_cents else {
        return "no_target".to_string();
    };
    if target <= 0 {
        return "no_target".to_string();
    }

    let delta = (avg_cents - target) as f64 / target as f64;
    if delta.abs() <= 0.10 {
        "on_track".to_string()
    } else if avg_cents < (target as f64 * 0.90) as i64 {
        "under".to_string()
    } else {
        "over".to_string()
    }
}

fn compute_delta_pct(avg_cents: i64, target_cents: i64) -> i32 {
    ((avg_cents - target_cents) as f64 * 100.0 / target_cents as f64).round() as i32
}

pub fn compute_category_compare(
    by_category: &[MonthlySpendByCategory],
    months: i32,
    targets: &HashMap<i64, i64>,
) -> Vec<CategoryCompareRow> {
    let divisor = months.max(1) as i64;

    let mut totals: HashMap<i64, (String, i64)> = HashMap::new();
    for row in by_category {
        let entry = totals
            .entry(row.category_id)
            .or_insert_with(|| (row.category_name.clone(), 0));
        entry.1 += row.spent_cents;
    }

    let mut rows: Vec<CategoryCompareRow> = totals
        .into_iter()
        .map(|(category_id, (category_name, total))| {
            let avg_cents = (total as f64 / divisor as f64).round() as i64;
            let target_cents = targets.get(&category_id).copied();
            let status = classify_status(avg_cents, target_cents);
            let delta_pct = target_cents
                .filter(|t| *t > 0)
                .map(|t| compute_delta_pct(avg_cents, t));

            CategoryCompareRow {
                category_id,
                category_name,
                avg_cents,
                target_cents,
                delta_pct,
                status,
            }
        })
        .collect();

    rows.sort_by(|a, b| b.avg_cents.cmp(&a.avg_cents));
    rows
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_row(category_id: i64, name: &str, spent: i64) -> MonthlySpendByCategory {
        MonthlySpendByCategory {
            month: "2026-01".to_string(),
            category_id,
            category_name: name.to_string(),
            spent_cents: spent,
        }
    }

    #[test]
    fn classify_on_track_at_exactly_10_percent_over() {
        assert_eq!(classify_status(11000, Some(10000)), "on_track");
    }

    #[test]
    fn classify_on_track_at_exactly_10_percent_under() {
        assert_eq!(classify_status(9000, Some(10000)), "on_track");
    }

    #[test]
    fn classify_under_below_band() {
        assert_eq!(classify_status(8999, Some(10000)), "under");
    }

    #[test]
    fn classify_over_above_band() {
        assert_eq!(classify_status(11001, Some(10000)), "over");
    }

    #[test]
    fn classify_no_target_when_missing_or_zero() {
        assert_eq!(classify_status(5000, None), "no_target");
        assert_eq!(classify_status(5000, Some(0)), "no_target");
        assert_eq!(classify_status(5000, Some(-100)), "no_target");
    }

    #[test]
    fn compute_delta_pct_rounds_to_nearest_whole_percent() {
        let mut targets = HashMap::new();
        targets.insert(1, 10000);
        let rows = compute_category_compare(
            &[sample_row(1, "Food", 66600)],
            6,
            &targets,
        );
        assert_eq!(rows[0].avg_cents, 11100);
        assert_eq!(rows[0].delta_pct, Some(11));
    }

    #[test]
    fn sparse_months_use_window_divisor_not_months_with_data() {
        let mut targets = HashMap::new();
        targets.insert(1, 100000);
        let rows = compute_category_compare(
            &[sample_row(1, "Food", 60000)],
            6,
            &targets,
        );
        assert_eq!(rows[0].avg_cents, 10000);
        assert_eq!(rows[0].status, "under");
    }

    #[test]
    fn rows_sorted_by_avg_descending() {
        let mut targets = HashMap::new();
        targets.insert(1, 50000);
        targets.insert(2, 50000);
        let rows = compute_category_compare(
            &[
                sample_row(1, "Food", 120000),
                sample_row(2, "Transport", 60000),
            ],
            6,
            &targets,
        );
        assert_eq!(rows[0].category_name, "Food");
        assert_eq!(rows[1].category_name, "Transport");
    }
}
