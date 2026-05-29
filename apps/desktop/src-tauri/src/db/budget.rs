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
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM budget_categories WHERE group_id = ?1",
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
        "SELECT id, group_id, name, target_cents, sort_order, created_at FROM budget_categories WHERE group_id = ?1 ORDER BY sort_order",
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
    let rows = conn.execute("DELETE FROM budget_categories WHERE id = ?1", params![id])?;
    if rows == 0 {
        return Err(AppError::Database {
            message: "Budget category not found".to_string(),
        });
    }
    Ok(())
}

pub fn delete_budget_group(conn: &Connection, id: i64) -> Result<(), AppError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM budget_categories WHERE group_id = ?1",
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
                COALESCE(SUM(e.amount_cents), 0) AS spent_cents
         FROM budget_categories bc
         LEFT JOIN expenses e ON e.budget_category_id = bc.id
           AND strftime('%Y', e.date) = ?1
           AND strftime('%m', e.date) = ?2
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
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(statuses)
}

pub fn get_all_budget_categories(conn: &Connection) -> Result<Vec<BudgetCategory>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, group_id, name, target_cents, sort_order, created_at FROM budget_categories ORDER BY group_id, sort_order",
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
