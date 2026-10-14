//! The SQL the capture regression tests (Story 15, AD-3/AD-19) drive the real schema with.
//!
//! WHY it lives in `db/`: it is raw SQL, and raw SQL belongs here (project-context rule 1),
//! following the `db::sim_tables` and `db::test_dataset` precedent. The tests own the assertions;
//! this module owns nothing but statements.
//!
//! The statements are deliberately RAW rather than calls into `db::budget` and friends: a capture
//! test asserts which messages a given SQL statement produces, so it has to be the statement that
//! is pinned, not whatever a write function happens to do around it today.

use rusqlite::{params, Connection};

use crate::error::AppError;

pub(crate) fn insert_budget_group(
    conn: &Connection,
    name: &str,
    sort_order: i64,
) -> Result<i64, AppError> {
    conn.execute(
        "INSERT INTO budget_groups (name, sort_order) VALUES (?1, ?2)",
        params![name, sort_order],
    )?;

    Ok(conn.last_insert_rowid())
}

pub(crate) fn rename_budget_group(conn: &Connection, id: i64, name: &str) -> Result<(), AppError> {
    conn.execute(
        "UPDATE budget_groups SET name = ?1 WHERE id = ?2",
        params![name, id],
    )?;

    Ok(())
}

pub(crate) fn restamp_budget_group(
    conn: &Connection,
    id: i64,
    created_at: &str,
) -> Result<(), AppError> {
    conn.execute(
        "UPDATE budget_groups SET created_at = ?1 WHERE id = ?2",
        params![created_at, id],
    )?;

    Ok(())
}

/// `INSERT OR REPLACE` on the PRIMARY KEY, which is the pair of hook callbacks AD-3 names: a
/// DELETE of the conflicting row and an INSERT re-using its row id.
pub(crate) fn replace_budget_group(
    conn: &Connection,
    id: i64,
    name: &str,
    sort_order: i64,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT OR REPLACE INTO budget_groups (id, name, sort_order) VALUES (?1, ?2, ?3)",
        params![id, name, sort_order],
    )?;

    Ok(())
}

/// Written without a `WHERE` clause on purpose: that is the shape SQLite would normally answer with
/// its truncate optimization, deleting every row without ever calling the pre-update hook.
pub(crate) fn delete_every_budget_group(conn: &Connection) -> Result<usize, AppError> {
    Ok(conn.execute("DELETE FROM budget_groups", [])?)
}

pub(crate) fn count_budget_groups(conn: &Connection) -> Result<i64, AppError> {
    Ok(conn.query_row("SELECT COUNT(*) FROM budget_groups", [], |row| row.get(0))?)
}

