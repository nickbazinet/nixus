//! The SQL reconcile scans with (AD-3): which rows a travelling table holds, and which identities
//! name a row that is no longer there.
//!
//! WHY it lives in `db/`: it is raw SQL, and raw SQL belongs here (project-context rule 1).
//! `sync::reconcile` owns every decision about what a difference MEANS; this module owns nothing
//! but the statements that find them.
//!
//! Every statement is KEYED AND BOUNDED — `_rowid_ > ?` / `uuid > ?` with a `LIMIT` — because AD-16
//! forbids a scan that blocks the UI: reconcile reads one chunk per tick and resumes from the last
//! key it saw rather than re-reading the table.
//!
//! Table and column names are the `&'static str` of `sync::registry` and never input, which is what
//! makes the formatted statements safe (the same rule `db::sync_apply` follows — a table name
//! cannot be bound as a parameter).

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppError;

/// The local ids of up to `limit` rows after `after`, in rowid order.
pub fn live_row_ids(
    conn: &Connection,
    table: &'static str,
    after: i64,
    limit: usize,
) -> Result<Vec<i64>, AppError> {
    let mut statement = conn.prepare_cached(&format!(
        "SELECT _rowid_ FROM {table} WHERE _rowid_ > ?1 ORDER BY _rowid_ LIMIT ?2"
    ))?;
    let ids = statement
        .query_map(params![after, limit as i64], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(ids)
}

/// The local ids of up to `limit` rows after `after` that have NO identity yet, in rowid order.
///
/// The rows a record predating sync leaves behind: nothing ever bound a `sync_uuid` to them. Keyed
/// and bounded like the scan above, so the settle pass that reads it can stop anywhere and resume.
pub fn unmapped_row_ids(
    conn: &Connection,
    table: &'static str,
    after: i64,
    limit: usize,
) -> Result<Vec<i64>, AppError> {
    let mut statement = conn.prepare_cached(&format!(
        "SELECT t._rowid_ FROM {table} t \
         WHERE t._rowid_ > ?1 \
           AND NOT EXISTS (SELECT 1 FROM sync_uuid u \
                           WHERE u.table_name = ?2 AND u.row_id = t._rowid_) \
         ORDER BY t._rowid_ LIMIT ?3"
    ))?;
    let ids = statement
        .query_map(params![after, table, limit as i64], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(ids)
}

/// Up to `limit` identity mappings of one table after `after`, in uuid order.
///
/// Ordered by uuid rather than by `row_id` so the cursor is stable while reconcile DELETES the
/// mappings of rows it finds missing: the keys it has already passed are the ones it removes.
pub fn mapped_rows(
    conn: &Connection,
    table: &str,
    after: &[u8],
    limit: usize,
) -> Result<Vec<(Vec<u8>, i64)>, AppError> {
    let mut statement = conn.prepare_cached(
        "SELECT uuid, row_id FROM sync_uuid \
         WHERE table_name = ?1 AND uuid > ?2 ORDER BY uuid LIMIT ?3",
    )?;
    let rows = statement
        .query_map(params![table, after, limit as i64], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

/// Whether the row an identity names is still there.
pub fn row_exists(
    conn: &Connection,
    table: &'static str,
    row_id: i64,
) -> Result<bool, AppError> {
    Ok(conn
        .prepare_cached(&format!("SELECT 1 FROM {table} WHERE _rowid_ = ?1"))?
        .query_row([row_id], |_| Ok(()))
        .optional()?
        .is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{capture_fixtures as fixtures, test_dataset};
    use tempfile::TempDir;

    #[test]
    fn the_scan_is_keyed_bounded_and_resumable() {
        let dir = TempDir::new().expect("temp dir");
        let conn = test_dataset::migrated_dataset(&dir.path().join("nixus.db"));

        for index in 0..5 {
            fixtures::insert_budget_group(&conn, &format!("group {index}"), index)
                .expect("a group inserts");
        }

        let first = live_row_ids(&conn, "budget_groups", 0, 2).expect("the scan reads");
        assert_eq!(first, vec![1, 2], "bounded by the limit, in rowid order");

        let rest = live_row_ids(&conn, "budget_groups", 2, 100).expect("the scan reads");
        assert_eq!(rest, vec![3, 4, 5], "resumes after the last key it saw");
        assert!(live_row_ids(&conn, "budget_groups", 5, 100)
            .expect("the scan reads")
            .is_empty());

        assert!(row_exists(&conn, "budget_groups", 3).expect("the probe reads"));
        assert!(!row_exists(&conn, "budget_groups", 99).expect("the probe reads"));
    }

    #[test]
    fn the_unmapped_scan_finds_only_rows_without_an_identity_and_resumes() {
        let dir = TempDir::new().expect("temp dir");
        let conn = test_dataset::migrated_dataset(&dir.path().join("nixus.db"));

        for index in 0..5 {
            fixtures::insert_budget_group(&conn, &format!("group {index}"), index)
                .expect("a group inserts");
        }
        crate::db::sync_identity::ensure(&conn, "budget_groups", 2, &[0x11; 16])
            .expect("row 2 is mapped");
        // The same row id in ANOTHER table must not hide an unmapped row here.
        crate::db::sync_identity::ensure(&conn, "accounts", 4, &[0x22; 16])
            .expect("an unrelated mapping");

        assert_eq!(
            unmapped_row_ids(&conn, "budget_groups", 0, 100).expect("the scan reads"),
            vec![1, 3, 4, 5]
        );
        assert_eq!(
            unmapped_row_ids(&conn, "budget_groups", 3, 1).expect("the scan reads"),
            vec![4],
            "bounded by the limit and resumed after the last key it saw"
        );
    }

    #[test]
    fn the_mapping_scan_is_ordered_by_uuid_and_scoped_to_one_table() {
        let dir = TempDir::new().expect("temp dir");
        let conn = test_dataset::migrated_dataset(&dir.path().join("nixus.db"));

        for (table, row_id, uuid) in [
            ("budget_groups", 7_i64, [0x22u8; 16]),
            ("budget_groups", 8, [0x11; 16]),
            ("accounts", 9, [0x33; 16]),
        ] {
            crate::db::sync_identity::ensure(&conn, table, row_id, &uuid)
                .expect("the mapping binds");
        }

        let groups = mapped_rows(&conn, "budget_groups", &[], 100).expect("the scan reads");
        assert_eq!(
            groups,
            vec![(vec![0x11; 16], 8), (vec![0x22; 16], 7)],
            "uuid order, and only this table's mappings"
        );
        assert_eq!(
            mapped_rows(&conn, "budget_groups", &[0x11; 16], 100).expect("the scan reads"),
            vec![(vec![0x22; 16], 7)]
        );
    }
}
