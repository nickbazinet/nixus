use rusqlite::{params, Connection};

use crate::db::account::{self as account_db, BalanceChange, CashFlowKind};
use crate::error::AppError;
use crate::models::{CreateExpenseInput, Expense, MerchantHint, UpdateExpenseInput};

#[derive(Debug, Clone)]
pub struct LinkedExpenseMutation {
    pub expense: Expense,
    pub balance_changes: Vec<BalanceChange>,
}

pub fn insert_expense(conn: &Connection, input: &CreateExpenseInput) -> Result<Expense, AppError> {
    Ok(insert_expense_with_balance_changes(conn, input)?.expense)
}

pub fn insert_expense_with_balance_changes(
    conn: &Connection,
    input: &CreateExpenseInput,
) -> Result<LinkedExpenseMutation, AppError> {
    insert_expense_with_source_with_balance_changes(conn, input, "manual")
}

pub fn insert_expense_with_source(
    conn: &Connection,
    input: &CreateExpenseInput,
    source: &str,
) -> Result<Expense, AppError> {
    Ok(insert_expense_with_source_with_balance_changes(conn, input, source)?.expense)
}

pub fn insert_expense_with_source_with_balance_changes(
    conn: &Connection,
    input: &CreateExpenseInput,
    source: &str,
) -> Result<LinkedExpenseMutation, AppError> {
    let merchant = input.merchant.trim();
    if merchant.is_empty() {
        return Err(AppError::Validation {
            message: "Merchant name is required".to_string(),
            field: Some("merchant".to_string()),
        });
    }

    if input.amount_cents <= 0 {
        return Err(AppError::Validation {
            message: "Amount must be greater than 0".to_string(),
            field: Some("amount_cents".to_string()),
        });
    }

    if input.date.is_empty() {
        return Err(AppError::Validation {
            message: "Date is required".to_string(),
            field: Some("date".to_string()),
        });
    }

    let tx = conn.unchecked_transaction()?;

    // Verify budget_category_id exists
    let category_exists: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM budget_categories WHERE id = ?1)",
        params![input.budget_category_id],
        |row| row.get(0),
    )?;

    if !category_exists {
        return Err(AppError::Validation {
            message: "Budget category not found".to_string(),
            field: Some("budget_category_id".to_string()),
        });
    }
    validate_account_id(&tx, input.account_id)?;

    tx.execute(
        "INSERT INTO expenses (merchant, amount_cents, budget_category_id, account_id, date, source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            merchant,
            input.amount_cents,
            input.budget_category_id,
            input.account_id,
            input.date,
            source
        ],
    )?;

    let id = tx.last_insert_rowid();
    let mut balance_changes = Vec::new();
    if let Some(account_id) = input.account_id {
        balance_changes.push(account_db::adjust_account_balance(
            &tx,
            account_id,
            CashFlowKind::Expense,
            input.amount_cents,
        )?);
    }

    let expense = get_expense_by_id(&tx, id)?;
    tx.commit()?;

    Ok(LinkedExpenseMutation {
        expense,
        balance_changes,
    })
}

