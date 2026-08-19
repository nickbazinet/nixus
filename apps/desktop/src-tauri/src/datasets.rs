//! Dataset path authority (AD-5).
//!
//! This is the *only* module allowed to call `app.path().app_data_dir()`. Every
//! other module resolves filesystem paths through `global_root`, `dataset_dir`,
//! or `active_dataset_dir` so a single choke point exists for per-dataset
//! scoping.
//!
//! Path resolution is split in two: the `AppHandle`-dependent wrappers below,
//! and the pure `Path`-based helpers (`dataset_dir_from_root`,
//! `resolve_active_dir`) that hold 100% of the branching and are unit-testable
//! without a running Tauri app. This mirrors `profile_store::profiles_dir`.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use tauri::{AppHandle, Manager};
use tracing::warn;

use crate::error::AppError;
use crate::json_store::write_json_atomic;
use crate::models::{Dataset, DatasetKind};

/// Fixed literal id of the Default dataset (AD-2). Its directory *is* the app
/// data root — no files move on upgrade.
pub(crate) const DEFAULT_DATASET_ID: &str = "default";

/// Which dataset id is active for this run.
///
/// Deliberately minimal, temporary shim: it exists only so `active_dataset_dir`
/// is genuinely fallible starting now. Story 33.3 replaces it outright by
/// folding the id into `DbState`'s Tauri-managed `ActiveDataset { id, conn }` —
/// do not extend it beyond what Story 33.1 needs.
static ACTIVE_DATASET_ID: Mutex<Option<String>> = Mutex::new(None);

/// Records the dataset id active for this run. Called once from `lib.rs`'s
/// `.setup()` before `init_db`.
pub(crate) fn set_active_dataset_id(id: &str) {
    let mut guard = ACTIVE_DATASET_ID
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *guard = Some(id.to_string());
}

fn active_dataset_id() -> Option<String> {
    ACTIVE_DATASET_ID
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

/// The app data root: anchors dataset-independent state (the demographic
/// `profiles/` store per AD-13, the vehicle-catalog cache, logs) and, from
/// Story 33.2 on, `datasets.json`.
pub(crate) fn global_root(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path().app_data_dir().map_err(|e| AppError::File {
        message: format!("Failed to resolve app data dir: {}", e),
    })
}

/// Directory owning `id`'s dataset. Pure and lock-free.
///
/// `#[allow(dead_code)]`: this is the third of the three functions AD-5
/// mandates, and Stories 33.2/33.3 (`create_dataset`, `select_dataset`) are its
/// callers. The repo has no Tauri test harness to exercise an `AppHandle`
/// wrapper, so a test cannot stand in as a caller either; the pure
/// `dataset_dir_from_root` it delegates to *is* covered below.
#[allow(dead_code)]
pub(crate) fn dataset_dir(app: &AppHandle, id: &str) -> Result<PathBuf, AppError> {
    Ok(dataset_dir_from_root(&global_root(app)?, id))
}

/// Directory owning the dataset active for this run.
///
/// Fails with `AppError::NotConfigured` when no dataset has been marked active.
pub(crate) fn active_dataset_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let root = global_root(app)?;

    resolve_active_dir(&root, active_dataset_id().as_deref())
}

/// Default lives at the root itself; every other dataset under `datasets/<id>/`.
fn dataset_dir_from_root(root: &Path, id: &str) -> PathBuf {
    if id == DEFAULT_DATASET_ID {
        root.to_path_buf()
    } else {
        root.join("datasets").join(id)
    }
}

fn resolve_active_dir(root: &Path, id: Option<&str>) -> Result<PathBuf, AppError> {
    Ok(dataset_dir_from_root(
        root,
        id.ok_or(AppError::NotConfigured)?,
    ))
}

/// The registry file (AD-3). This module is the only place the literal appears.
const REGISTRY_FILE_NAME: &str = "datasets.json";

const DEFAULT_DATASET_LABEL: &str = "Default";

/// Serializes the registry's existence-check → read-or-create sequence.
///
/// Deliberately *not* `ACTIVE_DATASET_ID`: AD-3's registry lock and AD-6's
/// active-dataset lock guard unrelated invariants, and merging them would make a
/// future `select_dataset` block registry reads. It guards the sequence, not a
/// payload, so a poisoned guard has nothing to recover beyond the unit.
static REGISTRY_LOCK: Mutex<()> = Mutex::new(());

fn registry_path(root: &Path) -> PathBuf {
    root.join(REGISTRY_FILE_NAME)
}

