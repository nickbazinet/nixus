use chrono::{Datelike, NaiveDate};
use rusqlite::{params, Connection};

use crate::db::expense as expense_db;
use crate::error::AppError;
use crate::models::{
    CreateExpenseInput, CreateRecurringExpenseTemplateInput, Expense, RecurringExpenseTemplate,
    UpdateRecurringExpenseTemplateInput,
};

pub fn insert_template(
    conn: &Connection,
    input: &CreateRecurringExpenseTemplateInput,
) -> Result<RecurringExpenseTemplate, AppError> {
    let merchant = input.merchant.trim();
    if merchant.is_empty() {
        return Err(AppError::Validation {
            message: "Merchant name is required".to_string(),
            field: Some("merchant".to_string()),
        });
    }

    if input.amount_cents <= 0 {
        return Err(AppError::Validation {
            message: "Amount must be greater than $0".to_string(),
            field: Some("amount_cents".to_string()),
        });
    }

    if input.day_of_month < 1 || input.day_of_month > 31 {
        return Err(AppError::Validation {
            message: "Day of month must be between 1 and 31".to_string(),
            field: Some("day_of_month".to_string()),
        });
    }

    conn.execute(
        "INSERT INTO recurring_expense_templates (merchant, amount_cents, budget_category_id, day_of_month)
         VALUES (?1, ?2, ?3, ?4)",
        params![merchant, input.amount_cents, input.budget_category_id, input.day_of_month],
    )?;

    let id = conn.last_insert_rowid();
    get_template_by_id(conn, id)
}

