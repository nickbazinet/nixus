//! The guarded swap (AD-9): what it carries over, what it keeps, and what it leaves behind
//! when it is interrupted at each individual step.
//!
//! The failure matrix is driven entirely through the `DatasetSlot` seam. That is deliberate:
//! sabotaging the files from inside `close()` is the one moment a real crash could also
//! strike (between "the connections are gone" and "the new file is in place"), so every
//! case below is reachable without a test-only branch anywhere in the production path.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use rusqlite::Connection;
use tempfile::TempDir;

use crate::datasets::DB_FILE_NAME;
use crate::db::backup::{
    copy_to_dated_backup, local_data_summary, recover_interrupted_restore, restore_snapshot_file,
    with_suffix, DatasetSlot, Recovery, RecoveryOutcome, SwapStage, BOOTSTRAP_SAFETY_SUFFIX,
    INCOMING_SUFFIX,
};
use crate::db::open_configured;
use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Sabotage {
    None,
    CloseFails,
    /// A directory where the verified file was: the copy over the live database cannot run.
    IncomingBecomesADirectory,
    /// Bytes that are not a database: the reopen fails.
    IncomingBecomesGarbage,
    /// A database that opens but does not verify.
    IncomingBecomesCorrupt,
    AdoptFailsOnce,
}

struct TestSlot {
    db_path: PathBuf,
    held: Mutex<Option<Connection>>,
    sabotage: Sabotage,
    closes: AtomicUsize,
    adopts: AtomicUsize,
}

impl TestSlot {
    fn holding(db_path: &Path, sabotage: Sabotage) -> Self {
        let conn = open_configured(db_path).expect("the live dataset opens");

        Self {
            db_path: db_path.to_path_buf(),
            held: Mutex::new(Some(conn)),
            sabotage,
            closes: AtomicUsize::new(0),
            adopts: AtomicUsize::new(0),
        }
    }

    fn incoming(&self) -> PathBuf {
        with_suffix(&self.db_path, INCOMING_SUFFIX)
    }

    fn marker(&self) -> String {
        let held = self.held.lock().expect("not poisoned");
        let conn = held.as_ref().expect("the slot holds a connection");

        read_marker(conn)
    }
}

impl DatasetSlot for TestSlot {
    fn close(&self) -> Result<(), AppError> {
        self.closes.fetch_add(1, Ordering::SeqCst);
        drop(self.held.lock().expect("not poisoned").take());

        match self.sabotage {
            Sabotage::CloseFails => {
                return Err(AppError::File {
                    message: "the test slot refuses to close".to_string(),
                })
            }
            Sabotage::IncomingBecomesADirectory => {
                std::fs::remove_file(self.incoming()).expect("the verified file is there");
                std::fs::create_dir(self.incoming()).expect("a directory takes its place");
            }
            Sabotage::IncomingBecomesGarbage => {
                std::fs::write(self.incoming(), b"not a database at all").expect("garbage written");
            }
            Sabotage::IncomingBecomesCorrupt => {
                corrupt_in_place(&self.incoming());
            }
            Sabotage::None | Sabotage::AdoptFailsOnce => {}
        }

        Ok(())
    }

    fn adopt(&self, conn: Connection) -> Result<(), AppError> {
        let attempt = self.adopts.fetch_add(1, Ordering::SeqCst);
        if self.sabotage == Sabotage::AdoptFailsOnce && attempt == 0 {
            return Err(AppError::File {
                message: "the test slot refuses the first connection".to_string(),
            });
        }

        *self.held.lock().expect("not poisoned") = Some(conn);

        Ok(())
    }
}

