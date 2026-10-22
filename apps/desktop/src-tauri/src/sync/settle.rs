//! The settle pass: every record that predates sync gets its identity BEFORE the first remote
//! message is applied or the first snapshot is built.
//!
//! Identities for those records are derived (`adopt`), not minted, so WHEN a computer settles does
//! not change WHAT it settles to — but it still has to happen first. A remote message that names an
//! identity this computer has not bound to its own copy of the record creates a second row for it,
//! and from then on the two cannot be told apart by anything except their history. Settling before
//! applying is what turns "the other computer sent me my own record" into an update instead of an
//! insert, and it is the whole of what makes joining an existing account safe for a computer that
//! already holds records.
//!
//! The same ordering applies to a snapshot: one built before the settle pass publishes rows that
//! have no identity, and whoever restores it has to settle them on its own. That works (it derives
//! the same identities) but it needlessly relies on the restoring computer doing so first.
//!
//! It is deliberately NOT reconcile. Reconcile describes records to other computers (it emits
//! messages, one bounded chunk per tick, over minutes); settle only decides which record each row
//! is. That is a few statements per row, no messages and nothing to ship, so it can run to
//! completion before the first apply without delaying anything the user can see. A dataset whose
//! every row already has an identity — which is every dataset that has ever been captured from its
//! first row — costs one scan and adopts nothing.

use rusqlite::Connection;

use crate::db::sync_apply as apply_db;
use crate::db::sync_identity;
use crate::db::sync_reconcile as reconcile_db;
use crate::error::AppError;

use super::adopt;
use super::reconcile::{self, ROWS_PER_CHUNK};
use super::registry::{self, MergeKind};

/// Where a pass has got to, so a chunk can stop anywhere and the next one resumes.
#[derive(Debug, Default)]
pub(crate) struct Cursor {
    table: usize,
    after_row_id: i64,
    done: bool,
    /// Owned by the pass and dropped with it: see [`adopt::Ordinals`].
    ordinals: adopt::Ordinals,
}

impl Cursor {
    pub(crate) fn done(&self) -> bool {
        self.done
    }
}

/// Counts only (AD-16): no value of any record is reported.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct SettleReport {
    /// Records that were given an identity.
    pub adopted: usize,
    /// Rows that stay without one: a setting that describes this computer, or a record whose parent
    /// cannot be named. Reconcile owns them from here.
    pub skipped: usize,
}

impl SettleReport {
    fn add(&mut self, other: SettleReport) {
        self.adopted += other.adopted;
        self.skipped += other.skipped;
    }
}

/// One bounded chunk of the pass, in ONE transaction (AD-16: short, and one per chunk).
///
/// Tables are visited in the registry's fixed order and the rows of each in local row order, which
/// is what numbers identical records the same way on every computer (`adopt`). A parent that has
/// not been reached yet is adopted when its first child asks for it, so the order of TABLES is not
/// load-bearing; the order of ROWS within a table is.
pub(crate) fn step(conn: &Connection, cursor: &mut Cursor) -> Result<SettleReport, AppError> {
    if cursor.done {
        return Ok(SettleReport::default());
    }

    let tables = reconcile::travelling();
    let Some(rule) = tables.get(cursor.table).copied() else {
        cursor.done = true;
        return Ok(SettleReport::default());
    };

    // Taken out of the cursor for the chunk and put back only if the chunk committed: a rolled-back
    // chunk must not leave the hints ahead of the database. A failed pass is dropped by its caller
    // and begins again from a fresh cursor, so the empty hints it leaves behind are never read.
    let mut ordinals = std::mem::take(&mut cursor.ordinals);
    let (mut table, mut after_row_id) = (cursor.table, cursor.after_row_id);

    let report = reconcile::in_transaction(conn, |conn| {
        let ids = reconcile_db::unmapped_row_ids(conn, rule.table, after_row_id, ROWS_PER_CHUNK)?;
        let before = sync_identity::count(conn)?;
        let mut report = SettleReport::default();

        for row_id in &ids {
            after_row_id = *row_id;
            report.add(settle_row(conn, rule, *row_id, &mut ordinals)?);
        }

        // Counted from the table and not from the rows visited: a parent is adopted the moment its
        // first child asks for it, so a row can be settled without this loop ever reaching it.
        report.adopted = usize::try_from(sync_identity::count(conn)? - before).unwrap_or(0);

        if ids.len() < ROWS_PER_CHUNK {
            table += 1;
            after_row_id = 0;
        }

        Ok(report)
    })?;

    cursor.ordinals = ordinals;
    cursor.table = table;
    cursor.after_row_id = after_row_id;
    if cursor.table >= tables.len() {
        cursor.done = true;
    }

    Ok(report)
}