pub(crate) fn budget_group_name(conn: &Connection, id: i64) -> Result<Option<String>, AppError> {
    use rusqlite::OptionalExtension;

    Ok(conn
        .query_row(
            "SELECT name FROM budget_groups WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()?)
}

pub(crate) fn insert_budget_category(
    conn: &Connection,
    group_id: i64,
    name: &str,
) -> Result<i64, AppError> {
    conn.execute(
        "INSERT INTO budget_categories (group_id, name, target_cents) VALUES (?1, ?2, 1000)",
        params![group_id, name],
    )?;

    Ok(conn.last_insert_rowid())
}

pub(crate) fn insert_income_source(conn: &Connection, name: &str) -> Result<i64, AppError> {
    conn.execute(
        "INSERT INTO income_sources (name, income_type) VALUES (?1, 'employment')",
        params![name],
    )?;

    Ok(conn.last_insert_rowid())
}

pub(crate) fn insert_income_entry(
    conn: &Connection,
    source_id: i64,
    amount_cents: i64,
    date: &str,
) -> Result<i64, AppError> {
    conn.execute(
        "INSERT INTO income_entries (source_id, amount_cents, date, month) \
         VALUES (?1, ?2, ?3, substr(?3, 1, 7))",
        params![source_id, amount_cents, date],
    )?;

    Ok(conn.last_insert_rowid())
}

/// `INSERT OR REPLACE` on a parent that HAS children, so the delete half of the REPLACE cascades
/// and the hook sees `Delete(parent)`, `Delete(child)...`, `Insert(parent)` in that order.
pub(crate) fn replace_income_source(
    conn: &Connection,
    id: i64,
    name: &str,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT OR REPLACE INTO income_sources (id, name, income_type) VALUES (?1, ?2, 'freelance')",
        params![id, name],
    )?;

    Ok(())
}

pub(crate) fn delete_income_source(conn: &Connection, id: i64) -> Result<usize, AppError> {
    Ok(conn.execute("DELETE FROM income_sources WHERE id = ?1", params![id])?)
}

pub(crate) fn count_income_entries(conn: &Connection) -> Result<i64, AppError> {
    Ok(conn.query_row("SELECT COUNT(*) FROM income_entries", [], |row| row.get(0))?)
}

pub(crate) fn insert_account(conn: &Connection, name: &str, cents: i64) -> Result<i64, AppError> {
    conn.execute(
        "INSERT INTO accounts (name, institution, account_type, currency, balance_cents) \
         VALUES (?1, 'Test Bank', 'checking', 'CAD', ?2)",
        params![name, cents],
    )?;

    Ok(conn.last_insert_rowid())
}

pub(crate) fn insert_merchant_hint(
    conn: &Connection,
    merchant: &str,
    category_id: i64,
) -> Result<i64, AppError> {
    conn.execute(
        "INSERT INTO merchant_category_hints (merchant, budget_category_id, confidence_score) \
         VALUES (?1, ?2, 0.9)",
        params![merchant, category_id],
    )?;

    Ok(conn.last_insert_rowid())
}

pub(crate) fn bump_merchant_hint(conn: &Connection, id: i64, by: i64) -> Result<(), AppError> {
    conn.execute(
        "UPDATE merchant_category_hints SET usage_count = usage_count + ?1 WHERE id = ?2",
        params![by, id],
    )?;

    Ok(())
}

/// The two scratch tables the `WITHOUT ROWID` and new-row-id-REPLACE cases need.
///
/// The real schema has neither shape among its travelling tables (`no_travelling_table_of_the_real_
/// schema_is_without_rowid` pins the first), so proving what capture does with them means creating
/// them. They are created in the same file as everything else, so the hook sees them exactly as it
/// would see a future migration's table.
pub(crate) fn create_scratch_tables(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "CREATE TABLE scratch_keyed (key TEXT NOT NULL PRIMARY KEY, label TEXT NOT NULL) \
             WITHOUT ROWID; \
         CREATE TABLE scratch_tagged (id INTEGER PRIMARY KEY, tag TEXT NOT NULL UNIQUE, \
             label TEXT NOT NULL)",
    )?;

    Ok(())
}

pub(crate) fn insert_scratch_keyed(
    conn: &Connection,
    key: &str,
    label: &str,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO scratch_keyed (key, label) VALUES (?1, ?2)",
        params![key, label],
    )?;

    Ok(())
}

pub(crate) fn count_scratch_keyed(conn: &Connection) -> Result<i64, AppError> {
    Ok(conn.query_row("SELECT COUNT(*) FROM scratch_keyed", [], |row| row.get(0))?)
}

pub(crate) fn insert_scratch_tagged(
    conn: &Connection,
    tag: &str,
    label: &str,
) -> Result<i64, AppError> {
    conn.execute(
        "INSERT INTO scratch_tagged (tag, label) VALUES (?1, ?2)",
        params![tag, label],
    )?;

    Ok(conn.last_insert_rowid())
}

/// A REPLACE that conflicts on a UNIQUE column rather than on the primary key, so SQLite deletes
/// the old row and inserts one with a DIFFERENT row id.
pub(crate) fn replace_scratch_tagged(
    conn: &Connection,
    tag: &str,
    label: &str,
) -> Result<i64, AppError> {
    conn.execute(
        "INSERT OR REPLACE INTO scratch_tagged (tag, label) VALUES (?1, ?2)",
        params![tag, label],
    )?;

    Ok(conn.last_insert_rowid())
}

/// One thousand rows in one statement-per-row loop, which is what the latency gate imports.
pub(crate) fn import_budget_groups(conn: &Connection, rows: usize) -> Result<(), AppError> {
    let mut statement =
        conn.prepare("INSERT INTO budget_groups (name, sort_order) VALUES (?1, ?2)")?;

    for row in 0..rows {
        statement.execute(params![format!("imported {row}"), row as i64])?;
    }

    Ok(())
}
