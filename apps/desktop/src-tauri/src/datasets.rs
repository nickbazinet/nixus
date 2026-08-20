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

/// Id of the dataset active for this run, for callers that need to scope
/// dataset-owned side stores (the AI keyring service, Story 34.2) rather than a
/// path. Same lock discipline as `active_dataset_dir` above: never call while
/// holding `DbState`'s guard.
pub(crate) fn active_dataset_id(db: &DbState) -> Result<String, AppError> {
    let active = db.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    active.id.clone().ok_or(AppError::NotConfigured)
}

/// Default lives at the root itself; every other dataset under `datasets/<id>/`.
///
/// Pure and lock-free, which is why it is exposed: callers already holding
/// `DbState`'s guard pair it with the id they read off that same guard, instead
/// of releasing the guard and calling `active_dataset_dir` — the latter would
/// deadlock on the non-reentrant mutex, and resolving after unlocking would let
/// a dataset switch slip between the connection and its path.
pub(crate) fn dataset_dir_from_root(root: &Path, id: &str) -> PathBuf {
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

    // Unfiltered, because this list is written back: an entry whose id fails
    // `is_valid_dataset_id` is invisible to the picker but must still survive a
    // create, and nothing in the product could restore it if it did not.
    let entries = read_registry_for_update(&registry_path(root))?;

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

    provision_dataset(root, entries, dataset, |_| Ok(()))
}

/// The database file every dataset directory owns. Only the main file is ever
/// copied by a migration: a `-wal`/`-shm` sidecar belongs to the *source's* open
/// connection, and carrying one across would hand the copy a stale log to replay.
const DB_FILE_NAME: &str = "nkbaz-finance.db";

/// The database file `id` owns, resolved by explicit id so a caller can name a
/// dataset other than the active one — which is exactly what Migrate's source is.
pub(crate) fn dataset_db_path(root: &Path, id: &str) -> PathBuf {
    dataset_dir_from_root(root, id).join(DB_FILE_NAME)
}

/// The cloud-linked entry to reopen for `sub`, or `None` when this account has
/// never been linked here.
///
/// Most-recently-created wins. Several cloud-linked profiles sharing one subject
/// is an accepted, documented edge case (AD-12), so this is a deterministic
/// tie-break rather than an error. An unparseable `created_at` sorts as the epoch,
/// which keeps a hand-edited entry from shadowing a real one.
fn most_recent_for_sub<'a>(entries: &'a [Dataset], sub: &str) -> Option<&'a Dataset> {
    entries
        .iter()
        .filter(|entry| is_valid_dataset_id(&entry.id))
        .filter(|entry| entry.kind == DatasetKind::CloudLinked)
        .filter(|entry| entry.cognito_sub.as_deref() == Some(sub))
        .max_by_key(|entry| {
            chrono::DateTime::parse_from_rfc3339(&entry.created_at)
                .map(|at| at.timestamp_millis())
                .unwrap_or(i64::MIN)
        })
}

fn cloud_linked_entry(id: String, label: &str, sub: &str, linked_from: Option<&str>) -> Dataset {
    Dataset {
        id,
        label: label.to_string(),
        kind: DatasetKind::CloudLinked,
        cognito_sub: Some(sub.to_string()),
        linked_from: linked_from.map(str::to_string),
        is_default: false,
        created_at: Utc::now().to_rfc3339(),
    }
}

/// Provisions `dataset`'s directory and appends it to an already-read registry.
///
/// Shared by both cloud branches so "empty new profile" and "copy of a source
/// profile" differ only in `seed`, which runs after the directory exists and
/// before `init_db`. Every caller already holds `REGISTRY_LOCK` and passes the
/// entries it read under it, so this must never take the lock or re-read the file.
///
/// The registry entry is written last, and a failure removes the directory this
/// call created — the same ordering and cleanup `create_dataset_at` documents, and
/// correct for the same reason: `reject_taken_id` proved the directory was not
/// there before.
fn provision_dataset(
    root: &Path,
    mut entries: Vec<Dataset>,
    dataset: Dataset,
    seed: impl FnOnce(&Path) -> Result<(), AppError>,
) -> Result<Dataset, AppError> {
    let dir = dataset_dir_from_root(root, &dataset.id);
    reject_taken_id(&entries, &dataset.id, &dir)?;

    std::fs::create_dir_all(&dir).map_err(|e| AppError::File {
        message: format!("Failed to create dataset directory: {}", e),
    })?;

    let provisioned = seed(&dir)
        .and_then(|()| init_db(&dir))
        .and_then(|conn| {
            drop(conn);
            entries.push(dataset.clone());
            write_json_atomic(&registry_path(root), &entries)
        });

    if let Err(error) = provisioned {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(error);
    }

    Ok(dataset)
}