fn settle_row(
    conn: &Connection,
    rule: &'static registry::TableRule,
    row_id: i64,
    ordinals: &mut adopt::Ordinals,
) -> Result<SettleReport, AppError> {
    // A plain surrogate table is the overwhelming majority of rows (every audit entry, chat message
    // and snapshot) and nothing about such a row can make it local-only or natural-keyed, so it goes
    // straight to its creation facts instead of reading the whole row first. So does a table whose
    // rows could be template-generated but whose rows keep no reference to a template (expenses).
    let by_facts = match rule.identity {
        Some(registry::RowIdentity::Surrogate) => true,
        Some(registry::RowIdentity::SurrogateOrTemplate) => {
            !reconcile::can_derive_from_template(rule.table)
        }
        _ => false,
    };
    if by_facts {
        return Ok(
            match adopt::legacy_identity(conn, rule.table, row_id, None, Some(ordinals))? {
                Some(_) => SettleReport::default(),
                None => SettleReport {
                    adopted: 0,
                    skipped: 1,
                },
            },
        );
    }

    let columns: Vec<&'static str> = registry::columns_of(rule.table)
        .filter(|column| !matches!(column.merge, MergeKind::Excluded))
        .map(|column| column.column)
        .collect();
    let values = apply_db::read_columns(conn, rule.table, row_id, &columns)?;

    // Gone between the id scan and this read, or a setting that describes THIS computer (AD-5's
    // deny list): neither may acquire an identity.
    if values.is_empty() || reconcile::row_is_local_only(rule.table, &values) {
        return Ok(SettleReport {
            adopted: 0,
            skipped: 1,
        });
    }

    Ok(
        match reconcile::identity_for(conn, rule.table, row_id, &values)? {
            Some(_) => SettleReport::default(),
            None => SettleReport {
                adopted: 0,
                skipped: 1,
            },
        },
    )
}

