//! Every statement that touches `sync_uuid`, the side table binding a 16-byte row identity to a
//! machine-local integer id (AD-2).
//!
//! It lives in `db/` because that is where this project keeps SQL (project-context rule 1);
//! `sync::identity` decides WHICH uuid a row gets and calls in here to store and read it.

use rusqlite::{Connection, OptionalExtension};

use crate::error::AppError;

/// A row identity: 16 raw bytes, the way `sync_uuid.uuid` and every message carry it.
///
/// Raw bytes rather than `uuid::Uuid` at this boundary so `db/` stays free of the uuid crate and
/// the stored form is the wire form with no conversion in between.
// Story 15 is the first production caller: the capture hook mints an identity for every row it
// sees, and until it exists nothing outside this module's own tests reads `sync_uuid`.
#[allow(dead_code)]
pub type RowUuid = [u8; 16];

/// A binding between an identity and a local row, as it stands in `sync_uuid`.
///
/// Both halves are returned because [`ensure`] can legitimately resolve to a row OTHER than the one
/// the caller asked about: a derived identity already belongs to whichever local row claimed it
/// first (AD-2), and a caller that generated a second local row for the same logical row has to be
/// able to see that rather than be told its own row id back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
// Story 15 is the first production caller.
#[allow(dead_code)]
pub struct Mapping {
    pub uuid: RowUuid,
    pub row_id: i64,
}

/// Binds `uuid` to `(table, row_id)` unless either side is already mapped, and returns the binding
/// that is in force afterwards.
///
/// FIRST-WRITER-WINS on BOTH keys, and that is the load-bearing part:
/// - the row already has an identity -> that identity is returned, not the offered one (minting is
///   lazy, so two call sites can race for one row);
/// - the identity already belongs to another row -> that row is returned (two computers derived the
///   same natural key, and the identity cannot be moved).
///
/// `INSERT OR IGNORE` plus the reads is one statement sequence inside the caller's transaction,
/// which is what makes the returned binding the committed one.
// Story 15 is the first production caller.
#[allow(dead_code)]
pub fn ensure(
    conn: &Connection,
    table: &str,
    row_id: i64,
    uuid: &RowUuid,
) -> Result<Mapping, AppError> {
    // Cached: capture mints one of these per newly seen row, and a 1,000-row import pays for the
    // parse every time otherwise (the AD-19 latency gate measures exactly that).
    let inserted = conn
        .prepare_cached(
            "INSERT OR IGNORE INTO sync_uuid (table_name, row_id, uuid) VALUES (?1, ?2, ?3)",
        )?
        .execute(rusqlite::params![table, row_id, &uuid[..]])?;

    // The row we just wrote IS the binding, so re-reading it would be a second statement per
    // newly captured row to learn what this one already proved (AD-19's latency gate).
    if inserted == 1 {
        return Ok(Mapping {
            uuid: *uuid,
            row_id,
        });
    }

    if let Some(bound) = lookup(conn, table, row_id)? {
        return Ok(Mapping { uuid: bound, row_id });
    }

    if let Some(owner) = row_id_for(conn, table, uuid)? {
        return Ok(Mapping {
            uuid: *uuid,
            row_id: owner,
        });
    }

    Err(AppError::Database {
        message: format!(
            "sync_uuid mapping for {table} disappeared immediately after it was written"
        ),
    })
}

// Story 15 is the first production caller.
#[allow(dead_code)]
pub fn lookup(conn: &Connection, table: &str, row_id: i64) -> Result<Option<RowUuid>, AppError> {
    let found: Option<Vec<u8>> = conn
        .prepare_cached("SELECT uuid FROM sync_uuid WHERE table_name = ?1 AND row_id = ?2")?
        .query_row(rusqlite::params![table, row_id], |row| row.get(0))
        .optional()?;

    found.map(|bytes| sized(table, bytes)).transpose()
}

