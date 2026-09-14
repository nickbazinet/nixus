//! Structural guard over `lib.rs`'s startup ordering.
//!
//! The migration's correctness is entirely a function of *when* it runs, and nothing
//! about `.setup()` makes that visible: moving the call three lines down still compiles,
//! still passes every other test in this crate, and silently strands the app data of
//! every existing install on first launch. Only the ordering is asserted, by reading the
//! source — driving the real `.setup()` would need a running Tauri app, a real app-data
//! directory, and the OS keychain.
//!
//! Each anchor is matched on its fully-qualified *call* form and required to appear
//! exactly once, so a rename or a second call site fails loudly here rather than
//! quietly weakening the guard to a no-op.

use std::path::Path;

/// The migration call, and every step it must precede, with why.
const MUST_FOLLOW_THE_MIGRATION: [(&str, &str); 5] = [
    (
        "std::fs::create_dir_all(&app_data_dir)",
        "creating the new root makes the atomic rename of the legacy root impossible",
    ),
    (
        "tracing_appender::rolling::daily(",
        "opening a log file inside the new root creates that root",
    ),
    (
        "tracing_subscriber::fmt()",
        "the subscriber is initialized against a root that must already be final",
    ),
    (
        "datasets::bootstrap_registry(",
        "bootstrapping writes datasets.json into the new root, creating it",
    ),
    (
        "commands::datasets::select_dataset_now(",
        "selecting a dataset opens a database, which creates it under the new name and \
         shadows the user's real one",
    ),
];

const MIGRATION_CALL: &str = "app_migration::migrate_from_legacy_identity(";

/// Steps the *credential* migration must sit between, for the same class of reason.
const CREDENTIAL_MIGRATION_CALL: &str = "credentials::migrate_legacy_ai_credentials(";
const KEYCHAIN_INIT: &str = "keyring::use_native_store(";
const AI_CLIENT_INIT: &str = "ai::init_ai_client(";

fn lib_source() -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lib.rs");
    std::fs::read_to_string(&path).expect("lib.rs is readable")
}

/// The byte offset of `needle`, asserting it appears exactly once.
///
/// Uniqueness is the guard's own integrity check: a needle that stopped matching, or
/// that matched twice, would otherwise turn an ordering assertion into a coin flip.
fn sole_offset(source: &str, needle: &str) -> usize {
    let occurrences = source.matches(needle).count();
    assert_eq!(
        occurrences, 1,
        "expected exactly one occurrence of {needle:?} in lib.rs, found {occurrences}; \
         this guard cannot enforce ordering against an anchor it cannot locate"
    );

    source.find(needle).expect("just counted one")
}

#[test]
fn the_app_data_migration_runs_before_anything_that_can_create_the_new_root() {
    let source = lib_source();
    let migration = sole_offset(&source, MIGRATION_CALL);

    for (anchor, reason) in MUST_FOLLOW_THE_MIGRATION {
        let offset = sole_offset(&source, anchor);
        assert!(
            migration < offset,
            "app_migration::migrate_from_legacy_identity must run BEFORE {anchor}: {reason}"
        );
    }
}

/// The credential migration's window: after the keychain store exists, before the first
/// reader. Too early and every keyring call fails; too late and a credential still under
/// the legacy service presents as "AI not configured" for the whole run.
#[test]
fn the_credential_migration_runs_after_keychain_init_and_before_the_first_reader() {
    let source = lib_source();
    let migration = sole_offset(&source, CREDENTIAL_MIGRATION_CALL);

    assert!(
        sole_offset(&source, KEYCHAIN_INIT) < migration,
        "{CREDENTIAL_MIGRATION_CALL} must run AFTER {KEYCHAIN_INIT}: no keyring entry is \
         reachable before the store is installed"
    );
    assert!(
        migration < sole_offset(&source, AI_CLIENT_INIT),
        "{CREDENTIAL_MIGRATION_CALL} must run BEFORE {AI_CLIENT_INIT}: it is the first \
         reader, and an unmigrated credential reads as absent"
    );
}

/// The filesystem migration must also precede the credential one, so a launch that
/// aborts on a filesystem fault has not already begun moving keyring entries.
#[test]
fn the_filesystem_migration_runs_before_the_credential_migration() {
    let source = lib_source();

    assert!(
        sole_offset(&source, MIGRATION_CALL) < sole_offset(&source, CREDENTIAL_MIGRATION_CALL),
        "{MIGRATION_CALL} must run BEFORE {CREDENTIAL_MIGRATION_CALL}"
    );
}
