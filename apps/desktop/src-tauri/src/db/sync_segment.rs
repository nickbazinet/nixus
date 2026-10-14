//! The SQL the segment cutter reads and the shipping mark it writes (AD-6).
//!
//! WHY it lives in `db/`: it is raw SQL, and raw SQL belongs here (project-context rule 1).
//! `sync::segment` owns every decision about what a segment IS — its seq, its encoding, its key —
//! and this module owns nothing but the statements that read the unshipped tail and record that a
//! batch has been shipped.
//!
//! The read side is deliberately a PURE FUNCTION of the stored rows: the next `seq` is derived from
//! the log and the batch is the lowest unshipped ids in id order. That is what makes a re-cut after
//! a crash mid-upload produce the same seq and the same bytes, so the create-only PUT dedups
//! instead of minting a second segment (AD-6).

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppError;

/// One unshipped `sync_log` row, in the shape migration 032 defines.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnshippedMessage {
    /// The `sync_log` rowid, which is what [`mark_shipped`] addresses.
    pub id: i64,
    /// Story 13's frozen 33-character encoding.
    pub hlc: String,
    /// One of the five kinds migration 032 closes by CHECK.
    pub kind: String,
    pub table_name: String,
    pub row_uuid: Vec<u8>,
    pub column_name: Option<String>,
    pub cause_uuid: Option<Vec<u8>>,
    pub payload: Option<Vec<u8>>,
}

/// The `seq` the next segment of `install` gets: one past the highest this install ever shipped.
///
/// Derived rather than counted or stored: a counter in a side table could disagree with the log
/// after a crash, and `MAX(seq)` cannot. Starts at 0 for an install that has shipped nothing.
pub fn next_seq(conn: &Connection, install: &str) -> Result<i64, AppError> {
    Ok(conn.query_row(
        "SELECT COALESCE(MAX(seq) + 1, 0) FROM sync_log WHERE install = ?1 AND seq IS NOT NULL",
        params![install],
        |row| row.get(0),
    )?)
}

