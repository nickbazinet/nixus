use rusqlite::Connection;

use crate::db::aggregates;
use crate::db::config;
use crate::error::AppError;
use crate::financial_health::constants::{
    is_essential_group_name, DEFAULT_EMERGENCY_FUND_TARGET_MONTHS,
    EMERGENCY_FUND_TARGET_CONFIG_KEY,
};
use crate::financial_health::evaluator::{
    compute_coverage_months, evaluate_waterfall, WaterfallEvalInput, WaterfallEvaluation,
};
use crate::models::{
    DiscretionaryCategory, EmergencyFundStatus, EmergencyFundSummary, FinancialHealthDetail,
    FinancialHealthFigures, FinancialHealthSummary, MonthlySurplusPoint, SavingsSummary,
    WaterfallDetail, WaterfallSummary,
};

const MONTHLY_SURPLUS_TREND_LIMIT: usize = 6;

#[derive(Debug, Clone, PartialEq)]
pub struct FinancialHealthFiguresInternal {
    pub liquid_savings_cents: i64,
    pub avg_monthly_expenses_cents: i64,
    pub avg_monthly_income_cents: i64,
    pub credit_card_debt_cents: i64,
    pub expense_month_count: i64,
    pub income_month_count: i64,
    pub data_sufficient: bool,
    pub coverage_months: Option<f64>,
    pub avg_monthly_surplus_cents: i64,
    pub target_months: i64,
}

pub fn get_emergency_fund_target_months(conn: &Connection) -> Result<i64, AppError> {
    let months = config::get(conn, EMERGENCY_FUND_TARGET_CONFIG_KEY)
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(DEFAULT_EMERGENCY_FUND_TARGET_MONTHS);
    Ok(months)
}

pub fn load_financial_health_figures(
    conn: &Connection,
) -> Result<FinancialHealthFiguresInternal, AppError> {
    let liquid_savings_cents = get_liquid_savings_cents(conn)?;
    let credit_card_debt_cents = get_credit_card_debt_cents(conn)?;
    let (avg_monthly_income_cents, income_month_count) =
        aggregates::get_trailing_income_average(conn)?;
    let (avg_monthly_expenses_cents, expense_month_count) =
        aggregates::get_trailing_expense_average(conn)?;
    let (data_sufficient, coverage_months) = compute_coverage_months(
        liquid_savings_cents,
        avg_monthly_expenses_cents,
        expense_month_count,
    );
    let target_months = get_emergency_fund_target_months(conn)?;

    Ok(FinancialHealthFiguresInternal {
        liquid_savings_cents,
        avg_monthly_expenses_cents,
        avg_monthly_income_cents,
        credit_card_debt_cents,
        expense_month_count,
        income_month_count,
        data_sufficient,
        coverage_months,
        avg_monthly_surplus_cents: avg_monthly_income_cents - avg_monthly_expenses_cents,
        target_months,
    })
}

pub fn set_emergency_fund_target_months(conn: &Connection, months: i64) -> Result<(), AppError> {
    if !(1..=24).contains(&months) {
        return Err(AppError::Validation {
            message: "Emergency fund target must be between 1 and 24 months".to_string(),
            field: Some("months".to_string()),
        });
    }

    config::set(conn, EMERGENCY_FUND_TARGET_CONFIG_KEY, &months.to_string())
        .map_err(AppError::from)
}

fn emergency_fund_status(
    coverage_months: Option<f64>,
    target_months: i64,
) -> EmergencyFundStatus {
    let Some(coverage) = coverage_months else {
        return EmergencyFundStatus::Underfunded;
    };

    let target = target_months as f64;
    if coverage >= target {
        EmergencyFundStatus::Funded
    } else if coverage >= target * 0.5 {
        EmergencyFundStatus::Approaching
    } else {
        EmergencyFundStatus::Underfunded
    }
}