/// Scribbles over the second-to-last page without changing the file's size.
///
/// Late in the file on purpose: opening a database reads page 1 and `sqlite_master`, so
/// corruption there fails the *open* instead of the verification, and the verification step
/// would then never be exercised. A page holding table data is read by `quick_check` and by
/// nothing else on the restore path.
///
/// Not `fs::write`, which truncates: Windows refuses to resize a file something still has
/// memory-mapped, and the Story-1 regression this mirrors was exactly that.
fn corrupt_in_place(path: &Path) {
    use std::io::{Seek, SeekFrom, Write};

    const PAGE: u64 = 4096;
    let length = std::fs::metadata(path).expect("the file is there").len();
    assert!(length > 4 * PAGE, "the fixture must be several pages long");

    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .open(path)
        .expect("the file opens for writing");
    file.seek(SeekFrom::Start((length / PAGE - 1) * PAGE))
        .expect("seek to the second-to-last page");
    file.write_all(&[0x5a; PAGE as usize])
        .expect("scribble over it");
}

fn seed_marker(conn: &Connection, marker: &str) {
    conn.execute(
        "INSERT INTO budget_groups (id, name) VALUES (1, ?1)",
        [marker],
    )
    .expect("seed budget group");
}

/// Appends enough rows that the file's last pages belong to a user table rather than to
/// `sqlite_master`, which is what makes a late-page corruption survive the open and be
/// caught by the verification instead.
fn seed_bulk(conn: &Connection, rows: usize) {
    let padding = "x".repeat(200);
    let mut insert = conn
        .prepare("INSERT INTO budget_groups (id, name) VALUES (?1, ?2)")
        .expect("prepare");
    for row in 0..rows {
        insert
            .execute(rusqlite::params![row as i64 + 2, padding])
            .expect("a padded row");
    }
}

fn read_marker(conn: &Connection) -> String {
    conn.query_row("SELECT name FROM budget_groups WHERE id = 1", [], |row| {
        row.get(0)
    })
    .expect("read budget group")
}

/// A complete, self-contained database file, built the way a snapshot payload arrives:
/// migrated, checkpointed and with no sidecar left beside it.
fn database_bytes(marker: &str, extras: impl FnOnce(&Connection)) -> Vec<u8> {
    let dir = TempDir::new().expect("temp dir");
    let path = dir.path().join("payload.db");

    {
        let conn = open_configured(&path).expect("the payload opens");
        seed_marker(&conn, marker);
        extras(&conn);
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .expect("checkpoint");
    }

    std::fs::read(&path).expect("the payload reads")
}

/// A live dataset holding `marker`, plus whatever `extras` adds.
fn live_dataset(marker: &str, extras: impl FnOnce(&Connection)) -> (TempDir, PathBuf) {
    let dir = TempDir::new().expect("temp dir");
    let path = dir.path().join(DB_FILE_NAME);

    {
        let conn = open_configured(&path).expect("the dataset opens");
        seed_marker(&conn, marker);
        extras(&conn);
    }

    (dir, path)
}

fn link_sync_state(conn: &Connection) {
    crate::db::sync_state::ensure(
        conn,
        "0123456789abcdef",
        "ab00000000000000000000000000000000000000000000000000000000000000",
    )
    .expect("the install identity is recorded");
    crate::db::sync_state::set_pin(conn, "us-east-1:0000", "sub-0").expect("the pin is recorded");
}

#[test]
fn a_restore_replaces_the_data_and_leaves_no_scratch_file_behind() {
    let (dir, db_path) = live_dataset("live", |_| {});
    let slot = TestSlot::holding(&db_path, Sabotage::None);

    let report = restore_snapshot_file(
        &slot,
        &db_path,
        &database_bytes("from the cloud", |_| {}),
        None,
    )
    .expect("the restore succeeds");

    assert_eq!(slot.marker(), "from the cloud");
    assert_eq!(report.dated_backup, None);
    assert!(!with_suffix(&db_path, INCOMING_SUFFIX).exists());
    assert!(!with_suffix(&db_path, BOOTSTRAP_SAFETY_SUFFIX).exists());
    drop(dir);
}

