//! Symlink refusal: the migration must never rename a file outside the app-data root.
//!
//! Unix-only. Windows symlink creation needs either Developer Mode or elevation, so a
//! test that silently failed to create the link would assert nothing; the production
//! guard itself is platform-independent.
#![cfg(unix)]

use std::os::unix::fs::symlink;
use std::path::Path;

use super::test_support::{fixture_root, legacy_beside, marker, migrate, seed_legacy_db};
use crate::datasets::{DATASETS_SUBDIR, DB_FILE_NAME, LEGACY_DB_FILE_NAME};
use crate::error::AppError;

/// Everything a real directory of user data outside the app root looks like, so an
/// escape is observable as *that* file being renamed.
fn outside_target(parent: &Path, marker_value: &str) -> std::path::PathBuf {
    let outside = parent.join("somewhere-else-entirely");
    seed_legacy_db(&outside, marker_value);
    outside
}

/// A symlinked legacy root is refused rather than followed or renamed.
///
/// `fs::rename` moves the link, not its target, so migrating it would install a symlink
/// as the app-data root and every later dataset path would resolve outside it.
#[test]
fn a_symlinked_legacy_root_is_refused_and_nothing_outside_the_app_root_is_renamed() {
    let (parent, root) = fixture_root();
    let outside = outside_target(parent.path(), "data-outside-the-app");
    let legacy = legacy_beside(&root);
    symlink(&outside, &legacy).expect("symlink the legacy root");

    let error = migrate(&root).expect_err("a symlinked legacy root must be refused");

    match error {
        AppError::File { ref message } => assert!(
            message.contains("symbolic link"),
            "the refusal must name the cause: {message}"
        ),
        other => panic!("expected AppError::File, got {other:?}"),
    }

    // The link is left for the user to resolve, and its target is untouched.
    assert!(
        std::fs::symlink_metadata(&legacy)
            .expect("the link survives")
            .file_type()
            .is_symlink(),
        "the migration must not consume the link"
    );
    assert_eq!(
        marker(&outside.join(LEGACY_DB_FILE_NAME)),
        "data-outside-the-app",
        "the symlink target must never be renamed"
    );
    assert!(
        !outside.join(DB_FILE_NAME).exists(),
        "no file outside the app-data root may be renamed"
    );
    assert!(!root.exists(), "a refused migration must create no root");
}

/// A symlink under `datasets/` is skipped. `is_dir` follows links, so without the
/// `symlink_metadata` check the walk would rename a database in the link's target —
/// an arbitrary directory anywhere on the filesystem.
#[test]
fn a_symlinked_dataset_directory_is_skipped_and_its_target_is_untouched() {
    let (parent, root) = fixture_root();
    let outside = outside_target(parent.path(), "data-outside-the-app");
    seed_legacy_db(&root, "default-data");
    let nested = root.join(DATASETS_SUBDIR);
    std::fs::create_dir_all(&nested).expect("datasets dir");

    // A *validly named* dataset id, so the id filter cannot be what rejects it: this
    // must be refused for being a link and nothing else.
    let link = nested.join("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa");
    assert!(crate::datasets::is_valid_dataset_id(
        link.file_name().unwrap().to_str().unwrap()
    ));
    symlink(&outside, &link).expect("symlink a dataset dir");

    let outcome = migrate(&root).expect("migration succeeds");

    assert_eq!(
        outcome.databases_renamed,
        vec![root.clone()],
        "only the root's own database may be migrated"
    );
    assert_eq!(marker(&root.join(DB_FILE_NAME)), "default-data");
    assert_eq!(
        marker(&outside.join(LEGACY_DB_FILE_NAME)),
        "data-outside-the-app",
        "the symlink target must never be renamed"
    );
    assert!(
        !outside.join(DB_FILE_NAME).exists(),
        "no file outside the app-data root may be renamed"
    );
}

/// A symlink whose target is a database *file* rather than a directory must also be
/// left alone, and must not abort the launch either — it is simply not a dataset.
#[test]
fn a_symlinked_file_under_datasets_is_skipped() {
    let (parent, root) = fixture_root();
    let outside = outside_target(parent.path(), "data-outside-the-app");
    seed_legacy_db(&root, "default-data");
    let nested = root.join(DATASETS_SUBDIR);
    std::fs::create_dir_all(&nested).expect("datasets dir");
    symlink(
        outside.join(LEGACY_DB_FILE_NAME),
        nested.join("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"),
    )
    .expect("symlink a file");

    let outcome = migrate(&root).expect("migration succeeds");

    assert_eq!(outcome.databases_renamed, vec![root.clone()]);
    assert_eq!(
        marker(&outside.join(LEGACY_DB_FILE_NAME)),
        "data-outside-the-app"
    );
}

/// The guard must not reject a legitimate install: a real directory reached through no
/// link at all still migrates. Without this, making `relocate_root` refuse everything
/// would satisfy every other test in this file.
#[test]
fn a_real_legacy_root_directory_still_migrates() {
    let (_parent, root) = fixture_root();
    let legacy = legacy_beside(&root);
    seed_legacy_db(&legacy, "default-data");

    let outcome = migrate(&root).expect("migration succeeds");

    assert_eq!(outcome.root_moved_from.as_deref(), Some(legacy.as_path()));
    assert_eq!(marker(&root.join(DB_FILE_NAME)), "default-data");
}
