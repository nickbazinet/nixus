use std::path::PathBuf;

use chrono::Datelike;
use tauri::{AppHandle, State};

use crate::datasets;
use crate::db::account as account_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::{
    Country, Subdivision, TfsaAccumulatedLimit, UpdateUserProfileInput, UserProfile,
};
use crate::profile_store;
use crate::tfsa;

// AD-13: the demographic profile store is dataset-independent — global_root,
// never active_dataset_dir, or profiles would silently become per-dataset once
// a non-default dataset can be active.
fn resolve_profiles_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(profile_store::profiles_dir(&datasets::global_root(app)?))
}

// Both commands resolve the `sub` BEFORE the directory, so "a no-session call
// touches no file" is structural rather than incidental. `async` because
// `current_subject` may perform a token refresh. No `State<DbState>` and no
// audit-log row: a file-backed store has neither a `Connection` nor an
// `i64 entity_id`, and keeping profile values out of `nkbaz-finance.db` is what
// keeps them out of backups.
#[tauri::command(rename_all = "snake_case")]
pub async fn get_user_profile(app: AppHandle) -> Result<Option<UserProfile>, AppError> {
    let sub = crate::commands::auth::current_subject().await?;
    let dir = resolve_profiles_dir(&app)?;

    profile_store::load_profile(&dir, &sub)
}

#[tauri::command(rename_all = "snake_case")]
#[allow(clippy::too_many_arguments)]
pub async fn save_user_profile(
    app: AppHandle,
    first_name: Option<String>,
    last_name: Option<String>,
    birth_date: Option<String>,
    income_bracket: Option<String>,
    income_bracket_currency: Option<String>,
    country_code: Option<String>,
    subdivision_code: Option<String>,
) -> Result<UserProfile, AppError> {
    let sub = crate::commands::auth::current_subject().await?;
    let dir = resolve_profiles_dir(&app)?;

    let input = UpdateUserProfileInput {
        first_name,
        last_name,
        birth_date,
        income_bracket,
        income_bracket_currency,
        country_code,
        subdivision_code,
    };

    profile_store::save_profile(&dir, &sub, &input)
}

// A thin orchestrator by design: the limits table, the eligibility gate, and
// every piece of year arithmetic live in `tfsa/` so the frontend cannot produce a
// divergent number, no second copy of the table can drift, and the whole
// shown-vs-withheld matrix is unit-testable without a keyring or an `AppHandle`.
//
// `Local::now()` is called here, once — `accumulated_limit_for_profile` takes
// `current_year` as a parameter so the past-the-bound case stays testable without
// freezing the clock. `Local` not `Utc`: `Utc` would flip the figure a few hours
// early or late around New Year for users west of UTC.
//
// `Ok(None)` is a normal outcome, not a failure: non-Canadian, no country, no
// profile document, no birth date, not yet 18, past the table bound, or a CAD TFSA
// balance that already reaches the accumulated room all withhold the figure
// silently. Never extrapolated, never truncated to the bound, and no balance is
// ever subtracted from the figure — the balance decides only whether the figure is
// shown at all, which is why the SQL lives in `db/` and the comparison lives here
// rather than inside the pure `tfsa/` module.
#[tauri::command(rename_all = "snake_case")]
pub async fn get_tfsa_accumulated_limit(
    app: AppHandle,
    state: State<'_, DbState>,
) -> Result<Option<TfsaAccumulatedLimit>, AppError> {
    let sub = crate::commands::auth::current_subject().await?;
    let dir = resolve_profiles_dir(&app)?;

    let profile = profile_store::load_profile(&dir, &sub)?;
    let current_year = chrono::Local::now().date_naive().year();

    let Some(limit) = tfsa::calculator::accumulated_limit_for_profile(profile.as_ref(), current_year)
    else {
        return Ok(None);
    };

    let cad_tfsa_balance_cents = {
        let conn = state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        account_db::get_cad_tfsa_balance_cents(&conn)?
    };

    Ok(gate_on_cad_tfsa_balance(limit, cad_tfsa_balance_cents))
}