#[test]
fn replace_keeps_a_dated_backup_that_opens_and_holds_the_data_it_displaced() {
    let (dir, db_path) = live_dataset("the data this computer had", |_| {});
    let backups = dir.path().join("backups");
    let slot = TestSlot::holding(&db_path, Sabotage::None);

    let report = restore_snapshot_file(
        &slot,
        &db_path,
        &database_bytes("from the cloud", |_| {}),
        Some(&backups),
    )
    .expect("the restore succeeds");

    let backup = report.dated_backup.expect("a dated backup was kept");
    let reopened = open_configured(&backup).expect("the dated backup opens");

    assert_eq!(read_marker(&reopened), "the data this computer had");
    assert_eq!(slot.marker(), "from the cloud");
    assert!(backup.starts_with(&backups));
}

#[test]
fn a_dated_backup_never_overwrites_one_taken_in_the_same_second() {
    let (dir, db_path) = live_dataset("live", |_| {});
    let backups = dir.path().join("backups");

    let first = copy_to_dated_backup(&db_path, &backups).expect("the first backup is written");
    let second = copy_to_dated_backup(&db_path, &backups).expect("the second backup is written");

    assert_ne!(first, second);
    assert!(first.exists() && second.exists());
    assert_eq!(
        std::fs::read(&first).expect("readable"),
        std::fs::read(&second).expect("readable")
    );
}

#[test]
fn the_local_only_tables_and_credential_config_keys_are_carried_over() {
    let (_dir, db_path) = live_dataset("live", |conn| {
        link_sync_state(conn);
        crate::db::config::set(conn, "ai_provider", "bedrock").expect("local-only key");
        crate::db::config::set(conn, "theme", "this computer's").expect("a synced key");
    });
    let slot = TestSlot::holding(&db_path, Sabotage::None);

    // The payload is what a snapshot is: stripped of `sync_*` and of the deny-listed keys,
    // and carrying the user's own settings.
    let payload = database_bytes("from the cloud", |conn| {
        crate::db::config::set(conn, "theme", "the account's").expect("a synced key");
    });

    let report =
        restore_snapshot_file(&slot, &db_path, &payload, None).expect("the restore succeeds");

    // INTENTIONAL BEHAVIOUR CHANGE (Story 23): a snapshot now CARRIES the account's merge and
    // identity state, so a restore must not overwrite it with this computer's copy. Only the three
    // tables that describe THIS computer come back from the safety copy — and `sync_log` is the
    // union rather than a replacement, because `next_seq` is derived from it.
    assert_eq!(
        report.carried.tables,
        vec![
            "sync_image_blobs".to_string(),
            "sync_log".to_string(),
            "sync_state".to_string(),
        ]
    );
    assert_eq!(report.carried.rows, 1);
    assert_eq!(report.carried.config_keys, 1);

    let held = slot.held.lock().expect("not poisoned");
    let conn = held.as_ref().expect("a connection");
    let state = crate::db::sync_state::load(conn)
        .expect("the state reads")
        .expect("the row was carried over");

    assert_eq!(state.install_id, "0123456789abcdef");
    assert_eq!(state.identity_id.as_deref(), Some("us-east-1:0000"));
    assert_eq!(state.owner_sub.as_deref(), Some("sub-0"));
    assert_eq!(state.link_state, crate::db::sync_state::LinkState::Linked);
    assert_eq!(
        crate::db::config::get(conn, "ai_provider").as_deref(),
        Some("bedrock"),
        "this computer's credential state must survive the swap"
    );
    assert_eq!(
        crate::db::config::get(conn, "theme").as_deref(),
        Some("the account's"),
        "a synced setting must come from the snapshot, not from the old file"
    );
}