/// Story 35.2's Login branch: the cloud-linked dataset for `sub`, created the
/// first time and reopened on every later sign-in.
///
/// The whole find-or-create runs under `REGISTRY_LOCK`, so two callbacks racing
/// with the same account cannot both conclude "none exists" and mint a duplicate.
/// The lock is released by returning, *before* the caller activates the dataset —
/// holding it across the switch deadlocks the callback thread (AD-12).
pub(crate) fn find_or_create_cloud_dataset_at(
    root: &Path,
    sub: &str,
    label: &str,
) -> Result<Dataset, AppError> {
    let _guard = REGISTRY_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let entries = read_registry_for_update(&registry_path(root))?;

    if let Some(existing) = most_recent_for_sub(&entries, sub) {
        return Ok(existing.clone());
    }

    let dataset = cloud_linked_entry(new_dataset_id(), label, sub, None);
    provision_dataset(root, entries, dataset, |_| Ok(()))
}

/// Story 35.3's Migrate branch: a brand-new cloud-linked dataset holding a copy of
/// `source_id`'s database and AI-provider keys as of this moment.
///
/// `prepare_source` runs *inside* the registry lock and returns the source
/// database file to copy. It is the story's abort seam: it re-checks that the
/// source is still the active dataset and checkpoints its connection, so a user
/// who switched profiles during the browser round-trip gets an error with nothing
/// created. Injected rather than inlined so the whole copy is testable without a
/// running Tauri app — the same reason `resolve_active_dir` is split out.
///
/// The source is only ever *read*: it is resolved by explicit id (never through
/// the active-dataset helper), and no step here writes to, converts, or removes
/// it (FR5).
pub(crate) fn migrate_to_cloud_dataset_at(
    root: &Path,
    source_id: &str,
    sub: &str,
    label: &str,
    prepare_source: impl FnOnce() -> Result<PathBuf, AppError>,
) -> Result<Dataset, AppError> {
    let _guard = REGISTRY_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let entries = read_registry_for_update(&registry_path(root))?;
    if !entries.iter().any(|entry| entry.id == source_id) {
        return Err(AppError::Validation {
            message: format!("Unknown dataset: {}", source_id),
            field: Some("source_dataset_id".to_string()),
        });
    }

    let source_db = prepare_source()?;

    let dataset = cloud_linked_entry(new_dataset_id(), label, sub, Some(source_id));
    let destination_id = dataset.id.clone();

    provision_dataset(root, entries, dataset, |dir| {
        std::fs::copy(&source_db, dir.join(DB_FILE_NAME)).map_err(|e| AppError::File {
            message: format!("Failed to copy the profile database: {}", e),
        })?;
        crate::credentials::copy_ai_credentials(source_id, &destination_id).map(|_| ())
    })
    .inspect_err(|_| crate::credentials::clear_credentials(&destination_id))
}

/// The longest display label a profile may carry.
///
/// Counted in `char`s, not bytes: the limit exists so a row stays readable, and a
/// byte budget would let an accented or CJK name be rejected at half the length an
/// ASCII one is allowed.
const MAX_DATASET_LABEL_CHARS: usize = 80;

