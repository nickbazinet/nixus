use rusqlite::{params, Connection};

use crate::error::AppError;
use crate::models::{CreateExpenseInput, Expense, MerchantHint, UpdateExpenseInput};

pub fn insert_expense(conn: &Connection, input: &CreateExpenseInput) -> Result<Expense, AppError> {
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

    // Verify budget_category_id exists
    let category_exists: bool = conn.query_row(
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

    conn.execute(
        "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date, source) VALUES (?1, ?2, ?3, ?4, 'manual')",
        params![merchant, input.amount_cents, input.budget_category_id, input.date],
    )?;

    let id = conn.last_insert_rowid();

    conn.query_row(
        "SELECT id, merchant, amount_cents, budget_category_id, date, source, created_at FROM expenses WHERE id = ?1",
        params![id],
        |row| {
            Ok(Expense {
                id: row.get(0)?,
                merchant: row.get(1)?,
                amount_cents: row.get(2)?,
                budget_category_id: row.get(3)?,
                date: row.get(4)?,
                source: row.get(5)?,
                created_at: row.get(6)?,
            })
        },
    )
    .map_err(AppError::from)
}

pub fn insert_expense_with_source(
    conn: &Connection,
    input: &CreateExpenseInput,
    source: &str,
) -> Result<Expense, AppError> {
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

    // Verify budget_category_id exists
    let category_exists: bool = conn.query_row(
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

    conn.execute(
        "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date, source) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![merchant, input.amount_cents, input.budget_category_id, input.date, source],
    )?;

    let id = conn.last_insert_rowid();

    conn.query_row(
        "SELECT id, merchant, amount_cents, budget_category_id, date, source, created_at FROM expenses WHERE id = ?1",
        params![id],
        |row| {
            Ok(Expense {
                id: row.get(0)?,
                merchant: row.get(1)?,
                amount_cents: row.get(2)?,
                budget_category_id: row.get(3)?,
                date: row.get(4)?,
                source: row.get(5)?,
                created_at: row.get(6)?,
            })
        },
    )
    .map_err(AppError::from)
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
        "SELECT id, merchant, amount_cents, budget_category_id, date, source, created_at
         FROM expenses
         WHERE date >= ?1 AND date < ?2
         ORDER BY date DESC, created_at DESC",
    )?;

    let expenses = stmt
        .query_map(params![start_date, end_date], |row| {
            Ok(Expense {
                id: row.get(0)?,
                merchant: row.get(1)?,
                amount_cents: row.get(2)?,
                budget_category_id: row.get(3)?,
                date: row.get(4)?,
                source: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(expenses)
}

pub fn update_expense(
    conn: &Connection,
    id: i64,
    input: &UpdateExpenseInput,
) -> Result<Expense, AppError> {
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

    // Verify budget_category_id exists
    let category_exists: bool = conn.query_row(
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

    let rows = conn.execute(
        "UPDATE expenses SET merchant = ?1, amount_cents = ?2, budget_category_id = ?3, date = ?4 WHERE id = ?5",
        params![merchant, input.amount_cents, input.budget_category_id, input.date, id],
    )?;

    if rows == 0 {
        return Err(AppError::Database {
            message: "Expense not found".to_string(),
        });
    }

    conn.query_row(
        "SELECT id, merchant, amount_cents, budget_category_id, date, source, created_at FROM expenses WHERE id = ?1",
        params![id],
        |row| {
            Ok(Expense {
                id: row.get(0)?,
                merchant: row.get(1)?,
                amount_cents: row.get(2)?,
                budget_category_id: row.get(3)?,
                date: row.get(4)?,
                source: row.get(5)?,
                created_at: row.get(6)?,
            })
        },
    )
    .map_err(AppError::from)
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

pub fn delete_expense(conn: &Connection, id: i64) -> Result<(), AppError> {
    let rows = conn.execute("DELETE FROM expenses WHERE id = ?1", params![id])?;
    if rows == 0 {
        return Err(AppError::Database {
            message: "Expense not found".to_string(),
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