/// The other half of Story 23's round trip (AD-9, AD-15): the snapshot's merge state SURVIVES the
/// swap, this computer's own state comes back from the safety copy, and `sync_log` is the union of
/// both.
///
/// INTENTIONAL BEHAVIOUR CHANGE from Milestone 1, which carried every `sync\_%` table back and so
/// discarded whatever the snapshot had brought.
#[test]
fn a_restore_keeps_the_snapshots_merge_state_and_this_computers_log() {
    let live_row: [u8; 16] = [0x11; 16];
    let snapshot_row: [u8; 16] = [0x33; 16];
    let (_dir, db_path) = live_dataset("live", |conn| {
        link_sync_state(conn);
        crate::db::test_dataset::seed_sync_bookkeeping(conn);
        // An unsent message of this computer's own: nobody else has it yet.
        conn.execute(
            "INSERT INTO sync_log (install, hlc, kind, table_name, row_uuid, column_name)
             VALUES ('0123456789abcdef', '0000000000000009-0123456789abcdef', 'field',
                     'accounts', ?1, 'name')",
            [live_row.to_vec()],
        )
        .expect("an unsent message");
        conn.execute(
            "INSERT INTO sync_log (install, seq, idx, hlc, kind, table_name, row_uuid, column_name)
             VALUES ('0123456789abcdef', 4, 0, '0000000000000008-0123456789abcdef', 'field',
                     'accounts', ?1, 'name')",
            [live_row.to_vec()],
        )
        .expect("a shipped message of this computer's own");
    });
    let slot = TestSlot::holding(&db_path, Sabotage::None);

    // A payload shaped like a Story-23 snapshot: no `sync_state`, no `sync_image_blobs`, but the
    // account's identities and a SHIPPED message of its own.
    let payload = database_bytes("from the cloud", |conn| {
        conn.execute(
            "INSERT INTO sync_uuid (table_name, row_id, uuid) VALUES ('accounts', 9, ?1)",
            [snapshot_row.to_vec()],
        )
        .expect("the account's identity");
        conn.execute(
            "INSERT INTO sync_applied_vector (install, seq, applied_offset)
             VALUES ('aaaaaaaaaaaaaaaa', 12, 3)",
            [],
        )
        .expect("the snapshot's watermark");
        conn.execute(
            "INSERT INTO sync_log (install, seq, idx, hlc, kind, table_name, row_uuid, cause_uuid, payload)
             VALUES ('aaaaaaaaaaaaaaaa', 12, 0, '0000000000000005-aaaaaaaaaaaaaaaa',
                     'balance_delta', 'accounts', ?1, ?2, x'01')",
            rusqlite::params![snapshot_row.to_vec(), snapshot_row.to_vec()],
        )
        .expect("a shipped increment message");
    });

    let report =
        restore_snapshot_file(&slot, &db_path, &payload, None).expect("the restore succeeds");

    assert_eq!(
        report.carried.tables,
        vec![
            "sync_image_blobs".to_string(),
            "sync_log".to_string(),
            "sync_state".to_string(),
        ]
    );

    let held = slot.held.lock().expect("not poisoned");
    let conn = held.as_ref().expect("a connection");
    let count = |sql: &str| -> i64 {
        conn.query_row(sql, [], |row| row.get(0))
            .expect("the count reads")
    };

    // The snapshot's identities and watermark are the ones that survived.
    assert_eq!(
        count("SELECT COUNT(*) FROM sync_uuid WHERE row_id = 9"),
        1,
        "the snapshot's identity for the account is what the dataset keeps"
    );
    assert_eq!(
        count("SELECT COUNT(*) FROM sync_uuid"),
        1,
        "and this computer's old mapping did not come back on top of it"
    );
    assert_eq!(
        count("SELECT seq FROM sync_applied_vector WHERE install = 'aaaaaaaaaaaaaaaa'"),
        12,
        "the snapshot's watermark is the honest statement of what the file holds"
    );
    assert_eq!(
        count("SELECT COUNT(*) FROM sync_applied_vector"),
        1,
        "the old file's vector claimed segments this file does not contain"
    );

    // The log is the UNION: the snapshot's increment message (which IS the balance merge state)
    // and this computer's unsent row, which must still be shippable.
    assert_eq!(
        count("SELECT COUNT(*) FROM sync_log WHERE kind = 'balance_delta'"),
        1,
        "the snapshot's merge state for the balance survived the swap"
    );
    assert_eq!(
        count("SELECT COUNT(*) FROM sync_log WHERE seq IS NULL AND install = '0123456789abcdef'"),
        1,
        "this computer's own unsent row is still unsent, and still shippable"
    );
    // INTENTIONAL BEHAVIOUR CHANGE (Story 25): the carry is scoped to THIS computer's install, so
    // the fixture's unsent row under a foreign install does NOT come back. An unsent row of another
    // install is nonsense to begin with — only the computer that captured a message can ship it —
    // and carrying a FOREIGN install's log row is a lost edit: it is a dedup record for a message
    // whose row the incoming snapshot does not have, so `apply` skips that message as already
    // applied and the row never exists here. Found by the convergence simulator's restore op.
    assert_eq!(
        count("SELECT COUNT(*) FROM sync_log WHERE seq IS NULL"),
        1,
        "no other install's unsent row came back on top of the snapshot"
    );
    assert_eq!(
        count("SELECT COUNT(*) FROM sync_log WHERE install = '0a1b2c3d4e5f6071'"),
        0,
        "the fixture's foreign-install log rows are the snapshot's business, not the old file's"
    );
    assert_eq!(
        count("SELECT COUNT(*) FROM sync_log WHERE install = '0123456789abcdef' AND seq IS NOT NULL"),
        1,
        "its shipped rows came back too, so `next_seq` cannot rewind (Story 19)"
    );

    // This computer's own state came back from the safety copy.
    let state = crate::db::sync_state::load(conn)
        .expect("the state reads")
        .expect("the row was carried over");
    assert_eq!(state.install_id, "0123456789abcdef");

    // And the restored file is still the cloud's data, not the old one.
    assert_eq!(read_marker(conn), "from the cloud");
}