pub fn get_expenses_by_month(
    conn: &Connection,
    year: i32,
    month: u32,
) -> Result<Vec<Expense>, AppError> {
    let start_date = format!("{:04}-{:02}-01", year, month);
    let (next_year, next_month) = if month == 12 {
        (year + 1, 1)
    } else {
        (year, month + 1)
    };
    let end_date = format!("{:04}-{:02}-01", next_year, next_month);

    let mut stmt = conn.prepare(
        "SELECT id, merchant, amount_cents, budget_category_id, account_id, date, source, created_at
         FROM expenses
         WHERE date >= ?1 AND date < ?2
         ORDER BY date DESC, created_at DESC",
    )?;

    let expenses = stmt
        .query_map(params![start_date, end_date], |row| {
            row_to_expense(row)
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(expenses)
}

pub fn update_expense(
    conn: &Connection,
    id: i64,
    input: &UpdateExpenseInput,
) -> Result<LinkedExpenseMutation, AppError> {
    let merchant = input.merchant.trim();
    if merchant.is_empty() {
        return Err(AppError::Validation {
            message: "Merchant name is required".to_string(),
            field: Some("merchant".to_string()),
        });
    }

    if input.amount_cents <= 0 {
        return Err(AppError::Validation {
            message: "Amount must be greater than 0".to_string(),
            field: Some("amount_cents".to_string()),
        });
    }

    let tx = conn.unchecked_transaction()?;
    let old_expense = get_expense_by_id(&tx, id)?;

    // Verify budget_category_id exists
    let category_exists: bool = tx.query_row(
        "SELECT EXISTS(SELECT 1 FROM budget_categories WHERE id = ?1)",
        params![input.budget_category_id],
        |row| row.get(0),
    )?;

    if !category_exists {
        return Err(AppError::Validation {
            message: "Budget category not found".to_string(),
            field: Some("budget_category_id".to_string()),
        });
    }
    validate_account_id(&tx, input.account_id)?;

    let mut balance_changes = Vec::new();
    if let Some(account_id) = old_expense.account_id {
        balance_changes.push(account_db::reverse_adjustment(
            &tx,
            account_id,
            CashFlowKind::Expense,
            old_expense.amount_cents,
        )?);
    }

    let rows = tx.execute(
        "UPDATE expenses
         SET merchant = ?1, amount_cents = ?2, budget_category_id = ?3, account_id = ?4, date = ?5
         WHERE id = ?6",
        params![
            merchant,
            input.amount_cents,
            input.budget_category_id,
            input.account_id,
            input.date,
            id
        ],
    )?;

    if rows == 0 {
        return Err(AppError::Database {
            message: "Expense not found".to_string(),
        });
    }

    if let Some(account_id) = input.account_id {
        balance_changes.push(account_db::adjust_account_balance(
            &tx,
            account_id,
            CashFlowKind::Expense,
            input.amount_cents,
        )?);
    }

    let expense = get_expense_by_id(&tx, id)?;
    tx.commit()?;

    Ok(LinkedExpenseMutation {
        expense,
        balance_changes,
    })
}

pub fn bulk_insert_imported_expenses(
    conn: &Connection,
    transactions: &[(String, i64, i64, String)], // (merchant, amount_cents, budget_category_id, date)
) -> Result<usize, AppError> {
    // Validate all rows before starting the transaction
    for (i, (merchant, amount_cents, category_id, _date)) in transactions.iter().enumerate() {
        if merchant.trim().is_empty() {
            return Err(AppError::Validation {
                message: format!("Row {}: merchant name is required", i + 1),
                field: Some("merchant".to_string()),
            });
        }
        if *amount_cents <= 0 {
            return Err(AppError::Validation {
                message: format!("Row {}: amount must be greater than 0", i + 1),
                field: Some("amount_cents".to_string()),
            });
        }
        let category_exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM budget_categories WHERE id = ?1)",
            params![category_id],
            |row| row.get(0),
        )?;
        if !category_exists {
            return Err(AppError::Validation {
                message: format!("Row {}: budget category not found (id={})", i + 1, category_id),
                field: Some("budget_category_id".to_string()),
            });
        }
    }

    let tx = conn.unchecked_transaction().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let mut count = 0;
    for (merchant, amount_cents, category_id, date) in transactions {
        tx.execute(
            "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date, source) VALUES (?1, ?2, ?3, ?4, 'import')",
            params![merchant.trim(), amount_cents, category_id, date],
        )?;
        count += 1;
    }

    tx.commit().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    Ok(count)
}