pub fn get_all_templates(conn: &Connection) -> Result<Vec<RecurringExpenseTemplate>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, merchant, amount_cents, budget_category_id, day_of_month, is_active, created_at, updated_at
         FROM recurring_expense_templates
         ORDER BY merchant ASC",
    )?;

    let templates = stmt
        .query_map([], |row| {
            Ok(RecurringExpenseTemplate {
                id: row.get(0)?,
                merchant: row.get(1)?,
                amount_cents: row.get(2)?,
                budget_category_id: row.get(3)?,
                day_of_month: row.get(4)?,
                is_active: row.get::<_, i64>(5)? != 0,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(templates)
}

pub fn update_template(
    conn: &Connection,
    id: i64,
    input: &UpdateRecurringExpenseTemplateInput,
) -> Result<RecurringExpenseTemplate, AppError> {
    let merchant = input.merchant.trim();
    if merchant.is_empty() {
        return Err(AppError::Validation {
            message: "Merchant name is required".to_string(),
            field: Some("merchant".to_string()),
        });
    }

    if input.amount_cents <= 0 {
        return Err(AppError::Validation {
            message: "Amount must be greater than $0".to_string(),
            field: Some("amount_cents".to_string()),
        });
    }

    if input.day_of_month < 1 || input.day_of_month > 31 {
        return Err(AppError::Validation {
            message: "Day of month must be between 1 and 31".to_string(),
            field: Some("day_of_month".to_string()),
        });
    }

    let is_active_int: i64 = if input.is_active { 1 } else { 0 };

    let rows = conn.execute(
        "UPDATE recurring_expense_templates
         SET merchant = ?1, amount_cents = ?2, budget_category_id = ?3, day_of_month = ?4, is_active = ?5, updated_at = datetime('now')
         WHERE id = ?6",
        params![merchant, input.amount_cents, input.budget_category_id, input.day_of_month, is_active_int, id],
    )?;

    if rows == 0 {
        return Err(AppError::Database {
            message: "Recurring template not found".to_string(),
        });
    }

    get_template_by_id(conn, id)
}

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

pub fn apply_recurring_for_month(
    conn: &Connection,
    year: i32,
    month: u32,
) -> Result<Vec<Expense>, AppError> {
    let templates = get_active_templates(conn)?;
    let mut created = Vec::new();

    for template in templates {
        if let Some(expense) = try_apply_template_for_month(conn, &template, year, month)? {
            created.push(expense);
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
        let start_date = parse_template_start_date(&template.created_at)?;
        let mut year = start_date.year();
        let mut month = start_date.month();

        while (year, month) <= (today.year(), today.month()) {
            let actual_day = clamp_day_to_month(year, month, template.day_of_month);
            let occurrence_date =
                NaiveDate::from_ymd_opt(year, month, actual_day as u32).ok_or_else(|| {
                    AppError::Database {
                        message: format!("Invalid recurring expense date: {year}-{month}-{actual_day}"),
                    }
                })?;

            if occurrence_date >= start_date && occurrence_date <= today {
                if let Some(expense) =
                    try_apply_template_for_month(conn, &template, year, month)?
                {
                    created.push(expense);
                }
            }

            (year, month) = next_month(year, month);
        }
    }

    Ok(created)
}

fn try_apply_template_for_month(
    conn: &Connection,
    template: &RecurringExpenseTemplate,
    year: i32,
    month: u32,
) -> Result<Option<Expense>, AppError> {
    let actual_day = clamp_day_to_month(year, month, template.day_of_month);
    let date = format!("{:04}-{:02}-{:02}", year, month, actual_day);

    if recurring_expense_exists(conn, &template.merchant, &date, template.amount_cents)? {
        return Ok(None);
    }

    let input = CreateExpenseInput {
        merchant: template.merchant.clone(),
        amount_cents: template.amount_cents,
        budget_category_id: template.budget_category_id,
        date,
    };
    let expense = expense_db::insert_expense_with_source(conn, &input, "recurring")?;
    Ok(Some(expense))
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

fn parse_template_start_date(created_at: &str) -> Result<NaiveDate, AppError> {
    let date_part = created_at.split([' ', 'T']).next().unwrap_or(created_at);
    NaiveDate::parse_from_str(date_part, "%Y-%m-%d").map_err(|e| AppError::Database {
        message: format!("Invalid template created_at date: {e}"),
    })
}

fn next_month(year: i32, month: u32) -> (i32, u32) {
    if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    }
}

fn get_active_templates(conn: &Connection) -> Result<Vec<RecurringExpenseTemplate>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, merchant, amount_cents, budget_category_id, day_of_month, is_active, created_at, updated_at
         FROM recurring_expense_templates
         WHERE is_active = 1
         ORDER BY merchant ASC",
    )?;

    let templates = stmt
        .query_map([], |row| {
            Ok(RecurringExpenseTemplate {
                id: row.get(0)?,
                merchant: row.get(1)?,
                amount_cents: row.get(2)?,
                budget_category_id: row.get(3)?,
                day_of_month: row.get(4)?,
                is_active: row.get::<_, i64>(5)? != 0,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(templates)
}

fn get_template_by_id(conn: &Connection, id: i64) -> Result<RecurringExpenseTemplate, AppError> {
    conn.query_row(
        "SELECT id, merchant, amount_cents, budget_category_id, day_of_month, is_active, created_at, updated_at
         FROM recurring_expense_templates
         WHERE id = ?1",
        params![id],
        |row| {
            Ok(RecurringExpenseTemplate {
                id: row.get(0)?,
                merchant: row.get(1)?,
                amount_cents: row.get(2)?,
                budget_category_id: row.get(3)?,
                day_of_month: row.get(4)?,
                is_active: row.get::<_, i64>(5)? != 0,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )
    .map_err(AppError::from)
}

fn clamp_day_to_month(year: i32, month: u32, day: i32) -> i32 {
    let last_day = last_day_of_month(year, month);
    std::cmp::min(day, last_day as i32)
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
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
            "CREATE TABLE budget_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                target_cents INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE recurring_expense_templates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                merchant TEXT NOT NULL,
                amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
                budget_category_id INTEGER NOT NULL REFERENCES budget_categories(id),
                day_of_month INTEGER NOT NULL CHECK(day_of_month BETWEEN 1 AND 31),
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                merchant TEXT NOT NULL,
                amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
                budget_category_id INTEGER NOT NULL REFERENCES budget_categories(id),
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
}