// WHY re-validated on read instead of trusted: an id becomes a directory name
// under `datasets/`, so excluding `.`, `/` and `\` is what stops a hand-edited
// `..` or `a/b` from escaping the app data root. A strict subset of
// `profile_store::validate_sub`'s charset — that one additionally allows `_` —
// and kept separate on purpose: subs are opaque identity keys, ids are path
// components.
fn is_valid_dataset_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn default_dataset_entry() -> Dataset {
    Dataset {
        id: DEFAULT_DATASET_ID.to_string(),
        label: DEFAULT_DATASET_LABEL.to_string(),
        kind: DatasetKind::Local,
        cognito_sub: None,
        linked_from: None,
        is_default: true,
        created_at: Utc::now().to_rfc3339(),
    }
}

// One unusable entry is not a corrupt registry: skipping it keeps every other
// dataset reachable, where an `Err` would lock the user out of all of them. A
// parse failure of the *file* stays fatal — see `bootstrap_registry_at`.
fn load_registry_entries(path: &Path) -> Result<Vec<Dataset>, AppError> {
    let raw = std::fs::read_to_string(path).map_err(|e| AppError::File {
        message: format!("Failed to read dataset registry: {}", e),
    })?;

    let entries: Vec<Dataset> = serde_json::from_str(&raw).map_err(|e| AppError::File {
        message: format!("Failed to parse dataset registry: {}", e),
    })?;

    Ok(entries
        .into_iter()
        .filter(|entry| {
            let valid = is_valid_dataset_id(&entry.id);
            if !valid {
                // Echoed because an id is an opaque slug, unlike `cognito_sub`.
                warn!(
                    "Dataset registry entry has an unusable id {:?}; skipping it",
                    entry.id
                );
            }
            valid
        })
        .collect())
}

/// Reads `root`'s registry, creating it with the single Default entry when absent.
///
/// Idempotent, and identical on the upgrade path (an `nkbaz-finance.db` already at
/// `root`) and a fresh install, because no sibling file is ever inspected. An
/// existing-but-unparseable registry is a hard error rather than a re-bootstrap,
/// which would orphan every non-default dataset recorded in it.
fn bootstrap_registry_at(root: &Path) -> Result<Vec<Dataset>, AppError> {
    let _guard = REGISTRY_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let path = registry_path(root);
    if path.exists() {
        return load_registry_entries(&path);
    }

    let entries = vec![default_dataset_entry()];
    write_json_atomic(&path, &entries)?;

    Ok(entries)
}

