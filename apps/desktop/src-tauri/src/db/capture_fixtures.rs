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

/// A plain `UPDATE` of `balance_cents`, which is what AD-5 says must produce no message about that
/// column even when it runs inside a captured write.
///
/// `updated_at` is passed in rather than `datetime('now')` so the statement provably changes a
/// captured column too: the test's non-vacuity check would otherwise depend on the row having been
/// created in an earlier second.
pub(crate) fn set_account_balance_directly(
    conn: &Connection,
    id: i64,
    cents: i64,
    updated_at: &str,
) -> Result<(), AppError> {
    conn.execute(
        "UPDATE accounts SET balance_cents = ?1, updated_at = ?2 WHERE id = ?3",
        params![cents, updated_at, id],
    )?;

    Ok(())
}

/// An expense row, so a balance delta has a real cause row to be keyed by.
///
/// Raw rather than `db::expense`, because `insert_expense_with_balance_changes` opens a transaction
/// of its own and cannot run inside `ActiveDataset::write` until Story 17 migrates it.
pub(crate) fn insert_expense_row(
    conn: &Connection,
    category_id: i64,
    account_id: i64,
    cents: i64,
) -> Result<i64, AppError> {
    conn.execute(
        "INSERT INTO expenses (merchant, amount_cents, budget_category_id, account_id, date, source)          VALUES ('Metro', ?1, ?2, ?3, '2026-03-04', 'manual')",
        params![cents, category_id, account_id],
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

/// Ages a tombstone past its retention window, which is the only way a test can reach the state
/// AD-5's purge sweep is written for: `purge_after` is a stored timestamp and the table's own CHECK
/// refuses a window that closes before the delete happened.
pub(crate) fn expire_tombstone(
    conn: &Connection,
    table: &str,
    row_uuid: &[u8],
) -> Result<(), AppError> {
    conn.execute(
        "UPDATE sync_tombstone \
         SET deleted_at = datetime('now', '-31 days'), purge_after = datetime('now', '-1 day') \
         WHERE table_name = ?1 AND row_uuid = ?2",
        params![table, row_uuid],
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

/// A raw `DELETE` of one expense row, so a test can delete a template-generated occurrence the way
/// the app does (inside a captured write) and reconcile a bypassing one the way it does not.
pub(crate) fn delete_expense_row(conn: &Connection, id: i64) -> Result<usize, AppError> {
    Ok(conn.execute("DELETE FROM expenses WHERE id = ?1", params![id])?)
}

pub(crate) fn count_expenses(conn: &Connection) -> Result<i64, AppError> {
    Ok(conn.query_row("SELECT COUNT(*) FROM expenses", [], |row| row.get(0))?)
}

/// A write to a `LocalOnly` table (AD-5), which reconcile must never describe in a message because
/// those tables never travel at all.
pub(crate) fn touch_local_only_table(conn: &Connection) -> Result<(), AppError> {
    conn.execute("UPDATE schema_version SET version = version", [])?;

    Ok(())
}

/// A raw `config` write, which is what an unmigrated write site looks like for the one table with a
/// per-ROW exclusion (AD-5): `db::config::set` goes through capture and binds an identity, and that
/// is exactly what a deny-listed key must never acquire.
pub(crate) fn set_config_directly(
    conn: &Connection,
    key: &str,
    value: &str,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT OR REPLACE INTO config (key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;

    Ok(())
}

/// A raw edit of ONE captured column of an expense, so a test can produce the partial `field`
/// message AD-5's delete-wins rule is about.
pub(crate) fn rename_expense_merchant(
    conn: &Connection,
    id: i64,
    merchant: &str,
) -> Result<(), AppError> {
    conn.execute(
        "UPDATE expenses SET merchant = ?1 WHERE id = ?2",
        params![merchant, id],
    )?;

    Ok(())
}
