use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use chrono::{Datelike, Local, NaiveDate, Utc};
use serde_json::Value;
use tracing::warn;

use crate::error::AppError;
use crate::models::{
    CloudProfileWire, Country, Iso3166Dataset, LocalUserProfile, ProfileFields, Subdivision,
    UpdateUserProfileInput, UserProfile,
};

pub const PROFILE_SCHEMA_VERSION: u32 = 1;

// Embedded at compile time so the country list is available on a first offline
// run: `country_code` gates validation, and an empty catalog would leave the
// field unfillable rather than merely unhelpful. The file is the single canonical
// copy shared with the profile Lambda (AD-5); no second copy may exist.
const ISO3166_JSON: &str = include_str!("../../../../packages/shared/data/iso3166.json");
static ISO3166: OnceLock<Iso3166Dataset> = OnceLock::new();

// Parsed once. Re-parsing ~570 KB on every get_countries call is avoidable.
pub(crate) fn dataset() -> &'static Iso3166Dataset {
    ISO3166.get_or_init(|| {
        serde_json::from_str(ISO3166_JSON).unwrap_or_else(|e| {
            // Unreachable in a shipped binary — the file is checked in and
            // embedded at compile time. An empty dataset keeps the process
            // alive where `.unwrap()`/`.expect()` would panic, and
            // `get_or_init` cannot carry a `Result` out.
            tracing::error!("Failed to parse bundled iso3166.json: {}", e);
            Iso3166Dataset {
                countries: Vec::new(),
            }
        })
    })
}

pub(crate) fn countries() -> Vec<Country> {
    dataset()
        .countries
        .iter()
        .map(|c| Country {
            code: c.code.clone(),
            name_en: c.name_en.clone(),
            name_fr: c.name_fr.clone(),
        })
        .collect()
}

pub(crate) fn country_exists(code: &str) -> bool {
    dataset().countries.iter().any(|c| c.code == code)
}

// A borrow, not a clone: the dataset already owns the `Vec<Subdivision>`, so
// nothing needs copying until the IPC boundary. An unknown country yields an
// empty slice rather than an error, which is the same shape a country with no
// subdivisions produces — the UI renders both as "field not offered".
pub(crate) fn subdivisions_for(country_code: &str) -> &'static [Subdivision] {
    dataset()
        .countries
        .iter()
        .find(|c| c.code == country_code)
        .map(|c| c.subdivisions.as_slice())
        .unwrap_or(&[])
}

const CORRUPT_SUFFIX: &str = "json.corrupt";

// A range label, not a monetary amount: there is nothing to add, subtract or
// format, so the `_cents` rule does not apply and the stored value is the
// categorical code verbatim. Adding cut points later stays additive.
pub(crate) const VALID_INCOME_BRACKETS: &[&str] = &[
    "under_50k",
    "50k_99k",
    "100k_149k",
    "150k_249k",
    "250k_plus",
];

// A curated subset of ISO 4217, not the full set: there is no bundled ISO 4217
// dataset and NFR6 forbids adding one, and ~180 options is poor UX for a field
// that qualifies five coarse buckets. This const is the sole validation
// authority — the frontend option list mirrors it and never overrides it.
pub(crate) const VALID_INCOME_BRACKET_CURRENCIES: &[&str] = &[
    "CAD", "USD", "EUR", "GBP", "AUD", "CHF", "JPY", "CNY", "INR", "MXN", "BRL", "SEK", "NOK",
    "DKK", "NZD", "SGD", "HKD", "ZAR", "KRW", "PLN",
];

pub(crate) const MIN_AGE_YEARS: i32 = 18;
pub(crate) const MAX_AGE_YEARS: i32 = 120;

pub fn profiles_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("profiles")
}

/// The subdirectory holding the editable on-device document of every LOCAL dataset (AD-6).
///
/// A subdirectory rather than a `local-<id>.json` prefix in the same folder, because the two
/// families are keyed by different things — a Cognito subject and a dataset id — and a shared
/// filename namespace lets one overwrite the other (adversary C3, rubric H5). The separation is
/// also what makes AD-8's legacy scan structurally unable to see a local document.
pub fn local_profiles_dir(dir: &Path) -> PathBuf {
    dir.join(LOCAL_SUBDIR)
}

const LOCAL_SUBDIR: &str = "local";

fn profile_path(dir: &Path, sub: &str) -> PathBuf {
    dir.join(format!("{sub}.json"))
}

fn corrupt_path(dir: &Path, sub: &str) -> PathBuf {
    dir.join(format!("{sub}.{CORRUPT_SUFFIX}"))
}

fn local_profile_path(dir: &Path, dataset_id: &str) -> PathBuf {
    local_profiles_dir(dir).join(format!("{dataset_id}.json"))
}

// WHY validated and never slugged: slugging is many-to-one, so two distinct
// `sub` values could collapse onto one filename and one account would read
// another's profile. The allow-list also excludes `.`, which is what makes
// `json_store`'s `with_extension("json.tmp")` temp-path scheme correct.
// The offending value is never echoed into the message: it is an identity key
// and `AppError::Validation`'s message crosses IPC to the UI.
//
// Crate-visible because `avatar_store` writes under the same `profiles/` directory
// and must not carry a second charset rule: one authority, whichever store the
// subject reaches.
pub(crate) fn validate_sub(sub: &str) -> Result<(), AppError> {
    let ok = !sub.is_empty()
        && sub.len() <= 128
        && sub
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');

    if ok {
        Ok(())
    } else {
        Err(AppError::Validation {
            message: "Invalid account identifier".to_string(),
            field: Some("cognito_sub".to_string()),
        })
    }
}

/// The dataset-id half of this module's naming authority for `profiles/`.
///
/// It DELEGATES to `datasets::is_valid_dataset_id` rather than restating a charset, so one rule
/// governs every name written under `profiles/` whichever key reaches it (AD-6). That predicate is
/// a strict subset of `validate_sub`'s — it additionally forbids `_` — and is already the
/// authority for the same id as a directory component, so a name it rejects belongs to a dataset
/// the product cannot open by any route.
pub(crate) fn validate_dataset_id(dataset_id: &str) -> Result<(), AppError> {
    if crate::datasets::is_valid_dataset_id(dataset_id) {
        Ok(())
    } else {
        Err(AppError::Validation {
            message: "Invalid profile identifier".to_string(),
            field: Some("dataset_id".to_string()),
        })
    }
}

fn normalize(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

// WHY the pre-delete: Windows `std::fs::rename` fails when the destination
// exists, while Unix silently replaces it. A rename failure still returns
// `Ok(None)` — the original bytes are never deleted, and an `Err` here would
// brick the page with no path out.
fn quarantine_corrupt_document(dir: &Path, sub: &str) {
    let path = profile_path(dir, sub);
    let corrupt = corrupt_path(dir, sub);
    let _ = std::fs::remove_file(&corrupt);

    match std::fs::rename(&path, &corrupt) {
        Ok(()) => warn!(
            "Profile document could not be parsed; quarantined as *.{}",
            CORRUPT_SUFFIX
        ),
        Err(e) => warn!(
            "Profile document could not be parsed and could not be quarantined: {}",
            e
        ),
    }
}

pub fn load_profile(dir: &Path, sub: &str) -> Result<Option<UserProfile>, AppError> {
    validate_sub(sub)?;

    let path = profile_path(dir, sub);
    let data = match std::fs::read_to_string(&path) {
        Ok(data) => data,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            return Err(AppError::File {
                message: format!("Failed to read profile: {}", e),
            })
        }
    };

    // The document body is deliberately never interpolated into the log or the
    // error: it is PII.
    let profile: UserProfile = match serde_json::from_str(&data) {
        Ok(profile) => profile,
        Err(_) => {
            quarantine_corrupt_document(dir, sub);
            return Ok(None);
        }
    };

    // A future version is unreadable, not corrupt, so it is left in place.
    if profile.schema_version != PROFILE_SCHEMA_VERSION {
        warn!(
            "Profile document has unrecognized schema_version {}; ignoring it",
            profile.schema_version
        );
        return Ok(None);
    }

    if profile.cognito_sub != sub {
        warn!("Profile document cognito_sub does not match its filename; ignoring it");
        return Ok(None);
    }

    Ok(Some(profile))
}

/// The one sentence every refusal from this module's validator carries.
///
/// Fixed, and never interpolated: `field` + `reason` are the machine-readable refusal and the UI
/// resolves its EN/FR text from them, so a message that named the offending country code or income
/// bracket would put a profile value into an error that crosses IPC and reaches logs (AD-12).
const REFUSED_MESSAGE: &str = "A profile field was refused.";

fn refused(field: &str, reason: &str) -> AppError {
    AppError::CloudProfile {
        code: "validation".to_string(),
        message: REFUSED_MESSAGE.to_string(),
        field: Some(field.to_string()),
        reason: Some(reason.to_string()),
        recoverable: true,
    }
}

// `today` is a parameter rather than an inner `Local::now()` so this is pure and
// the age-window tests are deterministic.
fn validate_birth_date_at(
    birth_date: Option<&str>,
    today: NaiveDate,
) -> Result<Option<String>, AppError> {
    let Some(raw) = birth_date else {
        return Ok(None);
    };

    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let parsed = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
        .map_err(|_| refused("birth_date", "invalid_format"))?;

    // chrono's `%Y-%m-%d` accepts unpadded components, so "1985-3-14" parses.
    // Round-tripping is what keeps the stored string canonically zero-padded.
    if parsed.format("%Y-%m-%d").to_string() != trimmed {
        return Err(refused("birth_date", "invalid_format"));
    }

    if parsed > today {
        return Err(refused("birth_date", "in_future"));
    }

    let mut age = today.year() - parsed.year();
    if (today.month(), today.day()) < (parsed.month(), parsed.day()) {
        age -= 1;
    }

    if age < MIN_AGE_YEARS {
        return Err(refused("birth_date", "too_young"));
    }

    if age > MAX_AGE_YEARS {
        return Err(refused("birth_date", "too_old"));
    }

    Ok(Some(trimmed.to_string()))
}

