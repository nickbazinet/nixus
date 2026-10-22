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

/// What `seed_pre_sync_records` wrote, so a test asserts against what it asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PreSyncRecords {
    pub budget_groups: i64,
    pub budget_categories: i64,
    pub accounts: i64,
    pub passive_assets: i64,
    pub expenses: i64,
    pub income_sources: i64,
    pub income_entries: i64,
    pub recurring_income_templates: i64,
    pub vehicles: i64,
    pub maintenance_tasks: i64,
    pub projects: i64,
    pub net_worth_snapshots: i64,
}

impl PreSyncRecords {
    /// `(table, expected rows)` for every table `seed_pre_sync_records` fills.
    pub(crate) fn per_table(&self) -> [(&'static str, i64); 12] {
        [
            ("budget_groups", self.budget_groups),
            ("budget_categories", self.budget_categories),
            ("accounts", self.accounts),
            ("passive_assets", self.passive_assets),
            ("expenses", self.expenses),
            ("income_sources", self.income_sources),
            ("income_entries", self.income_entries),
            ("recurring_income_templates", self.recurring_income_templates),
            ("vehicles", self.vehicles),
            ("maintenance_tasks", self.maintenance_tasks),
            ("projects", self.projects),
            ("net_worth_snapshots", self.net_worth_snapshots),
        ]
    }
}

/// The records a person has BEFORE they ever turn sync on: written with plain statements on a
/// connection that has no capture hook, so no row has an identity. This is every existing user's
/// dataset the day sync starts, and it is the shape the two-computer proofs were missing — they
/// wrote their rows through the hook, which hands each one an identity at birth.
///
/// Every timestamp is explicit. Two computers that hold "the same records" (a restored backup, an
/// older snapshot) hold byte-identical rows, and a `datetime('now')` default would make that
/// depend on which second each insert happened to land in.
///
/// Some rows are deliberately identical to their neighbours (three coffees on one day): those are
/// the rows a content-derived identity could confuse with each other.
pub(crate) fn seed_pre_sync_records(conn: &Connection) -> Result<PreSyncRecords, AppError> {
    const STAMP: &str = "2026-03-15 21:56:07";

    for (id, name, sort_order) in [(1, "Living", 0), (2, "Lifestyle", 1)] {
        conn.execute(
            "INSERT INTO budget_groups (id, name, sort_order, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, sort_order, STAMP],
        )?;
    }
    for (id, group_id, name, target) in [
        (1, 1, "Groceries", 60_000),
        (2, 1, "Rent", 150_000),
        (3, 2, "Eating out", 20_000),
    ] {
        conn.execute(
            "INSERT INTO budget_categories (id, group_id, name, target_cents, sort_order, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?1, ?5)",
            params![id, group_id, name, target, STAMP],
        )?;
    }

    for (id, name, institution, kind, cents, created) in [
        (
            1,
            "Main Chequing",
            "Desjardins",
            "chequing",
            639_967,
            "2026-03-15 21:55:51",
        ),
        (
            2,
            "Emergency",
            "Wealthsimple",
            "chequing",
            912_702,
            "2026-03-15 21:58:20",
        ),
        (
            3,
            "Auto TFSA",
            "Tangerine",
            "tfsa",
            1_561_658,
            "2026-03-15 21:56:24",
        ),
        (
            4,
            "Auto REER",
            "Desjardins",
            "rrsp",
            3_777_636,
            "2026-03-15 21:56:07",
        ),
    ] {
        conn.execute(
            "INSERT INTO accounts \
             (id, name, institution, account_type, currency, balance_cents, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, 'CAD', ?5, ?6, ?6)",
            params![id, name, institution, kind, cents, created],
        )?;
    }

    for (id, name, kind, cents) in [
        (1, "Accord 2014", "Vehicle", 300_000),
        (2, "Sovra", "Business", 4_000_000),
    ] {
        conn.execute(
            "INSERT INTO passive_assets (id, name, asset_type, value_cents, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            params![id, name, kind, cents, STAMP],
        )?;
    }

    // Three identical coffees on one day, one account: indistinguishable by anything but position.
    let expenses: [(i64, &str, i64, i64, i64, &str); 9] = [
        (1, "Metro", 8_412, 1, 1, "2026-03-02"),
        (2, "Metro", 6_120, 1, 1, "2026-03-09"),
        (3, "Landlord", 150_000, 2, 1, "2026-03-01"),
        (4, "Cafe", 450, 3, 2, "2026-03-04"),
        (5, "Cafe", 450, 3, 2, "2026-03-04"),
        (6, "Cafe", 450, 3, 2, "2026-03-04"),
        (7, "Restaurant", 5_230, 3, 2, "2026-03-06"),
        (8, "Metro", 9_999, 1, 3, "2026-03-16"),
        (9, "Landlord", 150_000, 2, 1, "2026-04-01"),
    ];
    for (id, merchant, cents, category, account, date) in expenses {
        conn.execute(
            "INSERT INTO expenses \
             (id, merchant, amount_cents, budget_category_id, account_id, date, source, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'manual', ?7)",
            params![id, merchant, cents, category, account, date, format!("{date} 12:00:00")],
        )?;
    }

    conn.execute(
        "INSERT INTO income_sources (id, name, income_type, created_at, updated_at) \
         VALUES (1, 'Employer', 'employment', ?1, ?1)",
        params![STAMP],
    )?;
    for (id, cents, date) in [
        (1, 410_000, "2026-03-15"),
        (2, 410_000, "2026-04-15"),
        (3, 425_000, "2026-05-15"),
    ] {
        conn.execute(
            "INSERT INTO income_entries \
             (id, source_id, amount_cents, date, month, account_id, created_at, updated_at) \
             VALUES (?1, 1, ?2, ?3, substr(?3, 1, 7), 1, ?4, ?4)",
            params![id, cents, date, format!("{date} 09:00:00")],
        )?;
    }

    // A monthly salary entry the app generated from a recurring template. Every computer generates
    // the same month from the same template, so its identity is derived from `(template, month)`.
    conn.execute(
        "INSERT INTO recurring_income_templates \
         (id, source_id, amount_cents, day_of_month, account_id, is_active, created_at, updated_at) \
         VALUES (1, 1, 410000, 15, 1, 1, ?1, ?1)",
        params![STAMP],
    )?;
    conn.execute(
        "INSERT INTO income_entries \
         (id, source_id, amount_cents, date, month, account_id, recurring_income_template_id, \
          created_at, updated_at) \
         VALUES (4, 1, 410000, '2026-06-15', '2026-06', 1, 1, \
                 '2026-06-15 00:00:01', '2026-06-15 00:00:01')",
        [],
    )?;

    for (id, nickname, make, year) in [(1, "Accord", "Honda", 2014), (2, "GLI", "Volkswagen", 2019)]
    {
        conn.execute(
            "INSERT INTO vehicles (id, nickname, make, year, odometer_km, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, 120000, ?5, ?5)",
            params![id, nickname, make, year, STAMP],
        )?;
    }
    for (id, vehicle, key) in [
        (1, 1, "oil_change"),
        (2, 1, "tire_rotation"),
        (3, 2, "oil_change"),
    ] {
        conn.execute(
            "INSERT INTO maintenance_tasks \
             (id, vehicle_id, task_type_key, interval_km, interval_months, created_at, updated_at) \
             VALUES (?1, ?2, ?3, 8000, 6, ?4, ?4)",
            params![id, vehicle, key, STAMP],
        )?;
    }

    conn.execute(
        "INSERT INTO projects (id, name, target_cents, priority, created_at, updated_at) \
         VALUES (1, 'New roof', 1500000, 0, ?1, ?1)",
        params![STAMP],
    )?;

    for (id, cents, date) in [
        (1, 9_000_000, "2026-03-31"),
        (2, 9_400_000, "2026-04-30"),
        (3, 9_800_000, "2026-05-31"),
    ] {
        conn.execute(
            "INSERT INTO net_worth_snapshots (id, total_cents, snapshot_date, breakdown_json, created_at) \
             VALUES (?1, ?2, ?3, '{}', ?4)",
            params![id, cents, date, format!("{date} 23:59:00")],
        )?;
    }

    Ok(PreSyncRecords {
        budget_groups: 2,
        budget_categories: 3,
        accounts: 4,
        passive_assets: 2,
        expenses: 9,
        income_sources: 1,
        income_entries: 4,
        recurring_income_templates: 1,
        vehicles: 2,
        maintenance_tasks: 3,
        projects: 1,
        net_worth_snapshots: 3,
    })
}

/// How many rows each of `PreSyncRecords`' tables holds right now, in the same order as
/// `per_table`. Raw counts on purpose: a duplicate is a row, whatever identity it carries or lacks,
/// so a comparison keyed by identity (the way the convergence dumps are) cannot see one.
pub(crate) fn count_rows_of_pre_sync_tables(
    conn: &Connection,
) -> Result<Vec<(&'static str, i64)>, AppError> {
    let mut counts = Vec::new();
    for table in [
        "budget_groups",
        "budget_categories",
        "accounts",
        "passive_assets",
        "expenses",
        "income_sources",
        "income_entries",
        "recurring_income_templates",
        "vehicles",
        "maintenance_tasks",
        "projects",
        "net_worth_snapshots",
    ] {
        let rows: i64 =
            conn.query_row(&format!("SELECT COUNT(*) FROM \"{table}\""), [], |row| {
                row.get(0)
            })?;
        counts.push((table, rows));
    }

    Ok(counts)
}

/// The SAME pre-sync records with every row id and every link between them moved, so a test can
/// stand for a second computer that numbered them differently without writing them twice.
pub(crate) fn renumber_pre_sync_records(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch(
        "PRAGMA foreign_keys = OFF;
         UPDATE expenses SET id = id + 100, account_id = account_id + 50,
                             budget_category_id = budget_category_id + 10;
         UPDATE budget_categories SET id = id + 10, group_id = group_id + 20;
         UPDATE budget_groups SET id = id + 20;
         UPDATE income_entries SET id = id + 30, source_id = source_id + 5,
                                   account_id = account_id + 50,
                                   recurring_income_template_id = recurring_income_template_id + 2;
         UPDATE recurring_income_templates SET id = id + 2, source_id = source_id + 5,
                                               account_id = account_id + 50;
         UPDATE income_sources SET id = id + 5;
         UPDATE accounts SET id = id + 50;
         UPDATE maintenance_tasks SET id = id + 7, vehicle_id = vehicle_id + 9;
         UPDATE vehicles SET id = id + 9;
         UPDATE passive_assets SET id = id + 3;
         UPDATE projects SET id = id + 4;
         UPDATE net_worth_snapshots SET id = id + 6;
         PRAGMA foreign_keys = ON;",
    )?;

    let broken: i64 =
        conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })?;
    if broken != 0 {
        return Err(AppError::Database {
            message: format!("renumbering the pre-sync records left {broken} dangling link(s)"),
        });
    }

    Ok(())
}

