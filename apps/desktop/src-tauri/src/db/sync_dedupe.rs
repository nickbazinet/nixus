//! The SQL the duplicate repair (`sync::dedupe`) reads and writes with.
//!
//! WHY it lives in `db/`: it is raw SQL, and raw SQL belongs here (project-context rule 1).
//! `sync::dedupe` owns every decision about which records are one record held twice; this module
//! owns nothing but the statements.
//!
//! Table and column names are the `&'static str` of `sync::registry` and never input, which is what
//! makes the formatted statements safe (a table name cannot be bound as a parameter).

use rusqlite::{params, Connection};

use crate::error::AppError;

/// Every row of a table that has an identity, with it, in row order.
pub fn identified_rows(conn: &Connection, table: &str) -> Result<Vec<(i64, Vec<u8>)>, AppError> {
    let mut statement = conn.prepare_cached(
        "SELECT row_id, uuid FROM sync_uuid WHERE table_name = ?1 ORDER BY row_id",
    )?;
    let rows = statement
        .query_map(params![table], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

// CAPTURE-SANCTIONED (AD-3): its only caller is `sync::dedupe::remove`, inside the one
// `ActiveDataset::write` that also deletes the duplicates, so the change travels like any other.
//
/// Points one child row's foreign key at a different parent row.
pub fn point_child_at(
    conn: &Connection,
    child_table: &'static str,
    child_column: &'static str,
    child_row_id: i64,
    parent_row_id: i64,
) -> Result<(), AppError> {
    conn.prepare_cached(&format!(
        "UPDATE {child_table} SET {child_column} = ?1 WHERE _rowid_ = ?2"
    ))?
    .execute(params![parent_row_id, child_row_id])?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{capture_fixtures as fixtures, sync_identity, test_dataset};
    use tempfile::TempDir;

    #[test]
    fn identified_rows_are_one_tables_mappings_in_row_order() {
        let dir = TempDir::new().expect("temp dir");
        let conn = test_dataset::migrated_dataset(&dir.path().join("nixus.db"));

        sync_identity::ensure(&conn, "accounts", 9, &[0x01; 16]).expect("a mapping");
        sync_identity::ensure(&conn, "accounts", 3, &[0x02; 16]).expect("a mapping");
        sync_identity::ensure(&conn, "projects", 1, &[0x03; 16]).expect("another table");

        assert_eq!(
            identified_rows(&conn, "accounts").expect("the rows read"),
            vec![(3, vec![0x02; 16]), (9, vec![0x01; 16])]
        );
    }

    #[test]
    fn a_child_can_be_pointed_at_another_parent() {
        let dir = TempDir::new().expect("temp dir");
        let conn = test_dataset::migrated_dataset(&dir.path().join("nixus.db"));
        let one = fixtures::insert_budget_group(&conn, "One", 0).expect("a group");
        let two = fixtures::insert_budget_group(&conn, "Two", 1).expect("a group");
        let category = fixtures::insert_budget_category(&conn, one, "Food").expect("a category");

        point_child_at(&conn, "budget_categories", "group_id", category, two).expect("it moves");

        let group: i64 = conn
            .query_row(
                "SELECT group_id FROM budget_categories WHERE id = ?1",
                [category],
                |row| row.get(0),
            )
            .expect("the link reads");
        assert_eq!(group, two);
    }
}