/// A whole pass, for tests: production runs it from the actor one chunk at a time between
/// yields, so the write lock is never held for a whole scan.
#[cfg(test)]
pub(crate) fn settle_all(conn: &Connection) -> Result<SettleReport, AppError> {
    let mut cursor = Cursor::default();
    let mut report = SettleReport::default();

    for _ in 0..(reconcile::travelling().len() + 2) * 1_000 {
        if cursor.done() {
            break;
        }
        report.add(step(conn, &mut cursor)?);
    }

    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::capture_fixtures as fixtures;
    use crate::db::test_dataset::migrated_dataset;
    use tempfile::TempDir;

    fn dataset() -> (TempDir, Connection) {
        let dir = TempDir::new().expect("temp dir");
        let conn = migrated_dataset(&dir.path().join("nixus.db"));

        (dir, conn)
    }

    fn rows_without_identity(conn: &Connection) -> i64 {
        let mut missing = 0;
        for rule in reconcile::travelling() {
            missing += reconcile_db::unmapped_row_ids(conn, rule.table, 0, usize::MAX >> 1)
                .expect("the scan reads")
                .len() as i64;
        }

        missing
    }

    #[test]
    fn a_pass_gives_every_record_that_predates_sync_an_identity() {
        let (_dir, conn) = dataset();
        let shape = fixtures::seed_pre_sync_records(&conn).expect("the records seed");
        let seeded: i64 = shape.per_table().iter().map(|(_, rows)| rows).sum();
        assert_eq!(
            rows_without_identity(&conn),
            seeded,
            "the fixture predates sync"
        );

        let report = settle_all(&conn).expect("the pass runs");

        assert_eq!(
            rows_without_identity(&conn),
            0,
            "nothing is left without an identity"
        );
        assert_eq!(report.adopted as i64, seeded);
        assert_eq!(
            sync_identity::count(&conn).expect("the count reads"),
            seeded
        );
    }

    #[test]
    fn a_second_pass_adopts_nothing() {
        let (_dir, conn) = dataset();
        fixtures::seed_pre_sync_records(&conn).expect("the records seed");
        settle_all(&conn).expect("the first pass runs");

        let again = settle_all(&conn).expect("the second pass runs");

        assert_eq!(
            again.adopted, 0,
            "a settled dataset is a scan and nothing else"
        );
    }

    /// The decentralisation claim at the level of a whole dataset: two computers that numbered the
    /// same records differently settle to the SAME set of identities.
    #[test]
    fn two_computers_holding_the_same_records_settle_to_the_same_identities() {
        let (_one_dir, one) = dataset();
        let (_two_dir, two) = dataset();
        fixtures::seed_pre_sync_records(&one).expect("the records seed");
        fixtures::seed_pre_sync_records(&two).expect("the records seed");
        // The same records, every row id and link moved: what a computer that imported them in a
        // different order looks like.
        fixtures::renumber_pre_sync_records(&two).expect("the rows are renumbered");

        settle_all(&one).expect("the first computer settles");
        settle_all(&two).expect("the second computer settles");

        let identities = |conn: &Connection| -> Vec<(String, Vec<u8>)> {
            let mut rows = conn
                .prepare("SELECT table_name, uuid FROM sync_uuid")
                .expect("prepares")
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .expect("reads")
                .collect::<Result<Vec<_>, _>>()
                .expect("collects");
            rows.sort();
            rows
        };

        assert_eq!(identities(&one), identities(&two));
    }

    /// A setting that describes this computer must never acquire an identity (AD-5).
    #[test]
    fn a_setting_that_describes_this_computer_stays_without_one() {
        let (_dir, conn) = dataset();
        fixtures::set_config_directly(&conn, "ai_provider", "bedrock").expect("a local-only key");
        fixtures::set_config_directly(&conn, "theme", "dark").expect("a synced key");

        let report = settle_all(&conn).expect("the pass runs");

        assert_eq!(report.adopted, 1, "only the synced setting is adopted");
        assert_eq!(report.skipped, 1, "the credential-state key is left alone");
        assert_eq!(sync_identity::count(&conn).expect("the count reads"), 1);
    }

    /// A person can have a great many records with identical facts (a bulk action that audits the
    /// same thing a thousand times in one second). Numbering them must cost one probe each, not one
    /// per record already numbered: two thousand of them once took half a minute.
    #[test]
    fn a_large_class_of_identical_records_is_numbered_in_linear_work() {
        let (_dir, conn) = dataset();
        conn.execute_batch("BEGIN").expect("a transaction opens");
        for _ in 0..1_500 {
            conn.execute(
                "INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value, created_at) \
                 VALUES ('import', 0, 'create', NULL, '{}', '2026-03-15 21:56:07')",
                [],
            )
            .expect("an audit entry inserts");
        }
        conn.execute_batch("COMMIT").expect("the entries commit");

        let mut cursor = Cursor::default();
        while !cursor.done() {
            step(&conn, &mut cursor).expect("a chunk runs");
        }

        assert_eq!(sync_identity::count(&conn).expect("the count reads"), 1_500);
        assert!(
            cursor.ordinals.probes <= 2 * 1_500,
            "{} probes for 1,500 identical records is not linear",
            cursor.ordinals.probes
        );
        let distinct: i64 = conn
            .query_row("SELECT COUNT(DISTINCT uuid) FROM sync_uuid", [], |row| {
                row.get(0)
            })
            .expect("the count reads");
        assert_eq!(
            distinct, 1_500,
            "identical records are still distinct records"
        );
    }

    #[test]
    fn the_pass_is_bounded_and_resumable() {
        let (_dir, conn) = dataset();
        for index in 0..(ROWS_PER_CHUNK + 20) {
            fixtures::insert_budget_group(&conn, &format!("group {index}"), index as i64)
                .expect("a group inserts");
        }

        let mut cursor = Cursor::default();
        let mut steps = 0;
        let mut adopted = 0;
        while !cursor.done() {
            let report = step(&conn, &mut cursor).expect("a chunk runs");
            assert!(
                report.adopted <= ROWS_PER_CHUNK,
                "a chunk never reads past its bound"
            );
            adopted += report.adopted;
            steps += 1;
        }

        assert_eq!(adopted, ROWS_PER_CHUNK + 20);
        assert!(
            steps > reconcile::travelling().len(),
            "a table larger than one chunk takes more than one step"
        );
    }
}