/// A computer can be restored more than once from an image that already holds its own unsent tail
/// — an imported backup, a copied dataset, a re-bootstrap after a second retention gap. The carry
/// then adds the live file's `seq IS NULL` rows on top of identical ones, and `UNIQUE (install,
/// seq, idx)` cannot dedup them: they have no `seq` and SQLite treats two NULLs as distinct. Without
/// a tuple-level predicate the next cut ships one `counter_delta` twice under two message ids, which
/// every other computer counts twice.
#[test]
fn a_second_restore_does_not_duplicate_the_unsent_tail() {
    let row: [u8; 16] = [0x44; 16];
    let unsent_tail = |conn: &Connection| {
        conn.execute(
            "INSERT INTO sync_log (install, hlc, kind, table_name, row_uuid, column_name, payload)
             VALUES ('0123456789abcdef', '000000000000000a-0123456789abcdef', 'counter_delta',
                     'merchant_category_hints', ?1, 'usage_count', x'0100000000000001')",
            [row.to_vec()],
        )
        .expect("an unsent increment nobody else has yet");
        conn.execute(
            "INSERT INTO sync_log (install, hlc, kind, table_name, row_uuid, column_name)
             VALUES ('0123456789abcdef', '000000000000000b-0123456789abcdef', 'field',
                     'accounts', ?1, '*')",
            [row.to_vec()],
        )
        .expect("an unsent field message with no cause and no seq");
    };

    let (_dir, db_path) = live_dataset("live", |conn| {
        link_sync_state(conn);
        unsent_tail(conn);
    });
    let slot = TestSlot::holding(&db_path, Sabotage::None);
    let payload = database_bytes("from the image", unsent_tail);

    let count = |sql: &str| -> i64 {
        let held = slot.held.lock().expect("not poisoned");
        let conn = held.as_ref().expect("a connection");
        conn.query_row(sql, [], |found| found.get(0))
            .expect("the count reads")
    };

    restore_snapshot_file(&slot, &db_path, &payload, None).expect("the first restore succeeds");
    assert_eq!(
        count("SELECT COUNT(*) FROM sync_log WHERE seq IS NULL"),
        2,
        "the tail the image and the live file agree on is carried forward ONCE"
    );

    restore_snapshot_file(&slot, &db_path, &payload, None).expect("the second restore succeeds");
    assert_eq!(
        count("SELECT COUNT(*) FROM sync_log WHERE seq IS NULL"),
        2,
        "and a second restore still carries the SAME tail, not another copy"
    );
    assert_eq!(
        count("SELECT COUNT(*) FROM sync_log WHERE kind = 'counter_delta'"),
        1,
        "so the next cut ships that increment exactly once"
    );
    assert_eq!(
        count(
            "SELECT COUNT(*) FROM sync_log
             WHERE kind = 'field' AND cause_uuid IS NULL AND seq IS NULL"
        ),
        1,
        "and a message that names no cause is matched too, which `=` would never have done"
    );
}