fn emergency_fund_progress_ratio(coverage_months: Option<f64>, target_months: i64) -> f64 {
    let Some(coverage) = coverage_months else {
        return 0.0;
    };

    if target_months == 0 {
        return 0.0;
    }

    coverage / target_months as f64
}

fn savings_rate_percent(
    avg_monthly_income_cents: i64,
    avg_monthly_surplus_cents: i64,
    income_month_count: i64,
) -> Option<f64> {
    if income_month_count == 0 || avg_monthly_income_cents == 0 {
        return None;
    }

    Some(
        (avg_monthly_surplus_cents as f64 / avg_monthly_income_cents as f64) * 100.0,
    )
}

pub fn build_financial_health_summary(
    figures: &FinancialHealthFiguresInternal,
    evaluation: &WaterfallEvaluation,
) -> FinancialHealthSummary {
    let emergency_fund = figures.data_sufficient.then(|| EmergencyFundSummary {
        coverage_months: figures.coverage_months,
        target_months: figures.target_months,
        progress_ratio: emergency_fund_progress_ratio(
            figures.coverage_months,
            figures.target_months,
        ),
        status: emergency_fund_status(figures.coverage_months, figures.target_months),
    });

    let savings = figures.data_sufficient.then(|| SavingsSummary {
        savings_rate_percent: savings_rate_percent(
            figures.avg_monthly_income_cents,
            figures.avg_monthly_surplus_cents,
            figures.income_month_count,
        ),
        avg_monthly_surplus_cents: if figures.income_month_count > 0 {
            Some(figures.avg_monthly_surplus_cents)
        } else {
            None
        },
    });

    let waterfall = Some(WaterfallSummary {
        current_step: evaluation.current_step.clone(),
        action_line_key: evaluation.reasoning_key.clone(),
    });

    FinancialHealthSummary {
        data_sufficient: figures.data_sufficient,
        emergency_fund,
        savings,
        waterfall,
    }
}

pub fn build_financial_health_detail(
    conn: &Connection,
    figures: &FinancialHealthFiguresInternal,
    evaluation: &WaterfallEvaluation,
) -> Result<FinancialHealthDetail, AppError> {
    let summary = build_financial_health_summary(figures, evaluation);

    Ok(FinancialHealthDetail {
        data_sufficient: summary.data_sufficient,
        emergency_fund: summary.emergency_fund,
        savings: summary.savings,
        figures: FinancialHealthFigures {
            liquid_savings_cents: figures.liquid_savings_cents,
            avg_monthly_expenses_cents: figures.avg_monthly_expenses_cents,
            avg_monthly_income_cents: figures.avg_monthly_income_cents,
            credit_card_debt_cents: figures.credit_card_debt_cents,
            expense_month_count: figures.expense_month_count,
            income_month_count: figures.income_month_count,
        },
        waterfall: WaterfallDetail {
            current_step: evaluation.current_step.clone(),
            completed_steps: evaluation.completed_steps.clone(),
            reasoning_key: evaluation.reasoning_key.clone(),
            reasoning_params: evaluation.reasoning_params.clone(),
        },
        top_discretionary_categories: get_top_discretionary_categories(conn, 3)?,
        monthly_surplus_trend: get_monthly_surplus_trend(conn, MONTHLY_SURPLUS_TREND_LIMIT)?,
    })
}

