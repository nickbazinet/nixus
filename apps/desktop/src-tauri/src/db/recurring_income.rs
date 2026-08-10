use chrono::{Datelike, NaiveDate};
use rusqlite::{params, Connection};

use crate::db::account::BalanceChange;
use crate::db::income as income_db;
use crate::db::recurring::{clamp_day_to_month, next_month, parse_template_start_date};
use crate::error::AppError;
use crate::models::{
    CreateIncomeEntryInput, CreateRecurringIncomeTemplateInput, IncomeEntry,
    RecurringIncomeTemplate, UpdateRecurringIncomeTemplateInput,
};

/// Entries created by a backfill run, with the account movements they caused so the caller can
/// audit them the same way a manually entered income does.
#[derive(Debug, Default)]
pub struct AppliedRecurringIncome {
    pub entries: Vec<IncomeEntry>,
    pub balance_changes: Vec<BalanceChange>,
}

const SELECT_TEMPLATE: &str = "SELECT t.id, t.source_id, s.name, s.income_type, t.amount_cents,
            t.day_of_month, t.account_id, t.is_active, t.created_at, t.updated_at
     FROM recurring_income_templates t
     JOIN income_sources s ON s.id = t.source_id";

pub fn insert_template(
    conn: &Connection,
    input: &CreateRecurringIncomeTemplateInput,
) -> Result<RecurringIncomeTemplate, AppError> {
    validate_amount(input.amount_cents)?;
    validate_day_of_month(input.day_of_month)?;
    validate_source_id(conn, input.source_id)?;
    income_db::validate_account_id(conn, input.account_id)?;

    conn.execute(
        "INSERT INTO recurring_income_templates (source_id, amount_cents, day_of_month, account_id)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            input.source_id,
            input.amount_cents,
            input.day_of_month,
            input.account_id
        ],
    )?;

    let id = conn.last_insert_rowid();
    get_template_by_id(conn, id)
}

pub fn get_all_templates(conn: &Connection) -> Result<Vec<RecurringIncomeTemplate>, AppError> {
    let mut stmt = conn.prepare(&format!("{SELECT_TEMPLATE} ORDER BY s.name ASC, t.id ASC"))?;

    let templates = stmt
        .query_map([], row_to_template)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(templates)
}

pub fn update_template(
    conn: &Connection,
    id: i64,
    input: &UpdateRecurringIncomeTemplateInput,
) -> Result<RecurringIncomeTemplate, AppError> {
    validate_amount(input.amount_cents)?;
    validate_day_of_month(input.day_of_month)?;
    validate_source_id(conn, input.source_id)?;
    income_db::validate_account_id(conn, input.account_id)?;

    let is_active_int: i64 = if input.is_active { 1 } else { 0 };

    let rows = conn.execute(
        "UPDATE recurring_income_templates
         SET source_id = ?1, amount_cents = ?2, day_of_month = ?3, account_id = ?4,
             is_active = ?5, updated_at = datetime('now')
         WHERE id = ?6",
        params![
            input.source_id,
            input.amount_cents,
            input.day_of_month,
            input.account_id,
            is_active_int,
            id
        ],
    )?;

    if rows == 0 {
        return Err(AppError::Database {
            message: "Recurring income template not found".to_string(),
        });
    }

    get_template_by_id(conn, id)
}

pub fn delete_template(conn: &Connection, id: i64) -> Result<(), AppError> {
    let rows = conn.execute(
        "DELETE FROM recurring_income_templates WHERE id = ?1",
        params![id],
    )?;
    if rows == 0 {
        return Err(AppError::Database {
            message: "Recurring income template not found".to_string(),
        });
    }
    Ok(())
}

/// Applies all active recurring income templates whose scheduled date is on or before today.
/// Skips occurrences already recorded in `income_entries` (any source of entry).
pub fn apply_due_recurring_income(conn: &Connection) -> Result<AppliedRecurringIncome, AppError> {
    let today = chrono::Local::now().date_naive();
    apply_due_recurring_income_as_of(conn, today)
}

fn apply_due_recurring_income_as_of(
    conn: &Connection,
    today: NaiveDate,
) -> Result<AppliedRecurringIncome, AppError> {
    let templates = get_active_templates(conn)?;
    let mut applied = AppliedRecurringIncome::default();

    for template in templates {
        // One unusable template must not stop the others: entries already written in this run
        // are committed, and abandoning the loop would leave them unaudited.
        if let Err(e) = apply_template_as_of(conn, &template, today, &mut applied) {
            tracing::error!(
                "Skipping recurring income template {}: {:?}",
                template.id,
                e
            );
        }
    }

    Ok(applied)
}

