use rusqlite::{params, Connection};

use crate::error::AppError;
use crate::models::{Account, CreateAccountInput, UpdateAccountInput};

const VALID_ACCOUNT_TYPES: &[&str] = &[
    "chequing",
    "savings",
    "credit_card",
    "tfsa",
    "rrsp",
    "fhsa",
    "non_registered",
    "crypto",
];

const VALID_CURRENCIES: &[&str] = &["CAD", "USD"];

pub fn insert_account(conn: &Connection, input: &CreateAccountInput) -> Result<Account, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation {
            message: "Account name is required".to_string(),
            field: Some("name".to_string()),
        });
    }

    let institution = input.institution.trim();
    if institution.is_empty() {
        return Err(AppError::Validation {
            message: "Institution is required".to_string(),
            field: Some("institution".to_string()),
        });
    }

    if !VALID_ACCOUNT_TYPES.contains(&input.account_type.as_str()) {
        return Err(AppError::Validation {
            message: format!("Invalid account type: {}", input.account_type),
            field: Some("account_type".to_string()),
        });
    }

    if !VALID_CURRENCIES.contains(&input.currency.as_str()) {
        return Err(AppError::Validation {
            message: format!("Invalid currency: {}", input.currency),
            field: Some("currency".to_string()),
        });
    }

    conn.execute(
        "INSERT INTO accounts (name, institution, account_type, currency) VALUES (?1, ?2, ?3, ?4)",
        params![name, institution, input.account_type, input.currency],
    )?;

    let id = conn.last_insert_rowid();

    conn.query_row(
        "SELECT id, name, institution, account_type, currency, balance_cents, created_at, updated_at FROM accounts WHERE id = ?1",
        params![id],
        |row| {
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                institution: row.get(2)?,
                account_type: row.get(3)?,
                currency: row.get(4)?,
                balance_cents: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )
    .map_err(AppError::from)
}

pub fn get_all_accounts(conn: &Connection) -> Result<Vec<Account>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, institution, account_type, currency, balance_cents, created_at, updated_at
         FROM accounts
         ORDER BY name",
    )?;

    let accounts = stmt
        .query_map([], |row| {
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                institution: row.get(2)?,
                account_type: row.get(3)?,
                currency: row.get(4)?,
                balance_cents: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(accounts)
}

/// Returns (old_balance_cents, updated Account)
pub fn update_account_balance(
    conn: &Connection,
    id: i64,
    balance_cents: i64,
) -> Result<(i64, Account), AppError> {
    let old_balance: i64 = conn
        .query_row(
            "SELECT balance_cents FROM accounts WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|_| AppError::Database {
            message: "Account not found".to_string(),
        })?;

    conn.execute(
        "UPDATE accounts SET balance_cents = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![balance_cents, id],
    )?;

    let account = get_account_by_id(conn, id)?;
    Ok((old_balance, account))
}

pub fn update_account(
    conn: &Connection,
    id: i64,
    input: &UpdateAccountInput,
) -> Result<Account, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation {
            message: "Account name is required".to_string(),
            field: Some("name".to_string()),
        });
    }

    let institution = input.institution.trim();
    if institution.is_empty() {
        return Err(AppError::Validation {
            message: "Institution is required".to_string(),
            field: Some("institution".to_string()),
        });
    }

    if !VALID_ACCOUNT_TYPES.contains(&input.account_type.as_str()) {
        return Err(AppError::Validation {
            message: format!("Invalid account type: {}", input.account_type),
            field: Some("account_type".to_string()),
        });
    }

    if !VALID_CURRENCIES.contains(&input.currency.as_str()) {
        return Err(AppError::Validation {
            message: format!("Invalid currency: {}", input.currency),
            field: Some("currency".to_string()),
        });
    }

    let rows = conn.execute(
        "UPDATE accounts SET name = ?1, institution = ?2, account_type = ?3, currency = ?4, updated_at = datetime('now') WHERE id = ?5",
        params![name, institution, input.account_type, input.currency, id],
    )?;

    if rows == 0 {
        return Err(AppError::Database {
            message: "Account not found".to_string(),
        });
    }

    get_account_by_id(conn, id)
}

pub fn delete_account(conn: &Connection, id: i64) -> Result<(), AppError> {
    let rows = conn.execute("DELETE FROM accounts WHERE id = ?1", params![id])?;
    if rows == 0 {
        return Err(AppError::Database {
            message: "Account not found".to_string(),
        });
    }
    Ok(())
}

pub fn get_account_by_id(conn: &Connection, id: i64) -> Result<Account, AppError> {
    conn.query_row(
        "SELECT id, name, institution, account_type, currency, balance_cents, created_at, updated_at FROM accounts WHERE id = ?1",
        params![id],
        |row| {
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                institution: row.get(2)?,
                account_type: row.get(3)?,
                currency: row.get(4)?,
                balance_cents: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        },
    )
    .map_err(AppError::from)
}