/// Called once from `lib.rs`'s `.setup()` before any UI renders (AD-4).
pub(crate) fn bootstrap_registry(app: &AppHandle) -> Result<Vec<Dataset>, AppError> {
    bootstrap_registry_at(&global_root(app)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_registry(root: &Path, contents: &str) {
        std::fs::write(registry_path(root), contents).expect("registry written");
    }

    fn entry(id: &str) -> Dataset {
        Dataset {
            id: id.to_string(),
            label: format!("Label {id}"),
            kind: DatasetKind::CloudLinked,
            cognito_sub: Some("sub-1".to_string()),
            linked_from: Some("device-a".to_string()),
            is_default: false,
            created_at: "2026-01-01T00:00:00+00:00".to_string(),
        }
    }

    #[test]
    fn dataset_dir_from_root_returns_root_unchanged_for_default_id() {
        let root = Path::new("/tmp/app-data");

        assert_eq!(dataset_dir_from_root(root, DEFAULT_DATASET_ID), root);
    }

    #[test]
    fn dataset_dir_from_root_nests_non_default_id_under_datasets() {
        let root = Path::new("/tmp/app-data");
        let id = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

        assert_eq!(
            dataset_dir_from_root(root, id),
            root.join("datasets").join(id)
        );
    }

    #[test]
    fn resolve_active_dir_errors_when_no_dataset_is_active() {
        let result = resolve_active_dir(Path::new("/tmp/app-data"), None);

        assert!(matches!(result, Err(AppError::NotConfigured)));
    }

    #[test]
    fn resolve_active_dir_returns_root_when_default_is_active() {
        let root = Path::new("/tmp/app-data");

        assert_eq!(
            resolve_active_dir(root, Some(DEFAULT_DATASET_ID)).unwrap(),
            root
        );
    }

    #[test]
    fn resolve_active_dir_nests_non_default_active_id() {
        let root = Path::new("/tmp/app-data");
        let id = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

        assert_eq!(
            resolve_active_dir(root, Some(id)).unwrap(),
            root.join("datasets").join(id)
        );
    }

    // One test, not two: ACTIVE_DATASET_ID is a process-wide static and cargo
    // runs tests on parallel threads, so separate #[test] functions writing it
    // would race. Both assertions stay sequential in a single thread.
    #[test]
    fn set_active_dataset_id_is_what_the_getter_reports() {
        set_active_dataset_id(DEFAULT_DATASET_ID);
        assert_eq!(active_dataset_id().as_deref(), Some(DEFAULT_DATASET_ID));

        set_active_dataset_id("other");
        assert_eq!(active_dataset_id().as_deref(), Some("other"));
    }

    #[test]
    fn registry_path_is_datasets_json_at_the_root() {
        let root = TempDir::new().expect("temp dir");

        assert_eq!(registry_path(root.path()), root.path().join("datasets.json"));
    }

    #[test]
    fn bootstrapping_a_missing_registry_writes_exactly_one_default_entry() {
        let root = TempDir::new().expect("temp dir");

        let entries = bootstrap_registry_at(root.path()).expect("bootstrap succeeds");

        assert_eq!(entries.len(), 1);
        let default = &entries[0];
        assert_eq!(default.id, DEFAULT_DATASET_ID);
        assert_eq!(default.label, "Default");
        assert_eq!(default.kind, DatasetKind::Local);
        assert_eq!(default.cognito_sub, None);
        assert_eq!(default.linked_from, None);
        assert!(default.is_default);
        assert!(
            chrono::DateTime::parse_from_rfc3339(&default.created_at).is_ok(),
            "created_at must be RFC 3339, got {}",
            default.created_at
        );
        assert!(registry_path(root.path()).exists());
    }

    // The on-disk shape is the contract Stories 33.3/33.4 read, so it is asserted
    // as raw JSON rather than only through the round-tripped struct.
    #[test]
    fn the_bootstrapped_file_is_an_array_carrying_the_ad3_wire_schema() {
        let root = TempDir::new().expect("temp dir");

        bootstrap_registry_at(root.path()).expect("bootstrap succeeds");

        let raw = std::fs::read_to_string(registry_path(root.path())).expect("file readable");
        let value: serde_json::Value = serde_json::from_str(&raw).expect("valid json");
        let array = value.as_array().expect("the registry is a JSON array");

        assert_eq!(array.len(), 1);
        assert_eq!(array[0]["id"], "default");
        assert_eq!(array[0]["label"], "Default");
        assert_eq!(array[0]["kind"], "local");
        assert_eq!(array[0]["is_default"], true);
        assert!(array[0]["cognito_sub"].is_null());
        assert!(array[0]["linked_from"].is_null());
        assert!(array[0]["created_at"].is_string());
        assert!(
            array[0].get("createdAt").is_none(),
            "snake_case keys only on the wire"
        );
        assert!(
            !root.path().join("datasets.json.tmp").exists(),
            "the atomic-write temp file must not survive"
        );
    }

    // The fresh-install path: on a first-ever launch the app data root itself may
    // not exist, so bootstrap must lean on `write_json_atomic`'s `create_dir_all`
    // rather than assuming a caller made the directory first.
    #[test]
    fn bootstrapping_creates_the_root_directory_when_it_does_not_exist_yet() {
        let parent = TempDir::new().expect("temp dir");
        let root = parent.path().join("does-not-exist-yet");
        assert!(!root.exists(), "the fixture must start with no root at all");

        let entries = bootstrap_registry_at(&root).expect("bootstrap succeeds");

        assert!(root.is_dir(), "bootstrap must create the root directory");
        assert!(registry_path(&root).exists());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, DEFAULT_DATASET_ID);
        assert!(entries[0].is_default);
        assert_eq!(
            load_registry_entries(&registry_path(&root)).expect("load succeeds"),
            entries,
            "what landed on disk is what was returned"
        );
    }

    // The upgrade path: an existing database at the root must be recognized as
    // Default with zero files moved, copied or renamed.
    #[test]
    fn bootstrapping_never_touches_a_sibling_database_file() {
        let root = TempDir::new().expect("temp dir");
        let db = root.path().join("nkbaz-finance.db");
        std::fs::write(&db, b"pretend sqlite bytes").expect("db written");

        let entries = bootstrap_registry_at(root.path()).expect("bootstrap succeeds");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, DEFAULT_DATASET_ID);
        assert_eq!(
            std::fs::read(&db).expect("db still readable"),
            b"pretend sqlite bytes",
            "the upgrade path must move, copy and rename nothing"
        );
    }

    #[test]
    fn bootstrapping_an_existing_registry_leaves_it_byte_for_byte_unchanged() {
        let root = TempDir::new().expect("temp dir");
        let existing = vec![entry("aaaa-1111"), entry("bbbb-2222")];
        write_registry(
            root.path(),
            &serde_json::to_string(&existing).expect("serialized"),
        );
        let before = std::fs::read(registry_path(root.path())).expect("file readable");

        let entries = bootstrap_registry_at(root.path()).expect("bootstrap succeeds");

        assert_eq!(entries, existing, "the recorded entries are returned as-is");
        assert_eq!(
            std::fs::read(registry_path(root.path())).expect("file readable"),
            before,
            "an existing registry must never be rewritten"
        );
    }

    // Re-running bootstrap must not append a second Default entry, which is what
    // would silently orphan the first one's directory.
    #[test]
    fn bootstrapping_is_idempotent() {
        let root = TempDir::new().expect("temp dir");

        let first = bootstrap_registry_at(root.path()).expect("first bootstrap");
        let second = bootstrap_registry_at(root.path()).expect("second bootstrap");

        assert_eq!(first, second);
        assert_eq!(second.len(), 1);
    }

    #[test]
    fn a_corrupt_registry_is_a_hard_error_and_is_left_untouched() {
        for corrupt in [
            "{ not json",
            r#"{"datasets":[]}"#,
            r#"[{"id":"a","label":"A"}]"#,
            "",
        ] {
            let root = TempDir::new().expect("temp dir");
            write_registry(root.path(), corrupt);

            let error = bootstrap_registry_at(root.path()).expect_err("bootstrap must fail");

            assert!(
                matches!(error, AppError::File { .. }),
                "expected AppError::File, got {error:?}"
            );
            assert_eq!(
                std::fs::read_to_string(registry_path(root.path())).expect("file readable"),
                corrupt,
                "a corrupt registry must never be silently replaced"
            );
        }
    }

    #[test]
    fn an_entry_with_an_unusable_id_is_skipped_without_failing_the_load() {
        let root = TempDir::new().expect("temp dir");
        let seeded = vec![
            entry("good-1"),
            entry("a/b"),
            entry(""),
            entry(".."),
            entry(&"x".repeat(129)),
            entry("good-2"),
        ];
        write_registry(
            root.path(),
            &serde_json::to_string(&seeded).expect("serialized"),
        );

        let entries =
            load_registry_entries(&registry_path(root.path())).expect("load still succeeds");

        assert_eq!(
            entries.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            vec!["good-1", "good-2"]
        );
    }

    #[test]
    fn loading_an_absent_registry_is_a_file_error() {
        let root = TempDir::new().expect("temp dir");

        let error =
            load_registry_entries(&registry_path(root.path())).expect_err("load must fail");

        assert!(matches!(error, AppError::File { .. }));
    }

    #[test]
    fn the_id_charset_accepts_path_safe_ids_and_rejects_the_rest() {
        for accepted in [
            DEFAULT_DATASET_ID,
            "7c9e6679-7425-40de-944b-e07fc1f90ae7",
            "A1",
            &"x".repeat(128),
        ] {
            assert!(is_valid_dataset_id(accepted), "{accepted} must be accepted");
        }

        for rejected in [
            "",
            "..",
            "a/b",
            "a\\b",
            "a.b",
            "a_b",
            "a b",
            "café",
            &"x".repeat(129),
        ] {
            assert!(!is_valid_dataset_id(rejected), "{rejected} must be rejected");
        }
    }

    // A round trip through the file is the only assertion that proves the enum's
    // kebab-case wire form is also what deserializes back.
    #[test]
    fn a_cloud_linked_kind_round_trips_through_the_registry_file() {
        let root = TempDir::new().expect("temp dir");
        let seeded = vec![entry("cloud-1")];
        write_registry(
            root.path(),
            &serde_json::to_string(&seeded).expect("serialized"),
        );

        let raw = std::fs::read_to_string(registry_path(root.path())).expect("file readable");
        let value: serde_json::Value = serde_json::from_str(&raw).expect("valid json");
        assert_eq!(value[0]["kind"], "cloud-linked");

        let entries = load_registry_entries(&registry_path(root.path())).expect("load succeeds");
        assert_eq!(entries[0].kind, DatasetKind::CloudLinked);
    }
}