pub fn get_monthly_surplus_trend(
    conn: &Connection,
    limit: usize,
) -> Result<Vec<MonthlySurplusPoint>, AppError> {
    let mut stmt = conn.prepare(
        "WITH months AS (
            SELECT strftime('%Y-%m', date) AS month, SUM(amount_cents) AS income_cents
            FROM income_entries
            WHERE strftime('%Y-%m', date) < strftime('%Y-%m', 'now')
            GROUP BY month
         ),
         expense_totals AS (
            SELECT strftime('%Y-%m', date) AS month, SUM(amount_cents) AS expense_cents
            FROM expenses
            WHERE strftime('%Y-%m', date) < strftime('%Y-%m', 'now')
            GROUP BY month
         ),
         all_months AS (
            SELECT month FROM months
            UNION
            SELECT month FROM expense_totals
         )
         SELECT am.month,
                COALESCE(m.income_cents, 0) AS income_cents,
                COALESCE(e.expense_cents, 0) AS expense_cents
         FROM all_months am
         LEFT JOIN months m ON am.month = m.month
         LEFT JOIN expense_totals e ON am.month = e.month
         ORDER BY am.month DESC
         LIMIT ?1",
    )?;

    let mut points: Vec<MonthlySurplusPoint> = stmt
        .query_map([limit as i64], |row| {
            let income_cents: i64 = row.get(1)?;
            let expense_cents: i64 = row.get(2)?;
            Ok(MonthlySurplusPoint {
                month: row.get(0)?,
                income_cents,
                expense_cents,
                surplus_cents: income_cents - expense_cents,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    points.reverse();
    Ok(points)
}

pub fn evaluate_financial_health_waterfall(
    conn: &Connection,
) -> Result<(FinancialHealthFiguresInternal, WaterfallEvaluation), AppError> {
    let figures = load_financial_health_figures(conn)?;
    let evaluation = evaluate_waterfall(&WaterfallEvalInput {
        data_sufficient: figures.data_sufficient,
        coverage_months: figures.coverage_months,
        target_months: figures.target_months,
        credit_card_debt_cents: figures.credit_card_debt_cents,
        avg_monthly_surplus_cents: figures.avg_monthly_surplus_cents,
        liquid_savings_cents: figures.liquid_savings_cents,
        avg_monthly_expenses_cents: figures.avg_monthly_expenses_cents,
    });
    Ok((figures, evaluation))
}

pub fn get_liquid_savings_cents(conn: &Connection) -> Result<i64, AppError> {
    conn.query_row(
        "SELECT COALESCE(SUM(balance_cents), 0)
         FROM accounts
         WHERE account_type IN ('chequing', 'savings')",
        [],
        |row| row.get(0),
    )
    .map_err(AppError::from)
}

pub fn get_credit_card_debt_cents(conn: &Connection) -> Result<i64, AppError> {
    crate::db::account::get_total_liabilities_cents(conn)
}

pub fn get_top_discretionary_categories(
    conn: &Connection,
    limit: usize,
) -> Result<Vec<DiscretionaryCategory>, AppError> {
    let (_, expense_month_count) = aggregates::get_trailing_expense_average(conn)?;
    if expense_month_count == 0 {
        return Ok(vec![]);
    }

    let mut stmt = conn.prepare(
        "SELECT bc.id, bc.name, bg.name, COALESCE(SUM(e.amount_cents), 0) AS total_cents
         FROM budget_categories bc
         JOIN budget_groups bg ON bc.group_id = bg.id
         LEFT JOIN expenses e ON e.budget_category_id = bc.id
             AND strftime('%Y-%m', e.date) < strftime('%Y-%m', 'now')
         GROUP BY bc.id, bc.name, bg.name",
    )?;

    let mut categories: Vec<DiscretionaryCategory> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?
        .filter_map(|result| result.ok())
        .filter_map(|(category_id, category_name, group_name, total_cents)| {
            if is_essential_group_name(&group_name) {
                return None;
            }
            let avg_monthly_spend_cents = total_cents / expense_month_count;
            if avg_monthly_spend_cents <= 0 {
                return None;
            }
            Some(DiscretionaryCategory {
                category_id,
                category_name,
                group_name,
                avg_monthly_spend_cents,
            })
        })
        .collect();

    categories.sort_by(|a, b| {
        b.avg_monthly_spend_cents
            .cmp(&a.avg_monthly_spend_cents)
            .then_with(|| a.category_name.cmp(&b.category_name))
    });
    categories.truncate(limit);
    Ok(categories)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::financial_health::evaluator::{evaluate_waterfall, WaterfallEvalInput};
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(
            "CREATE TABLE accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                institution TEXT NOT NULL,
                account_type TEXT NOT NULL,
                currency TEXT NOT NULL DEFAULT 'CAD',
                balance_cents INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE budget_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL
            );
            CREATE TABLE budget_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL REFERENCES budget_groups(id),
                name TEXT NOT NULL,
                target_cents INTEGER NOT NULL DEFAULT 0
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
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn liquid_savings_sums_chequing_and_savings_only() {
        let conn = setup_test_db();
        conn.execute_batch(
            "INSERT INTO accounts (name, institution, account_type, balance_cents) VALUES
             ('Chequing', 'Bank', 'chequing', 100000),
             ('Savings', 'Bank', 'savings', 50000),
             ('TFSA', 'Broker', 'tfsa', 999999);",
        )
        .unwrap();

        assert_eq!(get_liquid_savings_cents(&conn).unwrap(), 150000);
    }

    #[test]
    fn credit_card_debt_sums_absolute_negative_balances() {
        let conn = setup_test_db();
        conn.execute_batch(
            "INSERT INTO accounts (name, institution, account_type, balance_cents) VALUES
             ('Visa', 'Bank', 'credit_card', -150000),
             ('Amex', 'Bank', 'credit_card', -50000),
             ('Visa Paid', 'Bank', 'credit_card', 0);",
        )
        .unwrap();

        assert_eq!(get_credit_card_debt_cents(&conn).unwrap(), 200000);
    }

    #[test]
    fn credit_card_debt_counts_positive_liability_balances() {
        let conn = setup_test_db();
        conn.execute_batch(
            "INSERT INTO accounts (name, institution, account_type, balance_cents) VALUES
             ('Mastercard', 'Desjardins', 'credit_card', 200000);",
        )
        .unwrap();

        assert_eq!(get_credit_card_debt_cents(&conn).unwrap(), 200000);
    }

    #[test]
    fn discretionary_categories_exclude_essential_groups() {
        let conn = setup_test_db();
        conn.execute_batch(
            "INSERT INTO budget_groups (id, name) VALUES (1, 'Housing'), (2, 'Fun');
             INSERT INTO budget_categories (id, group_id, name, target_cents) VALUES
             (1, 1, 'Rent', 150000),
             (2, 2, 'Streaming', 5000),
             (3, 2, 'Dining', 8000);
             INSERT INTO expenses (merchant, amount_cents, budget_category_id, date) VALUES
             ('Landlord', 150000, 1, '2026-01-05'),
             ('Landlord', 150000, 1, '2026-02-05'),
             ('Netflix', 2000, 2, '2026-01-10'),
             ('Netflix', 2000, 2, '2026-02-10'),
             ('Restaurant', 4000, 3, '2026-01-15'),
             ('Restaurant', 4000, 3, '2026-02-15');",
        )
        .unwrap();

        let categories = get_top_discretionary_categories(&conn, 3).unwrap();
        assert_eq!(categories.len(), 2);
        assert!(categories.iter().all(|c| c.group_name != "Housing"));
        assert_eq!(categories[0].category_name, "Dining");
        assert_eq!(categories[0].avg_monthly_spend_cents, 4000);
        assert_eq!(categories[1].category_name, "Streaming");
    }

    #[test]
    fn discretionary_categories_return_empty_without_expense_history() {
        let conn = setup_test_db();
        conn.execute("INSERT INTO budget_groups (name) VALUES ('Fun')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO budget_categories (group_id, name, target_cents) VALUES (1, 'Streaming', 5000)",
            [],
        )
        .unwrap();

        let categories = get_top_discretionary_categories(&conn, 3).unwrap();
        assert!(categories.is_empty());
    }

    #[test]
    fn set_emergency_fund_target_rejects_out_of_range_values() {
        let conn = setup_test_db();
        conn.execute_batch(
            "CREATE TABLE config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )
        .unwrap();

        assert!(set_emergency_fund_target_months(&conn, 0).is_err());
        assert!(set_emergency_fund_target_months(&conn, 25).is_err());
    }

    #[test]
    fn set_emergency_fund_target_persists_valid_months() {
        let conn = setup_test_db();
        conn.execute_batch(
            "CREATE TABLE config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )
        .unwrap();

        set_emergency_fund_target_months(&conn, 8).unwrap();
        assert_eq!(get_emergency_fund_target_months(&conn).unwrap(), 8);
    }

    #[test]
    fn build_summary_marks_emergency_fund_approaching_at_half_target() {
        let figures = FinancialHealthFiguresInternal {
            liquid_savings_cents: 180000,
            avg_monthly_expenses_cents: 60000,
            avg_monthly_income_cents: 100000,
            credit_card_debt_cents: 0,
            expense_month_count: 2,
            income_month_count: 2,
            data_sufficient: true,
            coverage_months: Some(3.0),
            avg_monthly_surplus_cents: 40000,
            target_months: 6,
        };
        let evaluation = evaluate_waterfall(&WaterfallEvalInput {
            data_sufficient: true,
            coverage_months: Some(3.0),
            target_months: 6,
            credit_card_debt_cents: 0,
            avg_monthly_surplus_cents: 40000,
            liquid_savings_cents: 180000,
            avg_monthly_expenses_cents: 60000,
        });

        let summary = build_financial_health_summary(&figures, &evaluation);
        let emergency_fund = summary.emergency_fund.expect("expected emergency fund");
        assert_eq!(emergency_fund.status, EmergencyFundStatus::Approaching);
        assert_eq!(emergency_fund.progress_ratio, 0.5);
        assert_eq!(summary.savings.unwrap().avg_monthly_surplus_cents, Some(40000));
    }

    #[test]
    fn monthly_surplus_trend_returns_last_six_completed_months() {
        let conn = setup_test_db();
        conn.execute_batch(
            "INSERT INTO budget_groups (id, name) VALUES (1, 'Essential');
             INSERT INTO budget_categories (id, group_id, name, target_cents) VALUES (1, 1, 'Misc', 0);
             INSERT INTO income_entries (amount_cents, date) VALUES
             (100000, '2026-01-15'),
             (120000, '2026-02-15'),
             (110000, '2026-03-15');
             INSERT INTO expenses (merchant, amount_cents, budget_category_id, date) VALUES
             ('Shop', 60000, 1, '2026-01-10'),
             ('Shop', 70000, 1, '2026-02-10'),
             ('Shop', 65000, 1, '2026-03-10');",
        )
        .unwrap();

        let trend = get_monthly_surplus_trend(&conn, 6).unwrap();
        assert_eq!(trend.len(), 3);
        assert_eq!(trend[0].month, "2026-01");
        assert_eq!(trend[0].surplus_cents, 40000);
        assert_eq!(trend[2].month, "2026-03");
        assert_eq!(trend[2].surplus_cents, 45000);
    }

    #[test]
    fn evaluate_financial_health_waterfall_uses_shared_aggregates() {
        let conn = setup_test_db();
        conn.execute("INSERT INTO budget_groups (name) VALUES ('Essential')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO budget_categories (id, group_id, name, target_cents) VALUES (1, 1, 'Misc', 0)",
            [],
        )
        .unwrap();
        conn.execute_batch(
            "INSERT INTO accounts (name, institution, account_type, balance_cents) VALUES
             ('Chequing', 'Bank', 'chequing', 360000);
             INSERT INTO expenses (merchant, amount_cents, budget_category_id, date) VALUES
             ('Test', 120000, 1, '2026-01-01');",
        )
        .unwrap();

        let (figures, evaluation) = evaluate_financial_health_waterfall(&conn).unwrap();
        assert!(figures.data_sufficient);
        assert_eq!(figures.coverage_months, Some(3.0));
        assert_eq!(
            evaluation.current_step,
            crate::financial_health::evaluator::WaterfallStep::BuildEmergencyFund
        );
    }
}
