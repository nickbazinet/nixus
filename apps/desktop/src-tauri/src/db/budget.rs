use rusqlite::{params, Connection};

use crate::error::AppError;
use crate::models::{BudgetCategory, BudgetCategoryStatus, BudgetGroup, CreateBudgetCategory, CreateBudgetGroup};

pub fn create_budget_group(
    conn: &Connection,
    input: &CreateBudgetGroup,
) -> Result<BudgetGroup, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation {
            message: "Group name is required".to_string(),
            field: Some("name".to_string()),
        });
    }

    let sort_order: i32 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM budget_groups",
        [],
        |row| row.get(0),
    )?;

    conn.execute(
        "INSERT INTO budget_groups (name, sort_order) VALUES (?1, ?2)",
        params![name, sort_order],
    )?;

    let id = conn.last_insert_rowid();

    conn.query_row(
        "SELECT id, name, sort_order, created_at FROM budget_groups WHERE id = ?1",
        params![id],
        |row| {
            Ok(BudgetGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                created_at: row.get(3)?,
            })
        },
    )
    .map_err(AppError::from)
}

pub fn get_budget_groups(conn: &Connection) -> Result<Vec<BudgetGroup>, AppError> {
    let mut stmt =
        conn.prepare("SELECT id, name, sort_order, created_at FROM budget_groups ORDER BY sort_order")?;

    let groups = stmt
        .query_map([], |row| {
            Ok(BudgetGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(groups)
}

pub fn create_budget_category(
    conn: &Connection,
    input: &CreateBudgetCategory,
) -> Result<BudgetCategory, AppError> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Validation {
            message: "Category name is required".to_string(),
            field: Some("name".to_string()),
        });
    }

    if input.target_cents <= 0 {
        return Err(AppError::Validation {
            message: "Target must be greater than 0".to_string(),
            field: Some("target_cents".to_string()),
        });
    }

    let sort_order: i32 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM budget_categories WHERE group_id = ?1 AND deleted_at IS NULL",
        params![input.group_id],
        |row| row.get(0),
    )?;

    conn.execute(
        "INSERT INTO budget_categories (group_id, name, target_cents, sort_order) VALUES (?1, ?2, ?3, ?4)",
        params![input.group_id, name, input.target_cents, sort_order],
    )?;

    let id = conn.last_insert_rowid();

    conn.query_row(
        "SELECT id, group_id, name, target_cents, sort_order, created_at FROM budget_categories WHERE id = ?1",
        params![id],
        |row| {
            Ok(BudgetCategory {
                id: row.get(0)?,
                group_id: row.get(1)?,
                name: row.get(2)?,
                target_cents: row.get(3)?,
                sort_order: row.get(4)?,
                created_at: row.get(5)?,
            })
        },
    )
    .map_err(AppError::from)
}

pub fn get_budget_categories_by_group(
    conn: &Connection,
    group_id: i64,
) -> Result<Vec<BudgetCategory>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, group_id, name, target_cents, sort_order, created_at FROM budget_categories WHERE group_id = ?1 AND deleted_at IS NULL ORDER BY sort_order",
    )?;

    let categories = stmt
        .query_map(params![group_id], |row| {
            Ok(BudgetCategory {
                id: row.get(0)?,
                group_id: row.get(1)?,
                name: row.get(2)?,
                target_cents: row.get(3)?,
                sort_order: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(categories)
}

pub fn update_budget_group(
    conn: &Connection,
    id: i64,
    name: String,
) -> Result<BudgetGroup, AppError> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Validation {
            message: "Group name is required".to_string(),
            field: Some("name".to_string()),
        });
    }

    let rows = conn.execute(
        "UPDATE budget_groups SET name = ?1 WHERE id = ?2",
        params![name, id],
    )?;

    if rows == 0 {
        return Err(AppError::Database {
            message: "Budget group not found".to_string(),
        });
    }

    conn.query_row(
        "SELECT id, name, sort_order, created_at FROM budget_groups WHERE id = ?1",
        params![id],
        |row| {
            Ok(BudgetGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
                created_at: row.get(3)?,
            })
        },
    )
    .map_err(AppError::from)
}