/// The reverse lookup `sync::apply` does on every message: which local row does this identity name?
///
/// `None` is a legitimate answer and not an error — the row has not been created on this computer
/// yet, which is what AD-11 parks in `sync_pending`.
// Story 15 is the first production caller.
#[allow(dead_code)]
pub fn row_id_for(conn: &Connection, table: &str, uuid: &RowUuid) -> Result<Option<i64>, AppError> {
    Ok(conn
        .query_row(
            "SELECT row_id FROM sync_uuid WHERE table_name = ?1 AND uuid = ?2",
            rusqlite::params![table, &uuid[..]],
            |row| row.get(0),
        )
        .optional()?)
}

/// Drops the mapping of a local row, which AD-2 requires when its tombstone is recorded: data
/// tables use `INTEGER PRIMARY KEY` without `AUTOINCREMENT`, so SQLite may hand the same rowid to a
/// new row, and a surviving mapping would make that new row inherit a deleted row's identity.
// Story 15 is the first production caller.
#[allow(dead_code)]
pub fn forget(conn: &Connection, table: &str, row_id: i64) -> Result<bool, AppError> {
    let removed = conn
        .prepare_cached("DELETE FROM sync_uuid WHERE table_name = ?1 AND row_id = ?2")?
        .execute(rusqlite::params![table, row_id])?;

    Ok(removed > 0)
}

/// The same, addressed by identity: a remote tombstone names the row by uuid, never by an integer
/// id that means nothing on the computer it came from.
// Story 15 is the first production caller.
#[allow(dead_code)]
pub fn forget_uuid(conn: &Connection, table: &str, uuid: &RowUuid) -> Result<bool, AppError> {
    let removed = conn.execute(
        "DELETE FROM sync_uuid WHERE table_name = ?1 AND uuid = ?2",
        rusqlite::params![table, &uuid[..]],
    )?;

    Ok(removed > 0)
}

// Story 15 is the first production caller.
#[allow(dead_code)]
pub fn count(conn: &Connection) -> Result<i64, AppError> {
    Ok(conn.query_row("SELECT COUNT(*) FROM sync_uuid", [], |row| row.get(0))?)
}