#[test]
fn an_older_snapshot_is_migrated_before_it_is_ever_put_in_place() {
    let (dir, db_path) = live_dataset("live", |_| {});
    let older = dir.path().join("older.db");
    {
        let conn = Connection::open(&older).expect("the older payload opens");
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .expect("pragmas");
        crate::db::run_migrations_up_to(&conn, 18).expect("an older schema");
        seed_marker(&conn, "from an older build");
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .expect("checkpoint");
    }
    let slot = TestSlot::holding(&db_path, Sabotage::None);

    restore_snapshot_file(
        &slot,
        &db_path,
        &std::fs::read(&older).expect("readable"),
        None,
    )
    .expect("the restore succeeds");

    let held = slot.held.lock().expect("not poisoned");
    let conn = held.as_ref().expect("a connection");
    let version: i64 = conn
        .query_row("SELECT MAX(version) FROM schema_version", [], |row| {
            row.get(0)
        })
        .expect("the version reads");

    assert_eq!(version, crate::db::latest_schema_version());
    assert_eq!(read_marker(conn), "from an older build");
}

/// Payload bytes that are not a database, so the incoming file cannot even be opened. The
/// live dataset must never have been closed.
#[test]
fn a_payload_that_is_not_a_database_fails_before_anything_is_touched() {
    let (_dir, db_path) = live_dataset("live", |_| {});
    let slot = TestSlot::holding(&db_path, Sabotage::None);

    let failure = restore_snapshot_file(&slot, &db_path, b"not a database at all", None)
        .expect_err("the restore must fail");

    assert_eq!(failure.stage, SwapStage::OpenIncoming);
    assert!(failure.rolled_back);
    assert_eq!(slot.closes.load(Ordering::SeqCst), 0);
    assert_eq!(slot.marker(), "live");
    assert!(!with_suffix(&db_path, INCOMING_SUFFIX).exists());
}

/// A `sync_*` table whose columns the snapshot does not have: the carry-over cannot run, so
/// the swap must stop while the old file is still in place.
#[test]
fn a_carry_over_that_cannot_be_applied_stops_the_swap() {
    let (_dir, db_path) = live_dataset("live", |conn| {
        conn.execute_batch("CREATE TABLE sync_probe (a TEXT, only_here TEXT)")
            .expect("a local-only table the snapshot does not match");
        conn.execute("INSERT INTO sync_probe VALUES ('x', 'y')", [])
            .expect("a row to carry");
    });
    let slot = TestSlot::holding(&db_path, Sabotage::None);

    let payload = database_bytes("from the cloud", |conn| {
        conn.execute_batch("CREATE TABLE sync_probe (a TEXT)")
            .expect("the same table, fewer columns");
    });

    let failure =
        restore_snapshot_file(&slot, &db_path, &payload, None).expect_err("the restore must fail");

    assert_eq!(failure.stage, SwapStage::CarryLocalOnly);
    assert!(failure.rolled_back);
    assert_eq!(slot.closes.load(Ordering::SeqCst), 0);
    assert_eq!(slot.marker(), "live");
}

