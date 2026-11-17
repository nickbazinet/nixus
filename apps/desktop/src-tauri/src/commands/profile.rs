use std::path::PathBuf;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use chrono::Datelike;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::avatar_store;
use crate::datasets;
use crate::db::account as account_db;
use crate::db::DbState;
use crate::error::AppError;
use crate::models::{
    Country, Dataset, DatasetKind, ProfileFields, ProfileView, Subdivision, TfsaAccumulatedLimit,
    UpdateUserProfileInput, UserAvatar,
};
use crate::profile_store;
use crate::tfsa;

// AD-13: the demographic profile store is dataset-independent — global_root,
// never active_dataset_dir, or profiles would silently become per-dataset once
// a non-default dataset can be active.
fn resolve_profiles_dir(app: &AppHandle) -> Result<PathBuf, AppError> {
    Ok(profile_store::profiles_dir(&datasets::global_root(app)?))
}

/// Which home a demographic read or write belongs to (AD-6).
///
/// Rust-internal, and the `Cloud` arm's `sub` is why: the subject is resolved here and never
/// crosses IPC in either direction (D3). The webview is handed `source_key` instead, which is
/// derived from the active dataset and carries no identity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ProfileSource {
    Cloud { sub: String },
    Local { dataset_id: String },
}

impl ProfileSource {
    /// The spine's source token (`cloud:<sub>` / `local:<dataset-id>`), for logs and diagnostics.
    #[allow(dead_code)] // The refresh/save orchestration that logs it lands with Epic E.
    pub(crate) fn token(&self) -> String {
        match self {
            ProfileSource::Cloud { sub } => format!("cloud:{sub}"),
            ProfileSource::Local { dataset_id } => format!("local:{dataset_id}"),
        }
    }
}

/// The resolver, as a pure function of the active dataset and the resolved subject (AD-6).
///
/// Pure so the whole kind × session matrix — including AD-15's desktop cross-account row — is
/// testable with no keyring and no running app, which is the only way those refusals get exercised
/// at all.
///
/// The LOCAL arm never looks at `subject`: a local profile is a purely local concept, so resolving
/// one must not open the OS secure store or POST a token refresh for a profile that has no account
/// (adversary H1). The CLOUD arm defers to `datasets::is_signed_in` rather than re-deriving the
/// comparison, so "this dataset's own account is the one signed in" has exactly one definition in
/// the codebase (adversary H2) — a machine-wide session belonging to another account resolves to
/// `None`, never to that account's files.
pub(crate) fn resolve_source(entry: &Dataset, subject: Option<&str>) -> Option<ProfileSource> {
    match entry.kind {
        DatasetKind::Local => Some(ProfileSource::Local {
            dataset_id: entry.id.clone(),
        }),
        DatasetKind::CloudLinked => {
            let subject = subject?;
            crate::commands::datasets::is_signed_in(entry, Some(subject)).then(|| {
                ProfileSource::Cloud {
                    sub: subject.to_string(),
                }
            })
        }
    }
}

/// The opaque token the webview threads through an operation and into its query keys.
///
/// Keyed on the DATASET, never on the subject, which is what lets it cross IPC at all. It is also
/// what makes a stale write detectable: the key the caller was holding is compared against the
/// key the active dataset resolves to now, so a dataset switch that lands mid-edit refuses the
/// write instead of silently redirecting it at the other source (adversary M3).
fn source_key_of(source: &ProfileSource, dataset_id: &str) -> String {
    match source {
        ProfileSource::Cloud { .. } => format!("cloud:{dataset_id}"),
        ProfileSource::Local { .. } => format!("local:{dataset_id}"),
    }
}

struct ActiveSource {
    source: ProfileSource,
    key: String,
}

async fn resolve_active_source(app: &AppHandle) -> Result<Option<ActiveSource>, AppError> {
    let active_id = datasets::active_dataset_id(&app.state::<DbState>())?;
    let entry = crate::commands::datasets::find_registered(datasets::load_registry(app)?, &active_id)?;

    // Resolved only for a cloud-linked dataset, matching `get_active_profile`: `current_subject`
    // can refresh an expired session over the network, and a local profile must never trigger that.
    let subject = if entry.kind == DatasetKind::CloudLinked {
        crate::commands::auth::current_subject().await.ok()
    } else {
        None
    };

    Ok(resolve_source(&entry, subject.as_deref()).map(|source| ActiveSource {
        key: source_key_of(&source, &entry.id),
        source,
    }))
}

