use tauri::{AppHandle, State};
use tracing::{info, warn};

use crate::datasets;
use crate::db::danger_zone as danger_zone_db;
use crate::db::sync_state;
use crate::db::sync_wipe;
use crate::db::DbState;
use crate::error::AppError;
use crate::profile_store;

/// Permanently deletes all user data: finance, vehicles, net worth, chat and audit
/// history, plus the stored user profile. App preferences and stored AI credentials
/// are preserved.
///
/// On a SYNCED dataset this is a WIPE EVENT for the whole account (story wipe-epoch, revising
/// AD-15), and the order of the four steps below is load-bearing.
///
/// 1. Sync is disabled and the actor stopped FIRST, so no upload can be in flight over a file that
///    is being emptied and the vended credentials are gone.
/// 2. The deletes run through `write_uncaptured`, which detaches the capture hook for the
///    transaction: a wipe that captured would write a tombstone per row and ship the user's whole
///    dataset as deletions to every other computer. That remains the wrong mechanism — a tombstone
///    flood is unbounded, slow and restorable for 30 days, none of which is what "delete
///    everything" means.
/// 3. The INTENT is recorded in the SAME transaction. `sync_state` is `WIPE_TABLES[0]`, so
///    deleting the row IS the Unlinked state and any record of the wipe kept there would go with
///    it; `config.sync_wipe_pending` survives (`config` is preserved) and names the install id
///    this dataset had, so neither a crash between the two writes nor a second wipe later can lose
///    the event or be mistaken for the first one (`db::sync_wipe`).
/// 4. The actor is started again, which is what registers the event promptly: `sync::wipe::register`
///    runs at the top of its first join, moves the account to a new epoch, and every other
///    computer of this user empties itself when it reads that epoch. The pre-wipe cloud objects
///    are NOT deleted — the app holds no permission to delete the user's data (AD-13) — they are
///    made unreachable by the epoch and expire through retention.
///
/// What is NOT account-wide: edits made on another computer AFTER the wipe are kept (they are
/// published at the new epoch), and the global profile store is erased only here, on the computer
/// where the user asked, because that PII belongs to the person rather than to a dataset.
#[tauri::command(rename_all = "snake_case")]
pub async fn delete_all_data(app: AppHandle, state: State<'_, DbState>) -> Result<(), AppError> {
    crate::commands::sync::disable_and_stop(&app).await;

    {
        let mut active = state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;

        // Read BEFORE the wipe, because the wipe deletes the row it comes from. A dataset that
        // never JOINED has published nothing and holds none of the account's rows, so there is no
        // event for the account to learn about — only a local delete.
        let joined_install = {
            let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
            sync_state::load(conn)?
                .filter(sync_state::SyncState::joined)
                .map(|state| state.install_id)
        };

        let deleted = active.write_uncaptured(|conn| {
            let deleted = danger_zone_db::wipe_all(conn)?;
            if let Some(install) = &joined_install {
                sync_wipe::set_pending_wipe(conn, install)?;
            }

            Ok(deleted)
        })?;
        match &joined_install {
            Some(_) => info!(
                "Danger Zone wipe complete: {deleted} rows deleted; this account's other \
                 computers will be told once the event is registered"
            ),
            // S6: a cloud-linked profile that never finished a join holds none of the account's
            // rows and has published nothing, so there is no event for anyone to learn about —
            // and saying so is what stops this reading as a silently skipped notification.
            None => info!(
                "Danger Zone wipe complete: {deleted} rows deleted; no cloud event was \
                 registered because this profile had not joined an account's sync"
            ),
        }

        let conn = active.conn.as_mut().ok_or(AppError::NotConfigured)?;

        // Non-fatal: the rows are already gone, this only reclaims disk space.
        if let Err(e) = danger_zone_db::reclaim_space(conn) {
            warn!("Post-wipe checkpoint/vacuum failed: {}", e);
        }
    }

    // AD-13: profiles are dataset-independent, so the deletion target is
    // global_root, not active_dataset_dir — otherwise profile PII could survive
    // a "delete all data" run from a non-default dataset (NFR4).
    let app_data_dir = datasets::global_root(&app)?;

    // Fatal, unlike reclaim_space: a failure here means profile PII is still on
    // disk after the user asked for everything to be deleted (NFR4).
    profile_store::delete_all_profiles(&profile_store::profiles_dir(&app_data_dir))?;

    // Nothing else restarts it: `disable_and_stop` dropped the handle (it `take`s the supervisor
    // slot), and the frontend only relaunches the app on its happy path. `ensure_started` and not
    // `start_for_active_dataset`, because the latter REPLACES whatever is in the slot: an actor
    // that survived — a concurrent call, a slot repopulated by a dataset switch — would be
    // orphaned rather than stopped, and two live actors could both read the still-set
    // `sync_wipe_pending` and register two epochs for one wipe. Started AFTER the `DbState` guard
    // above is released, because the host reads the active dataset through that same lock.
    crate::commands::sync::ensure_started(&app);

    Ok(())
}
