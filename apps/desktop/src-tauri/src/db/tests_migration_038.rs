//! Migration 038 against a database that already holds 037 rows: the three presentation columns
//! are added by `ALTER TABLE ... ADD COLUMN`, so this is also where the empirical question gets
//! answered — whether the bundled SQLite accepts a column-level CHECK on an added column, and
//! whether existing rows come out of it with the documented defaults.

use rusqlite::Connection;
use tempfile::TempDir;

use crate::db::{open_configured, run_migrations_up_to};

/// The schema as it was before this migration: `home_widgets` without any presentation column.
const SCHEMA_BEFORE_038: i64 = 37;

/// A database at schema 37 holding two widgets, closed so the next open is a real launch.
fn seeded_pre_038_database() -> (TempDir, std::path::PathBuf) {
    let dir = TempDir::new().expect("temp dir");
    let path = dir.path().join("nixus.db");

    let conn = Connection::open(&path).expect("the database opens");
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .expect("the pragmas apply");
    run_migrations_up_to(&conn, SCHEMA_BEFORE_038).expect("the pre-038 schema applies");

    for (key, position, title) in [
        ("w_aaaa0000aaaa", 1, "Net Worth"),
        ("w_bbbb1111bbbb", 2, "Spend"),
    ] {
        conn.execute(
            "INSERT INTO home_widgets (widget_key, position, spec_json) VALUES (?1, ?2, ?3)",
            rusqlite::params![
                key,
                position,
                format!(
                    r#"{{"component":"LineChart","title":"{title}","dataBinding":{{"source":"net_worth_history"}}}}"#
                )
            ],
        )
        .expect("the legacy widget seeds");
    }

    drop(conn);

    (dir, path)
}

#[test]
fn the_presentation_columns_land_on_rows_that_predate_them() {
    let (_dir, path) = seeded_pre_038_database();
    let conn = open_configured(&path).expect("038 runs on open");

    let mut statement = conn
        .prepare(
            "SELECT widget_key, title_override, span, accent FROM home_widgets
             ORDER BY position",
        )
        .expect("the new columns exist");
    let rows: Vec<(String, Option<String>, i64, Option<i64>)> = statement
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })
        .expect("the rows read")
        .collect::<Result<_, _>>()
        .expect("the rows collect");

    assert_eq!(
        rows,
        vec![
            ("w_aaaa0000aaaa".to_string(), None, 1, None),
            ("w_bbbb1111bbbb".to_string(), None, 1, None),
        ],
        "a widget written before 038 reads back as half width with no override and no accent"
    );
}

/// The migration's own header claims the CHECKs are there; this is what makes that claim testable
/// rather than a comment nobody re-verified.
#[test]
fn the_added_columns_carry_their_named_range_checks() {
    let (_dir, path) = seeded_pre_038_database();
    let conn = open_configured(&path).expect("038 runs on open");

    let schema: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'home_widgets'",
            [],
            |row| row.get(0),
        )
        .expect("the table definition reads");
    assert!(schema.contains("home_widgets_span_range"), "{schema}");
    assert!(schema.contains("home_widgets_accent_range"), "{schema}");

    for bad_span in [0_i64, 3, -1] {
        conn.execute(
            "UPDATE home_widgets SET span = ?1 WHERE widget_key = 'w_aaaa0000aaaa'",
            rusqlite::params![bad_span],
        )
        .expect_err("SQLite refuses a span outside the grid");
    }
    for bad_accent in [-1_i64, 8] {
        conn.execute(
            "UPDATE home_widgets SET accent = ?1 WHERE widget_key = 'w_aaaa0000aaaa'",
            rusqlite::params![bad_accent],
        )
        .expect_err("SQLite refuses an accent outside the ramp");
    }

    conn.execute(
        "UPDATE home_widgets SET span = 2, accent = 7 WHERE widget_key = 'w_aaaa0000aaaa'",
        [],
    )
    .expect("the edges of both ranges are accepted");
}