/// Trims a submitted label and refuses one that is empty or over-long.
///
/// Parse-not-validate: the rest of the rename path receives a `String` that is
/// already the exact bytes to persist, so no later step re-checks or re-trims. The
/// error names `label` so the picker can attach it to the field the user typed in
/// rather than showing a bare toast.
///
/// Split out of `rename_dataset_at` for the same reason `reject_taken_id` is: the
/// whole rejection matrix is then testable without touching a filesystem.
fn parse_dataset_label(label: &str) -> Result<String, AppError> {
    let trimmed = label.trim();

    if trimmed.is_empty() || trimmed.chars().count() > MAX_DATASET_LABEL_CHARS {
        return Err(AppError::Validation {
            message: format!(
                "A profile name must be between 1 and {} characters",
                MAX_DATASET_LABEL_CHARS
            ),
            field: Some("label".to_string()),
        });
    }

    Ok(trimmed.to_string())
}

/// Replaces a local profile's display label, and nothing else.
///
/// Deliberately the narrowest possible mutator: `id`, `kind`, `cognito_sub`,
/// `linked_from`, `is_default` and `created_at` are all left exactly as recorded,
/// and no directory, database or keyring entry is touched. The id *is* the
/// directory name, so moving the label rather than the id is what keeps the rename
/// free of any data movement — Default included, whose directory is the app data
/// root itself.
///
/// `REGISTRY_LOCK` is held across the whole read-modify-write, matching
/// `create_dataset_at`: a rename racing a create must not drop the other's entry.
/// The read goes through the unfiltered `read_registry_for_update`, so an entry the
/// picker skips survives a rename of a sibling — the regression that helper exists
/// for.
///
/// A cloud-linked profile is refused rather than silently ignored: its label is
/// derived from the account it is linked to, so a local override would drift from
/// the account the next sign-in reports.
pub(crate) fn rename_dataset_at(root: &Path, id: &str, label: &str) -> Result<Dataset, AppError> {
    // Before the lock: an invalid label cannot be persisted, so there is nothing to
    // serialize against and no reason to make a valid rename wait behind it.
    let label = parse_dataset_label(label)?;

    let _guard = REGISTRY_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    let path = registry_path(root);
    let mut entries = read_registry_for_update(&path)?;

    // `is_valid_dataset_id` is part of the lookup, not a separate check: an entry the
    // picker cannot show is an entry the user cannot have asked to rename, so it reads
    // as not-found rather than as a rename that silently succeeded off-screen.
    let entry = entries
        .iter_mut()
        .find(|entry| entry.id == id && is_valid_dataset_id(&entry.id))
        .ok_or_else(|| AppError::Validation {
            message: format!("Unknown dataset: {}", id),
            field: Some("dataset_id".to_string()),
        })?;

    if entry.kind != DatasetKind::Local {
        return Err(AppError::Validation {
            message: "A Nixus Cloud profile is named by its account".to_string(),
            field: Some("dataset_id".to_string()),
        });
    }

    entry.label = label;
    let renamed = entry.clone();

    write_json_atomic(&path, &entries)?;

    Ok(renamed)
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

    const SUB: &str = "cognito-sub-1";
    const EMAIL: &str = "user@example.com";

    fn seed_db(dir: &Path, marker: &str) {
        std::fs::create_dir_all(dir).expect("dataset dir");
        let conn = init_db(dir).expect("database opens");
        conn.execute_batch(&format!("CREATE TABLE marker_{marker} (x)"))
            .expect("marker table created");
    }

    fn markers(db_path: &Path) -> Vec<String> {
        let conn = rusqlite::Connection::open(db_path).expect("database opens");
        let mut stmt = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'marker_%'")
            .expect("query prepares");
        let names = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .expect("query runs")
            .map(|name| name.expect("row readable"))
            .collect();
        names
    }

    #[test]
    fn a_first_sign_in_creates_a_cloud_linked_entry_labelled_with_the_account_email() {
        let root = bootstrapped_root();

        let created = find_or_create_cloud_dataset_at(root.path(), SUB, EMAIL)
            .expect("first sign-in succeeds");

        assert_eq!(created.kind, DatasetKind::CloudLinked);
        assert_eq!(created.cognito_sub.as_deref(), Some(SUB));
        assert_eq!(created.label, EMAIL);
        assert_eq!(created.linked_from, None);
        assert!(!created.is_default);
        assert!(dataset_db_path(root.path(), &created.id).is_file());

        let entries = recorded(root.path());
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, DEFAULT_DATASET_ID, "Default still comes first");
        assert_eq!(entries[1], created);
    }

    /// FR4's explicit success criterion: signing in again reopens the same profile.
    #[test]
    fn signing_in_again_with_the_same_account_reopens_the_same_dataset() {
        let root = bootstrapped_root();

        let first = find_or_create_cloud_dataset_at(root.path(), SUB, EMAIL).expect("first");
        let second = find_or_create_cloud_dataset_at(root.path(), SUB, EMAIL).expect("second");

        assert_eq!(first, second, "a repeat sign-in must not mint a new profile");
        assert_eq!(
            recorded(root.path()).len(),
            2,
            "a repeat sign-in must not append a registry entry"
        );
    }

    #[test]
    fn a_different_account_gets_its_own_cloud_linked_dataset() {
        let root = bootstrapped_root();

        let first = find_or_create_cloud_dataset_at(root.path(), SUB, EMAIL).expect("first");
        let other = find_or_create_cloud_dataset_at(root.path(), "sub-2", "other@example.com")
            .expect("second account");

        assert_ne!(first.id, other.id);
        assert_eq!(recorded(root.path()).len(), 3);
    }

    // Several cloud-linked profiles sharing one subject is accepted, not prevented,
    // so the tie-break has to be deterministic rather than "whichever is first".
    #[test]
    fn the_most_recently_created_match_wins_and_a_local_entry_never_matches() {
        let older = Dataset {
            created_at: "2026-01-01T00:00:00+00:00".to_string(),
            ..entry("cloud-old")
        };
        let newer = Dataset {
            created_at: "2026-06-01T00:00:00+00:00".to_string(),
            ..entry("cloud-new")
        };
        let local_with_a_sub = Dataset {
            kind: DatasetKind::Local,
            created_at: "2026-12-01T00:00:00+00:00".to_string(),
            ..entry("local-1")
        };
        let entries = vec![newer.clone(), local_with_a_sub, older];

        assert_eq!(
            most_recent_for_sub(&entries, "sub-1").map(|found| found.id.as_str()),
            Some("cloud-new")
        );
        assert_eq!(most_recent_for_sub(&entries, "sub-absent"), None);
        assert_eq!(most_recent_for_sub(&[], "sub-1"), None);
    }

    #[test]
    fn an_entry_the_reader_skips_is_never_reopened_as_a_match() {
        let entries = vec![entry("a/b")];

        assert_eq!(
            most_recent_for_sub(&entries, "sub-1"),
            None,
            "an unusable id must not be reopened; its directory is unreachable"
        );
    }

    #[test]
    fn migrating_copies_the_sources_database_into_a_new_cloud_linked_dataset() {
        // The copy reaches the keyring, and a read the keyring refuses is now fatal
        // rather than skipped, so every test that gets as far as the copy has to
        // install the mock store.
        let _keyring = crate::credentials::test_keyring_guard();
        let root = bootstrapped_root();
        let source = create_dataset_at(root.path()).expect("source created");
        seed_db(&dataset_dir_from_root(root.path(), &source.id), "source");

        let migrated = migrate_to_cloud_dataset_at(root.path(), &source.id, SUB, EMAIL, || {
            Ok(dataset_db_path(root.path(), &source.id))
        })
        .expect("migration succeeds");

        assert_eq!(migrated.kind, DatasetKind::CloudLinked);
        assert_eq!(migrated.cognito_sub.as_deref(), Some(SUB));
        assert_eq!(migrated.label, EMAIL);
        assert_eq!(migrated.linked_from.as_deref(), Some(source.id.as_str()));
        assert_eq!(
            markers(&dataset_db_path(root.path(), &migrated.id)),
            vec!["marker_source".to_string()],
            "the destination must hold a copy of the source's data"
        );

        // FR5: the source is left completely untouched and still listed.
        let entries = recorded(root.path());
        assert!(entries.contains(&source));
        assert_eq!(
            markers(&dataset_db_path(root.path(), &source.id)),
            vec!["marker_source".to_string()]
        );
    }

    #[test]
    fn a_migration_copies_only_the_main_database_file_and_no_wal_sidecar() {
        let _keyring = crate::credentials::test_keyring_guard();
        let root = bootstrapped_root();
        let source = create_dataset_at(root.path()).expect("source created");
        let source_dir = dataset_dir_from_root(root.path(), &source.id);
        seed_db(&source_dir, "source");
        std::fs::write(source_dir.join("nkbaz-finance.db-wal"), b"stale wal")
            .expect("sidecar written");
        std::fs::write(source_dir.join("nkbaz-finance.db-shm"), b"stale shm")
            .expect("sidecar written");

        let migrated = migrate_to_cloud_dataset_at(root.path(), &source.id, SUB, EMAIL, || {
            Ok(dataset_db_path(root.path(), &source.id))
        })
        .expect("migration succeeds");

        let dir = dataset_dir_from_root(root.path(), &migrated.id);
        assert!(dir.join("nkbaz-finance.db").is_file());
        assert!(
            !dir.join("nkbaz-finance.db-wal").exists(),
            "a copied -wal sidecar would be replayed over the copied database"
        );
        assert!(!dir.join("nkbaz-finance.db-shm").exists());
    }

    /// The user switched profiles during the browser round-trip: the abort seam
    /// fails and nothing at all is created.
    #[test]
    fn a_migration_whose_source_is_no_longer_active_creates_nothing() {
        let root = bootstrapped_root();
        let source = create_dataset_at(root.path()).expect("source created");
        let before = recorded(root.path());

        let error = migrate_to_cloud_dataset_at(root.path(), &source.id, SUB, EMAIL, || {
            Err(AppError::Validation {
                message: "no longer open".to_string(),
                field: Some("source_dataset_id".to_string()),
            })
        })
        .expect_err("migration must abort");

        assert!(matches!(error, AppError::Validation { .. }));
        assert_eq!(recorded(root.path()), before);
        assert_eq!(
            std::fs::read_dir(root.path().join("datasets"))
                .expect("the datasets directory exists")
                .count(),
            1,
            "only the source's directory may exist; an aborted migration creates none"
        );
    }

    #[test]
    fn migrating_from_an_unregistered_source_is_a_validation_error_naming_the_field() {
        let root = bootstrapped_root();

        let error =
            migrate_to_cloud_dataset_at(root.path(), "does-not-exist", SUB, EMAIL, || {
                panic!("the source must be validated before it is prepared")
            })
            .expect_err("migration must fail");

        match error {
            AppError::Validation { field, .. } => {
                assert_eq!(field.as_deref(), Some("source_dataset_id"))
            }
            other => panic!("expected AppError::Validation, got {other:?}"),
        }
    }

    /// The one migration every single-profile user will actually run, and the only
    /// one whose source directory is not a dataset directory: Default's *is* the app
    /// data root, so `datasets.json`, `profiles/` and every other top-level file sit
    /// right beside the database being copied. The copy takes the database and
    /// nothing standing next to it.
    #[test]
    fn migrating_from_the_default_dataset_copies_no_root_level_sidecar_files() {
        let _keyring = crate::credentials::test_keyring_guard();
        let root = bootstrapped_root();
        let source_dir = dataset_dir_from_root(root.path(), DEFAULT_DATASET_ID);
        assert_eq!(source_dir, root.path(), "Default's directory is the root itself");

        seed_db(&source_dir, "default");
        std::fs::create_dir_all(root.path().join("profiles")).expect("profiles directory");
        std::fs::write(root.path().join("profiles").join("me.json"), b"{}")
            .expect("profile written");
        assert!(
            registry_path(root.path()).is_file(),
            "the registry has to be sitting beside the source database for this to prove anything"
        );

        let migrated =
            migrate_to_cloud_dataset_at(root.path(), DEFAULT_DATASET_ID, SUB, EMAIL, || {
                // Resolved by the production helper from the source id — the same expression
                // `checkpoint_active_source` returns — so Default's root-is-the-dataset-dir rule is
                // exercised, not assumed. Only the WAL checkpoint itself is stubbed out: it needs a
                // running AppHandle and DbState, which is out of this test's reach.
                Ok(dataset_db_path(root.path(), DEFAULT_DATASET_ID))
            })
            .expect("migration succeeds");

        let dir = dataset_dir_from_root(root.path(), &migrated.id);
        let mut produced: Vec<String> = std::fs::read_dir(&dir)
            .expect("the destination directory exists")
            .map(|entry| {
                entry
                    .expect("directory entry")
                    .file_name()
                    .to_string_lossy()
                    .to_string()
            })
            .collect();
        produced.sort();

        assert_eq!(
            produced,
            vec![DB_FILE_NAME.to_string()],
            "the destination must hold the copied database and nothing else"
        );
        assert_eq!(
            markers(&dataset_db_path(root.path(), &migrated.id)),
            vec!["marker_default".to_string()],
            "and that database must be a copy of Default's own"
        );

        // FR5: Default keeps everything it had, registry and profiles included.
        assert!(registry_path(root.path()).is_file());
        assert!(root.path().join("profiles").join("me.json").is_file());
        assert_eq!(
            markers(&dataset_db_path(root.path(), DEFAULT_DATASET_ID)),
            vec!["marker_default".to_string()]
        );
    }

    /// Epic 34's per-profile keyring naming is what Migrate copies: the destination
    /// gets its own entries, and the source keeps every one of its own.
    #[test]
    fn migrating_copies_the_sources_ai_credentials_and_leaves_the_source_keys_intact() {
        let _keyring = crate::credentials::test_keyring_guard();
        let root = bootstrapped_root();
        let source = create_dataset_at(root.path()).expect("source created");
        seed_db(&dataset_dir_from_root(root.path(), &source.id), "source");
        crate::credentials::clear_credentials(&source.id);
        crate::credentials::store_openai_key(&source.id, "sk-source").expect("key stored");

        let migrated = migrate_to_cloud_dataset_at(root.path(), &source.id, SUB, EMAIL, || {
            Ok(dataset_db_path(root.path(), &source.id))
        })
        .expect("migration succeeds");

        assert_eq!(
            crate::credentials::load_openai_key(&migrated.id),
            Some("sk-source".to_string())
        );
        assert_eq!(
            crate::credentials::load_openai_key(&source.id),
            Some("sk-source".to_string()),
            "the source's keys must survive the migration untouched"
        );

        crate::credentials::clear_credentials(&source.id);
        crate::credentials::clear_credentials(&migrated.id);
    }

    fn local_entry(id: &str, label: &str) -> Dataset {
        Dataset {
            label: label.to_string(),
            kind: DatasetKind::Local,
            cognito_sub: None,
            linked_from: None,
            ..entry(id)
        }
    }

    fn seeded_root(entries: &[Dataset]) -> TempDir {
        let root = TempDir::new().expect("temp dir");
        write_registry(
            root.path(),
            &serde_json::to_string(entries).expect("serialized"),
        );
        root
    }

    #[test]
    fn a_submitted_label_is_trimmed_before_it_is_persisted() {
        let root = seeded_root(&[local_entry("local-1", "Local Profile 1")]);

        let renamed =
            rename_dataset_at(root.path(), "local-1", "  Work  ").expect("rename succeeds");

        assert_eq!(renamed.label, "Work");
        assert_eq!(recorded(root.path())[0].label, "Work");
    }

    // The rename's whole safety claim: only `label` moves. A mutator that rebuilt the
    // entry instead of assigning one field would reset `created_at` or `is_default`
    // here, and `created_at` is what `most_recent_for_sub` tie-breaks on.
    #[test]
    fn renaming_changes_the_label_and_no_other_field_of_the_entry() {
        let before = local_entry("local-1", "Local Profile 1");
        let root = seeded_root(std::slice::from_ref(&before));

        let renamed = rename_dataset_at(root.path(), "local-1", "Work").expect("rename succeeds");

        assert_eq!(
            renamed,
            Dataset {
                label: "Work".to_string(),
                ..before
            }
        );
        assert_eq!(
            recorded(root.path())[0],
            renamed,
            "and that is what landed on disk"
        );
    }

    // Default's directory *is* the app data root, so a rename that touched identity
    // would have to move every top-level file in the app.
    #[test]
    fn renaming_default_changes_its_label_while_its_root_storage_stays_put() {
        let root = TempDir::new().expect("temp dir");
        bootstrap_registry_at(root.path()).expect("bootstrap succeeds");
        let db = root.path().join(DB_FILE_NAME);
        std::fs::write(&db, b"pretend sqlite bytes").expect("db written");

        let renamed = rename_dataset_at(root.path(), DEFAULT_DATASET_ID, "Personal")
            .expect("rename succeeds");

        assert_eq!(renamed.id, DEFAULT_DATASET_ID);
        assert_eq!(renamed.label, "Personal");
        assert!(renamed.is_default, "Default must stay the default entry");
        assert_eq!(
            dataset_dir_from_root(root.path(), DEFAULT_DATASET_ID),
            root.path(),
            "Default's directory is still the root itself"
        );
        assert_eq!(
            std::fs::read(&db).expect("db still readable"),
            b"pretend sqlite bytes",
            "a rename must move, copy and rename no data"
        );
        assert!(!root.path().join("datasets").exists());
    }

    #[test]
    fn a_blank_or_whitespace_only_label_is_refused_and_the_registry_is_untouched() {
        let root = seeded_root(&[local_entry("local-1", "Local Profile 1")]);
        let before = std::fs::read(registry_path(root.path())).expect("file readable");

        for rejected in ["", "   ", "\t\n"] {
            let error = rename_dataset_at(root.path(), "local-1", rejected)
                .expect_err("a blank label must be refused");

            match error {
                AppError::Validation { field, .. } => {
                    assert_eq!(field.as_deref(), Some("label"))
                }
                other => panic!("expected AppError::Validation, got {other:?}"),
            }
        }

        assert_eq!(
            std::fs::read(registry_path(root.path())).expect("file readable"),
            before,
            "a refused rename must not rewrite the registry"
        );
    }

    // The boundary itself, both sides of it, and in `char`s rather than bytes — an
    // accented name must get the same 80 characters an ASCII one does.
    #[test]
    fn the_label_length_limit_is_eighty_characters_not_eighty_bytes() {
        let root = seeded_root(&[local_entry("local-1", "Local Profile 1")]);

        let accented = "é".repeat(MAX_DATASET_LABEL_CHARS);
        assert!(
            accented.len() > MAX_DATASET_LABEL_CHARS,
            "the fixture must be multi-byte"
        );
        let renamed =
            rename_dataset_at(root.path(), "local-1", &accented).expect("80 chars is accepted");
        assert_eq!(renamed.label, accented);

        let too_long = "x".repeat(MAX_DATASET_LABEL_CHARS + 1);
        let error = rename_dataset_at(root.path(), "local-1", &too_long)
            .expect_err("81 chars must be refused");
        match error {
            AppError::Validation { field, .. } => assert_eq!(field.as_deref(), Some("label")),
            other => panic!("expected AppError::Validation, got {other:?}"),
        }
        assert_eq!(
            recorded(root.path())[0].label,
            accented,
            "the refused label must not have replaced the accepted one"
        );
    }

    // Trimming happens before the length check, so a name that only exceeds the limit
    // with its padding is still accepted.
    #[test]
    fn surrounding_whitespace_does_not_count_against_the_length_limit() {
        let root = seeded_root(&[local_entry("local-1", "Local Profile 1")]);
        let at_limit = "x".repeat(MAX_DATASET_LABEL_CHARS);

        let renamed = rename_dataset_at(root.path(), "local-1", &format!("   {at_limit}   "))
            .expect("padding is trimmed before it is measured");

        assert_eq!(renamed.label, at_limit);
    }

    #[test]
    fn renaming_an_unknown_id_is_a_validation_error_naming_the_field() {
        let root = seeded_root(&[local_entry("local-1", "Local Profile 1")]);
        let before = std::fs::read(registry_path(root.path())).expect("file readable");

        let error = rename_dataset_at(root.path(), "does-not-exist", "Work")
            .expect_err("an unknown id must be refused");

        match error {
            AppError::Validation { field, .. } => {
                assert_eq!(field.as_deref(), Some("dataset_id"))
            }
            other => panic!("expected AppError::Validation, got {other:?}"),
        }
        assert_eq!(
            std::fs::read(registry_path(root.path())).expect("file readable"),
            before
        );
    }

    // A cloud-linked label is the account's, and the next sign-in re-derives it, so a
    // local override would silently drift rather than stick.
    #[test]
    fn renaming_a_cloud_linked_profile_is_refused_and_its_account_label_survives() {
        let root = seeded_root(&[entry("cloud-1")]);

        let error = rename_dataset_at(root.path(), "cloud-1", "Work")
            .expect_err("a cloud-linked profile must not be renamed");

        assert!(
            matches!(error, AppError::Validation { .. }),
            "expected AppError::Validation, got {error:?}"
        );
        assert_eq!(recorded(root.path())[0].label, "Label cloud-1");
    }

    // An id the picker cannot show is an id the user cannot have asked to rename, so
    // it reads as not-found rather than mutating an entry nothing can display.
    #[test]
    fn an_entry_the_reader_skips_cannot_be_renamed() {
        let root = seeded_root(&[default_dataset_entry(), entry("a/b")]);

        let error = rename_dataset_at(root.path(), "a/b", "Work").expect_err("rename must fail");

        match error {
            AppError::Validation { field, .. } => {
                assert_eq!(field.as_deref(), Some("dataset_id"))
            }
            other => panic!("expected AppError::Validation, got {other:?}"),
        }
    }

    // The same regression `read_registry_for_update` exists for, on the rename path:
    // reading the filtered view and writing it back would delete the skipped entry
    // from disk, with nothing in the product able to restore it.
    #[test]
    fn renaming_one_profile_leaves_every_sibling_entry_byte_for_byte_intact() {
        let seeded = vec![
            default_dataset_entry(),
            local_entry("local-1", "Local Profile 1"),
            local_entry("local-2", "Local Profile 2"),
            entry("cloud-1"),
            entry("a/b"),
        ];
        let root = seeded_root(&seeded);

        rename_dataset_at(root.path(), "local-2", "Work").expect("rename succeeds");

        let on_disk =
            read_registry_for_update(&registry_path(root.path())).expect("registry parses");
        assert_eq!(
            on_disk.len(),
            seeded.len(),
            "no entry may be added or dropped"
        );
        for (index, before) in seeded.iter().enumerate() {
            let expected = if before.id == "local-2" {
                Dataset {
                    label: "Work".to_string(),
                    ..before.clone()
                }
            } else {
                before.clone()
            };
            assert_eq!(
                on_disk[index], expected,
                "entry {index} changed unexpectedly"
            );
        }
    }

    #[test]
    fn a_rename_survives_a_registry_reload() {
        let root = seeded_root(&[local_entry("local-1", "Local Profile 1")]);

        rename_dataset_at(root.path(), "local-1", "Work").expect("rename succeeds");

        assert_eq!(
            load_registry_entries(&registry_path(root.path()))
                .expect("load succeeds")
                .into_iter()
                .map(|entry| entry.label)
                .collect::<Vec<_>>(),
            vec!["Work".to_string()]
        );
    }

    // The lock's claim on this path: a rename and a create both rewrite the whole
    // file, so splitting the read from the write would let one drop the other's work.
    // Asserted on final state only, so it cannot flake.
    #[test]
    fn parallel_renames_and_creates_all_survive_the_single_writer_lock() {
        const RENAMES: usize = 4;
        const CREATES: usize = 4;
        let root = bootstrapped_root();
        let target = create_dataset_at(root.path()).expect("target created");
        let root_path = root.path();
        let target_id = target.id.as_str();

        std::thread::scope(|scope| {
            for index in 0..RENAMES {
                scope.spawn(move || {
                    rename_dataset_at(root_path, target_id, &format!("Renamed {index}"))
                        .expect("rename succeeds");
                });
            }
            for _ in 0..CREATES {
                scope.spawn(move || {
                    create_dataset_at(root_path).expect("create succeeds");
                });
            }
        });

        let entries = recorded(root.path());
        assert_eq!(
            entries.len(),
            CREATES + 2,
            "Default, the target and every create must be recorded; a lost append means \
             the read-modify-write was not atomic"
        );
        let renamed = entries
            .iter()
            .find(|entry| entry.id == target.id)
            .expect("the target must still be recorded");
        assert!(
            renamed.label.starts_with("Renamed "),
            "one of the renames must have won outright, got {}",
            renamed.label
        );
    }
}
