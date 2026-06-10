use rusqlite::{params, Connection};

use crate::db::account::{self as account_db, BalanceChange, CashFlowKind};
use crate::error::AppError;
use crate::models::{
    CreateIncomeEntryInput, CreateIncomeSourceInput, IncomeEntry, IncomeSource,
    IncomeSourceWithLastEntry, IncomeTotal, UpdateIncomeEntryInput, UpdateIncomeSourceInput,
};

const VALID_INCOME_TYPES: &[&str] = &["employment", "freelance", "investment", "other"];

#[derive(Debug, Clone)]
pub struct LinkedIncomeEntryMutation {
    pub entry: IncomeEntry,
    pub balance_changes: Vec<BalanceChange>,
}

pub fn insert_income_source(
    conn: &Connection,
    input: &CreateIncomeSourceInput,
) -> Result<IncomeSource, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation {
            message: "Income source name is required".to_string(),
            field: Some("name".to_string()),
        });
    }

    if !VALID_INCOME_TYPES.contains(&input.income_type.as_str()) {
        return Err(AppError::Validation {
            message: format!("Invalid income type: {}", input.income_type),
            field: Some("income_type".to_string()),
        });
    }

    conn.execute(
        "INSERT INTO income_sources (name, income_type) VALUES (?1, ?2)",
        params![name, input.income_type],
    )?;

    let id = conn.last_insert_rowid();
    get_income_source_by_id(conn, id)
}

pub fn get_all_income_sources(
    conn: &Connection,
) -> Result<Vec<IncomeSourceWithLastEntry>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.name, s.income_type, s.created_at, s.updated_at,
                latest.total_cents, latest.month
         FROM income_sources s
         LEFT JOIN (
           SELECT source_id, month, SUM(amount_cents) AS total_cents
           FROM income_entries
           GROUP BY source_id, month
           HAVING month = (SELECT MAX(e2.month) FROM income_entries e2 WHERE e2.source_id = income_entries.source_id)
         ) latest ON latest.source_id = s.id
         ORDER BY s.name",
    )?;

    let sources = stmt
        .query_map([], |row| {
            Ok(IncomeSourceWithLastEntry {
                id: row.get(0)?,
                name: row.get(1)?,
                income_type: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                last_amount_cents: row.get(5)?,
                last_month: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(sources)
}

pub fn update_income_source(
    conn: &Connection,
    id: i64,
    input: &UpdateIncomeSourceInput,
) -> Result<IncomeSource, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation {
            message: "Income source name is required".to_string(),
            field: Some("name".to_string()),
        });
    }

    if !VALID_INCOME_TYPES.contains(&input.income_type.as_str()) {
        return Err(AppError::Validation {
            message: format!("Invalid income type: {}", input.income_type),
            field: Some("income_type".to_string()),
        });
    }

    let rows = conn.execute(
        "UPDATE income_sources SET name = ?1, income_type = ?2, updated_at = datetime('now') WHERE id = ?3",
        params![name, input.income_type, id],
    )?;

    if rows == 0 {
        return Err(AppError::Database {
            message: "Income source not found".to_string(),
        });
    }

    get_income_source_by_id(conn, id)
}

pub fn delete_income_source(conn: &Connection, id: i64) -> Result<(), AppError> {
    let rows = conn.execute("DELETE FROM income_sources WHERE id = ?1", params![id])?;
    if rows == 0 {
        return Err(AppError::Database {
            message: "Income source not found".to_string(),
        });
    }
    Ok(())
}

