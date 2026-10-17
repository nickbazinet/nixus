//! The sync IPC surface (AD-16) and the supervisor that keeps exactly one actor alive for
//! the ACTIVE dataset.
//!
//! Six commands, which is the minimum Story 11's UI needs. The CAP-5 link choice is
//! answered by calling `sync_enable` again *with* the choice rather than through a seventh
//! command, so there is one entry point for "turn sync on" in every state it can be in.
//!
//! Nothing here holds the active-dataset lock while awaiting the actor: a command either
//! reads the actor's `watch` status (no round trip at all) or sends one message and awaits
//! its own reply. That is what keeps AD-16's "sync never blocks the UI" true of the IPC
//! layer as well as of the actor.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tracing::{info, warn};

use crate::error::AppError;
use crate::models::ProjectImage;
use crate::sync::bootstrap::LinkChoice;
use crate::sync::host::DatasetHost;
use crate::sync::restore::{self, RecentlyDeletedView, RestoreOutcome};
use crate::sync::manager::{
    self, RemoteChoice, SyncDiagnostics, SyncEnableOutcome, SyncFault, SyncHandle, SyncPrompt,
    SyncState, SyncStatusPayload, SyncTuning,
};

/// The actor for the active dataset, or `None` when that dataset cannot sync.
#[derive(Default)]
pub struct SyncSupervisor(Mutex<Option<SyncHandle>>);

impl SyncSupervisor {
    fn take(&self) -> Option<SyncHandle> {
        self.0.lock().ok().and_then(|mut slot| slot.take())
    }

    fn current(&self) -> Option<SyncHandle> {
        self.0.lock().ok().and_then(|slot| slot.clone())
    }

    fn replace(&self, handle: Option<SyncHandle>) {
        if let Ok(mut slot) = self.0.lock() {
            *slot = handle;
        }
    }
}

/// Stops the actor for whatever dataset is active (AD-6: sync follows the active dataset
/// and stops on `dataset:switched`; also used on sign-out).
///
/// Synchronous and best-effort on purpose: a dataset switch must not wait for an upload in
/// flight, and dropping the handle releases the actor's thread, its connection and its
/// vended credentials as the task unwinds.
pub(crate) fn stop(app: &AppHandle) {
    let Some(supervisor) = app.try_state::<SyncSupervisor>() else {
        return;
    };

    if let Some(handle) = supervisor.take() {
        handle.stop();
        info!("Sync stopped for dataset {}", handle.dataset_id());
    }
}

/// Disables sync and stops the actor, for a caller that is about to unlink the dataset.
///
/// `disable` first and `stop` second: disabling is what releases the actor's connection and
/// forgets the vended credentials (AD-15 "credentials forgotten"), and only a running actor can
/// be asked to do it. A failure is logged rather than returned — the caller's own work (a
/// `danger_zone` wipe) must not be refused because sync could not be told about it, and the wipe
/// deletes the `sync_state` row anyway, which IS the Unlinked state.
pub(crate) async fn disable_and_stop(app: &AppHandle) {
    if let Some(handle) = app
        .try_state::<SyncSupervisor>()
        .and_then(|supervisor| supervisor.current())
    {
        if let Err(error) = handle.disable().await {
            warn!("Sync could not be disabled before the dataset was unlinked: {}", error.code());
        }
    }

    stop(app);
}

