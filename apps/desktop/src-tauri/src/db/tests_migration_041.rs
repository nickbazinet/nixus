//! Migration 041 against a database that already holds 040 rows: `project_id` arrives through
//! `ALTER TABLE ... ADD COLUMN` carrying a `REFERENCES` clause. The upgrade path is the one every
//! existing install takes, so this checks that a category written before the column reads back
//! unlinked, that the foreign key on the added column is genuinely enforced, and that its
//! `ON DELETE SET NULL` actually fires rather than merely being recorded in the schema text.

use rusqlite::Connection;
use tempfile::TempDir;

use crate::db::{open_configured, run_migrations_up_to};

/// The schema as it was before this migration: `budget_categories` with no project column.
const SCHEMA_BEFORE_041: i64 = 40;

/// A database at schema 40 holding a budget group, a category and a project, closed so the next
/// open is a real launch.
fn seeded_pre_041_database() -> (TempDir, std::path::PathBuf) {
    let dir = TempDir::new().expect("temp dir");
    let path = dir.path().join("nixus.db");

    let conn = Connection::open(&path).expect("the database opens");
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .expect("the pragmas apply");
    run_migrations_up_to(&conn, SCHEMA_BEFORE_041).expect("the pre-041 schema applies");

    conn.execute_batch(
        "INSERT INTO budget_groups (id, name, sort_order) VALUES (1, 'Housing', 0);
         INSERT INTO budget_categories (id, group_id, name, target_cents, sort_order)
             VALUES (1, 1, 'Rent', 150000, 0);
         INSERT INTO projects (id, name, target_cents, target_date, priority)
             VALUES (1, 'GLI Summer Tire', 120000, '2027-05-01', 0);",
    )
    .expect("the legacy budget and project seed");

    drop(conn);

    (dir, path)
}

#[test]
fn a_category_written_before_the_column_reads_back_unlinked_with_its_target_intact() {
    let (_dir, path) = seeded_pre_041_database();
    let conn = open_configured(&path).expect("041 runs on open");

    let (name, target_cents, project_id): (String, i64, Option<i64>) = conn
        .query_row(
            "SELECT name, target_cents, project_id FROM budget_categories WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("the new column exists on the pre-existing row");

    assert_eq!(name, "Rent");
    assert_eq!(target_cents, 150_000, "the upgrade must not disturb the target");
    assert_eq!(project_id, None, "an upgraded category starts unlinked");
}

#[test]
fn the_added_foreign_key_is_enforced_and_its_set_null_actually_fires() {
    let (_dir, path) = seeded_pre_041_database();
    let conn = open_configured(&path).expect("041 runs on open");

    conn.execute("UPDATE budget_categories SET project_id = 404 WHERE id = 1", [])
        .expect_err("the foreign key on the added column is enforced");

    conn.execute("UPDATE budget_categories SET project_id = 1 WHERE id = 1", [])
        .expect("a real project links");

    conn.execute("DELETE FROM projects WHERE id = 1", [])
        .expect("deleting the project is allowed rather than restricted");

    let (categories, project_id): (i64, Option<i64>) = conn
        .query_row(
            "SELECT COUNT(*), MAX(project_id) FROM budget_categories",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("the category reads");

    assert_eq!(categories, 1, "the category outlives the project it stood for");
    assert_eq!(
        project_id, None,
        "ON DELETE SET NULL fired on a column added by ALTER TABLE"
    );
}

#[test]
fn the_project_lookup_index_exists() {
    let (_dir, path) = seeded_pre_041_database();
    let conn = open_configured(&path).expect("041 runs on open");

    let indexed: bool = conn
        .query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master
             WHERE type = 'index' AND name = 'idx_budget_categories_project_id'",
            [],
            |row| row.get(0),
        )
        .expect("the index lookup runs");

    assert!(indexed, "the project_id index is created by the migration");
}