pub fn update_budget_category(
    conn: &Connection,
    id: i64,
    name: Option<String>,
    target_cents: Option<i64>,
) -> Result<BudgetCategory, AppError> {
    if let Some(ref n) = name {
        let trimmed = n.trim();
        if trimmed.is_empty() {
            return Err(AppError::Validation {
                message: "Category name is required".to_string(),
                field: Some("name".to_string()),
            });
        }
    }

    if let Some(tc) = target_cents {
        if tc <= 0 {
            return Err(AppError::Validation {
                message: "Target must be greater than 0".to_string(),
                field: Some("target_cents".to_string()),
            });
        }
    }

    let is_active: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM budget_categories WHERE id = ?1 AND deleted_at IS NULL)",
        params![id],
        |row| row.get(0),
    )?;

    if !is_active {
        return Err(AppError::Database {
            message: "Budget category not found".to_string(),
        });
    }

    if let Some(ref n) = name {
        conn.execute(
            "UPDATE budget_categories SET name = ?1 WHERE id = ?2",
            params![n.trim(), id],
        )?;
    }

    if let Some(tc) = target_cents {
        conn.execute(
            "UPDATE budget_categories SET target_cents = ?1 WHERE id = ?2",
            params![tc, id],
        )?;
    }

    conn.query_row(
        "SELECT id, group_id, name, target_cents, sort_order, created_at FROM budget_categories WHERE id = ?1",
        params![id],
        |row| {
            Ok(BudgetCategory {
                id: row.get(0)?,
                group_id: row.get(1)?,
                name: row.get(2)?,
                target_cents: row.get(3)?,
                sort_order: row.get(4)?,
                created_at: row.get(5)?,
            })
        },
    )
    .map_err(AppError::from)
}

pub fn delete_budget_category(conn: &Connection, id: i64) -> Result<(), AppError> {
    let is_active: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM budget_categories WHERE id = ?1 AND deleted_at IS NULL)",
        params![id],
        |row| row.get(0),
    )?;

    if !is_active {
        return Err(AppError::Database {
            message: "Budget category not found".to_string(),
        });
    }

    let recurring_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM recurring_expense_templates WHERE budget_category_id = ?1",
        params![id],
        |row| row.get(0),
    )?;

    if recurring_count > 0 {
        return Err(AppError::Validation {
            message:
                "Cannot delete category used by a recurring expense. Remove the template first."
                    .to_string(),
            field: None,
        });
    }

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM merchant_category_hints WHERE budget_category_id = ?1",
        params![id],
    )?;
    let rows = tx.execute(
        "UPDATE budget_categories SET deleted_at = datetime('now') WHERE id = ?1 AND deleted_at IS NULL",
        params![id],
    )?;
    tx.commit()?;

    if rows == 0 {
        return Err(AppError::Database {
            message: "Budget category not found".to_string(),
        });
    }

    Ok(())
}

pub fn delete_budget_group(conn: &Connection, id: i64) -> Result<(), AppError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM budget_categories WHERE group_id = ?1 AND deleted_at IS NULL",
        params![id],
        |row| row.get(0),
    )?;

    if count > 0 {
        return Err(AppError::Validation {
            message: "Remove all categories first".to_string(),
            field: None,
        });
    }

    let rows = conn.execute("DELETE FROM budget_groups WHERE id = ?1", params![id])?;
    if rows == 0 {
        return Err(AppError::Database {
            message: "Budget group not found".to_string(),
        });
    }
    Ok(())
}

