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

use tauri::{AppHandle, Emitter, Manager};
use tracing::{info, warn};

use crate::error::AppError;
use crate::sync::bootstrap::LinkChoice;
use crate::sync::host::DatasetHost;
use crate::sync::manager::{
    self, RemoteChoice, SyncDiagnostics, SyncEnableOutcome, SyncFault, SyncHandle, SyncState,
    SyncStatusPayload, SyncTuning,
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

    let resume = host.resume_wanted();

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

    if resume {
        // Fire-and-forget: a dataset that was synced on a previous launch resumes on its
        // own, and the first thing that happens is still a gate check, so a lapsed
        // entitlement resumes as `frozen` instead of as a transfer.
        tauri::async_runtime::spawn(async move {
            if let Err(fault) = handle.enable(None).await {
                info!("Sync did not resume: {}", fault.code());
            }
        });
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

/// Stops syncing this dataset without touching the cloud copy (AD-14: the cloud copy is
/// never deleted) and without unlinking the profile.
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
}