/// A heuristic display filter, deliberately NOT a remaining-room calculation.
///
/// `balance < room` means the user MIGHT still have contribution room, so the accumulated figure is
/// worth showing. `balance >= room` means they almost certainly do not, so nothing is shown. It
/// never proves room remains — someone could have contributed the maximum and then lost money in
/// the market — which is exactly why neither the difference nor the balance may ever be displayed.
fn gate_on_cad_tfsa_balance(
    limit: TfsaAccumulatedLimit,
    cad_tfsa_balance_cents: i64,
) -> Option<TfsaAccumulatedLimit> {
    if cad_tfsa_balance_cents >= limit.total_cents {
        return None;
    }

    Some(limit)
}

// The one command in this file that is deliberately NOT session-gated and NOT
// async: the ISO 3166 list is reference data, not user data, and it is read from
// a compile-time-embedded string, so there is no IO and no token refresh. It
// still returns `Result` because every command in this codebase does.
#[tauri::command(rename_all = "snake_case")]
pub fn get_countries() -> Result<Vec<Country>, AppError> {
    Ok(profile_store::countries())
}

// Same posture as `get_countries`: reference data, so no session and no async.
// An unknown or blank code answers `Ok([])` rather than erroring — this is a
// display read, and a profile carrying a stale country code must degrade to
// "field not offered" instead of raising a toast. `save_profile` is the authority.
#[tauri::command(rename_all = "snake_case")]
pub fn get_subdivisions(country_code: String) -> Result<Vec<Subdivision>, AppError> {
    Ok(profile_store::subdivisions_for(country_code.trim()).to_vec())
}


#[cfg(test)]
mod tests {
    use super::*;

    fn room(total_cents: i64) -> TfsaAccumulatedLimit {
        TfsaAccumulatedLimit {
            total_cents,
            eligible_from_year: 2009,
            known_through_year: 2026,
        }
    }

    #[test]
    fn a_balance_below_the_accumulated_room_shows_the_figure() {
        let gated = gate_on_cad_tfsa_balance(room(10_900_000), 3_000_000).unwrap();
        assert_eq!(gated.total_cents, 10_900_000);
        assert_eq!(gated.eligible_from_year, 2009);
        assert_eq!(gated.known_through_year, 2026);
    }

    // The gate is a filter, never a subtraction: what passes through is the untouched accumulated
    // total. A returned 7_900_000 here would be the remaining-room claim this feature forbids.
    #[test]
    fn the_figure_that_passes_the_gate_is_never_reduced_by_the_balance() {
        let gated = gate_on_cad_tfsa_balance(room(10_900_000), 3_000_000).unwrap();
        assert_ne!(gated.total_cents, 10_900_000 - 3_000_000);
        assert_eq!(gated.total_cents, 10_900_000);
    }

    #[test]
    fn a_balance_equal_to_the_accumulated_room_withholds_the_figure() {
        assert!(gate_on_cad_tfsa_balance(room(10_900_000), 10_900_000).is_none());
    }

    #[test]
    fn a_balance_above_the_accumulated_room_withholds_the_figure() {
        assert!(gate_on_cad_tfsa_balance(room(10_900_000), 10_900_001).is_none());
        assert!(gate_on_cad_tfsa_balance(room(10_900_000), 50_000_000).is_none());
    }

    // The boundary pair, one cent apart.
    #[test]
    fn one_cent_below_the_room_shows_and_exactly_at_the_room_withholds() {
        assert!(gate_on_cad_tfsa_balance(room(10_900_000), 10_899_999).is_some());
        assert!(gate_on_cad_tfsa_balance(room(10_900_000), 10_900_000).is_none());
    }

    #[test]
    fn a_zero_balance_shows_the_figure() {
        assert!(gate_on_cad_tfsa_balance(room(10_900_000), 0).is_some());
    }

    // A negative balance is not reachable through the accounts UI for a TFSA, but the gate must
    // still answer "might have room" rather than trip on the sign.
    #[test]
    fn a_negative_balance_still_shows_the_figure() {
        assert!(gate_on_cad_tfsa_balance(room(10_900_000), -500_000).is_some());
    }
}