/// Starts the actor for the active dataset, if that dataset is cloud-linked.
///
/// Never fails the caller: a sync fault at launch or at a dataset switch is logged and
/// leaves the app exactly as it was (AD-16). A local-only profile produces no actor at all
/// — no thread, no client, no request (inherited AD-12).
pub(crate) fn start_for_active_dataset(app: &AppHandle) {
    let Some(supervisor) = app.try_state::<SyncSupervisor>() else {
        return;
    };

    let host = match DatasetHost::for_active_dataset(app) {
        Ok(Some(host)) => host,
        Ok(None) => {
            supervisor.replace(None);
            return;
        }
        Err(error) => {
            warn!("Sync could not inspect the active dataset: {}", error);
            supervisor.replace(None);
            return;
        }
    };

    let (handle, mut events) = match manager::spawn(host, SyncTuning::default()) {
        Ok(started) => started,
        Err(error) => {
            warn!("Sync actor could not be started: {}", error);
            supervisor.replace(None);
            return;
        }
    };

    supervisor.replace(Some(handle.clone()));

    let emitter = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(payload) = events.recv().await {
            // Best-effort, matching the `dataset:switched` precedent: the transition has
            // already happened, so a failed notification must not be treated as a fault.
            let _ = emitter.emit("sync:status", payload);
        }
    });

    // Fire-and-forget, and UNCONDITIONAL for a cloud-linked dataset: sync is on by default for an
    // account that holds the capability, and the actor itself decides — it respects the user's
    // durable switch, and the first thing that happens is still a gate check, so an account
    // without the capability joins nothing and is told nothing. A join that cannot run yet is
    // retried from the actor's own tick rather than waiting for the next launch.
    tauri::async_runtime::spawn(async move {
        if let Err(fault) = handle.auto_start().await {
            info!("Sync could not be asked to start: {}", fault.code());
        }
    });
}

/// Starts the actor for the active dataset unless one is already running.
///
/// Sign-in needs this: `sign_out` stops the actor, and signing back in re-selects the dataset that
/// is already open, which `select_dataset_now` treats as a no-op, so nothing else would restart it
/// and the profile would sit unsynced (and the indicator hidden) until the next launch.
pub(crate) fn ensure_started(app: &AppHandle) {
    let running = app
        .try_state::<SyncSupervisor>()
        .is_some_and(|supervisor| supervisor.current().is_some());

    if !running {
        start_for_active_dataset(app);
    }
}

fn handle(app: &AppHandle) -> Result<SyncHandle, AppError> {
    app.try_state::<SyncSupervisor>()
        .and_then(|supervisor| supervisor.current())
        .ok_or_else(|| AppError::from(SyncFault::ActorUnavailable))
}

/// Turns sync on for the active dataset, and answers CAP-5's link choice when one is
/// needed. `link_choice` is `"replace"` or `"separate"`; `None` asks.
#[tauri::command(rename_all = "snake_case")]
pub async fn sync_enable(
    app: AppHandle,
    link_choice: Option<String>,
) -> Result<SyncEnableOutcome, AppError> {
    let choice = link_choice.as_deref().map(parse_link_choice).transpose()?;

    Ok(handle(&app)?.enable(choice).await?)
}

/// Turns "sync across my computers" off for this dataset, durably.
///
/// The cloud copy is never deleted (AD-14) and the profile stays linked; the switch is stored in
/// the dataset so a relaunch, a sign-in or a dataset switch does not turn sync back on.
#[tauri::command(rename_all = "snake_case")]
pub async fn sync_disable(app: AppHandle) -> Result<(), AppError> {
    Ok(handle(&app)?.disable().await?)
}

/// The current state. Never an error, because a profile that cannot sync has a state
/// (`unlinked`) rather than a failure, and the UI renders it the same way either way.
#[tauri::command(rename_all = "snake_case")]
pub fn sync_status(app: AppHandle) -> Result<SyncStatusPayload, AppError> {
    let dataset_id = crate::datasets::active_dataset_id(&app.state::<crate::db::DbState>())
        .unwrap_or_default();

    Ok(app
        .try_state::<SyncSupervisor>()
        .and_then(|supervisor| supervisor.current())
        .map(|handle| handle.status())
        .unwrap_or(SyncStatusPayload {
            state: SyncState::Unlinked,
            dataset_id,
            enabled: false,
            paused: false,
            last_sync_ms: None,
            error_code: None,
            recoverable: true,
            prompt: None,
        }))
}

/// Uploads now, ignoring the settle window and the minimum interval — those are the policy
/// for unattended uploads, and this call is the user asking.
#[tauri::command(rename_all = "snake_case")]
pub async fn sync_now(app: AppHandle) -> Result<SyncStatusPayload, AppError> {
    let handle = handle(&app)?;
    handle.sync_now().await?;

    Ok(handle.status())
}

/// The deletes that are still restorable (AD-5: 30 days), grouped for display.
///
/// Reads only this computer's own `sync_tombstone`, so it costs no request and works offline. A
/// local-only profile records no delete at all and is answered with `sync_available: false` rather
/// than with an empty list that would look like a bug.
#[tauri::command(rename_all = "snake_case")]
pub fn list_recently_deleted(
    state: State<crate::db::DbState>,
) -> Result<RecentlyDeletedView, AppError> {
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    restore::list(&active)
}