#[derive(Debug, Clone, Default)]
pub struct ExpenseSearchFilters {
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub merchant: Option<String>,
    pub category_id: Option<i64>,
    pub limit: Option<i64>,
    pub sort: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ExpenseSearchResult {
    pub id: i64,
    pub merchant: String,
    pub amount_cents: i64,
    pub category_name: String,
    pub date: String,
    pub source: String,
}

pub fn search_expenses(
    conn: &Connection,
    filters: &ExpenseSearchFilters,
) -> Result<Vec<ExpenseSearchResult>, AppError> {
    let mut sql = String::from(
        "SELECT e.id, e.merchant, e.amount_cents, bc.name, e.date, e.source
         FROM expenses e
         JOIN budget_categories bc ON e.budget_category_id = bc.id
         WHERE 1=1",
    );
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1;

    if let Some(ref date_from) = filters.date_from {
        sql.push_str(&format!(" AND e.date >= ?{}", param_idx));
        param_values.push(Box::new(date_from.clone()));
        param_idx += 1;
    }
    if let Some(ref date_to) = filters.date_to {
        sql.push_str(&format!(" AND e.date <= ?{}", param_idx));
        param_values.push(Box::new(date_to.clone()));
        param_idx += 1;
    }
    if let Some(ref merchant) = filters.merchant {
        sql.push_str(&format!(" AND e.merchant LIKE ?{} ESCAPE '\\'", param_idx));
        let escaped = merchant.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        param_values.push(Box::new(format!("%{}%", escaped)));
        param_idx += 1;
    }
    if let Some(category_id) = filters.category_id {
        sql.push_str(&format!(" AND e.budget_category_id = ?{}", param_idx));
        param_values.push(Box::new(category_id));
        param_idx += 1;
    }
    let _ = param_idx;

    let sort_order = match filters.sort.as_deref() {
        Some("date_asc") => "e.date ASC, e.created_at ASC",
        _ => "e.date DESC, e.created_at DESC",
    };
    sql.push_str(&format!(" ORDER BY {}", sort_order));

    let limit = filters.limit.unwrap_or(50).max(1).min(100);
    sql.push_str(&format!(" LIMIT {}", limit));

    let mut stmt = conn.prepare(&sql)?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
    let results = stmt
        .query_map(params_refs.as_slice(), |row| {
            Ok(ExpenseSearchResult {
                id: row.get(0)?,
                merchant: row.get(1)?,
                amount_cents: row.get(2)?,
                category_name: row.get(3)?,
                date: row.get(4)?,
                source: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(results)
}

pub fn find_duplicate_indices(
    conn: &Connection,
    transactions: &[(String, String, i64)], // (merchant, date, amount_cents)
) -> Result<Vec<usize>, AppError> {
    let mut duplicates = Vec::new();
    let mut stmt = conn.prepare(
        "SELECT EXISTS(
            SELECT 1 FROM expenses
            WHERE LOWER(merchant) = LOWER(?1) AND date = ?2 AND amount_cents = ?3
        )",
    )?;

    for (i, (merchant, date, amount_cents)) in transactions.iter().enumerate() {
        let exists: bool = stmt.query_row(
            params![merchant, date, amount_cents],
            |row| row.get(0),
        )?;
        if exists {
            duplicates.push(i);
        }
    }

    Ok(duplicates)
}

pub fn delete_expense(conn: &Connection, id: i64) -> Result<Vec<BalanceChange>, AppError> {
    let tx = conn.unchecked_transaction()?;
    let expense = get_expense_by_id(&tx, id)?;
    let mut balance_changes = Vec::new();

    if let Some(account_id) = expense.account_id {
        balance_changes.push(account_db::reverse_adjustment(
            &tx,
            account_id,
            CashFlowKind::Expense,
            expense.amount_cents,
        )?);
    }

    let rows = tx.execute("DELETE FROM expenses WHERE id = ?1", params![id])?;
    if rows == 0 {
        return Err(AppError::Database {
            message: "Expense not found".to_string(),
        });
    }
    tx.commit()?;
    Ok(balance_changes)
}

pub fn get_expense_by_id(conn: &Connection, id: i64) -> Result<Expense, AppError> {
    conn.query_row(
        "SELECT id, merchant, amount_cents, budget_category_id, account_id, date, source, created_at
         FROM expenses
         WHERE id = ?1",
        params![id],
        row_to_expense,
    )
    .map_err(AppError::from)
}

fn row_to_expense(row: &rusqlite::Row) -> rusqlite::Result<Expense> {
    Ok(Expense {
        id: row.get(0)?,
        merchant: row.get(1)?,
        amount_cents: row.get(2)?,
        budget_category_id: row.get(3)?,
        account_id: row.get(4)?,
        date: row.get(5)?,
        source: row.get(6)?,
        created_at: row.get(7)?,
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

pub fn get_merchant_category_hints(conn: &Connection) -> Result<Vec<MerchantHint>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT merchant, budget_category_id, confidence_score, usage_count
         FROM merchant_category_hints
         ORDER BY confidence_score * usage_count DESC
         LIMIT 50",
    )?;

    let hints = stmt
        .query_map([], |row| {
            Ok(MerchantHint {
                merchant: row.get(0)?,
                budget_category_id: row.get(1)?,
                confidence_score: row.get(2)?,
                usage_count: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(hints)
}

pub fn record_merchant_category_hint(
    conn: &Connection,
    merchant: &str,
    budget_category_id: i64,
    user_corrected: bool,
) -> Result<(), AppError> {
    let normalized = merchant.to_lowercase();
    let normalized = normalized.trim();

    conn.execute(
        "INSERT OR IGNORE INTO merchant_category_hints
         (merchant, budget_category_id, confidence_score, usage_count)
         VALUES (?1, ?2, 1.0, 1)",
        params![normalized, budget_category_id],
    )?;

    if user_corrected {
        // User changed the category — reinforce the new correct mapping
        conn.execute(
            "UPDATE merchant_category_hints
             SET usage_count = usage_count + 1,
                 confidence_score = 1.0,
                 last_updated = datetime('now')
             WHERE merchant = ?1 AND budget_category_id = ?2",
            params![normalized, budget_category_id],
        )?;
        // Degrade any OTHER mappings for this merchant
        conn.execute(
            "UPDATE merchant_category_hints
             SET confidence_score = MAX(0.1, confidence_score * 0.7),
                 last_updated = datetime('now')
             WHERE merchant = ?1 AND budget_category_id != ?2",
            params![normalized, budget_category_id],
        )?;
    } else {
        // User confirmed without change — reinforce
        conn.execute(
            "UPDATE merchant_category_hints
             SET usage_count = usage_count + 1,
                 confidence_score = MIN(1.0, confidence_score + 0.1),
                 last_updated = datetime('now')
             WHERE merchant = ?1 AND budget_category_id = ?2",
            params![normalized, budget_category_id],
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn insert_expense_without_account_preserves_account_balance() {
        let conn = expense_test_db();
        let input = expense_input(None, 2_500);

        let result = insert_expense_with_balance_changes(&conn, &input).unwrap();

        assert_eq!(result.expense.account_id, None);
        assert!(result.balance_changes.is_empty());
        assert_eq!(account_balance(&conn, 1), 10_000);
    }

    #[test]
    fn insert_expense_with_account_decreases_asset_balance() {
        let conn = expense_test_db();
        let input = expense_input(Some(1), 2_500);

        let result = insert_expense_with_balance_changes(&conn, &input).unwrap();

        assert_eq!(result.expense.account_id, Some(1));
        assert_eq!(result.balance_changes[0].old_balance_cents, 10_000);
        assert_eq!(result.balance_changes[0].new_balance_cents, 7_500);
        assert_eq!(account_balance(&conn, 1), 7_500);
    }

    #[test]
    fn insert_expense_with_invalid_account_rolls_back() {
        let conn = expense_test_db();
        let input = expense_input(Some(999), 2_500);

        let err = insert_expense_with_balance_changes(&conn, &input).unwrap_err();

        assert!(matches!(err, AppError::Validation { field: Some(field), .. } if field == "account_id"));
        assert_eq!(expense_count(&conn), 0);
        assert_eq!(account_balance(&conn, 1), 10_000);
    }

    #[test]
    fn update_expense_reverses_old_account_before_applying_new_account() {
        let conn = expense_test_db();
        let created = insert_expense_with_balance_changes(&conn, &expense_input(Some(1), 1_000))
            .unwrap()
            .expense;
        let input = UpdateExpenseInput {
            merchant: "Updated".to_string(),
            amount_cents: 2_500,
            budget_category_id: 1,
            date: "2026-06-11".to_string(),
            account_id: Some(2),
        };

        let result = update_expense(&conn, created.id, &input).unwrap();

        assert_eq!(result.expense.account_id, Some(2));
        assert_eq!(account_balance(&conn, 1), 10_000);
        assert_eq!(account_balance(&conn, 2), 17_500);
    }

    #[test]
    fn delete_expense_reverses_linked_account_balance() {
        let conn = expense_test_db();
        let created = insert_expense_with_balance_changes(&conn, &expense_input(Some(1), 1_500))
            .unwrap()
            .expense;

        let changes = delete_expense(&conn, created.id).unwrap();

        assert_eq!(changes.len(), 1);
        assert_eq!(account_balance(&conn, 1), 10_000);
        assert_eq!(expense_count(&conn), 0);
    }

    fn expense_input(account_id: Option<i64>, amount_cents: i64) -> CreateExpenseInput {
        CreateExpenseInput {
            merchant: "Grocer".to_string(),
            amount_cents,
            budget_category_id: 1,
            date: "2026-06-10".to_string(),
            account_id,
        }
    }

    fn expense_test_db() -> Connection {
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
            CREATE TABLE budget_groups (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE TABLE budget_categories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                group_id INTEGER NOT NULL REFERENCES budget_groups(id),
                name TEXT NOT NULL,
                target_cents INTEGER NOT NULL DEFAULT 0,
                sort_order INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
            );
            INSERT INTO accounts (id, name, institution, account_type, currency, balance_cents)
            VALUES (1, 'Chequing', 'Bank', 'chequing', 'CAD', 10000),
                   (2, 'Savings', 'Bank', 'savings', 'CAD', 20000);
            INSERT INTO budget_groups (id, name, sort_order) VALUES (1, 'Needs', 1);
            INSERT INTO budget_categories (id, group_id, name, target_cents, sort_order)
            VALUES (1, 1, 'Groceries', 50000, 1);",
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

    fn expense_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM expenses", [], |row| row.get(0))
            .unwrap()
    }
}