#[test]
fn a_backup_directory_that_cannot_be_created_stops_the_swap() {
    let (dir, db_path) = live_dataset("live", |_| {});
    let blocked = dir.path().join("not-a-directory");
    std::fs::write(&blocked, b"a file where the backup directory would go").expect("written");
    let slot = TestSlot::holding(&db_path, Sabotage::None);

    let failure = restore_snapshot_file(
        &slot,
        &db_path,
        &database_bytes("from the cloud", |_| {}),
        Some(&blocked.join("backups")),
    )
    .expect_err("the restore must fail");

    assert_eq!(failure.stage, SwapStage::DatedBackup);
    assert!(failure.rolled_back, "nothing was displaced");
    assert_eq!(slot.marker(), "live");
}

/// The whole failure matrix, in one place so a step that stops being reachable is visible.
///
/// The assertion is the invariant, not the stage: whatever fails, the dataset opens and
/// holds either the old data or the new data, and the app is left with a working connection.
#[test]
fn an_interruption_at_any_step_leaves_a_usable_dataset() {
    let cases = [
        (Sabotage::CloseFails, SwapStage::CloseLive, false),
        (
            Sabotage::IncomingBecomesADirectory,
            SwapStage::CopyOverLive,
            false,
        ),
        (
            Sabotage::IncomingBecomesGarbage,
            SwapStage::OpenRestored,
            false,
        ),
        // Fat, so the corrupted page holds table data: see `corrupt_in_place`.
        (
            Sabotage::IncomingBecomesCorrupt,
            SwapStage::VerifyRestored,
            true,
        ),
        (Sabotage::AdoptFailsOnce, SwapStage::Adopt, false),
    ];

    for (sabotage, expected, fat) in cases {
        let (dir, db_path) = live_dataset("live", link_sync_state);
        let backups = dir.path().join("backups");
        let slot = TestSlot::holding(&db_path, sabotage);

        let payload = database_bytes("from the cloud", |conn| {
            if fat {
                seed_bulk(conn, 4_000);
            }
        });
        let failure = restore_snapshot_file(&slot, &db_path, &payload, Some(&backups))
            .expect_err("the sabotaged restore must fail");

        assert_eq!(failure.stage, expected, "for {sabotage:?}");
        assert!(
            failure.rolled_back,
            "the rollback must succeed for {sabotage:?}"
        );

        let marker = slot.marker();
        assert!(
            marker == "live" || marker == "from the cloud",
            "{sabotage:?} left {marker:?}, which is neither the old nor the new data"
        );
        assert!(
            !with_suffix(&db_path, INCOMING_SUFFIX).exists(),
            "{sabotage:?} left a scratch file behind"
        );
        assert!(
            !with_suffix(&db_path, BOOTSTRAP_SAFETY_SUFFIX).exists(),
            "{sabotage:?} left a safety copy behind, which the next launch would act on"
        );
    }
}

/// A crash during the copy at step 6: the live file is half written and the safety copy is
/// still there. The next launch must put the old data back.
#[test]
fn an_interrupted_swap_is_rolled_back_at_the_next_launch() {
    let (_dir, db_path) = live_dataset("the data this computer had", |_| {});
    let safety = with_suffix(&db_path, BOOTSTRAP_SAFETY_SUFFIX);
    let incoming = with_suffix(&db_path, INCOMING_SUFFIX);

    {
        let conn = open_configured(&db_path).expect("open");
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .expect("checkpoint");
    }
    std::fs::copy(&db_path, &safety).expect("the safety copy exists");
    std::fs::write(&incoming, b"a download that never landed").expect("a scratch file");
    corrupt_in_place(&db_path);

    let recovery = recover_interrupted_restore(&db_path).expect("the recovery runs");

    assert_eq!(
        recovery,
        Recovery {
            stale_incoming_removed: true,
            outcome: RecoveryOutcome::RolledBack,
        }
    );
    assert!(!incoming.exists());
    assert!(!safety.exists());

    let reopened = open_configured(&db_path).expect("the dataset opens again");
    assert_eq!(read_marker(&reopened), "the data this computer had");
}