/// Brings one deleted row back, with the rows the schema cascaded away with it (AD-12).
///
/// The rows are written as ORDINARY captured changes, so the restore reaches the other computers
/// the way any local edit does.
#[tauri::command(rename_all = "snake_case")]
pub fn restore_deleted(
    state: State<crate::db::DbState>,
    id: String,
) -> Result<RestoreOutcome, AppError> {
    let key = restore::TombstoneKey::parse(&id)?;
    let active = state.0.lock().map_err(|e| AppError::Database {
        message: e.to_string(),
    })?;

    let outcome = restore::restore(&active, &key)?;

    let details = serde_json::to_string(&outcome).unwrap_or_default();
    crate::db::audit::record(&active, "recently_deleted", 0, "restore", None, Some(&details));

    Ok(outcome)
}

/// Answers the "the cloud copy changed on another computer" prompt. `action` is
/// `"load_remote"` (keeps the current file as a dated backup) or `"keep_local"`.
#[tauri::command(rename_all = "snake_case")]
pub async fn sync_resolve_remote_changed(
    app: AppHandle,
    action: String,
) -> Result<SyncStatusPayload, AppError> {
    let choice = parse_remote_choice(&action)?;
    let handle = handle(&app)?;
    handle.resolve_remote(choice).await?;

    Ok(handle.status())
}

/// Counts, states, timings and error codes — never values (AD-16).
#[tauri::command(rename_all = "snake_case")]
pub async fn sync_diagnostics(app: AppHandle) -> Result<SyncDiagnostics, AppError> {
    Ok(handle(&app)?.diagnostics().await?)
}

/// Downloads one project's full picture from the cloud and stores it locally (AD-10, CAP-6).
///
/// The answer is the same `ProjectImage` shape `get_project_image` returns, so the caller
/// replaces what it already had rather than merging two payloads — with
/// `full_image_available: true` once the bytes are here. A picture this computer already holds is
/// returned without a single request; a profile that cannot sync answers with a typed code and
/// makes none either (inherited AD-12, AD-14).
#[tauri::command(rename_all = "snake_case")]
pub async fn sync_fetch_project_image(
    app: AppHandle,
    project_id: i64,
) -> Result<ProjectImage, AppError> {
    Ok(handle(&app)?.fetch_image(project_id).await?)
}

/// The version of the exported document's own shape. Support reads it before anything else,
/// so it is the one field that may never be removed or re-used for a different layout.
const DIAGNOSTICS_EXPORT_VERSION: u32 = 1;

#[derive(Debug, Clone, serde::Serialize)]
pub struct SyncDiagnosticsExport {
    pub path: String,
}

/// The environment half of the report: everything about the computer rather than about sync.
pub(crate) struct ExportEnvironment {
    pub app_version: String,
    pub os: &'static str,
    pub arch: &'static str,
    pub generated_ms: i64,
}

