//! Active-dataset selection (AD-6).
//!
//! The hot-swap's entire safety argument is its ordering: the target's directory
//! is resolved and its database opened and migrated *before* `DbState`'s lock is
//! acquired. Any failure therefore happens while the lock is still untouched,
//! leaving the previously active dataset (or "none") provably unchanged with no
//! rollback logic to get wrong.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use rusqlite::Connection;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tracing::info;

use crate::ai::{self, AiState};
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
    // Re-selecting the open dataset must not emit `dataset:switched`, or the frontend
    // would wipe the cache and this profile's own import draft for a change that never
    // happened. Safe ahead of the registry read: an active id was validated when it was
    // selected, and startup's id is still None, so the first selection of a run proceeds.
    if is_already_active(&app.state::<DbState>().0, dataset_id)? {
        return Ok(());
    }

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

/// Whether `dataset_id` is the dataset already open, read under the same lock
/// `swap_active` writes through. `None` is startup, which has nothing open yet and
/// so is never a no-op.
///
/// Takes the bare `&Mutex<ActiveDataset>` for the same reason `swap_active` does:
/// the decision is then testable without a Tauri app.
fn is_already_active(lock: &Mutex<ActiveDataset>, dataset_id: &str) -> Result<bool, AppError> {
    let active = lock.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    Ok(active.id.as_deref() == Some(dataset_id))
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
pub async fn select_dataset(app: AppHandle, dataset_id: String) -> Result<(), AppError> {
    select_dataset_now(&app, &dataset_id)?;
    refresh_ai_state(&app, &dataset_id).await;
    Ok(())
}

/// Rebuilds `AiState` from the newly selected dataset, so an AI client built
/// from the previous profile's keyring service cannot survive the switch and
/// answer with the wrong profile's key.
///
/// Every path *replaces* the state — there is no early return that leaves the
/// old provider in place, because a stale provider is the exact leak this
/// exists to close. A poisoned guard is recovered with `into_inner()` (the
/// policy `credentials.rs` already uses) rather than bailing out, and an
/// unselected connection resolves to no provider.
///
/// The config read and the state write are separate short critical sections, so
/// neither lock is held across the client's async setup.
pub(crate) async fn refresh_ai_state(app: &AppHandle, dataset_id: &str) {
    let config = {
        let state = app.state::<DbState>();
        let active = state
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        active.conn.as_ref().map(ai::read_ai_config)
    };

    let rebuilt = match config {
        Some(config) => ai::init_ai_client(&config, dataset_id).await,
        None => AiState { provider: None },
    };

    let ai_state = app.state::<Mutex<AiState>>();
    let mut ai_state = ai_state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *ai_state = rebuilt;
}

/// A one-line wrapper on purpose: reading the registry is `datasets.rs`'s job
/// (AD-3), so this adds an IPC entry point and nothing else.
#[tauri::command(rename_all = "snake_case")]
pub fn list_datasets(app: AppHandle) -> Result<Vec<Dataset>, AppError> {
    datasets::load_registry(&app)
}

/// Adds an empty local profile to the registry, and nothing more: creating and
/// opening are separate user actions, so this neither selects nor activates the
/// result. Resolving the *global* root rather than the active dataset's directory
/// is deliberate — a new dataset is a sibling of every existing one, and
/// `active_dataset_dir` would additionally take `DbState`'s lock for no reason.
#[tauri::command(rename_all = "snake_case")]
pub fn create_dataset(app: AppHandle) -> Result<Dataset, AppError> {
    datasets::create_dataset_at(&datasets::global_root(&app)?)
}

/// Whether the launch-time picker has been passed during this run (AD-14).
///
/// Deliberately a standalone flag *alongside* `ActiveDataset` rather than derived
/// from it: `lib.rs`'s `.setup()` auto-selects Default before any UI exists, so
/// `ActiveDataset.id` is already `Some` on the first frame and can never answer
/// "has the user chosen yet". Keeping the two separate is what lets the backend go
/// on auto-selecting Default — and the AI client and recurring-apply code go on
/// assuming a live connection right after `.setup()` — while the frontend is still
/// shown the picker first.
///
/// In-memory only: a relaunch is a new run and must show the picker again.
static PICKER_PASSED: AtomicBool = AtomicBool::new(false);

/// Latches the picker as passed for the remainder of this run.
///
/// A separate command from `select_dataset` on purpose: `lib.rs`'s `.setup()` also
/// calls `select_dataset_now` to auto-select Default before any UI exists, and that
/// call must never mark the gate passed or the picker would never appear at all.
/// Only the picker's own click path may latch it, so the frontend issues this as a
/// second invoke after `select_dataset` resolves.
#[tauri::command(rename_all = "snake_case")]
pub fn mark_picker_passed() {
    PICKER_PASSED.store(true, Ordering::SeqCst);
}

fn picker_passed() -> bool {
    PICKER_PASSED.load(Ordering::SeqCst)
}

/// Same `{ needs_X: bool }` shape as `OnboardingStatus`'s primary field — one boolean the frontend's
/// root `beforeLoad` reads to decide whether to redirect. A wire contract, so the key spelling is
/// asserted in the tests below rather than left to the derive.
#[derive(Serialize)]
pub struct PickerGateStatus {
    pub needs_picker: bool,
}

#[tauri::command(rename_all = "snake_case")]
pub fn check_picker_gate() -> PickerGateStatus {
    PickerGateStatus {
        needs_picker: !picker_passed(),
    }
}

/// What the account menu needs to know about the dataset it is rendering inside
/// (Stories 35.3 and 35.4).
///
/// `is_signed_in` is derived entirely here and travels as a bare boolean: the
/// Cognito subject must never cross IPC (AD-10), and `AuthState`'s wire shape is
/// deliberately left alone so no second source of truth for "signed in" appears.
#[derive(Serialize)]
pub struct ActiveProfile {
    pub dataset_id: String,
    pub kind: DatasetKind,
    pub label: String,
    pub is_signed_in: bool,
}

/// Whether this dataset's own cloud account is the one currently signed in.
///
/// Local datasets are never auth-aware: a local profile is a purely local concept
/// (NFR7), so it reads `false` regardless of any machine-wide session. For a
/// cloud-linked one, a resolver error means "no session", which reads as
/// signed-out rather than as a failure the user has to act on.
fn is_signed_in(entry: &Dataset, current_subject: Option<&str>) -> bool {
    entry.kind == DatasetKind::CloudLinked
        && entry.cognito_sub.is_some()
        && entry.cognito_sub.as_deref() == current_subject
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_active_profile(app: AppHandle) -> Result<ActiveProfile, AppError> {
    let active_id = datasets::active_dataset_id(&app.state::<DbState>())?;
    let entry = find_registered(datasets::load_registry(&app)?, &active_id)?;

    // Resolved only for a cloud-linked dataset: `current_subject` can refresh an
    // expired session over the network, and a local profile must never trigger
    // that just to render its own menu.
    let subject = if entry.kind == DatasetKind::CloudLinked {
        crate::commands::auth::current_subject().await.ok()
    } else {
        None
    };

    Ok(ActiveProfile {
        is_signed_in: is_signed_in(&entry, subject.as_deref()),
        dataset_id: entry.id,
        kind: entry.kind,
        label: entry.label,
    })
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
    fn only_a_different_id_than_the_open_one_is_a_switch() {
        let selected = Mutex::new(active_tagged("work"));

        assert!(
            is_already_active(&selected, "work").expect("lock is not poisoned"),
            "re-selecting the open dataset must be a no-op, not a re-emitting switch"
        );
        assert!(
            !is_already_active(&selected, "home").expect("lock is not poisoned"),
            "a different dataset must still switch"
        );

        let unselected = Mutex::new(ActiveDataset {
            id: None,
            conn: None,
        });

        assert!(
            !is_already_active(&unselected, "default").expect("lock is not poisoned"),
            "startup has nothing open, so its first selection is always a switch"
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

    // Same reasoning as the payload above: `needs_picker` is the key the frontend's
    // root `beforeLoad` reads, so it is asserted as raw JSON.
    #[test]
    fn the_gate_status_payload_carries_snake_case_needs_picker() {
        let json = serde_json::to_string(&PickerGateStatus { needs_picker: true })
            .expect("payload serializes");

        assert_eq!(json, r#"{"needs_picker":true}"#);
    }

    // A cloud-linked profile's badge is the only auth-aware row in the picker's
    // world, so the local case is asserted alongside it rather than assumed.
    #[test]
    fn only_a_cloud_linked_entry_whose_subject_matches_reads_as_signed_in() {
        let cloud = Dataset {
            cognito_sub: Some("sub-1".to_string()),
            ..entry("cloud-1", DatasetKind::CloudLinked)
        };

        assert!(is_signed_in(&cloud, Some("sub-1")));
        assert!(!is_signed_in(&cloud, Some("sub-2")));
        assert!(
            !is_signed_in(&cloud, None),
            "a resolver error means no session, which reads as signed-out"
        );

        let local = Dataset {
            cognito_sub: Some("sub-1".to_string()),
            ..entry("local-1", DatasetKind::Local)
        };
        assert!(
            !is_signed_in(&local, Some("sub-1")),
            "a local profile must never be auth-aware, whatever it records"
        );

        let unlinked_cloud = entry("cloud-2", DatasetKind::CloudLinked);
        assert!(
            !is_signed_in(&unlinked_cloud, None),
            "two absent subjects must not compare equal"
        );
    }

    // The account menu reads these keys, and the subject is deliberately absent
    // from them (AD-10), so the payload is asserted as raw JSON.
    #[test]
    fn the_active_profile_payload_carries_a_bare_signed_in_boolean_and_no_subject() {
        let json = serde_json::to_string(&ActiveProfile {
            dataset_id: "cloud-1".to_string(),
            kind: DatasetKind::CloudLinked,
            label: "user@example.com".to_string(),
            is_signed_in: true,
        })
        .expect("payload serializes");

        assert_eq!(
            json,
            r#"{"dataset_id":"cloud-1","kind":"cloud-linked","label":"user@example.com","is_signed_in":true}"#
        );
        assert!(!json.contains("cognito"), "the subject must never cross IPC");
    }

    // Deliberately ONE test rather than three: `PICKER_PASSED` is a process-global
    // static and cargo runs a binary's tests in parallel threads, so a second test
    // touching it would make both order-dependent. This one owns the flag's whole
    // lifecycle instead.
    #[test]
    fn the_gate_asks_for_the_picker_until_it_is_marked_passed() {
        assert!(
            check_picker_gate().needs_picker,
            "a fresh run has not passed the picker yet"
        );

        mark_picker_passed();
        assert!(!check_picker_gate().needs_picker);

        // Latching, not toggling: Story 33.5 calls this from a row click, and a
        // second click must not put the gate back up mid-run.
        mark_picker_passed();
        assert!(!check_picker_gate().needs_picker);
    }
}
