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

/// Account types treated as liabilities (owed balances reduce net worth).
pub const LIABILITY_ACCOUNT_TYPES: &[&str] = &["credit_card"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CashFlowKind {
    Expense,
    Income,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BalanceChange {
    pub account_id: i64,
    pub old_balance_cents: i64,
    pub new_balance_cents: i64,
}

pub fn is_liability_account_type(account_type: &str) -> bool {
    LIABILITY_ACCOUNT_TYPES.contains(&account_type)
}

pub fn balance_delta_cents(
    account_type: &str,
    current_balance_cents: i64,
    kind: CashFlowKind,
    amount_cents: i64,
) -> i64 {
    if !is_liability_account_type(account_type) {
        return match kind {
            CashFlowKind::Expense => current_balance_cents - amount_cents,
            CashFlowKind::Income => current_balance_cents + amount_cents,
        };
    }

    let owed_cents = current_balance_cents.abs();
    let sign = if current_balance_cents < 0 { -1 } else { 1 };
    let new_owed_cents = match kind {
        CashFlowKind::Expense => owed_cents + amount_cents,
        CashFlowKind::Income => owed_cents - amount_cents,
    };

    sign * new_owed_cents
}

pub fn adjust_account_balance(
    conn: &Connection,
    account_id: i64,
    kind: CashFlowKind,
    amount_cents: i64,
) -> Result<BalanceChange, AppError> {
    let account = get_account_for_balance_adjustment(conn, account_id)?;
    let new_balance_cents = balance_delta_cents(
        &account.account_type,
        account.balance_cents,
        kind,
        amount_cents,
    );

    conn.execute(
        "UPDATE accounts SET balance_cents = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![new_balance_cents, account_id],
    )?;

    Ok(BalanceChange {
        account_id,
        old_balance_cents: account.balance_cents,
        new_balance_cents,
    })
}

pub fn reverse_adjustment(
    conn: &Connection,
    account_id: i64,
    kind: CashFlowKind,
    amount_cents: i64,
) -> Result<BalanceChange, AppError> {
    let reverse_kind = match kind {
        CashFlowKind::Expense => CashFlowKind::Income,
        CashFlowKind::Income => CashFlowKind::Expense,
    };

    adjust_account_balance(conn, account_id, reverse_kind, amount_cents)
}

pub fn get_total_liabilities_cents(conn: &Connection) -> Result<i64, AppError> {
    let mut total = 0i64;
    for account_type in LIABILITY_ACCOUNT_TYPES {
        let owed: i64 = conn.query_row(
            "SELECT COALESCE(SUM(ABS(balance_cents)), 0)
             FROM accounts
             WHERE account_type = ?1 AND balance_cents != 0",
            params![account_type],
            |row| row.get(0),
        )?;
        total += owed;
    }
    Ok(total)
}

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

fn get_account_for_balance_adjustment(conn: &Connection, id: i64) -> Result<Account, AppError> {
    get_account_by_id(conn, id).map_err(|_| AppError::Validation {
        message: "Account not found".to_string(),
        field: Some("account_id".to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn credit_card_is_liability_account_type() {
        assert!(is_liability_account_type("credit_card"));
        assert!(!is_liability_account_type("chequing"));
    }

    #[test]
    fn asset_expense_decreases_balance() {
        assert_eq!(
            balance_delta_cents("chequing", 10_000, CashFlowKind::Expense, 2_500),
            7_500
        );
    }

    #[test]
    fn asset_income_increases_balance() {
        assert_eq!(
            balance_delta_cents("savings", 10_000, CashFlowKind::Income, 2_500),
            12_500
        );
    }

    #[test]
    fn credit_card_positive_balance_expense_increases_owed() {
        assert_eq!(
            balance_delta_cents("credit_card", 10_000, CashFlowKind::Expense, 2_500),
            12_500
        );
    }

    #[test]
    fn credit_card_negative_balance_expense_increases_owed_preserving_sign() {
        assert_eq!(
            balance_delta_cents("credit_card", -10_000, CashFlowKind::Expense, 2_500),
            -12_500
        );
    }

    #[test]
    fn credit_card_zero_balance_expense_uses_positive_convention() {
        assert_eq!(
            balance_delta_cents("credit_card", 0, CashFlowKind::Expense, 2_500),
            2_500
        );
    }

    #[test]
    fn credit_card_income_decreases_owed() {
        assert_eq!(
            balance_delta_cents("credit_card", 10_000, CashFlowKind::Income, 2_500),
            7_500
        );
        assert_eq!(
            balance_delta_cents("credit_card", -10_000, CashFlowKind::Income, 2_500),
            -7_500
        );
    }

    #[test]
    fn reverse_adjustment_uses_opposite_cash_flow_kind() {
        let conn = account_test_db();
        conn.execute(
            "INSERT INTO accounts (id, name, institution, account_type, currency, balance_cents, created_at, updated_at)
             VALUES (1, 'Chequing', 'Bank', 'chequing', 'CAD', 7_500, datetime('now'), datetime('now'))",
            [],
        )
        .unwrap();

        let change = reverse_adjustment(&conn, 1, CashFlowKind::Expense, 2_500).unwrap();

        assert_eq!(change.old_balance_cents, 7_500);
        assert_eq!(change.new_balance_cents, 10_000);
    }

    fn account_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
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
            );",
        )
        .unwrap();
        conn
    }
}