/// The schema's `length(uuid) = 16` CHECK means this cannot happen through any supported path, so
/// the conversion is an error rather than a panic: the one way to reach it is a database edited
/// outside the app, and that must surface as a fault, not as a crash.
fn sized(table: &str, bytes: Vec<u8>) -> Result<RowUuid, AppError> {
    RowUuid::try_from(bytes.as_slice()).map_err(|_| AppError::Database {
        message: format!(
            "sync_uuid holds a {}-byte identity for {table}; a row identity is 16 bytes",
            bytes.len()
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_dataset::migrated_dataset;
    use tempfile::TempDir;

    fn dataset() -> (TempDir, Connection) {
        let dir = TempDir::new().expect("temp dir");
        let conn = migrated_dataset(&dir.path().join("nixus.db"));

        (dir, conn)
    }

    const A: RowUuid = [1u8; 16];
    const B: RowUuid = [2u8; 16];

    #[test]
    fn ensure_maps_a_row_once_and_the_first_writer_wins() {
        let (_dir, conn) = dataset();

        assert_eq!(
            ensure(&conn, "accounts", 7, &A).expect("the first mapping"),
            Mapping { uuid: A, row_id: 7 }
        );
        assert_eq!(
            ensure(&conn, "accounts", 7, &B).expect("the second attempt"),
            Mapping { uuid: A, row_id: 7 },
            "a lost race must see the identity that won, not its own"
        );
        assert_eq!(count(&conn).expect("the count reads"), 1);
    }

    /// The other half of first-writer-wins, and the case AD-2's derived identities need: an
    /// identity that already belongs to another local row is reported as belonging to it.
    #[test]
    fn an_identity_already_bound_to_another_row_reports_that_row() {
        let (_dir, conn) = dataset();
        ensure(&conn, "expenses", 1, &A).expect("the first binding");

        assert_eq!(
            ensure(&conn, "expenses", 2, &A).expect("the second binding"),
            Mapping { uuid: A, row_id: 1 },
            "an identity cannot be moved to a second local row"
        );
        assert_eq!(count(&conn).expect("the count reads"), 1);
        assert_eq!(lookup(&conn, "expenses", 2).expect("read"), None);
    }

    #[test]
    fn a_mapping_is_readable_both_ways() {
        let (_dir, conn) = dataset();
        ensure(&conn, "accounts", 7, &A).expect("the mapping");

        assert_eq!(lookup(&conn, "accounts", 7).expect("the lookup"), Some(A));
        assert_eq!(row_id_for(&conn, "accounts", &A).expect("the reverse"), Some(7));
    }

    /// Two tables may legitimately hold the same rowid, and `(table, row_id)` is the key precisely
    /// so that is not a collision.
    #[test]
    fn the_same_row_id_in_two_tables_gets_two_identities() {
        let (_dir, conn) = dataset();

        ensure(&conn, "accounts", 1, &A).expect("the account mapping");
        ensure(&conn, "expenses", 1, &B).expect("the expense mapping");

        assert_eq!(lookup(&conn, "accounts", 1).expect("read"), Some(A));
        assert_eq!(lookup(&conn, "expenses", 1).expect("read"), Some(B));
        assert_eq!(row_id_for(&conn, "accounts", &B).expect("read"), None);
    }

    /// The schema invariant AD-2 leans on: without it, two rows of one table could claim one
    /// identity and a remote field write would have no single subject.
    #[test]
    fn two_rows_of_one_table_cannot_claim_one_identity() {
        let (_dir, conn) = dataset();
        ensure(&conn, "accounts", 1, &A).expect("the first mapping");

        let error = conn
            .execute(
                "INSERT INTO sync_uuid (table_name, row_id, uuid) VALUES ('accounts', 2, ?1)",
                rusqlite::params![&A[..]],
            )
            .expect_err("a duplicate identity must be refused");

        // SQLite names the COLUMNS of a violated UNIQUE index rather than the constraint, unlike
        // a CHECK; the columns are what identifies the rule here.
        assert!(
            error.to_string().contains("sync_uuid.table_name, sync_uuid.uuid"),
            "the identity index must be what refuses it: {error}"
        );
    }

    #[test]
    fn a_short_identity_is_refused_by_the_schema() {
        let (_dir, conn) = dataset();

        let error = conn
            .execute(
                "INSERT INTO sync_uuid (table_name, row_id, uuid) VALUES ('accounts', 1, ?1)",
                rusqlite::params![&[0u8; 15][..]],
            )
            .expect_err("a 15-byte identity must be refused");

        assert!(
            error.to_string().contains("sync_uuid_is_16_bytes"),
            "the named constraint must be what reports it: {error}"
        );
    }

    /// The per-kind column rule Stories 16 and 20 depend on: a counter delta DOES name its column
    /// (`usage_count`), and a tombstone must not name one at all. Both were wrong in the first cut
    /// of the migration, so they are pinned here rather than left to the next story to discover.
    #[test]
    fn the_log_requires_a_column_exactly_for_the_per_column_kinds() {
        let (_dir, conn) = dataset();
        const HLC: &str = "0000000000000001-0a1b2c3d4e5f6071";

        let write = |kind: &str, column: Option<&str>| -> Result<usize, rusqlite::Error> {
            conn.execute(
                "INSERT INTO sync_log (install, hlc, kind, table_name, row_uuid, column_name,
                                       cause_uuid)
                 VALUES ('0a1b2c3d4e5f6071', ?1, ?2, 'accounts', ?3, ?4,
                         CASE ?2 WHEN 'balance_delta' THEN ?3 ELSE NULL END)",
                rusqlite::params![HLC, kind, &A[..], column],
            )
        };

        for (kind, column) in [
            ("field", Some("name")),
            ("counter_delta", Some("usage_count")),
            ("balance_set", None),
            ("balance_delta", None),
            ("tombstone", None),
        ] {
            write(kind, column).unwrap_or_else(|error| panic!("{kind} must be writable: {error}"));
        }

        for (kind, column) in [
            ("counter_delta", None),
            ("field", None),
            ("tombstone", Some("name")),
            ("balance_set", Some("balance_cents")),
        ] {
            let error = write(kind, column)
                .expect_err("the named constraint must refuse this combination");
            assert!(
                error
                    .to_string()
                    .contains("sync_log_names_a_column_only_when_it_has_one"),
                "{kind} with {column:?}: {error}"
            );
        }
    }

    /// AD-11 and CAP-7: a message this build does not understand must still be RECORDABLE, so
    /// `sync_quarantine` deliberately does not close its `kind` set the way every sibling does.
    #[test]
    fn a_kind_from_a_newer_build_can_still_be_quarantined() {
        let (_dir, conn) = dataset();

        conn.execute(
            "INSERT INTO sync_quarantine
                (install, seq, idx, hlc, kind, table_name, row_uuid, reason, schema_version)
             VALUES ('fedcba9876543210', 1, 0, ?1, 'a_kind_from_the_future', 'accounts', ?2,
                     'unknown_schema', 99)",
            rusqlite::params!["0".repeat(33), &A[..]],
        )
        .expect("an unknown kind must be recordable, not refused");

        let error = conn
            .execute(
                "INSERT INTO sync_pending
                    (install, seq, idx, hlc, kind, table_name, row_uuid,
                     waiting_on_table, waiting_on_uuid)
                 VALUES ('fedcba9876543210', 2, 0, ?1, 'a_kind_from_the_future', 'accounts', ?2,
                         'accounts', ?2)",
                rusqlite::params!["0".repeat(33), &A[..]],
            )
            .expect_err("a PARKED message must be one this build can apply once its parent lands");
        assert!(
            error.to_string().contains("sync_pending_kind_is_known"),
            "{error}"
        );
    }

    /// AD-2's rowid-reuse guard: forgetting the mapping is what makes a re-insert a NEW identity
    /// rather than a resurrection of the deleted row.
    #[test]
    fn forgetting_a_mapping_frees_the_row_id_for_a_new_identity() {
        let (_dir, conn) = dataset();
        ensure(&conn, "accounts", 7, &A).expect("the mapping");

        assert!(forget(&conn, "accounts", 7).expect("the delete"));
        assert!(!forget(&conn, "accounts", 7).expect("an idempotent repeat"));
        assert_eq!(lookup(&conn, "accounts", 7).expect("read"), None);

        assert_eq!(
            ensure(&conn, "accounts", 7, &B).expect("a reused row id"),
            Mapping { uuid: B, row_id: 7 }
        );
    }

    #[test]
    fn forgetting_by_identity_removes_the_same_mapping() {
        let (_dir, conn) = dataset();
        ensure(&conn, "accounts", 7, &A).expect("the mapping");

        assert!(forget_uuid(&conn, "accounts", &A).expect("the delete"));
        assert!(!forget_uuid(&conn, "accounts", &A).expect("an idempotent repeat"));
        assert_eq!(row_id_for(&conn, "accounts", &A).expect("read"), None);
    }

    /// A mapping written by a rolled-back transaction must not survive it: capture mints identities
    /// inside the write transaction (AD-3), so a rolled-back insert must leave no identity behind
    /// for the rowid SQLite will hand out again.
    #[test]
    fn a_mapping_minted_in_a_rolled_back_transaction_does_not_survive() {
        let (_dir, conn) = dataset();

        let tx = conn.unchecked_transaction().expect("the transaction opens");
        ensure(&tx, "accounts", 7, &A).expect("the mapping");
        tx.rollback().expect("the rollback runs");

        assert_eq!(lookup(&conn, "accounts", 7).expect("read"), None);
        assert_eq!(count(&conn).expect("the count reads"), 0);
    }
}
