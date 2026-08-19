//! Active-dataset selection (AD-6).
//!
//! The hot-swap's entire safety argument is its ordering: the target's directory
//! is resolved and its database opened and migrated *before* `DbState`'s lock is
//! acquired. Any failure therefore happens while the lock is still untouched,
//! leaving the previously active dataset (or "none") provably unchanged with no
//! rollback logic to get wrong.

use std::sync::Mutex;

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tracing::info;

use crate::datasets;
use crate::db::{init_db, ActiveDataset, DbState};
use crate::error::AppError;
use crate::models::{Dataset, DatasetKind};

#[derive(Serialize, Clone)]
struct DatasetSwitchedPayload {
    dataset_id: String,
    kind: DatasetKind,
}

/// Switches the active dataset, or selects the first one of a run.
///
/// Takes `&AppHandle` rather than `State<DbState>` so `lib.rs`'s `.setup()` —
/// which never has a Tauri-injected `State<T>` — selects the Default dataset
/// through this same path instead of a privileged startup-only one.
pub(crate) fn select_dataset_now(app: &AppHandle, dataset_id: &str) -> Result<(), AppError> {
    let entry = find_registered(datasets::load_registry(app)?, dataset_id)?;

    let dir = datasets::dataset_dir(app, &entry.id)?;
    let conn = init_db(&dir)?;

    swap_active(&app.state::<DbState>().0, entry.id.clone(), conn)?;

    info!("Active dataset is now {}", entry.id);

    // Best-effort, matching `import.rs`'s emit precedent: the swap has already
    // happened, so a failed notification must not be reported as a failed switch.
    let _ = app.emit(
        "dataset:switched",
        DatasetSwitchedPayload {
            dataset_id: entry.id,
            kind: entry.kind,
        },
    );

    Ok(())
}

/// The swap itself: one lock acquisition, one whole-struct assignment, so `id`
/// and `conn` are replaced together and no observer can see them disagree.
///
/// Takes the bare `&Mutex<ActiveDataset>` rather than `&AppHandle` so the step
/// this story's atomicity guarantee rests on is testable without a Tauri app.
/// Reaching it at all is the guarantee's other half: every fallible step lives
/// in `select_dataset_now` *above* this call.
fn swap_active(
    lock: &Mutex<ActiveDataset>,
    id: String,
    conn: Connection,
) -> Result<(), AppError> {
    let mut active = lock.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    *active = ActiveDataset {
        id: Some(id),
        conn: Some(conn),
    };

    Ok(())
}

/// The registry is the sole source of truth for which datasets exist (AD-3) and
/// the only place `kind` lives, so one lookup both validates the id and builds
/// the `dataset:switched` payload.
///
/// Split out of `select_dataset_now` so the unknown-id branch is unit-testable
/// without a running Tauri app, mirroring `datasets::resolve_active_dir`.
fn find_registered(entries: Vec<Dataset>, dataset_id: &str) -> Result<Dataset, AppError> {
    entries
        .into_iter()
        .find(|entry| entry.id == dataset_id)
        .ok_or_else(|| AppError::Validation {
            message: format!("Unknown dataset: {}", dataset_id),
            field: Some("dataset_id".to_string()),
        })
}

