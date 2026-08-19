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

use crate::db::{init_db, DbState};
use crate::error::AppError;
use crate::json_store::write_json_atomic;
use crate::models::{Dataset, DatasetKind};

/// Fixed literal id of the Default dataset (AD-2). Its directory *is* the app
/// data root — no files move on upgrade.
pub(crate) const DEFAULT_DATASET_ID: &str = "default";

/// The app data root: anchors dataset-independent state (the demographic
/// `profiles/` store per AD-13, the vehicle-catalog cache, logs) and, from
/// Story 33.2 on, `datasets.json`.
pub(crate) fn global_root(app: &AppHandle) -> Result<PathBuf, AppError> {
    app.path().app_data_dir().map_err(|e| AppError::File {
        message: format!("Failed to resolve app data dir: {}", e),
    })
}

/// Directory owning `id`'s dataset. Pure and lock-free.
pub(crate) fn dataset_dir(app: &AppHandle, id: &str) -> Result<PathBuf, AppError> {
    Ok(dataset_dir_from_root(&global_root(app)?, id))
}

/// Directory owning the dataset active for this run.
///
/// The id is read from the same `ActiveDataset` the open connection lives in
/// (AD-6), so a path can never be resolved for a dataset other than the one
/// currently connected.
///
/// **Never call this while holding `DbState`'s guard** (anything obtained from
/// `state.0.lock()`): this function re-acquires that same lock, and
/// `std::sync::Mutex` is not reentrant, so the call would deadlock silently
/// rather than return an error. Resolve the path *before* locking.
///
/// Fails with `AppError::NotConfigured` when no dataset has been selected.
pub(crate) fn active_dataset_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    let root = global_root(app)?;

    let state = app.state::<DbState>();
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    resolve_active_dir(&root, active.id.as_deref())
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
/// Deliberately *not* `DbState`'s lock: AD-3's registry lock and AD-6's
/// active-dataset lock guard unrelated invariants, and merging them would make
/// `select_dataset` block registry reads. It guards the sequence, not a
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
    Ok(read_registry_for_update(path)?
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

/// Parses the registry with **no** id filtering, for the read half of a
/// read-modify-write.
///
/// `load_registry_entries`'s skipping is the right *view* for a reader, but it is
/// lossy, and writing that view back would permanently delete every skipped entry
/// — with no delete/restore affordance anywhere in the product to undo it. A
/// mutator therefore rewrites the file as it actually is, and uses the filtered
/// view only where "what the user can see" is the question. A file that does not
/// deserialize at all stays a hard error, exactly as on the read path.
fn read_registry_for_update(path: &Path) -> Result<Vec<Dataset>, AppError> {
    let raw = std::fs::read_to_string(path).map_err(|e| AppError::File {
        message: format!("Failed to read dataset registry: {}", e),
    })?;

    serde_json::from_str(&raw).map_err(|e| AppError::File {
        message: format!("Failed to parse dataset registry: {}", e),
    })
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

/// Every dataset the registry records. Unlike `bootstrap_registry`, this never
/// creates the file — by the time anything reads it, `.setup()` has already
/// guaranteed it exists.
pub(crate) fn load_registry(app: &AppHandle) -> Result<Vec<Dataset>, AppError> {
    load_registry_entries(&registry_path(&global_root(app)?))
}

/// A canonical lowercase hyphenated UUID v4, minted from 16 random bytes.
///
/// Hand-rolled rather than taken from the `uuid` crate, which is only a
/// transitive dependency: this epic adds none, and `rand::random::<[u8; N]>()` is
/// already this codebase's way of drawing random bytes (`commands/auth.rs`'s PKCE
/// verifier and state). RFC 4122 §4.4 is entirely "16 random bytes with the
/// version nibble and the variant bits pinned", which is all that happens here.
/// Lowercase hex plus `-` is also exactly what `is_valid_dataset_id` accepts, so
/// the id is usable verbatim as a directory name.
fn new_dataset_id() -> String {
    let mut bytes = rand::random::<[u8; 16]>();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    let mut id = String::with_capacity(36);
    for (index, byte) in bytes.iter().enumerate() {
        if matches!(index, 4 | 6 | 8 | 10) {
            id.push('-');
        }
        id.push_str(&format!("{byte:02x}"));
    }

    id
}

/// The label the next local profile gets: `"Local Profile <n>"`.
///
/// `n` counts the existing local, non-default entries — Default and every
/// cloud-linked entry are excluded, because neither is a "Local Profile <n>" and
/// counting them would skip numbers. Counting rather than max-plus-one is what
/// the story specifies, and it is only sound while removal does not exist:
/// deleting "Local Profile 1" of two would make the next create collide with
/// "Local Profile 2". Whenever a delete affordance lands, this has to become
/// max-plus-one.
///
/// Takes an iterator so the caller chooses the view: the label is derived from the
/// entries the *picker can show*, not from every line in the file.
fn next_local_label<'a>(entries: impl Iterator<Item = &'a Dataset>) -> String {
    let existing = entries
        .filter(|entry| !entry.is_default && entry.kind == DatasetKind::Local)
        .count();

    format!("Local Profile {}", existing + 1)
}

/// Refuses an id that any existing dataset already owns.
///
/// `create_dir_all` succeeds on a directory that already exists and `init_db` is a
/// no-op against an already-migrated database, so without this a collision would
/// silently adopt another dataset's populated data with nothing anywhere noticing.
/// 122 bits of entropy makes it near-impossible and the consequence unrecoverable.
///
/// Split out of `create_dataset_at` so the branch is unit-testable at all — the
/// minter cannot be steered onto a chosen id — mirroring `resolve_active_dir` and
/// `commands::datasets::find_registered`.
fn reject_taken_id(entries: &[Dataset], id: &str, dir: &Path) -> Result<(), AppError> {
    if entries.iter().any(|entry| entry.id == id) || dir.exists() {
        return Err(AppError::File {
            message: format!("Dataset {} already exists", id),
        });
    }

    Ok(())
}

/// Appends a brand-new, empty local dataset to `root`'s registry.
///
/// The registry's first mutator. `REGISTRY_LOCK` is held for the *whole*
/// read-modify-write rather than only the write, so two concurrent creates can
/// neither derive the same label nor drop each other's entry. The read goes
/// through the non-locking `read_registry_for_update`, never `load_registry`,
/// which resolves its own path and would read outside the guard.
///
/// The registry entry is written **last**, once the directory and its migrated
/// database already exist. The registry is the sole source of truth for which
/// datasets exist (AD-3), so the only failure this ordering can leak is a
/// directory nothing points at — invisible, and reaped below anyway. The reverse
/// ordering would leak a picker row pointing at a dataset that cannot open, which
/// the user has no way to remove.
pub(crate) fn create_dataset_at(root: &Path) -> Result<Dataset, AppError> {
    // Same poison recovery, for the same reason, as `bootstrap_registry_at`.
    let _guard = REGISTRY_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let path = registry_path(root);
    // Unfiltered, because this list is written back: an entry whose id fails
    // `is_valid_dataset_id` is invisible to the picker but must still survive a
    // create, and nothing in the product could restore it if it did not.
    let mut entries = read_registry_for_update(&path)?;

    let dataset = Dataset {
        id: new_dataset_id(),
        // The filtered view, and only here: the label numbers the profiles the user
        // can actually see, so a skipped entry must not consume a number.
        label: next_local_label(
            entries
                .iter()
                .filter(|entry| is_valid_dataset_id(&entry.id)),
        ),
        kind: DatasetKind::Local,
        cognito_sub: None,
        linked_from: None,
        is_default: false,
        created_at: Utc::now().to_rfc3339(),
    };

    let dir = dataset_dir_from_root(root, &dataset.id);

    // Strictly before anything is created, and strictly before the cleanup below
    // becomes reachable.
    reject_taken_id(&entries, &dataset.id, &dir)?;

    std::fs::create_dir_all(&dir).map_err(|e| AppError::File {
        message: format!("Failed to create dataset directory: {}", e),
    })?;

    // `init_db`'s connection is dropped immediately: `select_dataset` opens its own
    // when the user actually chooses this profile, so holding this one would leak a
    // handle for the life of the process.
    let provisioned = init_db(&dir).and_then(|conn| {
        drop(conn);
        entries.push(dataset.clone());
        write_json_atomic(&path, &entries)
    });

    if let Err(error) = provisioned {
        // Best effort, and correct ONLY because the collision guard above proved
        // this directory did not exist before this call — so this can only remove
        // what this call created. Moving that guard after this point turns this
        // line into a data-loss bug: a collision followed by an error would wipe a
        // pre-existing dataset's database. Without the cleanup, repeated failures
        // accumulate migrated databases that nothing will ever reap.
        let _ = std::fs::remove_dir_all(&dir);
        return Err(error);
    }

    Ok(dataset)
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

    fn bootstrapped_root() -> TempDir {
        let root = TempDir::new().expect("temp dir");
        bootstrap_registry_at(root.path()).expect("bootstrap succeeds");
        root
    }

    fn recorded(root: &Path) -> Vec<Dataset> {
        load_registry_entries(&registry_path(root)).expect("load succeeds")
    }

    #[test]
    fn the_first_created_profile_is_labelled_local_profile_1() {
        let root = bootstrapped_root();

        let created = create_dataset_at(root.path()).expect("create succeeds");

        assert_eq!(created.label, "Local Profile 1");
        assert_eq!(created.kind, DatasetKind::Local);
        assert!(!created.is_default);
        assert_eq!(created.cognito_sub, None);
        assert_eq!(created.linked_from, None);
        assert!(
            chrono::DateTime::parse_from_rfc3339(&created.created_at).is_ok(),
            "created_at must be RFC 3339, got {}",
            created.created_at
        );
    }

    #[test]
    fn a_second_create_advances_the_label_and_gets_its_own_directory() {
        let root = bootstrapped_root();

        let first = create_dataset_at(root.path()).expect("first create succeeds");
        let second = create_dataset_at(root.path()).expect("second create succeeds");

        assert_eq!(first.label, "Local Profile 1");
        assert_eq!(second.label, "Local Profile 2");
        assert_ne!(first.id, second.id, "each create mints its own id");
        assert!(dataset_dir_from_root(root.path(), &first.id).is_dir());
        assert!(dataset_dir_from_root(root.path(), &second.id).is_dir());
    }

    // Cloud-linked entries are not "Local Profile <n>", so counting them would
    // leave a gap in the sequence the very first time Epic 35 links one.
    #[test]
    fn a_cloud_linked_entry_is_not_counted_when_labelling() {
        let root = TempDir::new().expect("temp dir");
        let seeded = vec![
            default_dataset_entry(),
            Dataset {
                label: "Local Profile 1".to_string(),
                kind: DatasetKind::Local,
                cognito_sub: None,
                linked_from: None,
                ..entry("local-1")
            },
            entry("cloud-1"),
        ];
        write_registry(
            root.path(),
            &serde_json::to_string(&seeded).expect("serialized"),
        );

        let created = create_dataset_at(root.path()).expect("create succeeds");

        assert_eq!(created.label, "Local Profile 2");

        // The rewrite is the risk, not the label: every seeded entry has to come back
        // out of the file unchanged and in order, or a create silently edited a
        // profile it was only supposed to read.
        let after = recorded(root.path());
        assert_eq!(after.len(), seeded.len() + 1);
        assert_eq!(after[..seeded.len()], seeded[..]);
        assert_eq!(after[seeded.len()], created);
    }

    #[test]
    fn a_created_profile_owns_a_migrated_empty_database() {
        let root = bootstrapped_root();

        let created = create_dataset_at(root.path()).expect("create succeeds");

        let dir = dataset_dir_from_root(root.path(), &created.id);
        assert!(dir.is_dir(), "the dataset directory must exist at {dir:?}");
        let db_path = dir.join("nkbaz-finance.db");
        assert!(db_path.is_file(), "a database must exist at {db_path:?}");

        let conn = rusqlite::Connection::open(&db_path).expect("database opens");
        let applied: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(version), 0) FROM schema_version",
                [],
                |row| row.get(0),
            )
            .expect("schema_version readable");
        assert!(applied > 0, "the migrations runner must have run");

        // The gate's *own* inputs, not a proxy: `check_onboarding_status` derives
        // `needs_onboarding` from exactly these two, so asserting them is what pins
        // the story's causal claim — a fresh profile is unonboarded because it is
        // empty. A migration that seeded a budget group would fail here, where a
        // count of some unrelated table would stay green.
        assert!(
            !crate::db::onboarding::has_budget_data(&conn).expect("budget data readable"),
            "a fresh profile must have no budget data"
        );
        assert!(
            !crate::db::onboarding::is_completed(&conn),
            "a fresh profile must not be marked onboarded"
        );
        let expenses: i64 = conn
            .query_row("SELECT COUNT(*) FROM expenses", [], |row| row.get(0))
            .expect("a migrated schema has an expenses table");
        assert_eq!(expenses, 0);
    }

    #[test]
    fn a_minted_id_is_a_canonical_lowercase_uuid_v4() {
        let root = bootstrapped_root();

        let created = create_dataset_at(root.path()).expect("create succeeds");

        // The id becomes a directory name, so passing the registry's own charset
        // check is the load-bearing property, not the RFC shape on its own.
        assert!(
            is_valid_dataset_id(&created.id),
            "{} must be a usable dataset id",
            created.id
        );
        assert_eq!(created.id.len(), 36);
        assert_eq!(
            created
                .id
                .char_indices()
                .filter(|(_, c)| *c == '-')
                .map(|(index, _)| index)
                .collect::<Vec<_>>(),
            vec![8, 13, 18, 23]
        );
        assert_eq!(created.id, created.id.to_lowercase());
        assert_eq!(
            created.id.chars().nth(14),
            Some('4'),
            "the version nibble must be 4"
        );
        assert!(
            matches!(created.id.chars().nth(19), Some('8' | '9' | 'a' | 'b')),
            "the variant bits must be 10, got {}",
            created.id
        );
    }

    #[test]
    fn creating_appends_to_the_registry_and_leaves_default_in_place() {
        let root = bootstrapped_root();

        let first = create_dataset_at(root.path()).expect("first create succeeds");
        let second = create_dataset_at(root.path()).expect("second create succeeds");

        let entries = recorded(root.path());
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].id, DEFAULT_DATASET_ID);
        assert!(entries[0].is_default);
        assert_eq!(entries[1], first, "the first create is recorded verbatim");
        assert_eq!(entries[2], second, "appended, never reordered");
        for created in [&entries[1], &entries[2]] {
            assert!(!created.is_default);
            assert_eq!(created.kind, DatasetKind::Local);
        }
    }

    // An upgrading user's only profile *is* Default's entry, so the rewrite must
    // leave it exactly as bootstrap recorded it. Asserted on the *parsed* entry
    // rather than a substring of the file: a `contains` check passes under
    // reordering, re-indentation, or a re-render of any other entry.
    #[test]
    fn creating_leaves_defaults_own_entry_untouched() {
        let root = TempDir::new().expect("temp dir");
        let bootstrapped = bootstrap_registry_at(root.path()).expect("bootstrap succeeds");

        create_dataset_at(root.path()).expect("create succeeds");

        let after = recorded(root.path());
        assert_eq!(after.len(), 2);
        assert_eq!(
            after[0], bootstrapped[0],
            "Default's recorded entry must survive the rewrite field-for-field"
        );
        assert_eq!(
            after[0].id, DEFAULT_DATASET_ID,
            "and must still be the first entry, not merely present somewhere"
        );
    }

    // The write-last ordering, exercised rather than asserted: `datasets` is a file
    // here, so the directory creation fails and `?` returns before the registry is
    // ever rewritten. That is *why* no rollback logic is needed for this window.
    //
    // Scoped deliberately to the *pre-provision* failure. The post-provision window
    // (`init_db` or the registry write failing once the directory exists) is handled
    // by `create_dataset_at`'s `remove_dir_all` cleanup, and is not reachable from a
    // test without modifying `init_db` — which this story forbids — so it is not
    // claimed here.
    #[test]
    fn a_failure_before_the_directory_is_provisioned_leaves_the_registry_intact() {
        let root = bootstrapped_root();
        std::fs::write(root.path().join("datasets"), b"not a directory")
            .expect("blocker written");
        let before = std::fs::read(registry_path(root.path())).expect("file readable");

        let error = create_dataset_at(root.path()).expect_err("create must fail");

        assert!(
            matches!(error, AppError::File { .. }),
            "expected AppError::File, got {error:?}"
        );
        assert_eq!(
            std::fs::read(registry_path(root.path())).expect("file readable"),
            before,
            "a failed create must not touch the registry"
        );
        let entries = recorded(root.path());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].id, DEFAULT_DATASET_ID);
    }

    // The regression `load_registry_entries`-as-the-read-half caused: its skipping is
    // a read-time view, so writing it back deletes the skipped entry from disk for
    // good — and no affordance in the product can restore a profile. A hand-edited or
    // corrupted id is exactly the case `is_valid_dataset_id` exists for, so this is
    // reachable, not theoretical.
    #[test]
    fn an_entry_the_reader_skips_still_survives_a_create() {
        let root = TempDir::new().expect("temp dir");
        let unusable = entry("a/b");
        let seeded = vec![default_dataset_entry(), unusable.clone()];
        write_registry(
            root.path(),
            &serde_json::to_string(&seeded).expect("serialized"),
        );

        let created = create_dataset_at(root.path()).expect("create succeeds");

        // Read unfiltered: the whole point is that the entry is still *on disk*, even
        // though `load_registry_entries` will go on hiding it from the picker.
        let on_disk = read_registry_for_update(&registry_path(root.path()))
            .expect("registry still parses");
        assert_eq!(on_disk.len(), seeded.len() + 1);
        assert_eq!(
            on_disk[..seeded.len()],
            seeded[..],
            "a create must never delete an entry the reader merely skips"
        );
        assert_eq!(on_disk[seeded.len()], created);

        // And the skipped entry does not consume a label number, because it is not a
        // profile the user can see.
        assert_eq!(recorded(root.path()).len(), 2);
        assert_eq!(created.label, "Local Profile 1");
    }

    // Near-impossible by construction, but `create_dir_all` succeeding on an existing
    // directory plus `init_db` being a no-op on an already-migrated database is what
    // would make a collision silently adopt another profile's populated data.
    #[test]
    fn an_id_any_existing_entry_already_owns_is_refused() {
        let root = TempDir::new().expect("temp dir");
        let entries = vec![default_dataset_entry(), entry("local-1")];

        for taken in [DEFAULT_DATASET_ID, "local-1"] {
            let error = reject_taken_id(&entries, taken, &root.path().join("nothing-here"))
                .expect_err("a registered id must be refused");

            assert!(
                matches!(error, AppError::File { .. }),
                "expected AppError::File, got {error:?}"
            );
        }
    }

    #[test]
    fn an_id_whose_directory_already_exists_is_refused_even_when_unregistered() {
        let root = TempDir::new().expect("temp dir");
        let squatter = dataset_dir_from_root(root.path(), "00000000-0000-4000-8000-000000000001");
        std::fs::create_dir_all(&squatter).expect("squatter created");

        // The registry does not know about it, so the directory check is the only thing
        // standing between a collision and adopting whatever database lives in there.
        let error = reject_taken_id(&[], "00000000-0000-4000-8000-000000000001", &squatter)
            .expect_err("an occupied directory must be refused");

        assert!(matches!(error, AppError::File { .. }));
    }

    #[test]
    fn a_fresh_id_with_no_directory_is_accepted() {
        let root = TempDir::new().expect("temp dir");
        let id = new_dataset_id();

        reject_taken_id(
            &[default_dataset_entry()],
            &id,
            &dataset_dir_from_root(root.path(), &id),
        )
        .expect("an unclaimed id must be accepted");
    }

    // Many draws, and no filesystem: the RFC shape was only observable through
    // `create_dataset_at` before, which does migrations just to inspect a string, and
    // a single sample cannot tell a real generator from a constant.
    #[test]
    fn every_minted_id_is_a_distinct_canonical_uuid_v4() {
        const DRAWS: usize = 1000;

        let ids: Vec<String> = (0..DRAWS).map(|_| new_dataset_id()).collect();

        let distinct: std::collections::HashSet<&String> = ids.iter().collect();
        assert_eq!(distinct.len(), DRAWS, "ids must not repeat");

        for id in &ids {
            assert!(is_valid_dataset_id(id), "{id} must be a usable dataset id");
            assert_eq!(id.len(), 36, "{id} must be 36 characters");
            assert_eq!(
                id.char_indices()
                    .filter(|(_, c)| *c == '-')
                    .map(|(index, _)| index)
                    .collect::<Vec<_>>(),
                vec![8, 13, 18, 23],
                "{id} must be hyphenated 8-4-4-4-12"
            );
            assert_eq!(*id, id.to_lowercase(), "{id} must be lowercase");
            assert_eq!(
                id.chars().nth(14),
                Some('4'),
                "{id} must carry version nibble 4"
            );
            assert!(
                matches!(id.chars().nth(19), Some('8' | '9' | 'a' | 'b')),
                "{id} must carry variant bits 10"
            );
        }
    }

    // AD-3's whole claim, which every sequential test above would satisfy with no lock
    // at all — or with the read and the write split into separate acquisitions, which
    // is precisely what the story forbids. Split them and the entry count drops as
    // creates overwrite each other's appends. Asserted on final state only, never on
    // timing, so it cannot flake.
    #[test]
    fn parallel_creates_all_survive_the_single_writer_lock() {
        const CREATES: usize = 8;
        let root = bootstrapped_root();

        let created: Vec<Dataset> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..CREATES)
                .map(|_| scope.spawn(|| create_dataset_at(root.path()).expect("create succeeds")))
                .collect();

            handles
                .into_iter()
                .map(|handle| handle.join().expect("thread did not panic"))
                .collect()
        });

        let ids: std::collections::HashSet<&str> =
            created.iter().map(|entry| entry.id.as_str()).collect();
        assert_eq!(ids.len(), CREATES, "every create must mint its own id");

        let labels: std::collections::HashSet<&str> =
            created.iter().map(|entry| entry.label.as_str()).collect();
        assert_eq!(
            labels.len(),
            CREATES,
            "two creates that both read the same registry would share a label"
        );

        let entries = recorded(root.path());
        assert_eq!(
            entries.len(),
            CREATES + 1,
            "Default plus every create must be recorded; a lost append means the \
             read-modify-write was not atomic"
        );
        for entry in &created {
            assert!(
                entries.contains(entry),
                "{} is missing from the registry",
                entry.id
            );
        }
    }
}