fn apply_template_as_of(
    conn: &Connection,
    template: &RecurringIncomeTemplate,
    today: NaiveDate,
    applied: &mut AppliedRecurringIncome,
) -> Result<(), AppError> {
    let start_date = parse_template_start_date(&template.created_at)?;
    let mut year = start_date.year();
    let mut month = start_date.month();

    while (year, month) <= (today.year(), today.month()) {
        let occurrence_date = occurrence_date_for(template, year, month)?;

        if occurrence_date >= start_date && occurrence_date <= today {
            if let Some(mutation) = try_apply_template(conn, template, occurrence_date)? {
                applied.entries.push(mutation.entry);
                applied.balance_changes.extend(mutation.balance_changes);
            }
        }

        (year, month) = next_month(year, month);
    }

    Ok(())
}

fn occurrence_date_for(
    template: &RecurringIncomeTemplate,
    year: i32,
    month: u32,
) -> Result<NaiveDate, AppError> {
    let day = clamp_day_to_month(year, month, template.day_of_month);
    NaiveDate::from_ymd_opt(year, month, day as u32).ok_or_else(|| AppError::Database {
        message: format!("Invalid recurring income date: {year}-{month}-{day}"),
    })
}

fn try_apply_template(
    conn: &Connection,
    template: &RecurringIncomeTemplate,
    occurrence_date: NaiveDate,
) -> Result<Option<income_db::LinkedIncomeEntryMutation>, AppError> {
    let date = occurrence_date.format("%Y-%m-%d").to_string();
    let month = occurrence_date.format("%Y-%m").to_string();

    if occurrence_already_applied(conn, template, &month, &date)? {
        return Ok(None);
    }

    let input = CreateIncomeEntryInput {
        source_id: template.source_id,
        amount_cents: template.amount_cents,
        date,
        account_id: template.account_id,
    };
    Ok(Some(income_db::insert_income_entry_from_template(
        conn,
        &input,
        Some(template.id),
    )?))
}

/// Two independent claims on a month. The template stamp is what survives an edit to the amount or
/// day; the source/date/amount match is how a manually recorded paycheque claims its own month.
fn occurrence_already_applied(
    conn: &Connection,
    template: &RecurringIncomeTemplate,
    month: &str,
    date: &str,
) -> Result<bool, AppError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM income_entries
         WHERE (recurring_income_template_id = ?1 AND month = ?2)
            OR (source_id = ?3 AND date = ?4 AND amount_cents = ?5)",
        params![
            template.id,
            month,
            template.source_id,
            date,
            template.amount_cents
        ],
        |row| row.get(0),
    )?;

    Ok(count > 0)
}

fn get_active_templates(conn: &Connection) -> Result<Vec<RecurringIncomeTemplate>, AppError> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT_TEMPLATE} WHERE t.is_active = 1 ORDER BY s.name ASC, t.id ASC"
    ))?;

    let templates = stmt
        .query_map([], row_to_template)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(templates)
}

pub fn get_template_by_id(
    conn: &Connection,
    id: i64,
) -> Result<RecurringIncomeTemplate, AppError> {
    conn.query_row(
        &format!("{SELECT_TEMPLATE} WHERE t.id = ?1"),
        params![id],
        row_to_template,
    )
    .map_err(AppError::from)
}