// Rust is the authority: a code the frontend never offered is still rejected
// here.
fn validate_country_code(country_code: Option<&str>) -> Result<(), AppError> {
    if let Some(code) = country_code {
        if !country_exists(code) {
            return Err(refused("country_code", "not_allowed"));
        }
    }

    Ok(())
}

// Cross-field rule: the allow-list is not a compile-time const but the
// subdivisions of the *selected* country, so the slice is a parameter rather
// than an inner `subdivisions_for` call. That keeps this pure and its tests
// independent of dataset churn.
fn validate_subdivision_code_against(
    country_code: Option<&str>,
    subdivision_code: Option<&str>,
    subdivisions_for_country: &[Subdivision],
) -> Result<Option<String>, AppError> {
    let Some(raw) = subdivision_code else {
        return Ok(None);
    };

    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    require_companion(
        Some(trimmed),
        country_code,
        "subdivision_code",
        "requires_country",
    )?;

    if subdivisions_for_country.is_empty() {
        return Err(refused("subdivision_code", "no_subdivisions"));
    }

    if !subdivisions_for_country.iter().any(|s| s.code == trimmed) {
        return Err(refused("subdivision_code", "not_allowed"));
    }

    Ok(Some(trimmed.to_string()))
}

// The store's single conditional-requirement primitive, shared by
// subdivision-requires-country and bracket-requires-currency so the two rules
// cannot drift apart. `error_field` is a parameter because the two rules blame
// opposite sides: a subdivision without a country is the subdivision's fault,
// while a bracket without a currency is reported against the currency the user
// has yet to pick. A blank string counts as unset, matching `normalize`.
fn require_companion(
    dependent: Option<&str>,
    companion: Option<&str>,
    error_field: &str,
    reason: &str,
) -> Result<(), AppError> {
    let is_set = |value: Option<&str>| value.map(str::trim).is_some_and(|v| !v.is_empty());

    if is_set(dependent) && !is_set(companion) {
        return Err(refused(error_field, reason));
    }

    Ok(())
}

// Rust is the authority: the allow-list is a compile-time const and the value is
// stored as the categorical code it arrived as, never parsed into a number.
fn validate_income_bracket(income_bracket: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(raw) = income_bracket else {
        return Ok(None);
    };

    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    if !VALID_INCOME_BRACKETS.contains(&trimmed) {
        return Err(refused("income_bracket", "not_allowed"));
    }

    Ok(Some(trimmed.to_string()))
}

// Uppercased *before* the allow-list check, unlike `db/account.rs`, so any IPC
// caller — not just the Select — yields a stored uppercase ISO 4217 code.
fn validate_income_bracket_currency(currency: Option<&str>) -> Result<Option<String>, AppError> {
    let Some(raw) = currency else {
        return Ok(None);
    };

    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let normalized = trimmed.to_uppercase();
    if !VALID_INCOME_BRACKET_CURRENCIES.contains(&normalized.as_str()) {
        return Err(refused("income_bracket_currency", "not_allowed"));
    }

    Ok(Some(normalized))
}

/// The single validation authority for the demographic field set, used by BOTH homes (AD-5).
///
/// `today` is a parameter for the same reason `validate_birth_date_at`'s is. The returned fields
/// are normalized — trimmed, blank-as-`None`, currency uppercased — so a caller never stores the
/// raw input.
pub(crate) fn validate_fields_at(
    input: &UpdateUserProfileInput,
    today: NaiveDate,
) -> Result<ProfileFields, AppError> {
    let birth_date = validate_birth_date_at(input.birth_date.as_deref(), today)?;

    // Normalized first, so a blank string clears the field instead of being
    // rejected as an unknown code. `None` is valid: every profile field is
    // nullable.
    let country_code = normalize(&input.country_code);
    validate_country_code(country_code.as_deref())?;

    // After the country check, so an unknown country reports `country_code`
    // rather than blaming the subdivision.
    let subdivision_code = validate_subdivision_code_against(
        country_code.as_deref(),
        input.subdivision_code.as_deref(),
        country_code.as_deref().map(subdivisions_for).unwrap_or(&[]),
    )?;

    let income_bracket = validate_income_bracket(input.income_bracket.as_deref())?;
    let income_bracket_currency =
        validate_income_bracket_currency(input.income_bracket_currency.as_deref())?;

    // A currency without a bracket is permitted and simply inert, so only the
    // one direction is required.
    require_companion(
        income_bracket.as_deref(),
        income_bracket_currency.as_deref(),
        "income_bracket_currency",
        "required",
    )?;

    Ok(ProfileFields {
        first_name: normalize(&input.first_name),
        last_name: normalize(&input.last_name),
        birth_date,
        income_bracket,
        income_bracket_currency,
        country_code,
        subdivision_code,
    })
}

fn validate_fields(input: &UpdateUserProfileInput) -> Result<ProfileFields, AppError> {
    validate_fields_at(input, Local::now().date_naive())
}

// Full replace: every field comes from `input`, so `None` clears it. `created_at`
// is carried forward verbatim from any existing document — regenerating it would
// silently destroy it — while `updated_at` is bumped on every save.
//
// Epic E: this is the local-first write the network PUT replaces. The copy becomes
// write-from-server-response-only (AD-1/AD-7), and this function's body is the seam —
// `validate_fields` stays (it is the offline affordance), the `write_json_atomic` below
// becomes `write_cloud_copy` fed by the response.
pub fn save_profile(
    dir: &Path,
    sub: &str,
    input: &UpdateUserProfileInput,
) -> Result<UserProfile, AppError> {
    validate_sub(sub)?;

    let fields = validate_fields(input)?;

    std::fs::create_dir_all(dir).map_err(|e| AppError::File {
        message: format!("Failed to create profiles dir: {}", e),
    })?;

    let existing = load_profile(dir, sub)?;
    let now = Utc::now().to_rfc3339();

    let profile = UserProfile {
        schema_version: PROFILE_SCHEMA_VERSION,
        cognito_sub: sub.to_string(),
        // Carried forward, never re-derived: the copy's version belongs to the server, and
        // `upload_declined` is a decision the user already made.
        version: existing.as_ref().and_then(|p| p.version),
        upload_declined: existing.as_ref().and_then(|p| p.upload_declined),
        first_name: fields.first_name,
        last_name: fields.last_name,
        birth_date: fields.birth_date,
        income_bracket: fields.income_bracket,
        income_bracket_currency: fields.income_bracket_currency,
        country_code: fields.country_code,
        subdivision_code: fields.subdivision_code,
        created_at: existing
            .map(|p| p.created_at)
            .unwrap_or_else(|| now.clone()),
        updated_at: now,
    };

    crate::json_store::write_json_atomic(&profile_path(dir, sub), &profile)?;

    Ok(profile)
}

/// What a `profiles/<sub>.json` is, read WITHOUT touching it (AD-8).
#[allow(dead_code)] // The launch probe and the consent prompt that read it land with Epic E.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CloudCopyState {
    Absent,
    /// `schema_version == 1`, no `version` member, not declined: the pre-service document AD-8's
    /// consent prompt exists for.
    Legacy,
    /// Legacy, and the user has already refused the upload. Never ask again.
    Declined,
    Synced(u64),
    /// Unparseable, or a `schema_version` this build does not recognize. Deliberately NOT
    /// quarantined here — see `probe_cloud_copy`.
    Unreadable,
}

/// Classifies the copy from the raw JSON, mutating nothing.
///
/// Its own reader rather than a `load_profile` call, and the difference is the whole point:
/// `load_profile` QUARANTINES a document it cannot parse, which would rename the user's only copy
/// of their date of birth and income out from under the very prompt that was looking for it
/// (adversary C4). This path never renames, never writes, and never creates the directory.
#[allow(dead_code)] // Called by Epic E's refresh, before the `GET`.
pub fn probe_cloud_copy(dir: &Path, sub: &str) -> Result<CloudCopyState, AppError> {
    validate_sub(sub)?;

    let raw = match std::fs::read_to_string(profile_path(dir, sub)) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(CloudCopyState::Absent),
        Err(e) => {
            return Err(AppError::File {
                message: format!("Failed to read profile: {}", e),
            })
        }
    };

    let Ok(Value::Object(members)) = serde_json::from_str::<Value>(&raw) else {
        return Ok(CloudCopyState::Unreadable);
    };

    if members.get("schema_version").and_then(Value::as_u64) != Some(u64::from(PROFILE_SCHEMA_VERSION))
    {
        return Ok(CloudCopyState::Unreadable);
    }

    if let Some(version) = members.get("version").and_then(Value::as_u64) {
        return Ok(CloudCopyState::Synced(version));
    }

    if members.get(DECLINED_KEY).and_then(Value::as_bool) == Some(true) {
        return Ok(CloudCopyState::Declined);
    }

    Ok(CloudCopyState::Legacy)
}

const DECLINED_KEY: &str = "upload_declined";

