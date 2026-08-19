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

use tauri::{AppHandle, Manager};

use crate::error::AppError;

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