/// Builds the document that leaves the machine, field by field.
///
/// Hand-built rather than `serde_json::to_value(diagnostics)` BECAUSE that is the redaction:
/// a field added to `SyncDiagnostics` later cannot leak into a user-facing file by being
/// serialized along with everything else — it has to be named here, which is a decision
/// someone makes once. Two identifiers the diagnostics do carry are dropped on the way out:
/// `dataset_id` and anything derived from the account. AD-16 asks for counts, states,
/// timings and codes, and an identifier is none of those; a hash would still be a stable
/// cross-report correlator, so they are omitted outright rather than hashed.
pub(crate) fn redacted_document(
    diagnostics: &SyncDiagnostics,
    environment: &ExportEnvironment,
) -> serde_json::Value {
    serde_json::json!({
        "export_version": DIAGNOSTICS_EXPORT_VERSION,
        "generated_ms": environment.generated_ms,
        "app": {
            "version": environment.app_version,
            "os": environment.os,
            "arch": environment.arch,
            "schema_version": diagnostics.schema_version,
        },
        "sync": {
            "capability": diagnostics.capability,
            "state": diagnostics.state,
            "enabled": diagnostics.enabled,
            "has_pulled_latest": diagnostics.has_pulled_latest,
            "pending_prompt": diagnostics.pending_prompt.as_ref().map(prompt_kind),
            "frozen_reason": diagnostics.frozen_reason,
            "last_error_code": diagnostics.last_error_code,
            "last_sync_ms": diagnostics.last_sync_ms,
            "transitions": diagnostics.transitions,
        },
        "counts": {
            "uploads": diagnostics.uploads,
            "conflicts": diagnostics.conflicts,
            "restores": diagnostics.restores,
            "failures": diagnostics.failures,
            "blocked": diagnostics.blocked,
            "local_rows": diagnostics.local_rows,
            "snapshots": diagnostics.uploads + diagnostics.restores,
            "parked_segments": diagnostics.parked_segments,
            "pending_messages": diagnostics.pending_messages,
            "quarantined_messages": diagnostics.quarantined_messages,
            "clock_skews": diagnostics.clock_skews,
        },
        "bytes": {
            "last_object": diagnostics.last_object_bytes,
            "last_payload": diagnostics.last_payload_bytes,
        },
        "timings_ms": {
            "last_build": diagnostics.last_build_ms,
            "backoff": diagnostics.backoff_ms,
            "settle_window": diagnostics.settle_window_ms,
            "min_upload_interval": diagnostics.min_upload_interval_ms,
            "poll_interval": diagnostics.poll_interval_ms,
            "last_clock_skew": diagnostics.last_clock_skew_ms,
        },
    })
}

/// Only which question is open, never the counts and timestamps the prompt carries about
/// the other computer's copy.
fn prompt_kind(prompt: &SyncPrompt) -> &'static str {
    match prompt {
        SyncPrompt::LinkChoice { .. } => "link_choice",
        SyncPrompt::RemoteChanged { .. } => "remote_changed",
    }
}

pub(crate) fn diagnostics_json(
    diagnostics: &SyncDiagnostics,
    environment: &ExportEnvironment,
) -> Result<String, AppError> {
    serde_json::to_string_pretty(&redacted_document(diagnostics, environment)).map_err(|error| {
        AppError::File {
            message: format!("Failed to render the diagnostics report: {}", error),
        }
    })
}

/// A cancelled dialog and a dialog that answered with something that is not a filesystem
/// path are the same outcome: nothing is written and the command answers `Ok(None)`.
fn chosen_path(chosen: Option<tauri_plugin_dialog::FilePath>) -> Option<std::path::PathBuf> {
    chosen.and_then(|path| path.as_path().map(|path| path.to_path_buf()))
}

/// Extracted so the failure path has a test that does not need a dialog, the same way
/// `backup::copy_db_to_path` is.
fn write_document(save_path: &std::path::Path, document: &str) -> Result<(), AppError> {
    std::fs::write(save_path, document).map_err(|error| AppError::File {
        message: format!("Failed to write the diagnostics report: {}", error),
    })
}

/// Saves the redacted diagnostics report to a file the user chooses, for a support report
/// (AD-16: counts, states, timings and error codes, never values).
///
/// `Ok(None)` is a cancelled dialog, which is not an error — the same contract as
/// `export_backup` and `export_budget_template`, and the dialog is opened on the Rust side
/// for the same reason: no state lock is held while it is open.
#[tauri::command(rename_all = "snake_case")]
pub async fn sync_export_diagnostics(
    app: AppHandle,
) -> Result<Option<SyncDiagnosticsExport>, AppError> {
    let diagnostics = handle(&app)?.diagnostics().await?;
    let environment = ExportEnvironment {
        app_version: app.package_info().version.to_string(),
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        generated_ms: chrono::Utc::now().timestamp_millis(),
    };
    let document = diagnostics_json(&diagnostics, &environment)?;

    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    let chosen = app
        .dialog()
        .file()
        .set_file_name(format!("nixus-sync-diagnostics-{}.json", today))
        .add_filter("JSON", &["json"])
        .blocking_save_file();

    let Some(save_path) = chosen_path(chosen) else {
        return Ok(None);
    };

    write_document(&save_path, &document)?;

    let path = save_path.to_string_lossy().to_string();
    info!("Sync diagnostics exported to {}", path);

    Ok(Some(SyncDiagnosticsExport { path }))
}

