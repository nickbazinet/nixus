//! Database renaming: the dataset walk, WAL handling, collisions, and refusals.

use rusqlite::Connection;

use super::test_support::{
    fixture_root, legacy_beside, marker, migrate, row_count, seed_legacy_db,
};
use crate::datasets::{DATASETS_SUBDIR, DB_FILE_NAME, LEGACY_DB_FILE_NAME};
use crate::db::backup::with_suffix;
use crate::error::AppError;

/// The multi-profile upgrade: Default's database sits at the root and every other
/// profile's under `datasets/<id>/`, so a walk that only looked at the root would
/// leave every additional profile permanently unopenable.
#[test]
fn every_profile_database_is_renamed_not_just_the_default_one() {
    let (_parent, root) = fixture_root();
    let legacy = legacy_beside(&root);
    seed_legacy_db(&legacy, "default-data");
    seed_legacy_db(&legacy.join(DATASETS_SUBDIR).join("profile-a"), "a-data");
    seed_legacy_db(&legacy.join(DATASETS_SUBDIR).join("profile-b"), "b-data");

    let outcome = migrate(&root).expect("migration succeeds");

    assert_eq!(outcome.databases_renamed.len(), 3);
    assert_eq!(marker(&root.join(DB_FILE_NAME)), "default-data");
    let nested = root.join(DATASETS_SUBDIR);
    assert_eq!(
        marker(&nested.join("profile-a").join(DB_FILE_NAME)),
        "a-data"
    );
    assert_eq!(
        marker(&nested.join("profile-b").join(DB_FILE_NAME)),
        "b-data"
    );
}

/// Committed rows that live only in the `-wal` sidecar: the rename must carry them,
/// which is only true if the checkpoint ran first.
///
/// The fixture is built by copying a live `.db`/`-wal` pair out from under an open
/// connection, because that is the only way to produce what this actually has to
/// handle: the state a *crashed* app leaves behind, where committed pages sit in the
/// sidecar and no process holds the file open. A connection merely left open instead
/// would be a different situation entirely — and one the migration correctly refuses,
/// since it cannot checkpoint past another writer.
///
/// The copied pair is therefore **never opened before `migrate`**. Opening it would
/// checkpoint the sidecar and unlink it as a side effect of the clean close, handing
/// the migration an already-flushed database and leaving the test green even if
/// production dropped its checkpoint entirely. The baseline is established instead
/// through a throwaway probe over a copy of the main file *alone*: that file carries
/// only the one row the seed checkpointed, so the second committed row provably lives
/// nowhere but the sidecar the migration is about to be handed.
#[test]
fn transactions_held_only_in_the_write_ahead_log_survive_the_rename() {
    let (parent, root) = fixture_root();
    let legacy = legacy_beside(&root);

    let staging = parent.path().join("staging");
    let staged_db = seed_legacy_db(&staging, "checkpointed");
    let live = Connection::open(&staged_db).expect("reopen");
    live.execute("INSERT INTO marker (value) VALUES ('in-wal')", [])
        .expect("insert");
    let staged_wal = with_suffix(&staged_db, "-wal");
    assert!(
        staged_wal.exists(),
        "the fixture must produce a live -wal, or this proves nothing"
    );

    std::fs::create_dir_all(&legacy).expect("legacy root");
    let db = legacy.join(LEGACY_DB_FILE_NAME);
    std::fs::copy(&staged_db, &db).expect("copy main file");
    std::fs::copy(&staged_wal, with_suffix(&db, "-wal")).expect("copy sidecar");

    // Outside both roots, so the migration never sees it, and sidecar-less by
    // construction — it is a copy of the main file only.
    let probe = parent.path().join("wal-probe.db");
    std::fs::copy(&db, &probe).expect("copy main file for the probe");
    drop(live);

    assert!(
        !with_suffix(&probe, "-wal").exists(),
        "the probe must have no sidecar, or it would read the row it exists to miss"
    );
    assert_eq!(
        row_count(&probe),
        1,
        "the main file alone must hold only the checkpointed baseline row; if it \
         already has both, the second row is not WAL-only and this test proves nothing"
    );
    assert!(
        with_suffix(&db, "-wal").exists(),
        "the pair handed to the migration must still carry its unflushed sidecar"
    );

    migrate(&root).expect("migration succeeds");

    let migrated = root.join(DB_FILE_NAME);
    assert!(
        !with_suffix(&migrated, "-wal").exists(),
        "the sidecar must be folded in and gone, not carried across"
    );
    assert!(!with_suffix(&migrated, "-shm").exists());
    assert_eq!(
        row_count(&migrated),
        2,
        "a row held only in the -wal was lost"
    );
}

/// A `-wal` that cannot be flushed because another process still holds the database
/// open: renaming past it would strand every transaction it holds, so the migration
/// aborts and leaves both files exactly where they are.
#[test]
fn an_unflushable_write_ahead_log_aborts_the_migration() {
    let (_parent, root) = fixture_root();
    let db = seed_legacy_db(&root, "held-open");

    let held = Connection::open(&db).expect("reopen");
    held.execute("INSERT INTO marker (value) VALUES ('in-wal')", [])
        .expect("insert");
    assert!(with_suffix(&db, "-wal").exists());

    let error = migrate(&root).expect_err("migration must refuse to rename");

    assert!(matches!(error, AppError::File { .. }), "got {error:?}");
    assert!(db.is_file(), "the legacy database must be left in place");
    assert!(!root.join(DB_FILE_NAME).exists());
    drop(held);
}