/// Inserts `"upload_declined": true` into a JSON object's text, changing nothing else.
///
/// A TEXT edit rather than a parse-and-reserialize, because `serde_json::Map` without the
/// `preserve_order` feature is a `BTreeMap`: re-serializing would silently alphabetize the user's
/// document. AD-8 requires the declined file to be the original plus this one member, so the
/// returned string is the input with exactly one inserted span and every other byte — key order,
/// indentation, trailing newline — untouched.
fn with_declined_member(raw: &str) -> Option<String> {
    let brace = raw.trim_end().strip_suffix('}')?.len();
    let (head, tail) = raw.split_at(brace);

    let kept = head.trim_end_matches(char::is_whitespace);
    if kept.trim_start_matches('{').trim().is_empty() {
        return None;
    }
    let trailing = &head[kept.len()..];

    let member = if trailing.contains('\n') {
        format!(",\n  \"{DECLINED_KEY}\": true")
    } else {
        format!(",\"{DECLINED_KEY}\":true")
    };

    Some(format!("{kept}{member}{trailing}{tail}"))
}

/// Records AD-8's decline on an existing copy, and changes nothing else about it.
#[allow(dead_code)] // Called by Epic E's consent prompt.
pub fn mark_upload_declined(dir: &Path, sub: &str) -> Result<(), AppError> {
    validate_sub(sub)?;

    let path = profile_path(dir, sub);
    let raw = std::fs::read_to_string(&path).map_err(|e| AppError::File {
        message: format!("Failed to read profile: {}", e),
    })?;

    // Idempotent: re-declining must not append a second member to the document.
    if matches!(probe_cloud_copy(dir, sub)?, CloudCopyState::Declined) {
        return Ok(());
    }

    let patched = with_declined_member(&raw).ok_or_else(|| AppError::File {
        message: "The profile document could not be updated".to_string(),
    })?;

    crate::json_store::write_bytes_atomic(&path, patched.as_bytes())
}

/// Writes the Nixus Cloud copy from a server response, which is the ONLY thing that may write it
/// (AD-1, AD-6).
///
/// No validation runs here on purpose: the Profile API is the validation authority (AD-5), so
/// re-checking its own answer could only reject a value the server has already accepted and leave
/// the device unable to cache it.
#[allow(dead_code)] // Called by Epic E, from a `GET`/`PUT` response.
pub fn write_cloud_copy(
    dir: &Path,
    sub: &str,
    wire: &CloudProfileWire,
) -> Result<UserProfile, AppError> {
    validate_sub(sub)?;

    std::fs::create_dir_all(dir).map_err(|e| AppError::File {
        message: format!("Failed to create profiles dir: {}", e),
    })?;

    let profile = UserProfile {
        schema_version: PROFILE_SCHEMA_VERSION,
        cognito_sub: sub.to_string(),
        version: Some(wire.version),
        // Dropped deliberately: a document carrying a server `version` is no longer legacy, so the
        // decline record has nothing left to suppress.
        upload_declined: None,
        first_name: wire.fields.first_name.clone(),
        last_name: wire.fields.last_name.clone(),
        birth_date: wire.fields.birth_date.clone(),
        income_bracket: wire.fields.income_bracket.clone(),
        income_bracket_currency: wire.fields.income_bracket_currency.clone(),
        country_code: wire.fields.country_code.clone(),
        subdivision_code: wire.fields.subdivision_code.clone(),
        created_at: wire.created_at.clone(),
        updated_at: wire.updated_at.clone(),
    };

    crate::json_store::write_json_atomic(&profile_path(dir, sub), &profile)?;

    Ok(profile)
}

/// A local dataset's own demographics, or `None` when it has none (AD-6).
///
/// An unparseable or mismatched document reads as `None` and is LEFT IN PLACE — never quarantined,
/// never rewritten: there is no cloud copy to restore it from, so the one thing this path must not
/// do is destroy it.
pub fn load_local(dir: &Path, dataset_id: &str) -> Result<Option<LocalUserProfile>, AppError> {
    validate_dataset_id(dataset_id)?;

    let data = match std::fs::read_to_string(local_profile_path(dir, dataset_id)) {
        Ok(data) => data,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => {
            return Err(AppError::File {
                message: format!("Failed to read profile: {}", e),
            })
        }
    };

    // The document body is deliberately never interpolated into the log or the error: it is PII.
    let Ok(profile) = serde_json::from_str::<LocalUserProfile>(&data) else {
        warn!("A local profile document could not be parsed; ignoring it");
        return Ok(None);
    };

    if profile.schema_version != PROFILE_SCHEMA_VERSION {
        warn!(
            "Local profile document has unrecognized schema_version {}; ignoring it",
            profile.schema_version
        );
        return Ok(None);
    }

    if profile.dataset_id != dataset_id {
        warn!("Local profile document dataset_id does not match its filename; ignoring it");
        return Ok(None);
    }

    Ok(Some(profile))
}

/// Full replace, with the same validator and the same `created_at` carry-forward as the cloud
/// copy's save (AD-5).
pub fn save_local(
    dir: &Path,
    dataset_id: &str,
    input: &UpdateUserProfileInput,
) -> Result<LocalUserProfile, AppError> {
    validate_dataset_id(dataset_id)?;

    let fields = validate_fields(input)?;

    let existing = load_local(dir, dataset_id)?;
    let now = Utc::now().to_rfc3339();

    let profile = LocalUserProfile {
        schema_version: PROFILE_SCHEMA_VERSION,
        dataset_id: dataset_id.to_string(),
        fields,
        created_at: existing
            .map(|p| p.created_at)
            .unwrap_or_else(|| now.clone()),
        updated_at: now,
    };

    crate::json_store::write_json_atomic(&local_profile_path(dir, dataset_id), &profile)?;

    Ok(profile)
}

/// Removes one local dataset's document and any crashed-write or quarantined sibling of it.
///
/// Called by `datasets::delete_dataset_at`, which is what gives AD-6's "deleted with that dataset"
/// an owner (adversary H9). An absent document is success: the deletion may be a retry.
pub fn delete_local(dir: &Path, dataset_id: &str) -> Result<(), AppError> {
    validate_dataset_id(dataset_id)?;

    let base = local_profile_path(dir, dataset_id);
    for path in [
        base.clone(),
        base.with_extension("json.tmp"),
        base.with_extension(CORRUPT_SUFFIX),
    ] {
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                return Err(AppError::File {
                    message: format!("Failed to delete the local profile document: {}", e),
                })
            }
        }
    }

    Ok(())
}

/// Deletes every local document whose dataset is no longer registered (AD-6's launch sweep).
///
/// The backstop for the one window `delete_dataset_at` cannot close — a crash between the registry
/// write and the document removal — and for a hand-edited `datasets.json`. The returned ids are
/// opaque slugs and therefore loggable (AD-12).
///
/// The id is taken as the name up to the first `.`, so a `<id>.json.tmp` left by an interrupted
/// write is swept with its document rather than outliving it; `is_valid_dataset_id` forbids `.` in
/// an id, which is what makes that split exact.
pub fn sweep_local_orphans(dir: &Path, known_ids: &[String]) -> Result<Vec<String>, AppError> {
    let local = local_profiles_dir(dir);

    let entries = match std::fs::read_dir(&local) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => {
            return Err(AppError::File {
                message: format!("Failed to read local profiles dir: {}", e),
            })
        }
    };

    let mut removed = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| AppError::File {
            message: format!("Failed to read local profiles dir: {}", e),
        })?;
        let name = entry.file_name().to_string_lossy().to_string();
        let Some(id) = name.split('.').next().map(str::to_string) else {
            continue;
        };
        if id.is_empty() || known_ids.contains(&id) {
            continue;
        }

        if entry.path().is_dir() {
            continue;
        }

        std::fs::remove_file(entry.path()).map_err(|e| AppError::File {
            message: format!("Failed to delete an orphaned local profile document: {}", e),
        })?;
        if !removed.contains(&id) {
            removed.push(id);
        }
    }

    Ok(removed)
}