fn parse_link_choice(choice: &str) -> Result<LinkChoice, AppError> {
    match choice {
        "replace" => Ok(LinkChoice::Replace),
        "separate" => Ok(LinkChoice::Separate),
        _ => Err(AppError::Validation {
            message: "Unknown sync link choice".to_string(),
            field: Some("link_choice".to_string()),
        }),
    }
}

fn parse_remote_choice(action: &str) -> Result<RemoteChoice, AppError> {
    match action {
        "load_remote" => Ok(RemoteChoice::LoadRemote),
        "keep_local" => Ok(RemoteChoice::KeepLocal),
        _ => Err(AppError::Validation {
            message: "Unknown sync conflict action".to_string(),
            field: Some("action".to_string()),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_two_conflict_answers_parse_and_nothing_else_does() {
        assert_eq!(
            parse_remote_choice("load_remote").expect("a known action"),
            RemoteChoice::LoadRemote
        );
        assert_eq!(
            parse_remote_choice("keep_local").expect("a known action"),
            RemoteChoice::KeepLocal
        );

        for unknown in ["", "LOAD_REMOTE", "replace", "load remote"] {
            assert!(
                parse_remote_choice(unknown).is_err(),
                "{unknown:?} must not be accepted"
            );
        }
    }

    #[test]
    fn the_two_link_choices_parse_and_nothing_else_does() {
        assert_eq!(
            parse_link_choice("replace").expect("a known choice"),
            LinkChoice::Replace
        );
        assert_eq!(
            parse_link_choice("separate").expect("a known choice"),
            LinkChoice::Separate
        );

        for unknown in ["", "Replace", "keep", "load_remote"] {
            assert!(
                parse_link_choice(unknown).is_err(),
                "{unknown:?} must not be accepted"
            );
        }
    }

    #[test]
    fn an_unknown_conflict_answer_names_the_argument_it_came_from() {
        match parse_remote_choice("nope") {
            Err(AppError::Validation { field, .. }) => {
                assert_eq!(field.as_deref(), Some("action"))
            }
            other => panic!("expected a validation error naming the field, got {other:?}"),
        }
    }

    fn environment() -> ExportEnvironment {
        ExportEnvironment {
            app_version: "0.1.6".to_string(),
            os: "macos",
            arch: "aarch64",
            generated_ms: 1_760_000_000_000,
        }
    }

    /// Every field populated and every optional one present, so a test about what the
    /// document carries is not quietly testing a document full of nulls.
    fn full_diagnostics() -> SyncDiagnostics {
        SyncDiagnostics {
            dataset_id: "01J0SECRETDATASETID".to_string(),
            capability: "multi_device_sync",
            state: SyncState::Offline,
            transitions: vec![crate::sync::manager::SyncTransition {
                state: SyncState::Syncing,
                at_ms: 1_759_999_000_000,
                error_code: Some("offline".to_string()),
            }],
            enabled: true,
            has_pulled_latest: true,
            rate_delays: 0,
            oversize_refusals: 0,
            pending_prompt: Some(SyncPrompt::RemoteChanged {
                remote_created_ms: 1_759_000_000_000,
                remote_schema_version: 30,
            }),
            uploads: 7,
            segments_shipped: 9,
            segments_fetched: 5,
            messages_received: 41,
            reconcile_messages: 2,
            parked_segments: 2,
            pending_messages: 3,
            quarantined_messages: 1,
            clock_skews: 1,
            last_clock_skew_ms: Some(612_000),
            segments_deleted: 11,
            snapshots_deleted: 1,
            roster_pruned: 1,
            conflicts: 2,
            restores: 1,
            failures: 3,
            blocked: 4,
            last_error_code: Some("offline".to_string()),
            last_sync_ms: Some(1_759_999_900_000),
            last_build_ms: Some(719),
            last_object_bytes: Some(2_131_153),
            last_payload_bytes: Some(14_950_400),
            local_rows: Some(26_012),
            schema_version: 30,
            frozen_reason: Some("entitlement_lapsed"),
            backoff_ms: Some(5_000),
            settle_window_ms: 5_000,
            min_upload_interval_ms: 60_000,
            poll_interval_ms: 2_000,
        }
    }

    fn strings_in(value: &serde_json::Value, found: &mut Vec<String>) {
        match value {
            serde_json::Value::String(text) => found.push(text.clone()),
            serde_json::Value::Array(items) => {
                for item in items {
                    strings_in(item, found);
                }
            }
            serde_json::Value::Object(fields) => {
                for field in fields.values() {
                    strings_in(field, found);
                }
            }
            _ => {}
        }
    }

    #[test]
    fn the_exported_document_is_valid_json_with_a_versioned_schema() {
        let rendered = diagnostics_json(&full_diagnostics(), &environment()).expect("renders");

        let parsed: serde_json::Value = serde_json::from_str(&rendered).expect("valid JSON");

        assert_eq!(parsed["export_version"], 1);
        assert_eq!(parsed["generated_ms"], 1_760_000_000_000_i64);
        assert_eq!(parsed["app"]["version"], "0.1.6");
        assert_eq!(parsed["app"]["schema_version"], 30);
        assert_eq!(parsed["sync"]["state"], "offline");
        assert_eq!(parsed["sync"]["pending_prompt"], "remote_changed");
        assert_eq!(parsed["sync"]["last_error_code"], "offline");
        assert_eq!(parsed["sync"]["transitions"][0]["state"], "syncing");
        assert_eq!(parsed["counts"]["uploads"], 7);
        assert_eq!(parsed["counts"]["local_rows"], 26_012);
        assert_eq!(parsed["counts"]["snapshots"], 8);
        assert_eq!(parsed["bytes"]["last_object"], 2_131_153);
        assert_eq!(parsed["timings_ms"]["last_build"], 719);
        assert_eq!(parsed["timings_ms"]["settle_window"], 5_000);
    }

    /// The structural half of AD-16's "never values": every string that reaches the file has
    /// to be one this code chose, which is a property of the whole document rather than of
    /// the fields someone remembered to check. A `SyncDiagnostics` field added later that
    /// carries text fails here even if nobody writes a test for it.
    #[test]
    fn no_string_in_the_document_can_come_from_the_dataset_or_the_account() {
        let document = redacted_document(&full_diagnostics(), &environment());
        let mut found = Vec::new();
        strings_in(&document, &mut found);

        let allowed = [
            "multi_device_sync",
            "offline",
            "syncing",
            "remote_changed",
            "entitlement_lapsed",
            "macos",
            "aarch64",
            "0.1.6",
        ];
        for text in &found {
            assert!(
                allowed.contains(&text.as_str()),
                "{text:?} is a string this document did not choose: a value, an identifier \
                 or a service message would arrive exactly this way"
            );
        }
        assert!(found.len() >= 6, "the fixture must exercise every string field");
    }

    #[test]
    fn the_dataset_id_never_leaves_the_backend() {
        let rendered = diagnostics_json(&full_diagnostics(), &environment()).expect("renders");

        assert!(
            !rendered.contains("01J0SECRETDATASETID"),
            "the dataset id is an identifier, not a count, a state, a timing or a code"
        );
    }

    #[test]
    fn a_cancelled_dialog_writes_nothing_and_is_not_an_error() {
        assert_eq!(chosen_path(None), None);
    }

    #[test]
    fn a_chosen_path_is_carried_through_verbatim() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let target = dir.path().join("report.json");

        assert_eq!(
            chosen_path(Some(tauri_plugin_dialog::FilePath::Path(target.clone()))),
            Some(target)
        );
    }

    #[test]
    fn a_write_that_fails_is_a_file_error_and_not_a_panic() {
        let dir = tempfile::tempdir().expect("a temp dir");

        // A directory is the portable way to make a write fail: it is refused on both
        // macOS and Windows, where a permission bit or a path shape would not be.
        let outcome = write_document(dir.path(), "{}");

        assert!(
            matches!(outcome, Err(AppError::File { .. })),
            "expected a file error, got {outcome:?}"
        );
    }

    #[test]
    fn a_write_that_succeeds_leaves_the_document_on_disk() {
        let dir = tempfile::tempdir().expect("a temp dir");
        let target = dir.path().join("report.json");
        let rendered = diagnostics_json(&full_diagnostics(), &environment()).expect("renders");

        write_document(&target, &rendered).expect("the write succeeds");

        assert_eq!(std::fs::read_to_string(&target).expect("readable"), rendered);
    }
}
