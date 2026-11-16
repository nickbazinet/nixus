use chrono::NaiveDate;
use rusqlite::{params, Connection, OptionalExtension};

use crate::db::account::{self as account_db, BalanceCauseRow, BalanceChange, CashFlowKind};
use crate::db::recurrence::{self, StoredSchedule};
use crate::error::AppError;
use crate::models::{
    AccountTransfer, CreateRecurringTransferTemplateInput, RecurrenceFrequency,
    RecurringTransferTemplate, UpdateRecurringTransferTemplateInput,
};
use crate::sync::capture::{self, BalanceCause};
use crate::sync::identity;

/// Transfers created by a backfill run, with the account movements they caused so the caller can
/// audit them the same way a manual balance change is.
#[derive(Debug, Default)]
pub struct AppliedRecurringTransfers {
    pub transfers: Vec<AccountTransfer>,
    pub balance_changes: Vec<BalanceChange>,
}

const SELECT_TEMPLATE: &str = "SELECT id, from_account_id, to_account_id, amount_cents,
            day_of_month, frequency, start_date, is_active, created_at, updated_at
     FROM recurring_transfer_templates";

/// CAPTURE-SANCTIONED (AD-3): reached only through `ActiveDataset::write`.
pub fn insert_template(
    conn: &Connection,
    input: &CreateRecurringTransferTemplateInput,
) -> Result<RecurringTransferTemplate, AppError> {
    validate_amount(input.amount_cents)?;
    let schedule = recurrence::normalize(
        input.frequency,
        input.day_of_month,
        input.start_date.as_deref(),
        None,
        chrono::Local::now().date_naive(),
    )?;
    validate_accounts(conn, input.from_account_id, input.to_account_id)?;

    conn.execute(
        "INSERT INTO recurring_transfer_templates
            (from_account_id, to_account_id, amount_cents, day_of_month, frequency, start_date)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            input.from_account_id,
            input.to_account_id,
            input.amount_cents,
            schedule.day_of_month,
            schedule.frequency,
            schedule.start_date
        ],
    )?;

    let id = conn.last_insert_rowid();
    get_template_by_id(conn, id).map_err(AppError::from)
}

pub fn get_all_templates(conn: &Connection) -> Result<Vec<RecurringTransferTemplate>, AppError> {
    let mut stmt = conn.prepare(&format!("{SELECT_TEMPLATE} ORDER BY id ASC"))?;

    let templates = stmt
        .query_map([], row_to_template)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(templates)
}

/// CAPTURE-SANCTIONED (AD-3): reached only through `ActiveDataset::write`.
pub fn update_template(
    conn: &Connection,
    id: i64,
    input: &UpdateRecurringTransferTemplateInput,
) -> Result<RecurringTransferTemplate, AppError> {
    validate_amount(input.amount_cents)?;
    let previous = get_template_by_id(conn, id)
        .optional()?
        .ok_or_else(|| AppError::Database {
            message: "Recurring transfer template not found".to_string(),
        })?;
    let schedule = recurrence::normalize(
        input.frequency,
        input.day_of_month,
        input.start_date.as_deref(),
        Some(&schedule_of(&previous)),
        chrono::Local::now().date_naive(),
    )?;
    validate_accounts(conn, input.from_account_id, input.to_account_id)?;

    let is_active_int: i64 = if input.is_active { 1 } else { 0 };

    conn.execute(
        "UPDATE recurring_transfer_templates
         SET from_account_id = ?1, to_account_id = ?2, amount_cents = ?3, day_of_month = ?4,
             frequency = ?5, start_date = ?6, is_active = ?7, updated_at = datetime('now')
         WHERE id = ?8",
        params![
            input.from_account_id,
            input.to_account_id,
            input.amount_cents,
            schedule.day_of_month,
            schedule.frequency,
            schedule.start_date,
            is_active_int,
            id
        ],
    )?;

    get_template_by_id(conn, id).map_err(AppError::from)
}

/// CAPTURE-SANCTIONED (AD-3): reached only through `ActiveDataset::write`.
pub fn delete_template(conn: &Connection, id: i64) -> Result<(), AppError> {
    let rows = conn.execute(
        "DELETE FROM recurring_transfer_templates WHERE id = ?1",
        params![id],
    )?;
    if rows == 0 {
        return Err(AppError::Database {
            message: "Recurring transfer template not found".to_string(),
        });
    }
    Ok(())
}