fn row_to_template(row: &rusqlite::Row) -> rusqlite::Result<RecurringIncomeTemplate> {
    Ok(RecurringIncomeTemplate {
        id: row.get(0)?,
        source_id: row.get(1)?,
        source_name: row.get(2)?,
        income_type: row.get(3)?,
        amount_cents: row.get(4)?,
        day_of_month: row.get(5)?,
        account_id: row.get(6)?,
        is_active: row.get::<_, i64>(7)? != 0,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn validate_amount(amount_cents: i64) -> Result<(), AppError> {
    if amount_cents <= 0 {
        return Err(AppError::Validation {
            message: "Amount must be greater than $0".to_string(),
            field: Some("amount_cents".to_string()),
        });
    }
    Ok(())
}

fn validate_day_of_month(day_of_month: i32) -> Result<(), AppError> {
    if !(1..=31).contains(&day_of_month) {
        return Err(AppError::Validation {
            message: "Day of month must be between 1 and 31".to_string(),
            field: Some("day_of_month".to_string()),
        });
    }
    Ok(())
}

fn validate_source_id(conn: &Connection, source_id: i64) -> Result<(), AppError> {
    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM income_sources WHERE id = ?1)",
        params![source_id],
        |row| row.get(0),
    )?;

    if !exists {
        return Err(AppError::Validation {
            message: "Income source not found".to_string(),
            field: Some("source_id".to_string()),
        });
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::run_migrations;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run_migrations(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO accounts (id, name, institution, account_type, currency, balance_cents)
             VALUES (1, 'Chequing', 'Bank', 'chequing', 'CAD', 10000);
             INSERT INTO income_sources (id, name, income_type) VALUES (1, 'Salary', 'employment');",
        )
        .unwrap();
        conn
    }

    fn seed_template(
        conn: &Connection,
        day_of_month: i32,
        amount_cents: i64,
        account_id: Option<i64>,
        created_at: &str,
    ) -> i64 {
        conn.execute(
            "INSERT INTO recurring_income_templates
             (source_id, amount_cents, day_of_month, account_id, created_at, updated_at)
             VALUES (1, ?1, ?2, ?3, ?4, ?4)",
            params![amount_cents, day_of_month, account_id, created_at],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn account_balance(conn: &Connection, account_id: i64) -> i64 {
        conn.query_row(
            "SELECT balance_cents FROM accounts WHERE id = ?1",
            params![account_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn as_of(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    fn apply_due(conn: &Connection, today: NaiveDate) -> Vec<IncomeEntry> {
        apply_due_recurring_income_as_of(conn, today).unwrap().entries
    }

    fn template_count(conn: &Connection) -> i64 {
        conn.query_row(
            "SELECT COUNT(*) FROM recurring_income_templates",
            [],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn income_entry_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM income_entries", [], |row| row.get(0))
            .unwrap()
    }

    #[test]
    fn apply_due_creates_every_past_occurrence() {
        let conn = setup_test_db();
        seed_template(&conn, 15, 250_000, None, "2026-01-01 00:00:00");

        let created = apply_due(&conn, as_of(2026, 3, 20));

        assert_eq!(created.len(), 3);
        assert!(created.iter().any(|e| e.date == "2026-01-15"));
        assert!(created.iter().any(|e| e.date == "2026-02-15"));
        assert!(created.iter().any(|e| e.date == "2026-03-15"));
    }

    #[test]
    fn apply_due_skips_occurrences_before_template_created() {
        let conn = setup_test_db();
        seed_template(&conn, 15, 250_000, None, "2026-02-15 00:00:00");

        let created = apply_due(&conn, as_of(2026, 3, 20));

        assert_eq!(created.len(), 2);
        assert!(!created.iter().any(|e| e.date == "2026-01-15"));
    }

    #[test]
    fn apply_due_skips_future_occurrence_in_current_month() {
        let conn = setup_test_db();
        seed_template(&conn, 25, 250_000, None, "2026-03-01 00:00:00");

        let created = apply_due(&conn, as_of(2026, 3, 20));

        assert!(created.is_empty());
    }

    #[test]
    fn apply_due_skips_occurrence_already_recorded_manually() {
        let conn = setup_test_db();
        seed_template(&conn, 1, 250_000, None, "2026-01-01 00:00:00");
        conn.execute(
            "INSERT INTO income_entries (source_id, amount_cents, date, month)
             VALUES (1, 250000, '2026-02-01', '2026-02')",
            [],
        )
        .unwrap();

        let created = apply_due(&conn, as_of(2026, 2, 10));

        assert_eq!(created.len(), 1);
        assert_eq!(created[0].date, "2026-01-01");
    }

    #[test]
    fn apply_due_clamps_day_to_last_day_of_short_month() {
        let conn = setup_test_db();
        seed_template(&conn, 31, 100_000, None, "2026-02-01 00:00:00");

        let created = apply_due(&conn, as_of(2026, 2, 28));

        assert_eq!(created.len(), 1);
        assert_eq!(created[0].date, "2026-02-28");
    }

    #[test]
    fn apply_due_clamps_day_to_february_29_in_a_leap_year() {
        let conn = setup_test_db();
        seed_template(&conn, 31, 100_000, None, "2028-02-01 00:00:00");

        let created = apply_due(&conn, as_of(2028, 2, 29));

        assert_eq!(created.len(), 1);
        assert_eq!(created[0].date, "2028-02-29");
    }

    #[test]
    fn apply_due_skips_a_template_with_an_unparsable_created_at_without_dropping_the_others() {
        let conn = setup_test_db();
        seed_template(&conn, 1, 100_000, None, "not-a-date");
        conn.execute(
            "INSERT INTO income_sources (id, name, income_type) VALUES (2, 'Rental', 'other')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO recurring_income_templates
             (source_id, amount_cents, day_of_month, created_at, updated_at)
             VALUES (2, 200000, 1, '2026-03-01 00:00:00', '2026-03-01 00:00:00')",
            [],
        )
        .unwrap();

        let created = apply_due(&conn, as_of(2026, 3, 5));

        assert_eq!(created.len(), 1);
        assert_eq!(created[0].source_name, "Rental");
    }

    #[test]
    fn apply_due_reports_balance_changes_for_linked_accounts() {
        let conn = setup_test_db();
        seed_template(&conn, 1, 250_000, Some(1), "2026-03-01 00:00:00");

        let applied = apply_due_recurring_income_as_of(&conn, as_of(2026, 3, 5)).unwrap();

        assert_eq!(applied.balance_changes.len(), 1);
        assert_eq!(applied.balance_changes[0].account_id, 1);
        assert_eq!(applied.balance_changes[0].old_balance_cents, 10_000);
        assert_eq!(applied.balance_changes[0].new_balance_cents, 260_000);
    }

    #[test]
    fn apply_due_reports_no_balance_changes_without_a_linked_account() {
        let conn = setup_test_db();
        seed_template(&conn, 1, 250_000, None, "2026-03-01 00:00:00");

        let applied = apply_due_recurring_income_as_of(&conn, as_of(2026, 3, 5)).unwrap();

        assert_eq!(applied.entries.len(), 1);
        assert!(applied.balance_changes.is_empty());
    }

    #[test]
    fn apply_due_with_linked_account_increases_balance() {
        let conn = setup_test_db();
        seed_template(&conn, 1, 250_000, Some(1), "2026-03-01 00:00:00");

        let created = apply_due(&conn, as_of(2026, 3, 5));

        assert_eq!(created.len(), 1);
        assert_eq!(created[0].account_id, Some(1));
        assert_eq!(account_balance(&conn, 1), 260_000);
    }

    #[test]
    fn apply_due_ignores_inactive_templates() {
        let conn = setup_test_db();
        let id = seed_template(&conn, 1, 250_000, None, "2026-01-01 00:00:00");
        conn.execute(
            "UPDATE recurring_income_templates SET is_active = 0 WHERE id = ?1",
            params![id],
        )
        .unwrap();

        let created = apply_due(&conn, as_of(2026, 3, 20));

        assert!(created.is_empty());
    }

    #[test]
    fn apply_due_is_idempotent_across_runs() {
        let conn = setup_test_db();
        seed_template(&conn, 1, 250_000, Some(1), "2026-01-01 00:00:00");

        let first = apply_due(&conn, as_of(2026, 3, 20));
        let second = apply_due(&conn, as_of(2026, 3, 20));

        assert_eq!(first.len(), 3);
        assert!(second.is_empty());
        assert_eq!(account_balance(&conn, 1), 10_000 + 3 * 250_000);
    }

    #[test]
    fn editing_the_amount_does_not_reapply_already_applied_months() {
        let conn = setup_test_db();
        let id = seed_template(&conn, 15, 250_000, Some(1), "2026-01-01 00:00:00");
        let first = apply_due(&conn, as_of(2026, 3, 20));
        assert_eq!(first.len(), 3);
        let balance_after_first_run = account_balance(&conn, 1);

        update_template(
            &conn,
            id,
            &UpdateRecurringIncomeTemplateInput {
                source_id: 1,
                amount_cents: 260_000,
                day_of_month: 15,
                account_id: Some(1),
                is_active: true,
            },
        )
        .unwrap();
        let second = apply_due(&conn, as_of(2026, 3, 20));

        assert!(second.is_empty());
        assert_eq!(income_entry_count(&conn), 3);
        assert_eq!(account_balance(&conn, 1), balance_after_first_run);
    }

    #[test]
    fn editing_the_day_does_not_reapply_already_applied_months() {
        let conn = setup_test_db();
        let id = seed_template(&conn, 15, 250_000, None, "2026-01-01 00:00:00");
        assert_eq!(apply_due(&conn, as_of(2026, 3, 20)).len(), 3);

        update_template(
            &conn,
            id,
            &UpdateRecurringIncomeTemplateInput {
                source_id: 1,
                amount_cents: 250_000,
                day_of_month: 20,
                account_id: None,
                is_active: true,
            },
        )
        .unwrap();
        let second = apply_due(&conn, as_of(2026, 3, 20));

        assert!(second.is_empty());
        assert_eq!(income_entry_count(&conn), 3);
    }

    #[test]
    fn applied_entries_are_stamped_with_the_template_that_created_them() {
        let conn = setup_test_db();
        let id = seed_template(&conn, 15, 250_000, None, "2026-03-01 00:00:00");

        apply_due(&conn, as_of(2026, 3, 20));

        let stamped: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM income_entries WHERE recurring_income_template_id = ?1",
                params![id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stamped, 1);
    }

    #[test]
    fn a_manual_entry_is_never_stamped_with_a_template() {
        let conn = setup_test_db();
        let input = CreateIncomeEntryInput {
            source_id: 1,
            amount_cents: 250_000,
            date: "2026-03-15".to_string(),
            account_id: None,
        };

        income_db::insert_income_entry(&conn, &input).unwrap();

        let unstamped: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM income_entries WHERE recurring_income_template_id IS NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(unstamped, 1);
    }

    #[test]
    fn deleting_a_template_keeps_the_entries_it_created() {
        let conn = setup_test_db();
        let id = seed_template(&conn, 15, 250_000, None, "2026-03-01 00:00:00");
        apply_due(&conn, as_of(2026, 3, 20));

        delete_template(&conn, id).unwrap();

        assert_eq!(income_entry_count(&conn), 1);
    }

    #[test]
    fn insert_template_rejects_non_positive_amount() {
        let conn = setup_test_db();
        let input = CreateRecurringIncomeTemplateInput {
            source_id: 1,
            amount_cents: 0,
            day_of_month: 15,
            account_id: None,
        };

        let err = insert_template(&conn, &input).unwrap_err();

        assert!(matches!(
            err,
            AppError::Validation { ref field, .. } if field.as_deref() == Some("amount_cents")
        ));
    }

    #[test]
    fn insert_template_rejects_day_outside_range() {
        let conn = setup_test_db();
        let input = CreateRecurringIncomeTemplateInput {
            source_id: 1,
            amount_cents: 100,
            day_of_month: 32,
            account_id: None,
        };

        let err = insert_template(&conn, &input).unwrap_err();

        assert!(matches!(
            err,
            AppError::Validation { ref field, .. } if field.as_deref() == Some("day_of_month")
        ));
    }

    #[test]
    fn insert_template_rejects_unknown_account() {
        let conn = setup_test_db();
        let input = CreateRecurringIncomeTemplateInput {
            source_id: 1,
            amount_cents: 100,
            day_of_month: 15,
            account_id: Some(99),
        };

        let err = insert_template(&conn, &input).unwrap_err();

        assert!(matches!(
            err,
            AppError::Validation { ref field, .. } if field.as_deref() == Some("account_id")
        ));
    }

    #[test]
    fn insert_template_rejects_unknown_source() {
        let conn = setup_test_db();
        let input = CreateRecurringIncomeTemplateInput {
            source_id: 99,
            amount_cents: 100,
            day_of_month: 15,
            account_id: None,
        };

        let err = insert_template(&conn, &input).unwrap_err();

        assert!(matches!(
            err,
            AppError::Validation { ref field, .. } if field.as_deref() == Some("source_id")
        ));
    }

    #[test]
    fn deleting_income_source_cascades_to_its_templates() {
        let conn = setup_test_db();
        seed_template(&conn, 15, 250_000, None, "2026-01-01 00:00:00");
        assert_eq!(template_count(&conn), 1);

        conn.execute("DELETE FROM income_sources WHERE id = 1", [])
            .unwrap();

        // Counted directly: `get_all_templates` inner-joins the source, so it would hide an
        // orphaned row instead of proving the cascade ran.
        assert_eq!(template_count(&conn), 0);
    }

    #[test]
    fn update_template_toggles_active_and_returns_joined_source() {
        let conn = setup_test_db();
        let id = seed_template(&conn, 15, 250_000, None, "2026-01-01 00:00:00");
        let input = UpdateRecurringIncomeTemplateInput {
            source_id: 1,
            amount_cents: 300_000,
            day_of_month: 20,
            account_id: Some(1),
            is_active: false,
        };

        let updated = update_template(&conn, id, &input).unwrap();

        assert_eq!(updated.amount_cents, 300_000);
        assert_eq!(updated.day_of_month, 20);
        assert_eq!(updated.account_id, Some(1));
        assert!(!updated.is_active);
        assert_eq!(updated.source_name, "Salary");
        assert_eq!(updated.income_type, "employment");
    }

    #[test]
    fn delete_template_on_missing_id_errors() {
        let conn = setup_test_db();

        assert!(delete_template(&conn, 404).is_err());
    }
}