pub fn insert_income_entry(
    conn: &Connection,
    input: &CreateIncomeEntryInput,
) -> Result<LinkedIncomeEntryMutation, AppError> {
    if input.amount_cents <= 0 {
        return Err(AppError::Validation {
            message: "Amount must be greater than $0".to_string(),
            field: Some("amount_cents".to_string()),
        });
    }

    if input.date.is_empty() {
        return Err(AppError::Validation {
            message: "Date is required".to_string(),
            field: Some("date".to_string()),
        });
    }

    // Verify source exists
    conn.query_row(
        "SELECT id FROM income_sources WHERE id = ?1",
        params![input.source_id],
        |_| Ok(()),
    )
    .map_err(|_| AppError::Database {
        message: "Income source not found".to_string(),
    })?;

    // Derive month from date (first 7 chars: "2026-03")
    let month = &input.date[..7];

    let tx = conn.unchecked_transaction()?;
    validate_account_id(&tx, input.account_id)?;
    tx.execute(
        "INSERT INTO income_entries (source_id, amount_cents, date, month, account_id)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![input.source_id, input.amount_cents, input.date, month, input.account_id],
    )?;

    let id = tx.last_insert_rowid();
    let mut balance_changes = Vec::new();
    if let Some(account_id) = input.account_id {
        balance_changes.push(account_db::adjust_account_balance(
            &tx,
            account_id,
            CashFlowKind::Income,
            input.amount_cents,
        )?);
    }

    let entry = get_income_entry_by_id(&tx, id)?;
    tx.commit()?;

    Ok(LinkedIncomeEntryMutation {
        entry,
        balance_changes,
    })
}

pub fn update_income_entry(
    conn: &Connection,
    id: i64,
    input: &UpdateIncomeEntryInput,
) -> Result<LinkedIncomeEntryMutation, AppError> {
    if input.amount_cents <= 0 {
        return Err(AppError::Validation {
            message: "Amount must be greater than $0".to_string(),
            field: Some("amount_cents".to_string()),
        });
    }

    if input.date.is_empty() {
        return Err(AppError::Validation {
            message: "Date is required".to_string(),
            field: Some("date".to_string()),
        });
    }

    let month = &input.date[..7];
    let tx = conn.unchecked_transaction()?;
    let old_entry = get_income_entry_by_id(&tx, id)?;
    validate_account_id(&tx, input.account_id)?;
    let mut balance_changes = Vec::new();

    if let Some(account_id) = old_entry.account_id {
        balance_changes.push(account_db::reverse_adjustment(
            &tx,
            account_id,
            CashFlowKind::Income,
            old_entry.amount_cents,
        )?);
    }

    let rows = tx.execute(
        "UPDATE income_entries
         SET source_id = ?1, amount_cents = ?2, date = ?3, month = ?4, account_id = ?5, updated_at = datetime('now')
         WHERE id = ?6",
        params![input.source_id, input.amount_cents, input.date, month, input.account_id, id],
    )?;

    if rows == 0 {
        return Err(AppError::Database {
            message: "Income entry not found".to_string(),
        });
    }

    if let Some(account_id) = input.account_id {
        balance_changes.push(account_db::adjust_account_balance(
            &tx,
            account_id,
            CashFlowKind::Income,
            input.amount_cents,
        )?);
    }

    let entry = get_income_entry_by_id(&tx, id)?;
    tx.commit()?;

    Ok(LinkedIncomeEntryMutation {
        entry,
        balance_changes,
    })
}

pub fn delete_income_entry(conn: &Connection, id: i64) -> Result<Vec<BalanceChange>, AppError> {
    let tx = conn.unchecked_transaction()?;
    let entry = get_income_entry_by_id(&tx, id)?;
    let mut balance_changes = Vec::new();

    if let Some(account_id) = entry.account_id {
        balance_changes.push(account_db::reverse_adjustment(
            &tx,
            account_id,
            CashFlowKind::Income,
            entry.amount_cents,
        )?);
    }

    let rows = tx.execute("DELETE FROM income_entries WHERE id = ?1", params![id])?;
    if rows == 0 {
        return Err(AppError::Database {
            message: "Income entry not found".to_string(),
        });
    }
    tx.commit()?;
    Ok(balance_changes)
}