/// Applies every active recurring transfer whose scheduled date is on or before today.
pub fn apply_due_recurring_transfers(
    conn: &Connection,
) -> Result<AppliedRecurringTransfers, AppError> {
    let today = chrono::Local::now().date_naive();
    apply_due_recurring_transfers_as_of(conn, today)
}

fn apply_due_recurring_transfers_as_of(
    conn: &Connection,
    today: NaiveDate,
) -> Result<AppliedRecurringTransfers, AppError> {
    let templates = get_active_templates(conn)?;
    let mut applied = AppliedRecurringTransfers::default();

    for template in templates {
        // One unusable template must not stop the others: transfers already written in this run
        // are committed, and abandoning the loop would leave them unaudited.
        if let Err(e) = apply_template_as_of(conn, &template, today, &mut applied) {
            tracing::error!(
                "Skipping recurring transfer template {}: {:?}",
                template.id,
                e
            );
        }
    }

    Ok(applied)
}

fn apply_template_as_of(
    conn: &Connection,
    template: &RecurringTransferTemplate,
    today: NaiveDate,
    applied: &mut AppliedRecurringTransfers,
) -> Result<(), AppError> {
    // Re-checked at apply time: an account's currency can be edited after the template was saved,
    // and Nixus never converts between currencies.
    validate_accounts(conn, template.from_account_id, template.to_account_id)?;
    let dates = recurrence::due_occurrences(&schedule_of(template), &template.created_at, today)?;

    for occurrence_date in dates {
        let date = occurrence_date.format("%Y-%m-%d").to_string();
        if occurrence_already_applied(conn, template, &date)? {
            continue;
        }

        let (transfer, balance_changes) = insert_transfer(conn, template, &date)?;
        let period = recurrence::period_of(template.frequency, occurrence_date);
        bind_generated_transfer_identity(conn, template.id, transfer.id, &period)?;

        applied.transfers.push(transfer);
        applied.balance_changes.extend(balance_changes);
    }

    Ok(())
}

/// CAPTURE-SANCTIONED (AD-3): reached only through `ActiveDataset::write`.
/// The transfer row and both balance movements commit together: money leaving one account without
/// arriving in the other is the one outcome a transfer must never have.
fn insert_transfer(
    conn: &Connection,
    template: &RecurringTransferTemplate,
    date: &str,
) -> Result<(AccountTransfer, Vec<BalanceChange>), AppError> {
    let tx = super::grouped(conn)?;
    tx.execute(
        "INSERT INTO account_transfers
            (recurring_transfer_template_id, from_account_id, to_account_id, amount_cents, date)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            template.id,
            template.from_account_id,
            template.to_account_id,
            template.amount_cents,
            date
        ],
    )?;
    let id = tx.last_insert_rowid();
    let cause = BalanceCauseRow::new("account_transfers", id, BalanceCause::Created);

    let balance_changes = vec![
        account_db::adjust_account_balance(
            &tx,
            template.from_account_id,
            CashFlowKind::Expense,
            template.amount_cents,
            cause,
        )?,
        account_db::adjust_account_balance(
            &tx,
            template.to_account_id,
            CashFlowKind::Income,
            template.amount_cents,
            cause,
        )?,
    ];

    let transfer = get_transfer_by_id(&tx, id)?;
    tx.commit()?;

    Ok((transfer, balance_changes))
}

/// AD-2's template rule for transfers: `(template uuid, period)`, derived and not minted, so two
/// computers that both backfill the same occurrence converge on ONE transfer — and its two balance
/// deltas, keyed by that row, are added once.
///
/// Skipped entirely when nothing is capturing (inherited AD-12).
fn bind_generated_transfer_identity(
    conn: &Connection,
    template_id: i64,
    transfer_id: i64,
    period: &str,
) -> Result<(), AppError> {
    if !capture::is_capturing() {
        return Ok(());
    }

    let template = identity::existing_uuid_for(conn, "recurring_transfer_templates", template_id)?;
    let derived = identity::recurring_transfer(&template, period);

    let mapping = identity::ensure_derived(conn, "account_transfers", transfer_id, &derived)?;
    if mapping.row_id != transfer_id {
        tracing::warn!(
            "Recurring transfer identity for period {period} already belongs to another local row"
        );
    }

    Ok(())
}

/// The template stamp is what survives an edit to the amount, day or accounts: a monthly template
/// claims its whole month, a week-based one only its own date.
fn occurrence_already_applied(
    conn: &Connection,
    template: &RecurringTransferTemplate,
    date: &str,
) -> Result<bool, AppError> {
    let claim = match template.frequency {
        RecurrenceFrequency::Monthly => "substr(date, 1, 7) = substr(?2, 1, 7)",
        _ => "date = ?2",
    };
    let count: i64 = conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM account_transfers
             WHERE recurring_transfer_template_id = ?1 AND {claim}"
        ),
        params![template.id, date],
        |row| row.get(0),
    )?;

    Ok(count > 0)
}

