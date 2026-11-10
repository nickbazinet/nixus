use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension};

use crate::db::budget as budget_db;
use crate::db::expense as expense_db;
use crate::db::recurrence::{self, StoredSchedule};
use crate::error::AppError;
use crate::sync::capture;
use crate::sync::identity;
use crate::models::{
    CreateExpenseInput, CreateRecurringExpenseTemplateInput, Expense, RecurringExpenseTemplate,
    UpdateRecurringExpenseTemplateInput,
};

const SELECT_TEMPLATE: &str = "SELECT id, merchant, amount_cents, budget_category_id, day_of_month,
            frequency, start_date, is_active, created_at, updated_at
     FROM recurring_expense_templates";

/// CAPTURE-SANCTIONED (AD-3): reached only through `ActiveDataset::write`.
pub fn insert_template(
    conn: &Connection,
    input: &CreateRecurringExpenseTemplateInput,
) -> Result<RecurringExpenseTemplate, AppError> {
    let merchant = validate_merchant_and_amount(&input.merchant, input.amount_cents)?;
    validate_template_category(conn, input.budget_category_id)?;
    let schedule = recurrence::normalize(
        input.frequency,
        input.day_of_month,
        input.start_date.as_deref(),
        None,
        chrono::Local::now().date_naive(),
    )?;

    conn.execute(
        "INSERT INTO recurring_expense_templates
            (merchant, amount_cents, budget_category_id, day_of_month, frequency, start_date)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            merchant,
            input.amount_cents,
            input.budget_category_id,
            schedule.day_of_month,
            schedule.frequency,
            schedule.start_date
        ],
    )?;

    let id = conn.last_insert_rowid();
    get_template_by_id(conn, id).map_err(AppError::from)
}

pub fn get_all_templates(conn: &Connection) -> Result<Vec<RecurringExpenseTemplate>, AppError> {
    let mut stmt = conn.prepare(&format!("{SELECT_TEMPLATE} ORDER BY merchant ASC"))?;

    let templates = stmt
        .query_map([], row_to_template)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(templates)
}

/// CAPTURE-SANCTIONED (AD-3): reached only through `ActiveDataset::write`.
pub fn update_template(
    conn: &Connection,
    id: i64,
    input: &UpdateRecurringExpenseTemplateInput,
) -> Result<RecurringExpenseTemplate, AppError> {
    let merchant = validate_merchant_and_amount(&input.merchant, input.amount_cents)?;
    validate_template_category(conn, input.budget_category_id)?;
    let previous = get_template_by_id(conn, id)
        .optional()?
        .ok_or_else(|| AppError::Database {
            message: "Recurring template not found".to_string(),
        })?;
    let schedule = recurrence::normalize(
        input.frequency,
        input.day_of_month,
        input.start_date.as_deref(),
        Some(&schedule_of(&previous)),
        chrono::Local::now().date_naive(),
    )?;

    let is_active_int: i64 = if input.is_active { 1 } else { 0 };

    conn.execute(
        "UPDATE recurring_expense_templates
         SET merchant = ?1, amount_cents = ?2, budget_category_id = ?3, day_of_month = ?4,
             frequency = ?5, start_date = ?6, is_active = ?7, updated_at = datetime('now')
         WHERE id = ?8",
        params![
            merchant,
            input.amount_cents,
            input.budget_category_id,
            schedule.day_of_month,
            schedule.frequency,
            schedule.start_date,
            is_active_int,
            id
        ],
    )?;

    get_template_by_id(conn, id).map_err(AppError::from)
}

fn validate_template_category(conn: &Connection, budget_category_id: i64) -> Result<(), AppError> {
    let category_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM budget_categories WHERE id = ?1 AND deleted_at IS NULL)",
        params![budget_category_id],
        |row| row.get(0),
    )?;
    if !category_exists {
        return Err(AppError::Validation {
            message: "Budget category not found".to_string(),
            field: Some("budget_category_id".to_string()),
        });
    }

    if budget_db::is_project_linked_category(conn, budget_category_id)? {
        return Err(budget_db::project_linked_category_rejected());
    }

    Ok(())
}