#[tauri::command(rename_all = "snake_case")]
pub fn select_dataset(app: AppHandle, dataset_id: String) -> Result<(), AppError> {
    select_dataset_now(&app, &dataset_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn entry(id: &str, kind: DatasetKind) -> Dataset {
        Dataset {
            id: id.to_string(),
            label: format!("Label {id}"),
            kind,
            cognito_sub: None,
            linked_from: None,
            is_default: false,
            created_at: "2026-01-01T00:00:00+00:00".to_string(),
        }
    }

    // Each connection is tagged with a uniquely-named table so a swap that moved
    // `id` while leaving `conn` behind (or vice versa) is actually detectable —
    // `Connection` itself carries nothing an assertion could distinguish.
    fn tagged_connection(tag: &str) -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database");
        conn.execute_batch(&format!("CREATE TABLE tag_{tag} (x)"))
            .expect("tag table created");
        conn
    }

    fn tag_of(conn: &Connection) -> String {
        conn.query_row(
            "SELECT name FROM sqlite_master WHERE type = 'table'",
            [],
            |row| row.get(0),
        )
        .expect("exactly one tag table")
    }

    fn active_tagged(tag: &str) -> ActiveDataset {
        ActiveDataset {
            id: Some(tag.to_string()),
            conn: Some(tagged_connection(tag)),
        }
    }

    #[test]
    fn a_swap_replaces_the_id_and_the_connection_together() {
        let lock = Mutex::new(active_tagged("previous"));

        swap_active(&lock, "next".to_string(), tagged_connection("next"))
            .expect("swap succeeds");

        let active = lock.lock().expect("lock is not poisoned");
        assert_eq!(active.id.as_deref(), Some("next"));
        assert_eq!(
            tag_of(active.conn.as_ref().expect("a swapped dataset is connected")),
            "tag_next",
            "the id advanced but the connection is still the previous dataset's"
        );
    }

    #[test]
    fn the_first_swap_of_a_run_fills_an_unselected_active_dataset() {
        let lock = Mutex::new(ActiveDataset {
            id: None,
            conn: None,
        });

        swap_active(&lock, "default".to_string(), tagged_connection("default"))
            .expect("swap succeeds");

        let active = lock.lock().expect("lock is not poisoned");
        assert_eq!(active.id.as_deref(), Some("default"));
        assert_eq!(
            tag_of(active.conn.as_ref().expect("a swapped dataset is connected")),
            "tag_default"
        );
    }

    // The story's "no rollback logic needed" claim, exercised rather than
    // asserted: the real `init_db` fails on a corrupt file and its `?` returns
    // before `swap_active` is ever reached, which is *why* prior state survives.
    #[test]
    fn a_failure_before_the_swap_leaves_the_previous_dataset_untouched() {
        let lock = Mutex::new(active_tagged("previous"));
        let dir = TempDir::new().expect("temp dir");
        std::fs::write(dir.path().join("nkbaz-finance.db"), b"not a sqlite file at all")
            .expect("garbage db written");

        let outcome = (|| -> Result<(), AppError> {
            let conn = init_db(dir.path())?;
            swap_active(&lock, "next".to_string(), conn)
        })();

        assert!(
            matches!(outcome, Err(AppError::Database { .. })),
            "expected the open to fail, got {outcome:?}"
        );
        let active = lock.lock().expect("lock is not poisoned");
        assert_eq!(active.id.as_deref(), Some("previous"));
        assert_eq!(
            tag_of(active.conn.as_ref().expect("still connected")),
            "tag_previous"
        );
    }

    #[test]
    fn a_registered_id_resolves_to_its_entry_with_its_kind() {
        let entries = vec![
            entry("default", DatasetKind::Local),
            entry("cloud-1", DatasetKind::CloudLinked),
        ];

        let found = find_registered(entries, "cloud-1").expect("registered id resolves");

        assert_eq!(found.id, "cloud-1");
        assert_eq!(found.kind, DatasetKind::CloudLinked);
    }

    #[test]
    fn an_unregistered_id_is_a_validation_error_naming_the_field() {
        let entries = vec![entry("default", DatasetKind::Local)];

        let error = find_registered(entries, "does-not-exist").expect_err("lookup must fail");

        match error {
            AppError::Validation { field, .. } => assert_eq!(field.as_deref(), Some("dataset_id")),
            other => panic!("expected AppError::Validation, got {other:?}"),
        }
    }

    #[test]
    fn an_empty_registry_resolves_nothing() {
        let error = find_registered(Vec::new(), "default").expect_err("lookup must fail");

        assert!(matches!(error, AppError::Validation { .. }));
    }

    // The payload is a wire contract the frontend reads, so its key and enum
    // spellings are asserted as raw JSON rather than through the struct.
    #[test]
    fn the_switched_event_payload_carries_snake_case_id_and_kebab_case_kind() {
        let json = serde_json::to_string(&DatasetSwitchedPayload {
            dataset_id: "cloud-1".to_string(),
            kind: DatasetKind::CloudLinked,
        })
        .expect("payload serializes");

        assert_eq!(json, r#"{"dataset_id":"cloud-1","kind":"cloud-linked"}"#);
    }
}