pub(crate) fn insert_project(conn: &Connection, name: &str) -> Result<i64, AppError> {
    conn.execute(
        "INSERT INTO projects (name, target_cents) VALUES (?1, 100000)",
        params![name],
    )?;

    Ok(conn.last_insert_rowid())
}

/// `(entity_type, entity_id, entity_uuid is set)` of every audit row, oldest first.
pub(crate) fn audit_entries(conn: &Connection) -> Result<Vec<(String, i64, bool)>, AppError> {
    let mut statement = conn.prepare(
        "SELECT entity_type, entity_id, entity_uuid IS NOT NULL FROM audit_log ORDER BY created_at, rowid",
    )?;
    let entries = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(entries)
}

pub(crate) fn set_income_amount(
    conn: &Connection,
    id: i64,
    amount_cents: i64,
) -> Result<usize, AppError> {
    Ok(conn.execute(
        "UPDATE income_entries SET amount_cents = ?1 WHERE id = ?2",
        params![amount_cents, id],
    )?)
}

/// Audit entries from before sync, with distinct creation seconds so each is its own record.
pub(crate) fn seed_pre_sync_audit_entries(conn: &Connection, count: usize) -> Result<(), AppError> {
    for index in 0..count {
        conn.execute(
            "INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, created_at) \
             VALUES ('import', 0, 'create', NULL, '{}', ?1)",
            params![format!("2026-03-15 21:56:{:02}", index)],
        )?;
    }

    Ok(())
}

/// How many audit entries of one type the dataset holds.
pub(crate) fn count_audit_entries_of(conn: &Connection, entity_type: &str) -> Result<i64, AppError> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM audit_log WHERE entity_type = ?1",
        params![entity_type],
        |row| row.get(0),
    )?)
}