pub fn get_income_entries(
    conn: &Connection,
    source_id: Option<i64>,
) -> Result<Vec<IncomeEntry>, AppError> {
    let row_mapper = |row: &rusqlite::Row| -> rusqlite::Result<IncomeEntry> {
        row_to_income_entry(row)
    };

    let entries = if let Some(sid) = source_id {
        let mut stmt = conn.prepare(
            "SELECT e.id, e.source_id, s.name, s.income_type, e.amount_cents, e.date, e.month, e.account_id, e.created_at, e.updated_at
             FROM income_entries e
             JOIN income_sources s ON s.id = e.source_id
             WHERE e.source_id = ?1
             ORDER BY e.date DESC, e.id DESC",
        )?;
        let result = stmt.query_map(params![sid], row_mapper)?
            .collect::<Result<Vec<_>, _>>()?;
        result
    } else {
        let mut stmt = conn.prepare(
            "SELECT e.id, e.source_id, s.name, s.income_type, e.amount_cents, e.date, e.month, e.account_id, e.created_at, e.updated_at
             FROM income_entries e
             JOIN income_sources s ON s.id = e.source_id
             ORDER BY e.date DESC, e.id DESC",
        )?;
        let result = stmt.query_map([], row_mapper)?
            .collect::<Result<Vec<_>, _>>()?;
        result
    };

    Ok(entries)
}

pub fn get_income_entries_by_month(
    conn: &Connection,
    year: i32,
    month: u32,
) -> Result<Vec<IncomeEntry>, AppError> {
    let start_date = format!("{:04}-{:02}-01", year, month);
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let end_date = format!("{:04}-{:02}-01", next_year, next_month);

    let mut stmt = conn.prepare(
        "SELECT e.id, e.source_id, s.name, s.income_type, e.amount_cents, e.date, e.month, e.account_id, e.created_at, e.updated_at
         FROM income_entries e
         JOIN income_sources s ON s.id = e.source_id
         WHERE e.date >= ?1 AND e.date < ?2
         ORDER BY e.date DESC, e.id DESC",
    )?;

    let entries = stmt
        .query_map(params![start_date, end_date], |row| {
            row_to_income_entry(row)
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(entries)
}

pub fn get_income_total(conn: &Connection, year: i32, month: u32) -> Result<IncomeTotal, AppError> {
    let start_date = format!("{:04}-{:02}-01", year, month);
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let end_date = format!("{:04}-{:02}-01", next_year, next_month);

    let total: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(amount_cents), 0) FROM income_entries WHERE date >= ?1 AND date < ?2",
            params![start_date, end_date],
            |row| row.get(0),
        )?;

    Ok(IncomeTotal {
        total_cents: total,
        month: format!("{:04}-{:02}", year, month),
    })
}