fn validate_merchant_and_amount(merchant: &str, amount_cents: i64) -> Result<&str, AppError> {
    let merchant = merchant.trim();
    if merchant.is_empty() {
        return Err(AppError::Validation {
            message: "Merchant name is required".to_string(),
            field: Some("merchant".to_string()),
        });
    }

    if amount_cents <= 0 {
        return Err(AppError::Validation {
            message: "Amount must be greater than $0".to_string(),
            field: Some("amount_cents".to_string()),
        });
    }

    Ok(merchant)
}

/// CAPTURE-SANCTIONED (AD-3): reached only through `ActiveDataset::write`.
pub fn delete_template(conn: &Connection, id: i64) -> Result<(), AppError> {
    let rows = conn.execute(
        "DELETE FROM recurring_expense_templates WHERE id = ?1",
        params![id],
    )?;
    if rows == 0 {
        return Err(AppError::Database {
            message: "Recurring template not found".to_string(),
        });
    }
    Ok(())
}

/// Records every occurrence of every active template that falls in the given month: one for a
/// monthly template, one per week for a weekly one.
pub fn apply_recurring_for_month(
    conn: &Connection,
    year: i32,
    month: u32,
) -> Result<Vec<Expense>, AppError> {
    let templates = get_active_templates(conn)?;
    let mut created = Vec::new();

    for template in templates {
        for date in recurrence::occurrences_in_month(&schedule_of(&template), year, month)? {
            if let Some(expense) = try_apply_template(conn, &template, date)? {
                created.push(expense);
            }
        }
    }

    Ok(created)
}

/// Applies all recurring expense templates whose scheduled date is on or before today.
/// Skips occurrences that already exist in expenses (any source).
pub fn apply_due_recurring_expenses(conn: &Connection) -> Result<Vec<Expense>, AppError> {
    let today = chrono::Local::now().date_naive();
    apply_due_recurring_expenses_as_of(conn, today)
}

fn apply_due_recurring_expenses_as_of(
    conn: &Connection,
    today: NaiveDate,
) -> Result<Vec<Expense>, AppError> {
    let templates = get_active_templates(conn)?;
    let mut created = Vec::new();

    for template in templates {
        // One unusable template must not stop the others, matching the income backfill.
        let dates =
            match recurrence::due_occurrences(&schedule_of(&template), &template.created_at, today) {
                Ok(dates) => dates,
                Err(e) => {
                    tracing::error!(
                        "Skipping recurring expense template {}: {:?}",
                        template.id,
                        e
                    );
                    continue;
                }
            };
        for date in dates {
            if let Some(expense) = try_apply_template(conn, &template, date)? {
                created.push(expense);
            }
        }
    }

    Ok(created)
}

fn try_apply_template(
    conn: &Connection,
    template: &RecurringExpenseTemplate,
    occurrence: NaiveDate,
) -> Result<Option<Expense>, AppError> {
    let date = occurrence.format("%Y-%m-%d").to_string();

    // Only a build without the template guard (an older version on another computer, arriving
    // through sync) can point a template at a savings line. Recording it would fail the whole
    // batch, so this one template is skipped instead.
    if budget_db::is_project_linked_category(conn, template.budget_category_id)? {
        tracing::warn!(
            "Skipping recurring expense template {}: its category tracks a savings project",
            template.id
        );
        return Ok(None);
    }

    if recurring_expense_exists(conn, &template.merchant, &date, template.amount_cents)? {
        return Ok(None);
    }

    let input = CreateExpenseInput {
        merchant: template.merchant.clone(),
        amount_cents: template.amount_cents,
        budget_category_id: template.budget_category_id,
        date,
        account_id: None,
    };
    let expense = expense_db::insert_expense_with_source(conn, &input, "recurring")?;
    let period = recurrence::period_of(template.frequency, occurrence);
    bind_generated_expense_identity(conn, template.id, expense.id, &period)?;

    Ok(Some(expense))
}