fn no_source() -> AppError {
    AppError::CloudProfile {
        code: "unauthorized".to_string(),
        message: "This profile has no demographics to read.".to_string(),
        field: None,
        reason: None,
        recoverable: true,
    }
}

fn source_mismatch() -> AppError {
    AppError::CloudProfile {
        code: "unavailable".to_string(),
        message: "The open profile changed before that could be saved.".to_string(),
        field: None,
        reason: None,
        recoverable: true,
    }
}

fn avatar_requires_cloud() -> AppError {
    AppError::CloudProfile {
        code: "unauthorized".to_string(),
        message: "A profile picture needs a Nixus Cloud profile.".to_string(),
        field: None,
        reason: None,
        recoverable: false,
    }
}

/// Re-resolves the active source and refuses anything the caller's `source_key` no longer names.
async fn require_source(app: &AppHandle, source_key: &str) -> Result<ProfileSource, AppError> {
    let active = resolve_active_source(app).await?.ok_or_else(no_source)?;

    if active.key != source_key {
        return Err(source_mismatch());
    }

    Ok(active.source)
}

/// What `/profile` branches on, and the only profile identity the webview ever sees.
#[derive(Debug, Serialize)]
pub struct ProfileSourceInfo {
    pub kind: &'static str,
    pub source_key: Option<String>,
}

#[tauri::command(rename_all = "snake_case")]
pub async fn get_profile_source(app: AppHandle) -> Result<ProfileSourceInfo, AppError> {
    let Some(active) = resolve_active_source(&app).await? else {
        return Ok(ProfileSourceInfo {
            kind: "none",
            source_key: None,
        });
    };

    Ok(ProfileSourceInfo {
        kind: match active.source {
            ProfileSource::Cloud { .. } => "cloud",
            ProfileSource::Local { .. } => "local",
        },
        source_key: Some(active.key),
    })
}

fn view(source_key: &str, fields: ProfileFields, created_at: String, updated_at: String) -> ProfileView {
    ProfileView {
        source_key: source_key.to_string(),
        fields,
        created_at,
        updated_at,
    }
}

fn fields_of_cloud_copy(profile: crate::models::UserProfile) -> ProfileFields {
    ProfileFields {
        first_name: profile.first_name,
        last_name: profile.last_name,
        birth_date: profile.birth_date,
        income_bracket: profile.income_bracket,
        income_bracket_currency: profile.income_bracket_currency,
        country_code: profile.country_code,
        subdivision_code: profile.subdivision_code,
    }
}

/// This dataset's demographics, from whichever home the resolver names.
///
/// The source is resolved BEFORE the directory in both arms, so "a call that resolves to nothing
/// touches no file" stays structural rather than incidental. `async` because the cloud arm's
/// subject resolution may perform a token refresh; the local arm awaits nothing of the sort.
///
/// No `State<DbState>` and no audit-log row: a file-backed store has neither a `Connection` nor an
/// `i64 entity_id`, and keeping profile values out of `nixus.db` is what keeps them out of backups
/// (D10).
#[tauri::command(rename_all = "snake_case")]
pub async fn get_user_profile(
    app: AppHandle,
    source_key: String,
) -> Result<Option<ProfileView>, AppError> {
    let source = require_source(&app, &source_key).await?;
    let dir = resolve_profiles_dir(&app)?;

    Ok(match source {
        ProfileSource::Cloud { sub } => profile_store::load_profile(&dir, &sub)?.map(|profile| {
            view(
                &source_key,
                fields_of_cloud_copy(profile.clone()),
                profile.created_at,
                profile.updated_at,
            )
        }),
        ProfileSource::Local { dataset_id } => profile_store::load_local(&dir, &dataset_id)?
            .map(|profile| {
                view(
                    &source_key,
                    profile.fields,
                    profile.created_at,
                    profile.updated_at,
                )
            }),
    })
}

/// Saves this dataset's demographics into the home the resolver names.
///
/// The fields stay separate IPC parameters rather than one input object because that is the shape
/// every existing caller and E2E mock already speaks; `source_key` joins them as the one new
/// argument, and Rust re-resolves it rather than trusting it.
#[tauri::command(rename_all = "snake_case")]
#[allow(clippy::too_many_arguments)]
pub async fn save_user_profile(
    app: AppHandle,
    source_key: String,
    first_name: Option<String>,
    last_name: Option<String>,
    birth_date: Option<String>,
    income_bracket: Option<String>,
    income_bracket_currency: Option<String>,
    country_code: Option<String>,
    subdivision_code: Option<String>,
) -> Result<ProfileView, AppError> {
    let source = require_source(&app, &source_key).await?;
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

    Ok(match source {
        // Epic E: the cloud arm becomes `PUT` → await success → `write_cloud_copy` from the
        // response (AD-1/AD-7). This local write is the seam it replaces, kept so the app is not
        // broken in the meantime; the local arm below is final.
        ProfileSource::Cloud { sub } => {
            let saved = profile_store::save_profile(&dir, &sub, &input)?;
            view(
                &source_key,
                fields_of_cloud_copy(saved.clone()),
                saved.created_at,
                saved.updated_at,
            )
        }
        ProfileSource::Local { dataset_id } => {
            let saved = profile_store::save_local(&dir, &dataset_id, &input)?;
            view(
                &source_key,
                saved.fields,
                saved.created_at,
                saved.updated_at,
            )
        }
    })
}