/// A crash after the copy finished: the new file is intact, so it is what the user keeps.
#[test]
fn an_interrupted_swap_whose_copy_had_finished_keeps_the_restored_file() {
    let (dir, db_path) = live_dataset("from the cloud", |_| {});
    let safety = with_suffix(&db_path, BOOTSTRAP_SAFETY_SUFFIX);
    std::fs::write(&safety, database_bytes("the data this computer had", |_| {}))
        .expect("the safety copy exists");
    {
        let conn = open_configured(&db_path).expect("open");
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .expect("checkpoint");
    }

    let recovery = recover_interrupted_restore(&db_path).expect("the recovery runs");

    assert_eq!(
        recovery,
        Recovery {
            stale_incoming_removed: false,
            outcome: RecoveryOutcome::KeptFileInPlace,
        }
    );
    assert!(!safety.exists());

    let reopened = open_configured(&db_path).expect("the dataset opens");
    assert_eq!(read_marker(&reopened), "from the cloud");
    drop(dir);
}

/// A payload that opens but does not verify: the download or the disk let the app down, and
/// the live dataset must not be touched at all.
#[test]
fn a_payload_that_does_not_verify_is_refused_before_the_live_file_is_touched() {
    let (_dir, db_path) = live_dataset("live", |_| {});
    let before = std::fs::read(&db_path).expect("readable");
    let slot = TestSlot::holding(&db_path, Sabotage::None);

    let mut payload = database_bytes("from the cloud", |conn| seed_bulk(conn, 4_000));
    let page = 4096;
    let at = (payload.len() / page - 1) * page;
    payload[at..at + page].fill(0x5a);

    let failure =
        restore_snapshot_file(&slot, &db_path, &payload, None).expect_err("the restore must fail");

    assert_eq!(failure.stage, SwapStage::VerifyIncoming);
    assert!(failure.rolled_back);
    assert_eq!(slot.closes.load(Ordering::SeqCst), 0);
    assert_eq!(slot.marker(), "live");
    assert_eq!(std::fs::read(&db_path).expect("readable"), before);
}

#[test]
fn recovery_is_idempotent_and_does_nothing_when_no_swap_was_interrupted() {
    let (_dir, db_path) = live_dataset("live", |_| {});

    for _ in 0..2 {
        assert_eq!(
            recover_interrupted_restore(&db_path).expect("the recovery runs"),
            Recovery {
                stale_incoming_removed: false,
                outcome: RecoveryOutcome::NothingToDo,
            }
        );
    }

    let reopened = open_configured(&db_path).expect("the dataset opens");
    assert_eq!(read_marker(&reopened), "live");
}

#[test]
fn only_user_data_makes_a_dataset_non_empty() {
    let dir = TempDir::new().expect("temp dir");
    let path = dir.path().join(DB_FILE_NAME);
    let conn = open_configured(&path).expect("the dataset opens");

    assert!(
        local_data_summary(&conn)
            .expect("the summary reads")
            .is_empty(),
        "a freshly migrated dataset holds no user data"
    );

    link_sync_state(&conn);
    crate::db::config::set(&conn, "theme", "dark").expect("a setting");
    assert!(
        local_data_summary(&conn)
            .expect("the summary reads")
            .is_empty(),
        "sync state and this computer's settings are not user data"
    );

    seed_marker(&conn, "a budget the user made");
    let summary = local_data_summary(&conn).expect("the summary reads");

    assert!(!summary.is_empty());
    assert_eq!(summary.rows, 1);
    assert_eq!(summary.tables, vec![("budget_groups".to_string(), 1)]);
}