fn get_income_source_by_id(conn: &Connection, id: i64) -> Result<IncomeSource, AppError> {
    conn.query_row(
        "SELECT id, name, income_type, created_at, updated_at FROM income_sources WHERE id = ?1",
        params![id],
        |row| {
            Ok(IncomeSource {
                id: row.get(0)?,
                name: row.get(1)?,
                income_type: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        },
    )
    .map_err(AppError::from)
}

pub fn get_income_entry_by_id(conn: &Connection, id: i64) -> Result<IncomeEntry, AppError> {
    conn.query_row(
        "SELECT e.id, e.source_id, s.name, s.income_type, e.amount_cents, e.date, e.month, e.account_id, e.created_at, e.updated_at
         FROM income_entries e
         JOIN income_sources s ON s.id = e.source_id
         WHERE e.id = ?1",
        params![id],
        row_to_income_entry,
    )
    .map_err(AppError::from)
}

fn row_to_income_entry(row: &rusqlite::Row) -> rusqlite::Result<IncomeEntry> {
    Ok(IncomeEntry {
        id: row.get(0)?,
        source_id: row.get(1)?,
        source_name: row.get(2)?,
        income_type: row.get(3)?,
        amount_cents: row.get(4)?,
        date: row.get(5)?,
        month: row.get(6)?,
        account_id: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn validate_account_id(conn: &Connection, account_id: Option<i64>) -> Result<(), AppError> {
    let Some(account_id) = account_id else {
        return Ok(());
    };

    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1)",
        params![account_id],
        |row| row.get(0),
    )?;

    if !exists {
        return Err(AppError::Validation {
            message: "Account not found".to_string(),
            field: Some("account_id".to_string()),
        });
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn insert_income_entry_with_account_increases_asset_balance() {
        let conn = income_test_db();
        let input = income_input(Some(1), 2_500);

        let result = insert_income_entry(&conn, &input).unwrap();

        assert_eq!(result.entry.account_id, Some(1));
        assert_eq!(result.balance_changes[0].old_balance_cents, 10_000);
        assert_eq!(result.balance_changes[0].new_balance_cents, 12_500);
        assert_eq!(account_balance(&conn, 1), 12_500);
    }

    #[test]
    fn insert_income_entry_payment_reduces_credit_card_owed_balance() {
        let conn = income_test_db();
        let input = income_input(Some(2), 2_500);

        insert_income_entry(&conn, &input).unwrap();

        assert_eq!(account_balance(&conn, 2), 7_500);
    }

    #[test]
    fn update_income_entry_reverses_old_account_before_applying_new_account() {
        let conn = income_test_db();
        let created = insert_income_entry(&conn, &income_input(Some(1), 1_000))
            .unwrap()
            .entry;
        let input = UpdateIncomeEntryInput {
            source_id: 1,
            amount_cents: 2_500,
            date: "2026-06-11".to_string(),
            account_id: Some(3),
        };

        let result = update_income_entry(&conn, created.id, &input).unwrap();

        assert_eq!(result.entry.account_id, Some(3));
        assert_eq!(account_balance(&conn, 1), 10_000);
        assert_eq!(account_balance(&conn, 3), 22_500);
    }

    #[test]
    fn delete_income_entry_reverses_linked_account_balance() {
        let conn = income_test_db();
        let created = insert_income_entry(&conn, &income_input(Some(1), 1_500))
            .unwrap()
            .entry;

        let changes = delete_income_entry(&conn, created.id).unwrap();

        assert_eq!(changes.len(), 1);
        assert_eq!(account_balance(&conn, 1), 10_000);
        assert_eq!(income_entry_count(&conn), 0);
    }

    fn income_input(account_id: Option<i64>, amount_cents: i64) -> CreateIncomeEntryInput {
        CreateIncomeEntryInput {
            source_id: 1,
            amount_cents,
            date: "2026-06-10".to_string(),
            account_id,
        }
    }

    fn income_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys=ON;
            CREATE TABLE accounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                institution TEXT NOT NULL,
                account_type TEXT NOT NULL,
                currency TEXT NOT NULL DEFAULT 'CAD',
                balance_cents INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE income_sources (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                income_type TEXT NOT NULL CHECK(income_type IN ('employment', 'freelance', 'investment', 'other')),
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE income_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_id INTEGER NOT NULL REFERENCES income_sources(id) ON DELETE CASCADE,
                amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
                date TEXT NOT NULL,
                month TEXT NOT NULL,
                account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT INTO accounts (id, name, institution, account_type, currency, balance_cents)
            VALUES (1, 'Chequing', 'Bank', 'chequing', 'CAD', 10000),
                   (2, 'Credit Card', 'Bank', 'credit_card', 'CAD', 10000),
                   (3, 'Savings', 'Bank', 'savings', 'CAD', 20000);
            INSERT INTO income_sources (id, name, income_type) VALUES (1, 'Salary', 'employment');",
        )
        .unwrap();
        conn
    }

    fn account_balance(conn: &Connection, account_id: i64) -> i64 {
        conn.query_row(
            "SELECT balance_cents FROM accounts WHERE id = ?1",
            params![account_id],
            |row| row.get(0),
        )
        .unwrap()
    }

    fn income_entry_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM income_entries", [], |row| row.get(0))
            .unwrap()
    }
}