pub fn get_budget_status(
    conn: &Connection,
    year: i32,
    month: i32,
) -> Result<Vec<BudgetCategoryStatus>, AppError> {
    let year_str = format!("{:04}", year);
    let month_str = format!("{:02}", month);

    let mut stmt = conn.prepare(
        "SELECT bc.id, bc.group_id, bc.name, bc.target_cents,
                COALESCE(SUM(e.amount_cents), 0) AS spent_cents,
                CASE WHEN bc.deleted_at IS NOT NULL THEN 1 ELSE 0 END AS is_deleted
         FROM budget_categories bc
         LEFT JOIN expenses e ON e.budget_category_id = bc.id
           AND strftime('%Y', e.date) = ?1
           AND strftime('%m', e.date) = ?2
         WHERE bc.deleted_at IS NULL
            OR EXISTS (
                SELECT 1 FROM expenses ex
                WHERE ex.budget_category_id = bc.id
                  AND strftime('%Y', ex.date) = ?1
                  AND strftime('%m', ex.date) = ?2
            )
         GROUP BY bc.id
         ORDER BY bc.group_id, bc.sort_order",
    )?;

    let statuses = stmt
        .query_map(params![year_str, month_str], |row| {
            Ok(BudgetCategoryStatus {
                id: row.get(0)?,
                group_id: row.get(1)?,
                name: row.get(2)?,
                target_cents: row.get(3)?,
                spent_cents: row.get(4)?,
                is_deleted: row.get::<_, i32>(5)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(statuses)
}

pub fn get_all_budget_categories(conn: &Connection) -> Result<Vec<BudgetCategory>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, group_id, name, target_cents, sort_order, created_at FROM budget_categories WHERE deleted_at IS NULL ORDER BY group_id, sort_order",
    )?;

    let categories = stmt
        .query_map([], |row| {
            Ok(BudgetCategory {
                id: row.get(0)?,
                group_id: row.get(1)?,
                name: row.get(2)?,
                target_cents: row.get(3)?,
                sort_order: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(categories)
}

/// Write actions store a single foreign key, so ambiguity is a validation outcome
/// rather than a reason to pick the first row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CategoryNameMatch {
    Unique(i64),
    Missing,
    Ambiguous,
}

// SQLite `LOWER` folds ASCII only: accented or non-Latin names must match stored case.
pub fn resolve_active_category_id_by_name(
    conn: &Connection,
    name: &str,
) -> Result<CategoryNameMatch, AppError> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Ok(CategoryNameMatch::Missing);
    }

    let mut stmt = conn.prepare(
        "SELECT id FROM budget_categories
         WHERE deleted_at IS NULL AND LOWER(TRIM(name)) = LOWER(?1)
         ORDER BY id ASC
         LIMIT 2",
    )?;
    let ids = stmt
        .query_map(params![trimmed], |row| row.get::<_, i64>(0))?
        .collect::<Result<Vec<_>, _>>()?;

    match ids.as_slice() {
        [] => Ok(CategoryNameMatch::Missing),
        [id] => Ok(CategoryNameMatch::Unique(*id)),
        _ => Ok(CategoryNameMatch::Ambiguous),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn budget_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn.execute_batch(
            "CREATE TABLE budget_groups (
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
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                deleted_at TEXT
            );
            CREATE TABLE expenses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                merchant TEXT NOT NULL,
                amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
                budget_category_id INTEGER NOT NULL REFERENCES budget_categories(id),
                account_id INTEGER,
                date TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'manual',
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
            CREATE TABLE merchant_category_hints (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                merchant TEXT NOT NULL,
                budget_category_id INTEGER NOT NULL REFERENCES budget_categories(id),
                confidence_score REAL NOT NULL DEFAULT 1.0,
                usage_count INTEGER NOT NULL DEFAULT 1,
                last_updated TEXT NOT NULL DEFAULT (datetime('now')),
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            INSERT INTO budget_groups (id, name, sort_order) VALUES (1, 'Needs', 1);
            INSERT INTO budget_categories (id, group_id, name, target_cents, sort_order)
            VALUES (1, 1, 'Groceries', 50000, 1);",
        )
        .unwrap();
        conn
    }

    #[test]
    fn delete_budget_category_soft_deletes_when_unreferenced() {
        let conn = budget_test_db();
        delete_budget_category(&conn, 1).unwrap();
        let deleted_at: Option<String> = conn
            .query_row(
                "SELECT deleted_at FROM budget_categories WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(deleted_at.is_some());
    }

    #[test]
    fn delete_budget_category_soft_deletes_when_expenses_exist() {
        let conn = budget_test_db();
        conn.execute(
            "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date)
             VALUES ('Store', 1500, 1, '2026-06-10')",
            [],
        )
        .unwrap();

        delete_budget_category(&conn, 1).unwrap();

        let deleted_at: Option<String> = conn
            .query_row(
                "SELECT deleted_at FROM budget_categories WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(deleted_at.is_some());
    }

    #[test]
    fn get_budget_status_includes_archived_category_only_in_months_with_spending() {
        let conn = budget_test_db();
        conn.execute(
            "INSERT INTO expenses (merchant, amount_cents, budget_category_id, date)
             VALUES ('Store', 1500, 1, '2026-06-10')",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE budget_categories SET deleted_at = datetime('now') WHERE id = 1",
            [],
        )
        .unwrap();

        let june_status = get_budget_status(&conn, 2026, 6).unwrap();
        assert_eq!(june_status.len(), 1);
        assert!(june_status[0].is_deleted);
        assert_eq!(june_status[0].spent_cents, 1500);

        let july_status = get_budget_status(&conn, 2026, 7).unwrap();
        assert!(july_status.is_empty());
    }

    #[test]
    fn delete_budget_category_blocked_when_recurring_template_exists() {
        let conn = budget_test_db();
        conn.execute(
            "INSERT INTO recurring_expense_templates
             (merchant, amount_cents, budget_category_id, day_of_month)
             VALUES ('Rent', 120000, 1, 1)",
            [],
        )
        .unwrap();

        let err = delete_budget_category(&conn, 1).unwrap_err();
        match err {
            AppError::Validation { message, .. } => {
                assert!(message.contains("recurring"));
            }
            other => panic!("expected validation error, got {other:?}"),
        }
    }

    #[test]
    fn delete_budget_category_cleans_merchant_hints() {
        let conn = budget_test_db();
        conn.execute(
            "INSERT INTO merchant_category_hints (merchant, budget_category_id)
             VALUES ('Costco', 1)",
            [],
        )
        .unwrap();

        delete_budget_category(&conn, 1).unwrap();

        let deleted_at: Option<String> = conn
            .query_row(
                "SELECT deleted_at FROM budget_categories WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let hint_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM merchant_category_hints",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(deleted_at.is_some());
        assert_eq!(hint_count, 0);
    }

    fn insert_category(conn: &Connection, id: i64, name: &str) {
        conn.execute(
            "INSERT INTO budget_categories (id, group_id, name, target_cents, sort_order)
             VALUES (?1, 1, ?2, 0, 9)",
            params![id, name],
        )
        .unwrap();
    }

    #[test]
    fn resolve_active_category_id_by_name_returns_unique_id_for_exact_name() {
        let conn = budget_test_db();
        insert_category(&conn, 42, "Vacation");

        assert_eq!(
            resolve_active_category_id_by_name(&conn, "Vacation").unwrap(),
            CategoryNameMatch::Unique(42)
        );
    }

    #[test]
    fn resolve_active_category_id_by_name_is_case_insensitive_and_trims_input() {
        let conn = budget_test_db();
        insert_category(&conn, 42, "Vacation");

        assert_eq!(
            resolve_active_category_id_by_name(&conn, "  vAcAtIoN  ").unwrap(),
            CategoryNameMatch::Unique(42)
        );
    }

    #[test]
    fn resolve_active_category_id_by_name_reports_missing_for_unknown_name() {
        let conn = budget_test_db();
        insert_category(&conn, 42, "Vacation");

        assert_eq!(
            resolve_active_category_id_by_name(&conn, "Cloud").unwrap(),
            CategoryNameMatch::Missing
        );
    }

    #[test]
    fn resolve_active_category_id_by_name_rejects_partial_matches() {
        let conn = budget_test_db();
        insert_category(&conn, 42, "Vacation");

        assert_eq!(
            resolve_active_category_id_by_name(&conn, "Vac").unwrap(),
            CategoryNameMatch::Missing
        );
    }

    #[test]
    fn resolve_active_category_id_by_name_reports_missing_for_blank_name() {
        let conn = budget_test_db();
        insert_category(&conn, 42, "Vacation");

        assert_eq!(
            resolve_active_category_id_by_name(&conn, "   ").unwrap(),
            CategoryNameMatch::Missing
        );
    }

    #[test]
    fn resolve_active_category_id_by_name_reports_ambiguous_for_duplicate_active_names() {
        let conn = budget_test_db();
        insert_category(&conn, 42, "Vacation");
        insert_category(&conn, 43, "vacation");

        assert_eq!(
            resolve_active_category_id_by_name(&conn, "Vacation").unwrap(),
            CategoryNameMatch::Ambiguous
        );
    }

    #[test]
    fn resolve_active_category_id_by_name_ignores_soft_deleted_duplicates() {
        let conn = budget_test_db();
        insert_category(&conn, 42, "Vacation");
        insert_category(&conn, 43, "Vacation");
        conn.execute(
            "UPDATE budget_categories SET deleted_at = datetime('now') WHERE id = 43",
            [],
        )
        .unwrap();

        assert_eq!(
            resolve_active_category_id_by_name(&conn, "Vacation").unwrap(),
            CategoryNameMatch::Unique(42)
        );
    }

    #[test]
    fn resolve_active_category_id_by_name_reports_missing_when_only_match_is_soft_deleted() {
        let conn = budget_test_db();
        insert_category(&conn, 42, "Vacation");
        conn.execute(
            "UPDATE budget_categories SET deleted_at = datetime('now') WHERE id = 42",
            [],
        )
        .unwrap();

        assert_eq!(
            resolve_active_category_id_by_name(&conn, "Vacation").unwrap(),
            CategoryNameMatch::Missing
        );
    }
}