/// AD-2: every computer generates this row on its own, so its identity is DERIVED from
/// `(template uuid, period)` rather than minted — otherwise the same month would arrive as one
/// expense per computer.
///
/// Skipped entirely when nothing is capturing, so a local-only profile still writes no `sync_*`
/// row at all (inherited AD-12).
fn bind_generated_expense_identity(
    conn: &Connection,
    template_id: i64,
    expense_id: i64,
    period: &str,
) -> Result<(), AppError> {
    if !capture::is_capturing() {
        return Ok(());
    }

    let template = identity::existing_uuid_for(conn, "recurring_expense_templates", template_id)?;
    let derived = identity::recurring_expense(&template, period);

    let mapping = identity::ensure_derived(conn, "expenses", expense_id, &derived)?;
    if mapping.row_id != expense_id {
        tracing::warn!(
            "Recurring expense identity for period {period} already belongs to another local row"
        );
    }

    Ok(())
}

fn recurring_expense_exists(
    conn: &Connection,
    merchant: &str,
    date: &str,
    amount_cents: i64,
) -> Result<bool, AppError> {
    conn.query_row(
        "SELECT COUNT(*) FROM expenses
         WHERE merchant = ?1 AND date = ?2 AND amount_cents = ?3",
        params![merchant, date, amount_cents],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count > 0)
    .map_err(AppError::from)
}

fn schedule_of(template: &RecurringExpenseTemplate) -> StoredSchedule {
    StoredSchedule {
        frequency: template.frequency,
        day_of_month: template.day_of_month,
        start_date: template.start_date.clone(),
    }
}

pub(crate) fn parse_template_start_date(created_at: &str) -> Result<NaiveDate, AppError> {
    let date_part = created_at.split([' ', 'T']).next().unwrap_or(created_at);
    NaiveDate::parse_from_str(date_part, "%Y-%m-%d").map_err(|e| AppError::Database {
        message: format!("Invalid template created_at date: {e}"),
    })
}

pub(crate) fn next_month(year: i32, month: u32) -> (i32, u32) {
    if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    }
}

fn get_active_templates(conn: &Connection) -> Result<Vec<RecurringExpenseTemplate>, AppError> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT_TEMPLATE} WHERE is_active = 1 ORDER BY merchant ASC"
    ))?;

    let templates = stmt
        .query_map([], row_to_template)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(templates)
}

pub(crate) fn get_template_by_id(
    conn: &Connection,
    id: i64,
) -> rusqlite::Result<RecurringExpenseTemplate> {
    conn.query_row(
        &format!("{SELECT_TEMPLATE} WHERE id = ?1"),
        params![id],
        row_to_template,
    )
}