#[test]
fn a_database_collision_keeps_both_files_and_leaves_the_new_one_live() {
    let (_parent, root) = fixture_root();
    seed_legacy_db(&root, "legacy-data");
    let current = root.join(DB_FILE_NAME);
    std::fs::copy(root.join(LEGACY_DB_FILE_NAME), &current).expect("current db");
    let conn = Connection::open(&current).expect("open");
    conn.execute("UPDATE marker SET value = 'current-data'", [])
        .expect("update");
    conn.close().expect("close");

    let outcome = migrate(&root).expect("a collision is not a failure");

    assert_eq!(outcome.database_collisions, vec![root.clone()]);
    assert!(outcome.databases_renamed.is_empty());
    assert_eq!(marker(&current), "current-data", "the new database wins");
    assert_eq!(
        marker(&root.join(LEGACY_DB_FILE_NAME)),
        "legacy-data",
        "the legacy database must be preserved, not clobbered"
    );
}

/// A stray file under `datasets/` is not a dataset. Failing on it would make the
/// app unlaunchable for a user who once dropped a file in their app-data folder.
#[test]
fn a_non_directory_entry_under_datasets_is_skipped() {
    let (_parent, root) = fixture_root();
    seed_legacy_db(&root, "default-data");
    let nested = root.join(DATASETS_SUBDIR);
    std::fs::create_dir_all(&nested).expect("datasets dir");
    std::fs::write(nested.join("stray.txt"), b"not a dataset").expect("stray file");

    let outcome = migrate(&root).expect("migration succeeds");

    assert_eq!(outcome.databases_renamed, vec![root.clone()]);
    assert!(nested.join("stray.txt").is_file());
}

/// A directory whose name `is_valid_dataset_id` rejects belongs to a dataset the app
/// can never open, so the migration must not reach inside it. Every rejected shape is
/// exercised, because the predicate is what keeps a hand-edited name from being used
/// as a path component at all.
#[test]
fn a_directory_whose_name_is_not_a_valid_dataset_id_is_left_untouched() {
    let (_parent, root) = fixture_root();
    seed_legacy_db(&root, "default-data");

    let invalid = ["under_score", "has.dot", "has space", "café"];
    for name in invalid {
        assert!(
            !crate::datasets::is_valid_dataset_id(name),
            "{name} must be an invalid id, or this fixture proves nothing"
        );
        seed_legacy_db(&root.join(DATASETS_SUBDIR).join(name), name);
    }
    seed_legacy_db(&root.join(DATASETS_SUBDIR).join("valid-id"), "valid-data");

    let outcome = migrate(&root).expect("migration succeeds");

    assert_eq!(
        outcome.databases_renamed.len(),
        2,
        "only the root and the validly-named profile may be migrated, got {:?}",
        outcome.databases_renamed
    );
    assert!(outcome.database_collisions.is_empty());
    assert_eq!(
        marker(
            &root
                .join(DATASETS_SUBDIR)
                .join("valid-id")
                .join(DB_FILE_NAME)
        ),
        "valid-data"
    );

    for name in invalid {
        let dir = root.join(DATASETS_SUBDIR).join(name);
        assert_eq!(
            marker(&dir.join(LEGACY_DB_FILE_NAME)),
            name,
            "{name}'s legacy database must be left exactly where it is"
        );
        assert!(
            !dir.join(DB_FILE_NAME).exists(),
            "{name} must not gain a Nixus database"
        );
    }
}

#[test]
fn a_profile_directory_with_no_legacy_database_is_skipped() {
    let (_parent, root) = fixture_root();
    seed_legacy_db(&root, "default-data");
    let empty = root.join(DATASETS_SUBDIR).join("profile-empty");
    std::fs::create_dir_all(&empty).expect("empty profile dir");

    let outcome = migrate(&root).expect("migration succeeds");

    assert_eq!(outcome.databases_renamed, vec![root.clone()]);
    assert!(!empty.join(DB_FILE_NAME).exists());
}

/// A file carrying the legacy database name that SQLite cannot read is refused
/// rather than renamed or skipped: renaming it would hand `init_db` a corrupt file
/// under the live name, and skipping it would start the app on an empty database
/// while what looks exactly like the user's data sits beside it unopened.
#[test]
fn an_unreadable_legacy_database_aborts_the_migration_and_changes_nothing() {
    let (_parent, root) = fixture_root();
    std::fs::create_dir_all(&root).expect("root");
    let legacy_db = root.join(LEGACY_DB_FILE_NAME);
    std::fs::write(&legacy_db, b"this is not a sqlite database at all").expect("garbage");

    let error = migrate(&root).expect_err("migration must fail");

    assert!(matches!(error, AppError::File { .. }), "got {error:?}");
    assert_eq!(
        std::fs::read(&legacy_db).expect("still readable"),
        b"this is not a sqlite database at all",
        "an aborted migration must leave the legacy file byte-for-byte intact"
    );
    assert!(!root.join(DB_FILE_NAME).exists());
}
