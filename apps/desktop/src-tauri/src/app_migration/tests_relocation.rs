//! Root relocation: the atomic sibling rename, its no-op cases, and its collision.

use super::migrate_from_legacy_identity;
use super::test_support::{fixture_root, legacy_beside, marker, migrate, seed_legacy_db};
use crate::datasets::{DB_FILE_NAME, LEGACY_DB_FILE_NAME};

#[test]
fn a_fresh_install_migrates_nothing_and_creates_nothing() {
    let (_parent, root) = fixture_root();

    let outcome = migrate(&root).expect("migration succeeds");

    assert!(outcome.is_noop());
    assert!(
        !root.exists(),
        "migration must leave root creation to bootstrap_registry"
    );
    assert!(!legacy_beside(&root).exists());
}

#[test]
fn an_existing_install_moves_the_root_and_renames_the_default_database() {
    let (_parent, root) = fixture_root();
    let legacy = legacy_beside(&root);
    seed_legacy_db(&legacy, "default-data");
    std::fs::write(legacy.join("datasets.json"), b"[]").expect("registry");

    let outcome = migrate(&root).expect("migration succeeds");

    assert_eq!(outcome.root_moved_from.as_deref(), Some(legacy.as_path()));
    assert_eq!(outcome.root_collision, None);
    assert_eq!(outcome.databases_renamed, vec![root.clone()]);
    assert!(outcome.database_collisions.is_empty());
    assert!(!legacy.exists(), "the legacy root must be gone, not copied");
    assert_eq!(marker(&root.join(DB_FILE_NAME)), "default-data");
    assert!(!root.join(LEGACY_DB_FILE_NAME).exists());
    assert!(
        root.join("datasets.json").is_file(),
        "every sibling file in the root must travel with it"
    );
}

#[test]
fn a_second_launch_is_a_no_op() {
    let (_parent, root) = fixture_root();
    seed_legacy_db(&legacy_beside(&root), "default-data");

    let first = migrate(&root).expect("first migration succeeds");
    assert!(!first.is_noop());
    let before = std::fs::read(root.join(DB_FILE_NAME)).expect("db readable");

    let second = migrate(&root).expect("second migration succeeds");

    assert!(second.is_noop());
    assert_eq!(
        std::fs::read(root.join(DB_FILE_NAME)).expect("db readable"),
        before,
        "a repeated launch must not rewrite a byte"
    );
}

/// The interrupted run: the root moved but the process died before the databases
/// were renamed. The next launch has to finish the job rather than see a root that
/// already exists and give up.
#[test]
fn a_run_interrupted_after_the_root_move_finishes_on_the_next_launch() {
    let (_parent, root) = fixture_root();
    seed_legacy_db(&root, "half-migrated");
    seed_legacy_db(
        &root
            .join(crate::datasets::DATASETS_SUBDIR)
            .join("profile-a"),
        "a-data",
    );

    let outcome = migrate(&root).expect("migration succeeds");

    assert_eq!(outcome.root_moved_from, None);
    assert_eq!(outcome.root_collision, None);
    assert_eq!(outcome.databases_renamed.len(), 2);
    assert_eq!(marker(&root.join(DB_FILE_NAME)), "half-migrated");
    assert_eq!(
        marker(
            &root
                .join(crate::datasets::DATASETS_SUBDIR)
                .join("profile-a")
                .join(DB_FILE_NAME)
        ),
        "a-data"
    );
}

/// Both roots holding data is the one case the spec reserves for a human, so the
/// legacy root must survive completely untouched — and, critically, the outcome must
/// be distinguishable from "nothing to migrate", or the caller reports a clean no-op
/// while an entire installation sits stranded beside the live one.
#[test]
fn a_root_collision_is_reported_and_leaves_both_roots_intact() {
    let (_parent, root) = fixture_root();
    let legacy = legacy_beside(&root);
    seed_legacy_db(&legacy, "legacy-root-data");
    std::fs::write(legacy.join("datasets.json"), b"[]").expect("legacy registry");
    seed_legacy_db(&root, "new-root-data");

    let outcome = migrate(&root).expect("a collision is not a failure");

    assert_eq!(
        outcome.root_collision.as_deref(),
        Some(legacy.as_path()),
        "a root collision must be represented explicitly"
    );
    assert!(
        !outcome.is_noop(),
        "a stranded legacy root must never be reported as nothing to migrate"
    );
    assert_eq!(outcome.root_moved_from, None);

    // Neither root is merged, copied, deleted or overwritten.
    assert_eq!(
        marker(&legacy.join(LEGACY_DB_FILE_NAME)),
        "legacy-root-data",
        "the legacy root must be left entirely alone"
    );
    assert!(legacy.join("datasets.json").is_file());
    assert_eq!(marker(&root.join(DB_FILE_NAME)), "new-root-data");
    assert!(
        !root.join(LEGACY_DB_FILE_NAME).exists(),
        "nothing may be copied out of the legacy root"
    );
}

/// A collision is a standing state, not a one-off event: it must keep being reported
/// on every launch until a human resolves it, and must never start mutating either side.
#[test]
fn a_root_collision_is_reported_again_on_the_next_launch() {
    let (_parent, root) = fixture_root();
    let legacy = legacy_beside(&root);
    seed_legacy_db(&legacy, "legacy-root-data");
    seed_legacy_db(&root, "new-root-data");

    migrate(&root).expect("first launch");
    let second = migrate(&root).expect("second launch");

    assert_eq!(second.root_collision.as_deref(), Some(legacy.as_path()));
    assert_eq!(
        marker(&legacy.join(LEGACY_DB_FILE_NAME)),
        "legacy-root-data"
    );
    assert_eq!(marker(&root.join(DB_FILE_NAME)), "new-root-data");
}

#[test]
fn a_root_without_a_legacy_sibling_is_left_alone() {
    let (_parent, root) = fixture_root();
    seed_legacy_db(&root, "default-data");

    let outcome = migrate_from_legacy_identity(&root, None).expect("migration succeeds");

    assert_eq!(outcome.root_moved_from, None);
    assert_eq!(outcome.root_collision, None);
    assert_eq!(
        outcome.databases_renamed,
        vec![root.clone()],
        "databases in place still get renamed with no legacy root to move"
    );
}