fn schedule_of(template: &RecurringTransferTemplate) -> StoredSchedule {
    StoredSchedule {
        frequency: template.frequency,
        day_of_month: template.day_of_month,
        start_date: template.start_date.clone(),
    }
}

fn get_active_templates(conn: &Connection) -> Result<Vec<RecurringTransferTemplate>, AppError> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT_TEMPLATE} WHERE is_active = 1 ORDER BY id ASC"
    ))?;

    let templates = stmt
        .query_map([], row_to_template)?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(templates)
}

pub fn get_template_by_id(
    conn: &Connection,
    id: i64,
) -> rusqlite::Result<RecurringTransferTemplate> {
    conn.query_row(
        &format!("{SELECT_TEMPLATE} WHERE id = ?1"),
        params![id],
        row_to_template,
    )
}

fn row_to_template(row: &rusqlite::Row) -> rusqlite::Result<RecurringTransferTemplate> {
    Ok(RecurringTransferTemplate {
        id: row.get(0)?,
        from_account_id: row.get(1)?,
        to_account_id: row.get(2)?,
        amount_cents: row.get(3)?,
        day_of_month: row.get(4)?,
        frequency: row.get(5)?,
        start_date: row.get(6)?,
        is_active: row.get::<_, i64>(7)? != 0,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn get_transfer_by_id(conn: &Connection, id: i64) -> rusqlite::Result<AccountTransfer> {
    conn.query_row(
        "SELECT id, recurring_transfer_template_id, from_account_id, to_account_id, amount_cents,
                date, created_at
         FROM account_transfers WHERE id = ?1",
        params![id],
        |row| {
            Ok(AccountTransfer {
                id: row.get(0)?,
                recurring_transfer_template_id: row.get(1)?,
                from_account_id: row.get(2)?,
                to_account_id: row.get(3)?,
                amount_cents: row.get(4)?,
                date: row.get(5)?,
                created_at: row.get(6)?,
            })
        },
    )
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

fn validate_accounts(
    conn: &Connection,
    from_account_id: i64,
    to_account_id: i64,
) -> Result<(), AppError> {
    if from_account_id == to_account_id {
        return Err(AppError::Validation {
            message: "Pick two different accounts".to_string(),
            field: Some("to_account_id".to_string()),
        });
    }

    let from =
        account_db::get_account_by_id(conn, from_account_id).map_err(|_| AppError::Validation {
            message: "Account not found".to_string(),
            field: Some("from_account_id".to_string()),
        })?;
    let to =
        account_db::get_account_by_id(conn, to_account_id).map_err(|_| AppError::Validation {
            message: "Account not found".to_string(),
            field: Some("to_account_id".to_string()),
        })?;

    if from.currency != to.currency {
        return Err(AppError::Validation {
            message: "Both accounts must use the same currency".to_string(),
            field: Some("to_account_id".to_string()),
        });
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::run_migrations;

    const CHEQUING: i64 = 1;
    const SAVINGS: i64 = 2;
    const VISA: i64 = 3;
    const USD: i64 = 4;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        run_migrations(&conn).unwrap();
        conn.execute_batch(
            "INSERT INTO accounts (id, name, institution, account_type, currency, balance_cents)
             VALUES (1, 'Chequing', 'Bank', 'chequing', 'CAD', 100000),
                    (2, 'Savings', 'Bank', 'savings', 'CAD', 50000),
                    (3, 'Visa', 'Bank', 'credit_card', 'CAD', 30000),
                    (4, 'US Chequing', 'Bank', 'chequing', 'USD', 10000);",
        )
        .unwrap();
        conn
    }

    fn seed_monthly(
        conn: &Connection,
        from: i64,
        to: i64,
        amount: i64,
        day: i32,
        created_at: &str,
    ) -> i64 {
        conn.execute(
            "INSERT INTO recurring_transfer_templates
             (from_account_id, to_account_id, amount_cents, day_of_month, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![from, to, amount, day, created_at],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn seed_weekly(conn: &Connection, amount: i64, start_date: &str) -> i64 {
        conn.execute(
            "INSERT INTO recurring_transfer_templates
             (from_account_id, to_account_id, amount_cents, day_of_month, frequency, start_date,
              created_at, updated_at)
             VALUES (1, 2, ?1, 1, 'weekly', ?2, ?2, ?2)",
            params![amount, start_date],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn balance(conn: &Connection, account_id: i64) -> i64 {
        conn.query_row(
            "SELECT balance_cents FROM accounts WHERE id = ?1",
            params![account_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn transfer_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM account_transfers", [], |row| {
            row.get(0)
        })
        .unwrap()
    }

    fn as_of(year: i32, month: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(year, month, day).unwrap()
    }

    fn apply_due(conn: &Connection, today: NaiveDate) -> AppliedRecurringTransfers {
        apply_due_recurring_transfers_as_of(conn, today).unwrap()
    }

    fn create_input(from: i64, to: i64) -> CreateRecurringTransferTemplateInput {
        CreateRecurringTransferTemplateInput {
            from_account_id: from,
            to_account_id: to,
            amount_cents: 20_000,
            day_of_month: 1,
            frequency: Default::default(),
            start_date: None,
        }
    }

    fn validation_field(err: AppError) -> Option<String> {
        match err {
            AppError::Validation { field, .. } => field,
            other => panic!("expected a validation error, got {other:?}"),
        }
    }

    #[test]
    fn a_weekly_transfer_moves_money_out_of_one_account_and_into_the_other() {
        let conn = setup_test_db();
        seed_weekly(&conn, 20_000, "2026-10-01");

        let applied = apply_due(&conn, as_of(2026, 10, 20));

        let dates: Vec<&str> = applied.transfers.iter().map(|t| t.date.as_str()).collect();
        assert_eq!(dates, vec!["2026-10-01", "2026-10-08", "2026-10-15"]);
        assert_eq!(balance(&conn, CHEQUING), 100_000 - 3 * 20_000);
        assert_eq!(balance(&conn, SAVINGS), 50_000 + 3 * 20_000);
        assert_eq!(applied.balance_changes.len(), 6);
    }

    #[test]
    fn applying_twice_moves_money_once() {
        let conn = setup_test_db();
        seed_weekly(&conn, 20_000, "2026-10-01");

        apply_due(&conn, as_of(2026, 10, 20));
        let second = apply_due(&conn, as_of(2026, 10, 20));

        assert!(second.transfers.is_empty());
        assert!(second.balance_changes.is_empty());
        assert_eq!(transfer_count(&conn), 3);
        assert_eq!(balance(&conn, CHEQUING), 40_000);
    }

    #[test]
    fn a_monthly_transfer_backfills_every_past_month_from_its_creation() {
        let conn = setup_test_db();
        seed_monthly(&conn, CHEQUING, SAVINGS, 10_000, 15, "2026-01-01 00:00:00");

        let applied = apply_due(&conn, as_of(2026, 3, 20));

        let dates: Vec<&str> = applied.transfers.iter().map(|t| t.date.as_str()).collect();
        assert_eq!(dates, vec!["2026-01-15", "2026-02-15", "2026-03-15"]);
        assert_eq!(balance(&conn, SAVINGS), 80_000);
    }

    #[test]
    fn a_future_occurrence_is_not_applied_yet() {
        let conn = setup_test_db();
        seed_monthly(&conn, CHEQUING, SAVINGS, 10_000, 25, "2026-03-01 00:00:00");

        assert!(apply_due(&conn, as_of(2026, 3, 20)).transfers.is_empty());
        assert_eq!(balance(&conn, CHEQUING), 100_000);
    }

    #[test]
    fn paying_a_credit_card_lowers_both_the_chequing_balance_and_the_amount_owed() {
        let conn = setup_test_db();
        seed_monthly(&conn, CHEQUING, VISA, 10_000, 1, "2026-03-01 00:00:00");

        apply_due(&conn, as_of(2026, 3, 5));

        assert_eq!(balance(&conn, CHEQUING), 90_000);
        assert_eq!(balance(&conn, VISA), 20_000);
    }

    #[test]
    fn an_inactive_template_moves_nothing() {
        let conn = setup_test_db();
        let id = seed_monthly(&conn, CHEQUING, SAVINGS, 10_000, 1, "2026-01-01 00:00:00");
        conn.execute(
            "UPDATE recurring_transfer_templates SET is_active = 0 WHERE id = ?1",
            params![id],
        )
        .unwrap();

        assert!(apply_due(&conn, as_of(2026, 3, 20)).transfers.is_empty());
    }

    #[test]
    fn editing_the_amount_does_not_reapply_months_already_transferred() {
        let conn = setup_test_db();
        let id = seed_monthly(&conn, CHEQUING, SAVINGS, 10_000, 15, "2026-01-01 00:00:00");
        apply_due(&conn, as_of(2026, 3, 20));

        update_template(
            &conn,
            id,
            &UpdateRecurringTransferTemplateInput {
                from_account_id: CHEQUING,
                to_account_id: SAVINGS,
                amount_cents: 25_000,
                day_of_month: 15,
                frequency: Default::default(),
                start_date: None,
                is_active: true,
            },
        )
        .unwrap();

        assert!(apply_due(&conn, as_of(2026, 3, 20)).transfers.is_empty());
        assert_eq!(balance(&conn, CHEQUING), 70_000);
    }

    #[test]
    fn a_template_whose_accounts_no_longer_share_a_currency_is_skipped_without_stopping_others() {
        let conn = setup_test_db();
        seed_monthly(&conn, CHEQUING, SAVINGS, 10_000, 1, "2026-03-01 00:00:00");
        seed_monthly(&conn, SAVINGS, CHEQUING, 5_000, 1, "2026-03-01 00:00:00");
        conn.execute("UPDATE accounts SET currency = 'USD' WHERE id = 2", [])
            .unwrap();

        let applied = apply_due(&conn, as_of(2026, 3, 5));

        assert!(applied.transfers.is_empty());
        assert_eq!(balance(&conn, CHEQUING), 100_000);

        conn.execute("UPDATE accounts SET currency = 'CAD' WHERE id = 2", [])
            .unwrap();
        assert_eq!(apply_due(&conn, as_of(2026, 3, 5)).transfers.len(), 2);
    }

    #[test]
    fn deleting_a_template_keeps_the_transfers_it_made() {
        let conn = setup_test_db();
        let id = seed_monthly(&conn, CHEQUING, SAVINGS, 10_000, 1, "2026-03-01 00:00:00");
        apply_due(&conn, as_of(2026, 3, 5));

        delete_template(&conn, id).unwrap();

        assert_eq!(transfer_count(&conn), 1);
    }

    #[test]
    fn deleting_an_account_removes_its_templates_but_keeps_past_transfers() {
        let conn = setup_test_db();
        seed_monthly(&conn, CHEQUING, SAVINGS, 10_000, 1, "2026-03-01 00:00:00");
        apply_due(&conn, as_of(2026, 3, 5));

        account_db::delete_account(&conn, SAVINGS).unwrap();

        assert!(get_all_templates(&conn).unwrap().is_empty());
        assert_eq!(transfer_count(&conn), 1);
    }

    #[test]
    fn insert_template_round_trips_its_fields() {
        let conn = setup_test_db();

        let created = insert_template(&conn, &create_input(CHEQUING, SAVINGS)).unwrap();

        assert_eq!(created.from_account_id, CHEQUING);
        assert_eq!(created.to_account_id, SAVINGS);
        assert_eq!(created.amount_cents, 20_000);
        assert!(created.is_active);
        assert_eq!(get_all_templates(&conn).unwrap().len(), 1);
    }

    #[test]
    fn insert_template_rejects_the_same_account_on_both_ends() {
        let conn = setup_test_db();

        let err = insert_template(&conn, &create_input(CHEQUING, CHEQUING)).unwrap_err();

        assert_eq!(validation_field(err).as_deref(), Some("to_account_id"));
    }

    #[test]
    fn insert_template_rejects_accounts_in_different_currencies() {
        let conn = setup_test_db();

        let err = insert_template(&conn, &create_input(CHEQUING, USD)).unwrap_err();

        assert_eq!(validation_field(err).as_deref(), Some("to_account_id"));
    }

    #[test]
    fn insert_template_rejects_an_unknown_account() {
        let conn = setup_test_db();

        let err = insert_template(&conn, &create_input(99, SAVINGS)).unwrap_err();

        assert_eq!(validation_field(err).as_deref(), Some("from_account_id"));
    }

    #[test]
    fn insert_template_rejects_a_non_positive_amount() {
        let conn = setup_test_db();
        let input = CreateRecurringTransferTemplateInput {
            amount_cents: 0,
            ..create_input(CHEQUING, SAVINGS)
        };

        let err = insert_template(&conn, &input).unwrap_err();

        assert_eq!(validation_field(err).as_deref(), Some("amount_cents"));
    }

    #[test]
    fn delete_template_on_a_missing_id_errors() {
        let conn = setup_test_db();

        assert!(delete_template(&conn, 404).is_err());
    }
}