// A thin orchestrator by design: the limits table, the eligibility gate, and
// every piece of year arithmetic live in `tfsa/` so the frontend cannot produce a
// divergent number, no second copy of the table can drift, and the whole
// shown-vs-withheld matrix is unit-testable without a keyring or an `AppHandle`.
//
// It reads through the resolver rather than the session, so a LOCAL dataset's own demographics
// produce the figure with no account at all (AD-6) — and a cloud-linked dataset whose account is
// not the one signed in produces nothing rather than someone else's figure.
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
    let Some(active) = resolve_active_source(&app).await? else {
        return Ok(None);
    };
    let dir = resolve_profiles_dir(&app)?;

    let fields = match active.source {
        ProfileSource::Cloud { sub } => {
            profile_store::load_profile(&dir, &sub)?.map(fields_of_cloud_copy)
        }
        ProfileSource::Local { dataset_id } => {
            profile_store::load_local(&dir, &dataset_id)?.map(|profile| profile.fields)
        }
    };

    let current_year = chrono::Local::now().date_naive().year();

    let Some(limit) = tfsa::calculator::accumulated_limit_for_profile(fields.as_ref(), current_year)
    else {
        return Ok(None);
    };

    let cad_tfsa_balance_cents = {
        let active = state.0.lock().map_err(|e| AppError::Database {
            message: e.to_string(),
        })?;
        let conn = active.conn.as_ref().ok_or(AppError::NotConfigured)?;
        account_db::get_cad_tfsa_balance_cents(conn)?
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

fn encoded_avatar(stored: avatar_store::StoredAvatar) -> UserAvatar {
    UserAvatar {
        mime_type: stored.mime_type,
        image_base64: STANDARD.encode(&stored.image_bytes),
        uploaded_at: stored.uploaded_at,
    }
}

// The avatar pair follows `get_user_profile`'s posture exactly: the source is resolved BEFORE the
// directory, so a call that resolves to nothing opens no database, and neither takes
// `State<DbState>` — an avatar belongs to the Cognito account, so keeping it out of `nixus.db` is
// what keeps it out of dataset backups and out of the dataset lifecycle. No audit-log row for the
// same reason `save_user_profile` writes none.
//
// Avatars are Nixus Cloud-only (AD-6), so a LOCAL source has no picture rather than an error:
// there is nothing to show and nothing has gone wrong.
#[tauri::command(rename_all = "snake_case")]
pub async fn get_user_avatar(
    app: AppHandle,
    source_key: String,
) -> Result<Option<UserAvatar>, AppError> {
    let source = require_source(&app, &source_key).await?;

    let ProfileSource::Cloud { sub } = source else {
        return Ok(None);
    };

    let dir = resolve_profiles_dir(&app)?;

    Ok(avatar_store::load_avatar(&dir, &sub)?.map(encoded_avatar))
}

// The source check precedes the read of the picked path, so an unauthorized call never opens a file
// the webview named. Only the derivative is stored — the source is dropped inside
// `derive_from_file` and never persisted anywhere.
#[tauri::command(rename_all = "snake_case")]
pub async fn set_user_avatar(
    app: AppHandle,
    source_key: String,
    file_path: String,
) -> Result<UserAvatar, AppError> {
    let source = require_source(&app, &source_key).await?;

    let ProfileSource::Cloud { sub } = source else {
        return Err(avatar_requires_cloud());
    };

    let dir = resolve_profiles_dir(&app)?;

    let (image_bytes, mime_type) = avatar_store::derive_from_file(&file_path)?;

    // Epic E: this becomes `PUT /avatar` → `save_avatar_with_version` from the response.
    Ok(encoded_avatar(avatar_store::save_avatar(
        &dir,
        &sub,
        &image_bytes,
        mime_type,
    )?))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SUB_A: &str = "aaaaaaaa-0000-4000-8000-000000000001";
    const SUB_B: &str = "bbbbbbbb-0000-4000-8000-000000000002";
    const DATASET_ID: &str = "00000000-0000-4000-8000-00000000000a";

    fn local_entry() -> Dataset {
        Dataset {
            id: DATASET_ID.to_string(),
            label: "Local Profile 1".to_string(),
            kind: DatasetKind::Local,
            cognito_sub: None,
            linked_from: None,
            is_default: false,
            created_at: "2026-01-01T00:00:00+00:00".to_string(),
        }
    }

    fn cloud_entry(owner: &str) -> Dataset {
        Dataset {
            kind: DatasetKind::CloudLinked,
            cognito_sub: Some(owner.to_string()),
            ..local_entry()
        }
    }

    #[test]
    fn a_local_dataset_resolves_to_its_own_document_whatever_the_session_says() {
        for subject in [None, Some(SUB_A)] {
            assert_eq!(
                resolve_source(&local_entry(), subject),
                Some(ProfileSource::Local {
                    dataset_id: DATASET_ID.to_string()
                })
            );
        }
    }

    #[test]
    fn a_cloud_dataset_resolves_to_its_own_subject_when_that_account_is_signed_in() {
        assert_eq!(
            resolve_source(&cloud_entry(SUB_A), Some(SUB_A)),
            Some(ProfileSource::Cloud {
                sub: SUB_A.to_string()
            })
        );
    }

    // AD-15's desktop cross-account gate. The session is a single machine-wide slot while the
    // copies are subject-keyed, so the only thing standing between account A's signed-in session
    // and a dataset it does not own is this comparison (adversary H2).
    #[test]
    fn no_source_resolves_while_another_accounts_session_is_live() {
        assert_eq!(resolve_source(&cloud_entry(SUB_B), Some(SUB_A)), None);
        assert_eq!(resolve_source(&cloud_entry(SUB_A), Some(SUB_B)), None);
        assert_eq!(resolve_source(&cloud_entry(SUB_A), None), None);

        // The local row of the same matrix: A's session is live, a local dataset is open, and the
        // resolved source names the DATASET — never A's subject, so no byte of A's profile or
        // avatar is reachable through any command path.
        let resolved = resolve_source(&local_entry(), Some(SUB_A)).expect("local always resolves");
        assert_eq!(
            resolved,
            ProfileSource::Local {
                dataset_id: DATASET_ID.to_string()
            }
        );
        assert!(!resolved.token().contains(SUB_A));
    }

    #[test]
    fn an_unlinked_cloud_dataset_resolves_to_no_source() {
        let unlinked = Dataset {
            kind: DatasetKind::CloudLinked,
            cognito_sub: None,
            ..local_entry()
        };

        assert_eq!(resolve_source(&unlinked, Some(SUB_A)), None);
    }

    // The key the webview holds is keyed on the DATASET in both arms: the subject may never cross
    // IPC (D3), and a key that embedded it would hand the identity key straight to the frontend.
    #[test]
    fn the_source_key_names_the_dataset_and_never_the_subject() {
        let cloud = resolve_source(&cloud_entry(SUB_A), Some(SUB_A)).expect("resolves");
        let local = resolve_source(&local_entry(), None).expect("resolves");

        assert_eq!(
            source_key_of(&cloud, DATASET_ID),
            format!("cloud:{DATASET_ID}")
        );
        assert_eq!(
            source_key_of(&local, DATASET_ID),
            format!("local:{DATASET_ID}")
        );
        assert!(!source_key_of(&cloud, DATASET_ID).contains(SUB_A));
    }

    #[test]
    fn the_internal_token_keeps_the_spines_cloud_sub_form() {
        assert_eq!(
            ProfileSource::Cloud {
                sub: SUB_A.to_string()
            }
            .token(),
            format!("cloud:{SUB_A}")
        );
        assert_eq!(
            ProfileSource::Local {
                dataset_id: DATASET_ID.to_string()
            }
            .token(),
            format!("local:{DATASET_ID}")
        );
    }

    // A refused source must be distinguishable from a refused field, and must never be mistaken
    // for "your save went through": both are `cloud_profile` errors carrying no profile value.
    #[test]
    fn the_source_refusals_carry_no_identity_and_no_value() {
        for error in [no_source(), source_mismatch(), avatar_requires_cloud()] {
            let serialized = serde_json::to_string(&error).expect("serializable");
            assert!(serialized.contains(r#""type":"cloud_profile""#), "{serialized}");
            assert!(!serialized.contains(SUB_A));
            assert!(!serialized.contains(DATASET_ID));
        }
    }

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