/// The lowest `limit` unshipped messages of `install`, in id order.
///
/// `ORDER BY id` is the causal order capture wrote them in, and the partial
/// `idx_sync_log_unshipped` index serves the `seq IS NULL` predicate, so this is one index walk
/// over the tail rather than a scan of the log.
pub fn unshipped(
    conn: &Connection,
    install: &str,
    limit: usize,
) -> Result<Vec<UnshippedMessage>, AppError> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, hlc, kind, table_name, row_uuid, column_name, cause_uuid, payload \
         FROM sync_log WHERE seq IS NULL AND install = ?1 ORDER BY id LIMIT ?2",
    )?;

    let rows = stmt
        .query_map(params![install, limit as i64], |row| {
            Ok(UnshippedMessage {
                id: row.get(0)?,
                hlc: row.get(1)?,
                kind: row.get(2)?,
                table_name: row.get(3)?,
                row_uuid: row.get(4)?,
                column_name: row.get(5)?,
                cause_uuid: row.get(6)?,
                payload: row.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

/// How many messages of `install` are still unshipped.
///
/// `#[cfg(test)]`: production's change signal is `sync::segment::cut` answering `None`, which reads
/// the same partial index and would otherwise be asked the same question twice.
#[cfg(test)]
pub(crate) fn unshipped_count(conn: &Connection, install: &str) -> Result<i64, AppError> {
    Ok(conn.query_row(
        "SELECT COUNT(*) FROM sync_log WHERE seq IS NULL AND install = ?1",
        params![install],
        |row| row.get(0),
    )?)
}

/// Records that the rows of one cut segment have been shipped, as one transaction.
///
/// Atomic on purpose: `sync_log`'s `UNIQUE (install, seq, idx)` is what keeps AD-4's message id
/// unique, and a half-written assignment would leave a segment whose bytes claim positions the log
/// does not. Either every row of the segment carries its `(seq, idx)` or none does.
pub fn mark_shipped(
    conn: &Connection,
    seq: i64,
    assignments: &[(i64, i64)],
) -> Result<usize, AppError> {
    if assignments.is_empty() {
        return Ok(0);
    }

    let grouped = super::grouped(conn)?;
    let mut marked = 0;

    {
        let mut stmt = grouped
            .prepare_cached("UPDATE sync_log SET seq = ?1, idx = ?2 WHERE id = ?3 AND seq IS NULL")?;
        for (id, idx) in assignments {
            marked += stmt.execute(params![seq, idx, id])?;
        }
    }

    grouped.commit()?;

    Ok(marked)
}

/// The highest contiguous segment `seq` this computer has APPLIED for `install`, if any (AD-11).
///
/// Read-only here: only the apply path (Story 20) advances the vector, and it does so in the same
/// transaction as the data. The fetch side reads it once per install to know where to resume, so a
/// relaunch does not re-download what has already been written into the tables.
pub fn applied_seq(conn: &Connection, install: &str) -> Result<Option<i64>, AppError> {
    Ok(conn
        .query_row(
            "SELECT seq FROM sync_applied_vector WHERE install = ?1",
            params![install],
            |row| row.get(0),
        )
        .optional()?)
}

/// Appends `count` ordinary `field` messages for `install`, for the tests that measure how a large
/// backlog is cut. Raw SQL rather than real captured writes on purpose: what is under test is the
/// CUTTER's bounding, and 5,000 real transactions would measure SQLite instead.
#[cfg(test)]
pub(crate) fn seed_log_messages(conn: &Connection, install: &str, count: usize) {
    seed_log_messages_sized(conn, install, count, 4);
}

/// The same, with a stated payload size, for the tests that measure AD-18's byte cap: the cutter
/// has to split on bytes before it reaches the message count, and only a wide payload gets there.
#[cfg(test)]
pub(crate) fn seed_log_messages_sized(
    conn: &Connection,
    install: &str,
    count: usize,
    payload_bytes: usize,
) {
    let mut stmt = conn
        .prepare(
            "INSERT INTO sync_log (install, hlc, kind, table_name, row_uuid, column_name, payload) \
             VALUES (?1, ?2, 'field', 'budget_groups', ?3, '*', ?4)",
        )
        .expect("the statement prepares");

    for index in 0..count {
        let uuid: Vec<u8> = (0..16u8).map(|byte| byte ^ (index as u8)).collect();
        stmt.execute(params![
            install,
            format!("{:016x}-{install}", index as u64 + 1),
            uuid,
            vec![3u8; payload_bytes.max(1)],
        ])
        .expect("the message inserts");
    }
}

/// Every `(id, seq, idx)` the log holds for shipped messages, in id order. Tests read the
/// assignment back; production never needs it.
#[cfg(test)]
pub(crate) fn shipped_positions(conn: &Connection) -> Result<Vec<(i64, i64, i64)>, AppError> {
    let mut stmt = conn
        .prepare("SELECT id, seq, idx FROM sync_log WHERE seq IS NOT NULL ORDER BY seq, idx")?;

    let rows = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_dataset::migrated_dataset;

    const INSTALL: &str = "0123456789abcdef";
    const OTHER: &str = "fedcba9876543210";

    fn log_row(conn: &Connection, install: &str, counter: u8) {
        conn.execute(
            "INSERT INTO sync_log (install, hlc, kind, table_name, row_uuid, column_name, payload) \
             VALUES (?1, ?2, 'field', 'accounts', ?3, '*', ?4)",
            params![
                install,
                format!("{:016x}-{install}", counter as u64),
                vec![counter; 16],
                vec![counter, 1, 2, 3],
            ],
        )
        .expect("the message inserts");
    }

    #[test]
    fn the_next_seq_is_derived_from_the_log_and_is_per_install() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let conn = migrated_dataset(&dir.path().join("nixus.db"));

        assert_eq!(next_seq(&conn, INSTALL).expect("it reads"), 0);

        for counter in 1..=3 {
            log_row(&conn, INSTALL, counter);
        }
        log_row(&conn, OTHER, 9);

        // Still 0: nothing is shipped yet, so the next segment is this install's first.
        assert_eq!(next_seq(&conn, INSTALL).expect("it reads"), 0);

        let batch = unshipped(&conn, INSTALL, 100).expect("it reads");
        assert_eq!(batch.len(), 3, "the other install's message is not ours");

        let assignments: Vec<(i64, i64)> = batch
            .iter()
            .enumerate()
            .map(|(idx, message)| (message.id, idx as i64))
            .collect();
        assert_eq!(mark_shipped(&conn, 0, &assignments).expect("it marks"), 3);

        assert_eq!(next_seq(&conn, INSTALL).expect("it reads"), 1);
        assert_eq!(
            next_seq(&conn, OTHER).expect("it reads"),
            0,
            "one install's segments never move another's sequence"
        );
        assert_eq!(unshipped_count(&conn, INSTALL).expect("it counts"), 0);
        assert_eq!(unshipped_count(&conn, OTHER).expect("it counts"), 1);
        assert_eq!(
            shipped_positions(&conn).expect("it reads"),
            vec![(1, 0, 0), (2, 0, 1), (3, 0, 2)]
        );
    }

    #[test]
    fn the_batch_is_the_lowest_ids_and_a_second_read_returns_exactly_the_same_rows() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let conn = migrated_dataset(&dir.path().join("nixus.db"));

        for counter in 1..=5 {
            log_row(&conn, INSTALL, counter);
        }

        let first = unshipped(&conn, INSTALL, 2).expect("it reads");
        // A later message cannot change what the earlier batch contains, which is why a re-cut
        // after a crash mid-upload produces the same bytes.
        log_row(&conn, INSTALL, 6);
        let again = unshipped(&conn, INSTALL, 2).expect("it reads");

        assert_eq!(first, again);
        assert_eq!(first.iter().map(|m| m.id).collect::<Vec<_>>(), vec![1, 2]);
    }

    #[test]
    fn marking_a_row_that_is_already_shipped_changes_nothing() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let conn = migrated_dataset(&dir.path().join("nixus.db"));
        log_row(&conn, INSTALL, 1);

        assert_eq!(mark_shipped(&conn, 0, &[(1, 0)]).expect("it marks"), 1);
        assert_eq!(
            mark_shipped(&conn, 7, &[(1, 0)]).expect("it marks"),
            0,
            "the `seq IS NULL` guard is what keeps a shipped message in its own segment"
        );
        assert_eq!(shipped_positions(&conn).expect("it reads"), vec![(1, 0, 0)]);
    }

    #[test]
    fn an_absent_applied_vector_row_reads_as_nothing_applied() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let conn = migrated_dataset(&dir.path().join("nixus.db"));

        assert_eq!(applied_seq(&conn, INSTALL).expect("it reads"), None);

        conn.execute(
            "INSERT INTO sync_applied_vector (install, seq) VALUES (?1, 4)",
            params![INSTALL],
        )
        .expect("the vector row inserts");

        assert_eq!(applied_seq(&conn, INSTALL).expect("it reads"), Some(4));
    }
}