/// The machine-wide wipe of every Nixus Cloud copy, for the Danger Zone (AD-7).
///
/// Deliberately NOT the recursive `remove_dir_all` it replaces: once a local dataset's only copy
/// of its demographics lives under `local/`, wiping the whole directory from dataset A destroys
/// dataset B's data while B still exists (adversary C6, rubric H2).
///
/// Every JSON extension this store can produce goes — a bare `*.json` glob would leave
/// `.json.corrupt` and `.json.tmp` PII behind — and nothing else is touched, so `avatars.db` stays
/// the property of the store that owns it and the Danger Zone deletes it by calling that store.
pub fn delete_all_cloud_copies(dir: &Path) -> Result<(), AppError> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => {
            return Err(AppError::File {
                message: format!("Failed to read profiles dir: {}", e),
            })
        }
    };

    for entry in entries {
        let entry = entry.map_err(|e| AppError::File {
            message: format!("Failed to read profiles dir: {}", e),
        })?;

        let name = entry.file_name().to_string_lossy().to_string();
        let is_cloud_copy = [".json", ".json.corrupt", ".json.tmp"]
            .iter()
            .any(|suffix| name.ends_with(suffix));
        if !is_cloud_copy || entry.path().is_dir() {
            continue;
        }

        match std::fs::remove_file(entry.path()) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                return Err(AppError::File {
                    message: format!("Failed to delete profiles: {}", e),
                })
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const SUB: &str = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const DATASET_ID: &str = "00000000-0000-4000-8000-000000000001";

    /// The `field` and `reason` of a refusal, asserting the variant and the privacy rule at once:
    /// no refusal may carry a submitted value, and both vocabularies belong to the shared contract.
    fn refusal(error: &AppError) -> (String, String) {
        match error {
            AppError::CloudProfile {
                code,
                message,
                field,
                reason,
                recoverable,
            } => {
                assert_eq!(code, "validation");
                assert_eq!(message, REFUSED_MESSAGE);
                assert!(recoverable, "a refused field is always fixable by the user");
                let field = field.clone().expect("a validation refusal names its field");
                let reason = reason.clone().expect("a validation refusal names its reason");
                assert!(
                    crate::account_contract::VALIDATION_FIELDS.contains(&field.as_str()),
                    "{field} is not in the shared contract's field vocabulary"
                );
                assert!(
                    crate::account_contract::VALIDATION_REASONS.contains(&reason.as_str()),
                    "{reason} is not in the shared contract's reason vocabulary"
                );
                (field, reason)
            }
            other => panic!("expected a cloud-profile validation error, got {other:?}"),
        }
    }

    fn empty_input() -> UpdateUserProfileInput {
        UpdateUserProfileInput {
            first_name: None,
            last_name: None,
            birth_date: None,
            income_bracket: None,
            income_bracket_currency: None,
            country_code: None,
            subdivision_code: None,
        }
    }

    fn named_input(first: Option<&str>, last: Option<&str>) -> UpdateUserProfileInput {
        UpdateUserProfileInput {
            first_name: first.map(str::to_string),
            last_name: last.map(str::to_string),
            ..empty_input()
        }
    }

    fn birth_date_input(birth_date: Option<&str>) -> UpdateUserProfileInput {
        UpdateUserProfileInput {
            birth_date: birth_date.map(str::to_string),
            ..empty_input()
        }
    }

    fn country_input(country_code: Option<&str>) -> UpdateUserProfileInput {
        UpdateUserProfileInput {
            country_code: country_code.map(str::to_string),
            ..empty_input()
        }
    }

    fn location_input(
        country_code: Option<&str>,
        subdivision_code: Option<&str>,
    ) -> UpdateUserProfileInput {
        UpdateUserProfileInput {
            country_code: country_code.map(str::to_string),
            subdivision_code: subdivision_code.map(str::to_string),
            ..empty_input()
        }
    }

    fn income_input(
        income_bracket: Option<&str>,
        income_bracket_currency: Option<&str>,
    ) -> UpdateUserProfileInput {
        UpdateUserProfileInput {
            income_bracket: income_bracket.map(str::to_string),
            income_bracket_currency: income_bracket_currency.map(str::to_string),
            ..empty_input()
        }
    }

    fn assert_income_rejected(
        income_bracket: Option<&str>,
        income_bracket_currency: Option<&str>,
        expected_field: &str,
    ) {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        let error = save_profile(&dir, SUB, &income_input(income_bracket, income_bracket_currency))
            .expect_err("save rejects");

        assert_eq!(refusal(&error).0, expected_field);
        assert!(!profile_path(&dir, SUB).exists());
    }

    fn sub(code: &str, name_en: &str, name_fr: Option<&str>) -> Subdivision {
        Subdivision {
            code: code.to_string(),
            name_en: name_en.to_string(),
            name_fr: name_fr.map(str::to_string),
        }
    }

    fn ca_subs() -> Vec<Subdivision> {
        vec![
            sub("CA-QC", "Quebec", Some("Québec")),
            sub("CA-ON", "Ontario", None),
        ]
    }

    fn us_subs() -> Vec<Subdivision> {
        vec![sub("US-NY", "New York", None), sub("US-CA", "California", None)]
    }

    fn assert_subdivision_rejected(
        country_code: Option<&str>,
        subdivision_code: Option<&str>,
        subdivisions: &[Subdivision],
    ) {
        let error = validate_subdivision_code_against(country_code, subdivision_code, subdivisions)
            .expect_err("the pair must be rejected");

        assert_eq!(
            refusal(&error).0,
            "subdivision_code",
            "the error must be scoped to the subdivision_code form field"
        );
    }

    fn pinned_today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 8, 10).expect("valid date")
    }

    fn assert_birth_date_rejected(candidate: &str) -> String {
        let error = validate_birth_date_at(Some(candidate), pinned_today())
            .expect_err("candidate must be rejected");

        let (field, reason) = refusal(&error);
        assert_eq!(
            field, "birth_date",
            "the error must be scoped to the birth_date form field"
        );
        reason
    }

    #[test]
    fn a_valid_birth_date_is_stored_as_the_iso_string_it_arrived_as() {
        assert_eq!(
            validate_birth_date_at(Some("1985-03-14"), pinned_today()).expect("accepted"),
            Some("1985-03-14".to_string())
        );
    }

    #[test]
    fn a_future_birth_date_is_rejected() {
        assert_eq!(assert_birth_date_rejected("2027-01-01"), "in_future");
    }

    #[test]
    fn an_age_under_the_minimum_is_rejected() {
        assert_eq!(assert_birth_date_rejected("2015-06-01"), "too_young");
    }

    #[test]
    fn an_age_over_the_maximum_is_rejected() {
        assert_eq!(assert_birth_date_rejected("1890-01-01"), "too_old");
    }

    #[test]
    fn a_malformed_birth_date_is_rejected() {
        for candidate in ["not-a-date", "14/03/1985", "1985-3-14", "1985-13-01", "1985"] {
            assert_eq!(assert_birth_date_rejected(candidate), "invalid_format", "{candidate}");
        }
    }

    #[test]
    fn a_cleared_birth_date_reads_as_unset() {
        assert_eq!(validate_birth_date_at(None, pinned_today()).expect("accepted"), None);
        assert_eq!(
            validate_birth_date_at(Some(""), pinned_today()).expect("accepted"),
            None
        );
        assert_eq!(
            validate_birth_date_at(Some("   "), pinned_today()).expect("accepted"),
            None
        );
    }

    #[test]
    fn the_age_window_boundaries_are_inclusive() {
        assert_eq!(
            validate_birth_date_at(Some("2008-08-10"), pinned_today()).expect("18 today"),
            Some("2008-08-10".to_string())
        );
        assert_eq!(assert_birth_date_rejected("2008-08-11"), "too_young");
        assert_eq!(
            validate_birth_date_at(Some("1906-08-10"), pinned_today()).expect("120 today"),
            Some("1906-08-10".to_string())
        );
    }

    #[test]
    fn the_age_helper_is_calendar_correct_across_a_leap_day() {
        let day_before = NaiveDate::from_ymd_opt(2026, 2, 28).expect("valid date");
        let error = validate_birth_date_at(Some("2008-02-29"), day_before)
            .expect_err("still 17 the day before");
        assert_eq!(refusal(&error), ("birth_date".to_string(), "too_young".to_string()));

        assert_eq!(
            validate_birth_date_at(
                Some("2008-02-29"),
                NaiveDate::from_ymd_opt(2026, 3, 1).expect("valid date")
            )
            .expect("18 by March 1st"),
            Some("2008-02-29".to_string())
        );
    }

    #[test]
    fn a_saved_birth_date_persists_as_an_iso_string_and_clears_to_null() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        let saved = save_profile(&dir, SUB, &birth_date_input(Some("1985-03-14")))
            .expect("save succeeds");
        assert_eq!(saved.birth_date.as_deref(), Some("1985-03-14"));

        let raw = std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable");
        let value: serde_json::Value = serde_json::from_str(&raw).expect("valid json");
        assert_eq!(value["birth_date"], "1985-03-14");
        assert!(
            value["birth_date"].is_string(),
            "a date is an ISO 8601 string, never a timestamp"
        );

        save_profile(&dir, SUB, &birth_date_input(None)).expect("clearing save succeeds");

        let cleared = std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable");
        let cleared: serde_json::Value = serde_json::from_str(&cleared).expect("valid json");
        assert!(cleared["birth_date"].is_null());
    }

    #[test]
    fn save_rejects_an_invalid_birth_date_before_touching_the_document() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        let error = save_profile(&dir, SUB, &birth_date_input(Some("not-a-date")))
            .expect_err("save rejects");

        assert_eq!(refusal(&error).0, "birth_date");
        assert!(!profile_path(&dir, SUB).exists());
    }

    #[test]
    fn profiles_dir_is_a_subdirectory_of_app_data() {
        let dir = TempDir::new().expect("temp dir");
        assert_eq!(profiles_dir(dir.path()), dir.path().join("profiles"));
    }

    #[test]
    fn load_returns_none_when_no_document_exists() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        assert!(load_profile(&dir, SUB).expect("load succeeds").is_none());
        assert!(!dir.exists(), "load must not create the directory");
    }

    #[test]
    fn save_then_load_round_trips() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        save_profile(&dir, SUB, &named_input(Some("Ada"), Some("Lovelace")))
            .expect("save succeeds");

        let loaded = load_profile(&dir, SUB)
            .expect("load succeeds")
            .expect("document present");
        assert_eq!(loaded.first_name.as_deref(), Some("Ada"));
        assert_eq!(loaded.last_name.as_deref(), Some("Lovelace"));
        assert_eq!(loaded.schema_version, PROFILE_SCHEMA_VERSION);
        assert_eq!(loaded.cognito_sub, SUB);
    }

    #[test]
    fn first_write_contains_schema_version_and_cognito_sub() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        save_profile(&dir, SUB, &named_input(Some("Ada"), None)).expect("save succeeds");

        let raw = std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable");
        let value: serde_json::Value = serde_json::from_str(&raw).expect("valid json");

        assert_eq!(value["schema_version"], 1);
        assert_eq!(value["cognito_sub"], SUB);
        assert!(value.get("first_name").is_some(), "snake_case key expected");
        assert!(value.get("firstName").is_none(), "camelCase key must not ship");
        assert!(value["last_name"].is_null(), "unset field serializes as null");
    }

    #[test]
    fn clearing_a_field_writes_null_and_is_a_full_replace() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        save_profile(&dir, SUB, &named_input(Some("Ada"), Some("Lovelace")))
            .expect("first save succeeds");
        save_profile(&dir, SUB, &named_input(None, Some("Byron")))
            .expect("second save succeeds");

        let loaded = load_profile(&dir, SUB)
            .expect("load succeeds")
            .expect("document present");
        assert_eq!(loaded.first_name, None);
        assert_eq!(loaded.last_name.as_deref(), Some("Byron"));

        let raw = std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable");
        let value: serde_json::Value = serde_json::from_str(&raw).expect("valid json");
        assert!(value["first_name"].is_null());
    }

    #[test]
    fn blank_and_padded_values_normalize_to_none_and_trimmed() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        let saved = save_profile(&dir, SUB, &named_input(Some("  Ada  "), Some("   ")))
            .expect("save succeeds");

        assert_eq!(saved.first_name.as_deref(), Some("Ada"));
        assert_eq!(saved.last_name, None);
    }

    #[test]
    fn created_at_is_carried_forward_and_updated_at_is_bumped() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        let first = save_profile(&dir, SUB, &named_input(Some("Ada"), None))
            .expect("first save succeeds");
        let second = save_profile(&dir, SUB, &named_input(Some("Grace"), None))
            .expect("second save succeeds");

        assert_eq!(second.created_at, first.created_at);
        assert!(second.updated_at >= second.created_at);
    }

    #[test]
    fn an_unparseable_document_is_renamed_and_read_as_no_profile() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());
        std::fs::create_dir_all(&dir).expect("dir created");
        std::fs::write(profile_path(&dir, SUB), b"{ not json").expect("file written");

        assert!(load_profile(&dir, SUB).expect("load succeeds").is_none());
        assert!(
            !profile_path(&dir, SUB).exists(),
            "the unparseable document must be moved aside"
        );

        let quarantined = std::fs::read(corrupt_path(&dir, SUB)).expect("corrupt file exists");
        assert_eq!(quarantined, b"{ not json", "original bytes must be preserved");
    }

    #[test]
    fn a_second_corruption_replaces_the_previous_corrupt_file() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());
        std::fs::create_dir_all(&dir).expect("dir created");
        std::fs::write(corrupt_path(&dir, SUB), b"older corruption").expect("file written");
        std::fs::write(profile_path(&dir, SUB), b"{ still not json").expect("file written");

        assert!(load_profile(&dir, SUB).expect("load succeeds").is_none());

        let quarantined = std::fs::read(corrupt_path(&dir, SUB)).expect("corrupt file exists");
        assert_eq!(quarantined, b"{ still not json");
    }

    #[test]
    fn a_future_schema_version_reads_as_no_profile_without_renaming() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());
        std::fs::create_dir_all(&dir).expect("dir created");
        std::fs::write(
            profile_path(&dir, SUB),
            format!(
                r#"{{"schema_version":2,"cognito_sub":"{SUB}","first_name":"Ada","last_name":null,"birth_date":null,"income_bracket":null,"income_bracket_currency":null,"country_code":null,"subdivision_code":null,"created_at":"2026-01-01T00:00:00+00:00","updated_at":"2026-01-01T00:00:00+00:00"}}"#
            ),
        )
        .expect("file written");

        assert!(load_profile(&dir, SUB).expect("load succeeds").is_none());
        assert!(profile_path(&dir, SUB).exists(), "a future version is not corrupt");
        assert!(!corrupt_path(&dir, SUB).exists());
    }

    #[test]
    fn a_cognito_sub_mismatch_reads_as_no_profile() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());
        std::fs::create_dir_all(&dir).expect("dir created");
        std::fs::write(
            profile_path(&dir, SUB),
            r#"{"schema_version":1,"cognito_sub":"someone-else","first_name":"Other","last_name":"Account","birth_date":null,"income_bracket":null,"income_bracket_currency":null,"country_code":null,"subdivision_code":null,"created_at":"2026-01-01T00:00:00+00:00","updated_at":"2026-01-01T00:00:00+00:00"}"#,
        )
        .expect("file written");

        assert!(load_profile(&dir, SUB).expect("load succeeds").is_none());
        assert!(profile_path(&dir, SUB).exists());
        assert!(!corrupt_path(&dir, SUB).exists());
    }

    #[test]
    fn an_invalid_sub_charset_is_rejected_on_load_and_on_save() {
        let long = "x".repeat(129);
        let cases = ["a/b", "../etc", "a.b", "", long.as_str()];

        for case in cases {
            let root = TempDir::new().expect("temp dir");
            let dir = profiles_dir(root.path());

            for error in [
                load_profile(&dir, case).expect_err("load rejects"),
                save_profile(&dir, case, &named_input(Some("Ada"), None))
                    .expect_err("save rejects"),
            ] {
                match error {
                    AppError::Validation { field, message } => {
                        assert_eq!(field.as_deref(), Some("cognito_sub"));
                        assert!(
                            !message.contains(case) || case.is_empty(),
                            "the sub must not be echoed into the message"
                        );
                    }
                    other => panic!("expected a validation error, got {other:?}"),
                }
            }

            assert!(!dir.exists(), "a rejected sub must touch no file");
        }
    }

    #[test]
    fn a_sub_at_the_length_boundary_is_accepted() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());
        let sub = "x".repeat(128);

        save_profile(&dir, &sub, &named_input(Some("Ada"), None)).expect("save succeeds");
        assert!(load_profile(&dir, &sub).expect("load succeeds").is_some());
    }

    #[test]
    fn no_tmp_file_survives_a_successful_save() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        save_profile(&dir, SUB, &named_input(Some("Ada"), None)).expect("save succeeds");

        assert!(
            !dir.join(format!("{SUB}.json.tmp")).exists(),
            "the atomic-write temp file must not survive"
        );
    }

    // The assertion is deliberately per-extension, never "no *.json files remain": a `*.json` glob
    // implementation would pass the weaker form while leaving `.json.corrupt` and `.json.tmp` PII
    // on disk (NFR4).
    #[test]
    fn delete_all_cloud_copies_removes_every_extension_of_every_subject() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());
        save_profile(&dir, SUB, &named_input(Some("Ada"), None)).expect("save succeeds");
        save_profile(&dir, "99999999-8888-7777-6666-555555555555", &named_input(Some("Bob"), None))
            .expect("save succeeds");
        std::fs::write(corrupt_path(&dir, SUB), b"quarantined pii").expect("file written");
        std::fs::write(dir.join(format!("{SUB}.json.tmp")), b"crashed-write pii")
            .expect("file written");

        delete_all_cloud_copies(&dir).expect("delete succeeds");

        for wiped in [
            profile_path(&dir, SUB),
            corrupt_path(&dir, SUB),
            dir.join(format!("{SUB}.json.tmp")),
            profile_path(&dir, "99999999-8888-7777-6666-555555555555"),
        ] {
            assert!(!wiped.exists(), "{wiped:?} must not survive delete-all");
        }
    }

    // The AD-7 matrix's narrowest row: the wipe is machine-wide for `<sub>.json`, and takes NOTHING
    // belonging to a local dataset — those documents are dataset-owned and have no cloud copy to be
    // restored from (adversary C6, rubric H2).
    #[test]
    fn delete_all_cloud_copies_leaves_every_local_document_alone() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());
        save_profile(&dir, SUB, &named_input(Some("Ada"), None)).expect("save succeeds");
        save_local(&dir, DATASET_ID, &named_input(Some("Grace"), None)).expect("save succeeds");

        delete_all_cloud_copies(&dir).expect("delete succeeds");

        assert!(!profile_path(&dir, SUB).exists());
        assert_eq!(
            load_local(&dir, DATASET_ID)
                .expect("load succeeds")
                .expect("the local document survives")
                .fields
                .first_name
                .as_deref(),
            Some("Grace")
        );
    }

    #[test]
    fn delete_all_cloud_copies_is_ok_when_directory_absent() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        delete_all_cloud_copies(&dir).expect("absent dir is not an error");
        delete_all_cloud_copies(&dir).expect("the delete is idempotent");
    }

    #[test]
    fn a_valid_country_code_round_trips() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        let saved = save_profile(&dir, SUB, &country_input(Some("CA"))).expect("save succeeds");
        assert_eq!(saved.country_code.as_deref(), Some("CA"));

        let loaded = load_profile(&dir, SUB)
            .expect("load succeeds")
            .expect("document present");
        assert_eq!(loaded.country_code.as_deref(), Some("CA"));
    }

    #[test]
    fn an_unknown_country_code_is_rejected_before_touching_the_document() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        let error =
            save_profile(&dir, SUB, &country_input(Some("ZZ"))).expect_err("save rejects");

        assert_eq!(
            refusal(&error),
            ("country_code".to_string(), "not_allowed".to_string())
        );
        assert!(!profile_path(&dir, SUB).exists());
    }

    #[test]
    fn a_cleared_country_code_is_valid_and_stores_null() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        save_profile(&dir, SUB, &country_input(Some("CA"))).expect("save succeeds");
        let cleared = save_profile(&dir, SUB, &country_input(None)).expect("clearing succeeds");
        assert_eq!(cleared.country_code, None);

        let blank = save_profile(&dir, SUB, &country_input(Some("   ")))
            .expect("a blank code clears rather than failing validation");
        assert_eq!(blank.country_code, None);

        let raw = std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable");
        let value: serde_json::Value = serde_json::from_str(&raw).expect("valid json");
        assert!(value["country_code"].is_null());
    }

    // Pointer identity is the only assertion that distinguishes "initialized
    // once" from "re-parsed per call": a per-call parse would hand back a fresh
    // allocation each time while still comparing equal by value.
    #[test]
    fn the_dataset_is_parsed_once() {
        assert!(std::ptr::eq(dataset(), dataset()));
    }

    #[test]
    fn the_bundled_dataset_is_non_empty_and_every_name_en_is_non_empty() {
        let parsed = dataset();
        assert!(
            parsed.countries.len() > 200,
            "the bundled dataset must cover ISO 3166-1, got {} countries",
            parsed.countries.len()
        );

        for country in &parsed.countries {
            assert!(
                !country.name_en.trim().is_empty(),
                "country {} has a blank name_en, which would render as a blank option",
                country.code
            );
            assert_eq!(country.code.len(), 2, "{} is not alpha-2", country.code);

            for subdivision in &country.subdivisions {
                assert!(
                    !subdivision.name_en.trim().is_empty(),
                    "subdivision {} has a blank name_en",
                    subdivision.code
                );
            }
        }
    }

    #[test]
    fn countries_exposes_the_dataset_without_subdivisions() {
        let exposed = countries();
        assert_eq!(exposed.len(), dataset().countries.len());
        assert!(country_exists("CA"));
        assert!(!country_exists("ZZ"));
        assert!(!country_exists("ca"), "codes are uppercase alpha-2");
    }

    #[test]
    fn a_subdivision_of_the_selected_country_is_accepted() {
        assert_eq!(
            validate_subdivision_code_against(Some("CA"), Some("CA-QC"), &ca_subs())
                .expect("accepted"),
            Some("CA-QC".to_string())
        );
    }

    #[test]
    fn a_subdivision_without_a_country_is_rejected() {
        assert_subdivision_rejected(None, Some("CA-QC"), &[]);
    }

    #[test]
    fn a_subdivision_of_another_country_is_rejected() {
        assert_subdivision_rejected(Some("US"), Some("CA-QC"), &us_subs());
    }

    #[test]
    fn a_subdivision_for_a_country_that_has_none_is_rejected() {
        assert_subdivision_rejected(Some("VA"), Some("VA-01"), &[]);
    }

    #[test]
    fn a_blank_country_is_the_same_failure_as_no_country() {
        assert_subdivision_rejected(Some("   "), Some("CA-QC"), &ca_subs());
    }

    #[test]
    fn a_cleared_subdivision_reads_as_unset() {
        for (country, subdivision, subdivisions) in [
            (Some("CA"), None, ca_subs()),
            (Some("CA"), Some(""), ca_subs()),
            (Some("CA"), Some("   "), ca_subs()),
            (None, None, Vec::new()),
        ] {
            assert_eq!(
                validate_subdivision_code_against(country, subdivision, &subdivisions)
                    .expect("accepted"),
                None
            );
        }
    }

    #[test]
    fn subdivisions_for_indexes_by_country_and_is_empty_for_an_unknown_code() {
        let canadian = subdivisions_for("CA");
        assert!(!canadian.is_empty(), "CA has ISO 3166-2 subdivisions");
        for subdivision in canadian {
            assert!(
                !subdivision.name_en.trim().is_empty(),
                "subdivision {} would render as a blank option",
                subdivision.code
            );
        }

        assert!(subdivisions_for("ZZ").is_empty());
        assert!(subdivisions_for("").is_empty());
    }

    #[test]
    fn a_valid_country_and_subdivision_pair_round_trips() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        let saved = save_profile(&dir, SUB, &location_input(Some("CA"), Some("CA-QC")))
            .expect("save succeeds");
        assert_eq!(saved.subdivision_code.as_deref(), Some("CA-QC"));

        let raw = std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable");
        let value: serde_json::Value = serde_json::from_str(&raw).expect("valid json");
        assert_eq!(value["subdivision_code"], "CA-QC");

        let loaded = load_profile(&dir, SUB)
            .expect("load succeeds")
            .expect("document present");
        assert_eq!(loaded.subdivision_code.as_deref(), Some("CA-QC"));

        save_profile(&dir, SUB, &location_input(Some("CA"), None)).expect("clearing succeeds");
        let cleared = std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable");
        let cleared: serde_json::Value = serde_json::from_str(&cleared).expect("valid json");
        assert!(cleared["subdivision_code"].is_null());
    }

    #[test]
    fn save_rejects_a_mismatched_pair_without_writing_the_document() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        let error = save_profile(&dir, SUB, &location_input(Some("US"), Some("CA-QC")))
            .expect_err("save rejects");

        assert_eq!(refusal(&error).0, "subdivision_code");
        assert!(!profile_path(&dir, SUB).exists());
    }

    #[test]
    fn save_rejects_a_subdivision_with_no_country_and_leaves_the_document_alone() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        save_profile(&dir, SUB, &location_input(Some("CA"), Some("CA-QC")))
            .expect("first save succeeds");
        let before = std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable");

        let error = save_profile(&dir, SUB, &location_input(None, Some("CA-QC")))
            .expect_err("save rejects");
        assert_eq!(
            refusal(&error),
            ("subdivision_code".to_string(), "requires_country".to_string())
        );

        let after = std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable");
        assert_eq!(before, after, "a rejected save must not modify the document");
    }

    #[test]
    fn an_unknown_country_reports_the_country_field_not_the_subdivision() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        let error = save_profile(&dir, SUB, &location_input(Some("ZZ"), Some("CA-QC")))
            .expect_err("save rejects");

        assert_eq!(refusal(&error).0, "country_code");
    }

    #[test]
    fn valid_bracket_and_currency_are_saved() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        let saved = save_profile(&dir, SUB, &income_input(Some("100k_149k"), Some(" cad ")))
            .expect("save succeeds");
        assert_eq!(saved.income_bracket.as_deref(), Some("100k_149k"));
        assert_eq!(
            saved.income_bracket_currency.as_deref(),
            Some("CAD"),
            "the stored code is normalized to uppercase, whatever the IPC caller sent"
        );

        let raw = std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable");
        let value: serde_json::Value = serde_json::from_str(&raw).expect("valid json");
        assert_eq!(value["income_bracket"], "100k_149k");
        assert_eq!(value["income_bracket_currency"], "CAD");
        assert!(
            value["income_bracket"].is_string(),
            "the bracket is a categorical code, never a cents integer"
        );

        let loaded = load_profile(&dir, SUB)
            .expect("load succeeds")
            .expect("document present");
        assert_eq!(loaded.income_bracket.as_deref(), Some("100k_149k"));
        assert_eq!(loaded.income_bracket_currency.as_deref(), Some("CAD"));
    }

    #[test]
    fn every_allow_listed_bracket_is_accepted() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        assert_eq!(VALID_INCOME_BRACKETS.len(), 5);
        for bracket in VALID_INCOME_BRACKETS.iter().copied() {
            let saved = save_profile(&dir, SUB, &income_input(Some(bracket), Some("USD")))
                .expect("save succeeds");
            assert_eq!(saved.income_bracket.as_deref(), Some(bracket));
        }
    }
    #[test]
    fn bracket_without_currency_is_rejected() {
        assert_income_rejected(Some("50k_99k"), None, "income_bracket_currency");
        assert_income_rejected(Some("50k_99k"), Some("   "), "income_bracket_currency");
    }

    #[test]
    fn currency_without_bracket_saves_and_is_inert() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        let saved =
            save_profile(&dir, SUB, &income_input(None, Some("EUR"))).expect("save succeeds");
        assert_eq!(saved.income_bracket, None);
        assert_eq!(saved.income_bracket_currency.as_deref(), Some("EUR"));

        let loaded = load_profile(&dir, SUB)
            .expect("load succeeds")
            .expect("document present");
        assert_eq!(loaded.income_bracket, None);
        assert_eq!(
            loaded.income_bracket_currency.as_deref(),
            Some("EUR"),
            "an inert currency is preserved, not cleared or coerced"
        );
    }

    #[test]
    fn invalid_bracket_code_is_rejected() {
        for candidate in ["bracket-3", "UNDER_50K", "50000", "under_50k_plus", "0"] {
            assert_income_rejected(Some(candidate), Some("CAD"), "income_bracket");
        }
    }

    #[test]
    fn invalid_currency_code_is_rejected() {
        for candidate in ["ZZZ", "CA", "dollars", "CADX", "C$"] {
            assert_income_rejected(Some("250k_plus"), Some(candidate), "income_bracket_currency");
        }
    }

    #[test]
    fn both_income_fields_cleared_to_none() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        save_profile(&dir, SUB, &income_input(Some("150k_249k"), Some("GBP")))
            .expect("first save succeeds");

        let cleared = save_profile(&dir, SUB, &income_input(None, None))
            .expect("clearing both fields succeeds");
        assert_eq!(cleared.income_bracket, None);
        assert_eq!(cleared.income_bracket_currency, None);

        let blank = save_profile(&dir, SUB, &income_input(Some(""), Some("  ")))
            .expect("blank strings clear rather than failing validation");
        assert_eq!(blank.income_bracket, None);
        assert_eq!(blank.income_bracket_currency, None);

        let raw = std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable");
        let value: serde_json::Value = serde_json::from_str(&raw).expect("valid json");
        assert!(value["income_bracket"].is_null(), "absent is null, never \"\"");
        assert!(value["income_bracket_currency"].is_null());

        let loaded = load_profile(&dir, SUB)
            .expect("load succeeds")
            .expect("document present");
        assert_eq!(loaded.income_bracket, None);
        assert_eq!(loaded.income_bracket_currency, None);
    }

    #[test]
    fn the_currency_allow_list_is_the_curated_twenty_uppercase_codes() {
        assert_eq!(VALID_INCOME_BRACKET_CURRENCIES.len(), 20);
        for code in VALID_INCOME_BRACKET_CURRENCIES {
            assert_eq!(code.len(), 3, "{code} is not an ISO 4217 alpha-3 code");
            assert_eq!(*code, code.to_uppercase(), "{code} must be uppercase");
        }
        for expected in ["CAD", "USD", "EUR", "JPY", "PLN"] {
            assert!(VALID_INCOME_BRACKET_CURRENCIES.contains(&expected));
        }
    }

    // The two conditional rules must stay one primitive: a regression that
    // reintroduced an ad-hoc branch for either would still pass their
    // rule-specific tests above while diverging on blank-vs-absent handling.
    #[test]
    fn require_companion_treats_blank_and_absent_alike_in_both_directions() {
        for companion in [None, Some(""), Some("   ")] {
            assert!(require_companion(Some("x"), companion, "birth_date", "required").is_err());
            assert!(require_companion(companion, Some("y"), "birth_date", "required").is_ok());
            assert!(require_companion(companion, companion, "birth_date", "required").is_ok());
        }
        assert!(require_companion(Some("x"), Some("y"), "birth_date", "required").is_ok());
    }

    /// The EXACT bytes a shipped build writes today: `schema_version` + `cognito_sub` + the seven
    /// fields + the two timestamps, pretty-printed in that order, with no `version` member.
    ///
    /// Pinned as a literal rather than produced by `save_profile`, because the thing under test is
    /// that TODAY'S on-disk shape still loads after the struct gained two members. A fixture
    /// generated by the new code could not fail that way.
    const LEGACY_V1_DOCUMENT: &str = concat!(
        "{\n",
        "  \"schema_version\": 1,\n",
        "  \"cognito_sub\": \"a1b2c3d4-e5f6-7890-abcd-ef1234567890\",\n",
        "  \"first_name\": \"Ada\",\n",
        "  \"last_name\": \"Lovelace\",\n",
        "  \"birth_date\": \"1985-03-14\",\n",
        "  \"income_bracket\": \"100k_149k\",\n",
        "  \"income_bracket_currency\": \"CAD\",\n",
        "  \"country_code\": \"CA\",\n",
        "  \"subdivision_code\": \"CA-QC\",\n",
        "  \"created_at\": \"2026-01-01T00:00:00+00:00\",\n",
        "  \"updated_at\": \"2026-02-01T00:00:00+00:00\"\n",
        "}"
    );

    fn seed_legacy_document(dir: &Path) {
        std::fs::create_dir_all(dir).expect("dir created");
        std::fs::write(profile_path(dir, SUB), LEGACY_V1_DOCUMENT).expect("file written");
    }

    /// The order the keys appear in the raw text, which `serde_json::Map`'s `BTreeMap` ordering
    /// would silently alphabetize on any parse-and-reserialize.
    fn key_order(raw: &str) -> Vec<String> {
        raw.lines()
            .filter_map(|line| {
                let line = line.trim();
                line.strip_prefix('"')
                    .and_then(|rest| rest.split('"').next())
                    .map(str::to_string)
            })
            .collect()
    }

    #[test]
    fn a_legacy_v1_document_loads_unchanged_into_the_current_struct() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());
        seed_legacy_document(&dir);

        let loaded = load_profile(&dir, SUB)
            .expect("load succeeds")
            .expect("a legacy document is a readable profile, never a corrupt one");

        assert_eq!(loaded.schema_version, PROFILE_SCHEMA_VERSION);
        assert_eq!(loaded.cognito_sub, SUB);
        assert_eq!(loaded.version, None, "a legacy document has no server version");
        assert_eq!(loaded.upload_declined, None);
        assert_eq!(loaded.first_name.as_deref(), Some("Ada"));
        assert_eq!(loaded.birth_date.as_deref(), Some("1985-03-14"));
        assert_eq!(loaded.income_bracket_currency.as_deref(), Some("CAD"));
        assert_eq!(loaded.subdivision_code.as_deref(), Some("CA-QC"));
        assert_eq!(loaded.created_at, "2026-01-01T00:00:00+00:00");

        assert!(
            !corrupt_path(&dir, SUB).exists(),
            "the load must not have quarantined it"
        );
        assert_eq!(
            std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable"),
            LEGACY_V1_DOCUMENT,
            "a load must not rewrite the document"
        );
    }

    #[test]
    fn a_round_trip_through_save_keeps_a_legacy_document_legacy() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());
        seed_legacy_document(&dir);

        save_profile(&dir, SUB, &named_input(Some("Grace"), Some("Hopper"))).expect("save succeeds");

        let raw = std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable");
        assert!(
            !raw.contains("\"version\""),
            "a `version: null` member would make AD-8 read this as already uploaded: {raw}"
        );
        assert!(!raw.contains(DECLINED_KEY));
        assert_eq!(key_order(&raw), key_order(LEGACY_V1_DOCUMENT));
        assert_eq!(probe_cloud_copy(&dir, SUB).expect("probe succeeds"), CloudCopyState::Legacy);
    }

    #[test]
    fn the_probe_classifies_every_state_without_touching_the_file() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        assert_eq!(probe_cloud_copy(&dir, SUB).expect("probe succeeds"), CloudCopyState::Absent);
        assert!(!dir.exists(), "the probe must not create the directory");

        seed_legacy_document(&dir);
        assert_eq!(probe_cloud_copy(&dir, SUB).expect("probe succeeds"), CloudCopyState::Legacy);

        mark_upload_declined(&dir, SUB).expect("decline succeeds");
        assert_eq!(probe_cloud_copy(&dir, SUB).expect("probe succeeds"), CloudCopyState::Declined);

        write_cloud_copy(&dir, SUB, &wire(7)).expect("write succeeds");
        assert_eq!(probe_cloud_copy(&dir, SUB).expect("probe succeeds"), CloudCopyState::Synced(7));
    }

    // The one case `load_profile` would destroy: an unparseable document is reported, NEVER
    // quarantined, because the probe runs on the launch path the consent prompt depends on
    // (adversary C4).
    #[test]
    fn the_probe_never_quarantines_an_unreadable_document() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());
        std::fs::create_dir_all(&dir).expect("dir created");

        for body in ["{ not json", r#"{"schema_version":2,"cognito_sub":"x"}"#, "[]"] {
            std::fs::write(profile_path(&dir, SUB), body).expect("file written");

            assert_eq!(
                probe_cloud_copy(&dir, SUB).expect("probe succeeds"),
                CloudCopyState::Unreadable
            );
            assert_eq!(
                std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable"),
                body
            );
            assert!(!corrupt_path(&dir, SUB).exists(), "{body}");
        }
    }

    /// AD-15's legacy-document survival gate, end to end: the launch-equivalent load, the probe,
    /// the simulated `GET` returning null (no `write_cloud_copy` call), then the decline.
    ///
    /// The strongest available form of "byte-identical except `upload_declined`": removing the
    /// inserted span from the resulting bytes must reproduce the original file exactly.
    #[test]
    fn a_legacy_document_survives_launch_probe_and_decline_byte_identical() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());
        seed_legacy_document(&dir);

        load_profile(&dir, SUB)
            .expect("the launch load succeeds")
            .expect("document present");
        assert_eq!(probe_cloud_copy(&dir, SUB).expect("probe succeeds"), CloudCopyState::Legacy);
        mark_upload_declined(&dir, SUB).expect("the decline succeeds");

        let patched = std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable");
        let inserted = ",\n  \"upload_declined\": true";
        assert!(patched.contains(inserted), "{patched}");
        assert_eq!(
            patched.replacen(inserted, "", 1),
            LEGACY_V1_DOCUMENT,
            "every byte outside the inserted member must be untouched"
        );

        let mut parsed: serde_json::Map<String, Value> =
            serde_json::from_str(&patched).expect("valid json");
        assert_eq!(parsed.remove(DECLINED_KEY), Some(Value::Bool(true)));
        assert_eq!(
            Value::Object(parsed),
            serde_json::from_str::<Value>(LEGACY_V1_DOCUMENT).expect("valid json")
        );
        assert_eq!(
            key_order(&patched)
                .into_iter()
                .filter(|key| key != DECLINED_KEY)
                .collect::<Vec<_>>(),
            key_order(LEGACY_V1_DOCUMENT)
        );

        assert!(!corrupt_path(&dir, SUB).exists(), "nothing may be quarantined");
        assert_eq!(probe_cloud_copy(&dir, SUB).expect("probe succeeds"), CloudCopyState::Declined);
    }

    #[test]
    fn declining_twice_adds_the_member_once() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());
        seed_legacy_document(&dir);

        mark_upload_declined(&dir, SUB).expect("first decline succeeds");
        let once = std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable");
        mark_upload_declined(&dir, SUB).expect("second decline succeeds");

        assert_eq!(
            std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable"),
            once
        );
        assert!(!dir.join(format!("{SUB}.json.tmp")).exists());
    }

    #[test]
    fn a_compact_document_keeps_its_formatting_through_a_decline() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());
        std::fs::create_dir_all(&dir).expect("dir created");
        let compact = format!(r#"{{"schema_version":1,"cognito_sub":"{SUB}","first_name":"Ada"}}"#);
        std::fs::write(profile_path(&dir, SUB), &compact).expect("file written");

        mark_upload_declined(&dir, SUB).expect("decline succeeds");

        let patched = std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable");
        assert_eq!(patched.replacen(",\"upload_declined\":true", "", 1), compact);
    }

    #[test]
    fn with_declined_member_refuses_a_shape_it_cannot_patch() {
        for raw in ["{}", "{  }", "[]", "", "not json"] {
            assert!(with_declined_member(raw).is_none(), "{raw}");
        }
    }

    fn wire(version: u64) -> CloudProfileWire {
        CloudProfileWire {
            fields: ProfileFields {
                first_name: Some("Grace".to_string()),
                last_name: None,
                birth_date: Some("1906-12-09".to_string()),
                income_bracket: None,
                income_bracket_currency: None,
                country_code: Some("US".to_string()),
                subdivision_code: None,
            },
            version,
            created_at: "2026-03-01T00:00:00+00:00".to_string(),
            updated_at: "2026-03-02T00:00:00+00:00".to_string(),
            avatar_version: Some(2),
        }
    }

    #[test]
    fn write_cloud_copy_stores_the_server_version_and_timestamps_verbatim() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        let written = write_cloud_copy(&dir, SUB, &wire(4)).expect("write succeeds");

        assert_eq!(written.version, Some(4));
        assert_eq!(written.created_at, "2026-03-01T00:00:00+00:00");
        assert_eq!(written.updated_at, "2026-03-02T00:00:00+00:00");

        let loaded = load_profile(&dir, SUB)
            .expect("load succeeds")
            .expect("document present");
        assert_eq!(loaded.version, Some(4));
        assert_eq!(loaded.first_name.as_deref(), Some("Grace"));
        assert_eq!(loaded.cognito_sub, SUB);
    }

    // The decline record is meaningless once the copy has a server version, and leaving it would
    // let a later legacy-shaped document inherit a refusal the user gave about a different one.
    #[test]
    fn write_cloud_copy_clears_a_previous_decline() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());
        seed_legacy_document(&dir);
        mark_upload_declined(&dir, SUB).expect("decline succeeds");

        write_cloud_copy(&dir, SUB, &wire(2)).expect("write succeeds");

        let raw = std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable");
        assert!(!raw.contains(DECLINED_KEY), "{raw}");
        assert_eq!(probe_cloud_copy(&dir, SUB).expect("probe succeeds"), CloudCopyState::Synced(2));
    }

    #[test]
    fn a_local_document_round_trips_under_the_local_subdirectory() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        let saved = save_local(&dir, DATASET_ID, &location_input(Some("CA"), Some("CA-QC")))
            .expect("save succeeds");
        assert_eq!(saved.dataset_id, DATASET_ID);
        assert_eq!(saved.schema_version, PROFILE_SCHEMA_VERSION);

        assert_eq!(
            local_profile_path(&dir, DATASET_ID),
            dir.join("local").join(format!("{DATASET_ID}.json"))
        );

        let loaded = load_local(&dir, DATASET_ID)
            .expect("load succeeds")
            .expect("document present");
        assert_eq!(loaded.fields.country_code.as_deref(), Some("CA"));
        assert_eq!(loaded.fields.subdivision_code.as_deref(), Some("CA-QC"));
    }

    // A local document is never a legal upload body (AD-6), and the structural reason is that it
    // carries no account identifier at all — not an empty one, not a dataset id wearing the
    // subject's name (adversary C3).
    #[test]
    fn a_local_document_carries_a_dataset_id_and_no_cognito_sub() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());
        save_local(&dir, DATASET_ID, &named_input(Some("Ada"), None)).expect("save succeeds");

        let raw =
            std::fs::read_to_string(local_profile_path(&dir, DATASET_ID)).expect("file readable");
        let value: Value = serde_json::from_str(&raw).expect("valid json");

        assert_eq!(value["schema_version"], 1);
        assert_eq!(value["dataset_id"], DATASET_ID);
        assert!(value.get("cognito_sub").is_none(), "{raw}");
        assert!(value.get("version").is_none());
        assert!(value["last_name"].is_null(), "unset field serializes as null");
    }

    #[test]
    fn a_local_save_runs_the_same_validator_as_the_cloud_copy() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        for (input, field) in [
            (birth_date_input(Some("2015-06-01")), "birth_date"),
            (country_input(Some("ZZ")), "country_code"),
            (income_input(Some("50k_99k"), None), "income_bracket_currency"),
        ] {
            let error = save_local(&dir, DATASET_ID, &input).expect_err("save rejects");
            assert_eq!(refusal(&error).0, field);
        }

        assert!(
            !local_profile_path(&dir, DATASET_ID).exists(),
            "a rejected save must touch no document"
        );
    }

    #[test]
    fn created_at_is_carried_forward_across_local_saves() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        let first = save_local(&dir, DATASET_ID, &named_input(Some("Ada"), None))
            .expect("first save succeeds");
        let second = save_local(&dir, DATASET_ID, &named_input(Some("Grace"), None))
            .expect("second save succeeds");

        assert_eq!(second.created_at, first.created_at);
        assert!(second.updated_at >= second.created_at);
    }

    // The two families cannot collide: one lives in `profiles/`, the other in `profiles/local/`,
    // so a subject literally named like a dataset id reads its own document and nothing else.
    #[test]
    fn a_subject_named_like_a_dataset_id_cannot_reach_a_local_document() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        save_local(&dir, DATASET_ID, &named_input(Some("Local"), None)).expect("save succeeds");
        save_profile(&dir, DATASET_ID, &named_input(Some("Cloud"), None)).expect("save succeeds");

        assert_eq!(
            load_local(&dir, DATASET_ID)
                .expect("load succeeds")
                .expect("document present")
                .fields
                .first_name
                .as_deref(),
            Some("Local")
        );
        assert_eq!(
            load_profile(&dir, DATASET_ID)
                .expect("load succeeds")
                .expect("document present")
                .first_name
                .as_deref(),
            Some("Cloud")
        );
    }

    #[test]
    fn an_invalid_dataset_id_is_rejected_on_every_local_entry_point() {
        let long = "x".repeat(129);
        for case in ["a/b", "../etc", "a.b", "a_b", "", long.as_str()] {
            let root = TempDir::new().expect("temp dir");
            let dir = profiles_dir(root.path());

            for error in [
                load_local(&dir, case).expect_err("load rejects"),
                save_local(&dir, case, &named_input(Some("Ada"), None)).expect_err("save rejects"),
                delete_local(&dir, case).expect_err("delete rejects"),
            ] {
                match error {
                    AppError::Validation { field, message } => {
                        assert_eq!(field.as_deref(), Some("dataset_id"));
                        assert!(
                            !message.contains(case) || case.is_empty(),
                            "the id must not be echoed into the message"
                        );
                    }
                    other => panic!("expected a validation error, got {other:?}"),
                }
            }

            assert!(!dir.exists(), "a rejected id must touch no file");
        }
    }

    #[test]
    fn delete_local_removes_the_document_and_its_siblings_and_is_idempotent() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());
        save_local(&dir, DATASET_ID, &named_input(Some("Ada"), None)).expect("save succeeds");
        let base = local_profile_path(&dir, DATASET_ID);
        std::fs::write(base.with_extension("json.tmp"), b"crashed-write pii").expect("written");
        std::fs::write(base.with_extension(CORRUPT_SUFFIX), b"quarantined pii").expect("written");

        delete_local(&dir, DATASET_ID).expect("delete succeeds");

        for path in [
            base.clone(),
            base.with_extension("json.tmp"),
            base.with_extension(CORRUPT_SUFFIX),
        ] {
            assert!(!path.exists(), "{path:?}");
        }
        delete_local(&dir, DATASET_ID).expect("an absent document is success");
    }

    #[test]
    fn the_orphan_sweep_removes_unregistered_documents_and_keeps_registered_ones() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());
        const ORPHAN_ID: &str = "00000000-0000-4000-8000-000000000009";

        save_local(&dir, DATASET_ID, &named_input(Some("Kept"), None)).expect("save succeeds");
        save_local(&dir, ORPHAN_ID, &named_input(Some("Orphaned"), None)).expect("save succeeds");
        let orphan_tmp = local_profile_path(&dir, ORPHAN_ID).with_extension("json.tmp");
        std::fs::write(&orphan_tmp, b"crashed-write pii").expect("written");

        let removed =
            sweep_local_orphans(&dir, &[DATASET_ID.to_string()]).expect("sweep succeeds");

        assert_eq!(removed, vec![ORPHAN_ID.to_string()]);
        assert!(!local_profile_path(&dir, ORPHAN_ID).exists());
        assert!(!orphan_tmp.exists(), "a crashed write must not outlive its document");
        assert!(local_profile_path(&dir, DATASET_ID).exists());
        assert!(
            sweep_local_orphans(&dir, &[DATASET_ID.to_string()])
                .expect("sweep succeeds")
                .is_empty(),
            "a second sweep has nothing left to do"
        );
    }

    #[test]
    fn the_orphan_sweep_is_a_no_op_with_no_local_directory() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        assert!(sweep_local_orphans(&dir, &[]).expect("sweep succeeds").is_empty());
        assert!(!local_profiles_dir(&dir).exists());
    }

    // The sweep never reaches the cloud copies: they are keyed by subject, not by dataset, so an
    // id-based "is this registered" test is meaningless for them.
    #[test]
    fn the_orphan_sweep_leaves_cloud_copies_alone() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());
        save_profile(&dir, SUB, &named_input(Some("Ada"), None)).expect("save succeeds");

        sweep_local_orphans(&dir, &[]).expect("sweep succeeds");

        assert!(profile_path(&dir, SUB).exists());
    }

    /// AD-12 as a machine-checked rule rather than a review habit: every refusal this module can
    /// produce is rendered and must not contain the value that was submitted.
    #[test]
    fn no_validation_refusal_contains_the_submitted_value() {
        let probes = [
            ("1812-07-04", birth_date_input(Some("1812-07-04"))),
            ("not-a-date", birth_date_input(Some("not-a-date"))),
            ("2099-01-01", birth_date_input(Some("2099-01-01"))),
            ("2015-06-01", birth_date_input(Some("2015-06-01"))),
            ("ZZ", country_input(Some("ZZ"))),
            ("CA-QC", location_input(Some("US"), Some("CA-QC"))),
            ("VA-01", location_input(Some("VA"), Some("VA-01"))),
            ("bracket-3", income_input(Some("bracket-3"), Some("CAD"))),
            ("ZZZ", income_input(Some("250k_plus"), Some("ZZZ"))),
        ];

        for (value, input) in probes {
            let error = validate_fields_at(&input, pinned_today()).expect_err("refused");
            let rendered = format!("{error}");
            let serialized = serde_json::to_string(&error).expect("serializable");

            assert!(!rendered.contains(value), "{value}: {rendered}");
            assert!(!serialized.contains(value), "{value}: {serialized}");
            refusal(&error);
        }
    }
}