fn row_to_template(row: &rusqlite::Row) -> rusqlite::Result<RecurringExpenseTemplate> {
    Ok(RecurringExpenseTemplate {
        id: row.get(0)?,
        merchant: row.get(1)?,
        amount_cents: row.get(2)?,
        budget_category_id: row.get(3)?,
        day_of_month: row.get(4)?,
        frequency: row.get(5)?,
        start_date: row.get(6)?,
        is_active: row.get::<_, i64>(7)? != 0,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

pub(crate) fn clamp_day_to_month(year: i32, month: u32, day: i32) -> i32 {
    let last_day = last_day_of_month(year, month);
    std::cmp::min(day, last_day as i32)
}

pub(crate) fn last_day_of_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if is_leap_year(year) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

#[cfg(test)]
mod tests {
    use super::*;
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
                balance_cents INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE budget_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                target_cents INTEGER NOT NULL DEFAULT 0,
                deleted_at TEXT,
                project_id INTEGER
            );
            CREATE TABLE recurring_expense_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                merchant TEXT NOT NULL,
                amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
                budget_category_id INTEGER NOT NULL REFERENCES budget_categories(id),
                day_of_month INTEGER NOT NULL CHECK(day_of_month BETWEEN 1 AND 31),
                frequency TEXT NOT NULL DEFAULT 'monthly',
                start_date TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                merchant TEXT NOT NULL,
                amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
                budget_category_id INTEGER NOT NULL REFERENCES budget_categories(id),
                account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
                date TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'manual',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )
        .unwrap();

        conn.execute(
            "INSERT INTO budget_categories (group_id, name, target_cents) VALUES (1, 'Subscriptions', 5000)",
            [],
        )
        .unwrap();

        conn
    }

    fn insert_template(
        conn: &Connection,
        merchant: &str,
        amount_cents: i64,
        day_of_month: i32,
        created_at: &str,
    ) {
        conn.execute(
            "INSERT INTO recurring_expense_templates
             (merchant, amount_cents, budget_category_id, day_of_month, created_at, updated_at)
             VALUES (?1, ?2, 1, ?3, ?4, ?4)",
            params![merchant, amount_cents, day_of_month, created_at],
        )
        .unwrap();
    }

    #[test]
    fn apply_due_recurring_skips_occurrences_before_template_created() {
        let conn = setup_test_db();
        insert_template(&conn, "Insurance", 8000, 15, "2026-02-15 00:00:00");

        let today = NaiveDate::from_ymd_opt(2026, 3, 20).unwrap();
        let created = apply_due_recurring_expenses_as_of(&conn, today).unwrap();

        assert_eq!(created.len(), 2);
        assert!(created.iter().any(|e| e.date == "2026-02-15"));
        assert!(created.iter().any(|e| e.date == "2026-03-15"));
        assert!(!created.iter().any(|e| e.date == "2026-01-15"));
    }

    #[test]
    fn apply_due_recurring_creates_past_occurrences() {
        let conn = setup_test_db();
        insert_template(&conn, "Netflix", 1599, 15, "2026-01-01 00:00:00");

        let today = NaiveDate::from_ymd_opt(2026, 3, 20).unwrap();
        let created = apply_due_recurring_expenses_as_of(&conn, today).unwrap();

        assert_eq!(created.len(), 3);
        assert!(created.iter().any(|e| e.date == "2026-01-15"));
        assert!(created.iter().any(|e| e.date == "2026-02-15"));
        assert!(created.iter().any(|e| e.date == "2026-03-15"));
    }

    #[test]
    fn apply_due_recurring_skips_future_occurrence_in_current_month() {
        let conn = setup_test_db();
        insert_template(&conn, "Gym", 5000, 25, "2026-03-01 00:00:00");

        let today = NaiveDate::from_ymd_opt(2026, 3, 20).unwrap();
        let created = apply_due_recurring_expenses_as_of(&conn, today).unwrap();

        assert!(created.is_empty());
    }

    #[test]
    fn apply_due_recurring_skips_when_manual_expense_exists() {
        let conn = setup_test_db();
        insert_template(&conn, "Rent", 150000, 1, "2026-01-01 00:00:00");
        conn.execute(
            "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date, source)
             VALUES ('Rent', 150000, 1, '2026-02-01', 'manual')",
            [],
        )
        .unwrap();

        let today = NaiveDate::from_ymd_opt(2026, 2, 10).unwrap();
        let created = apply_due_recurring_expenses_as_of(&conn, today).unwrap();

        assert_eq!(created.len(), 1);
        assert_eq!(created[0].date, "2026-01-01");
    }

    #[test]
    fn apply_recurring_for_month_skips_existing_manual_expense() {
        let conn = setup_test_db();
        insert_template(&conn, "Spotify", 1199, 10, "2026-01-01 00:00:00");
        conn.execute(
            "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date, source)
             VALUES ('Spotify', 1199, 1, '2026-03-10', 'manual')",
            [],
        )
        .unwrap();

        let created = apply_recurring_for_month(&conn, 2026, 3).unwrap();
        assert!(created.is_empty());
    }

    #[test]
    fn a_weekly_template_backfills_each_week_and_applies_every_week_of_a_month() {
        let conn = setup_test_db();
        conn.execute(
            "INSERT INTO recurring_expense_templates
             (merchant, amount_cents, budget_category_id, day_of_month, frequency, start_date,
              created_at, updated_at)
             VALUES ('Cleaner', 6000, 1, 5, 'weekly', '2026-11-05', '2026-11-05 00:00:00',
                     '2026-11-05 00:00:00')",
            [],
        )
        .unwrap();

        let due = apply_due_recurring_expenses_as_of(&conn, NaiveDate::from_ymd_opt(2026, 11, 20).unwrap())
            .unwrap();
        let dates: Vec<&str> = due.iter().map(|e| e.date.as_str()).collect();
        assert_eq!(dates, vec!["2026-11-05", "2026-11-12", "2026-11-19"]);

        let rest = apply_recurring_for_month(&conn, 2026, 11).unwrap();
        let dates: Vec<&str> = rest.iter().map(|e| e.date.as_str()).collect();
        assert_eq!(dates, vec!["2026-11-26"]);
    }
}
