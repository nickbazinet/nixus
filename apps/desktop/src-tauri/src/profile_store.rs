use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use chrono::{Datelike, Local, NaiveDate, Utc};
use tracing::warn;

use crate::error::AppError;
use crate::models::{Country, Iso3166Dataset, Subdivision, UpdateUserProfileInput, UserProfile};

pub const PROFILE_SCHEMA_VERSION: u32 = 1;

// Embedded at compile time so the country list is available on a first offline
// run: `country_code` gates validation, and an empty catalog would leave the
// field unfillable rather than merely unhelpful.
const ISO3166_JSON: &str = include_str!("../data/iso3166.json");
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
const VALID_INCOME_BRACKETS: &[&str] = &[
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
const VALID_INCOME_BRACKET_CURRENCIES: &[&str] = &[
    "CAD", "USD", "EUR", "GBP", "AUD", "CHF", "JPY", "CNY", "INR", "MXN", "BRL", "SEK", "NOK",
    "DKK", "NZD", "SGD", "HKD", "ZAR", "KRW", "PLN",
];

const MIN_AGE_YEARS: i32 = 18;
const MAX_AGE_YEARS: i32 = 120;

pub fn profiles_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("profiles")
}

fn profile_path(dir: &Path, sub: &str) -> PathBuf {
    dir.join(format!("{sub}.json"))
}

fn corrupt_path(dir: &Path, sub: &str) -> PathBuf {
    dir.join(format!("{sub}.{CORRUPT_SUFFIX}"))
}

// WHY validated and never slugged: slugging is many-to-one, so two distinct
// `sub` values could collapse onto one filename and one account would read
// another's profile. The allow-list also excludes `.`, which is what makes
// `json_store`'s `with_extension("json.tmp")` temp-path scheme correct.
// The offending value is never echoed into the message: it is an identity key
// and `AppError::Validation`'s message crosses IPC to the UI.
fn validate_sub(sub: &str) -> Result<(), AppError> {
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

fn birth_date_error(message: &str) -> AppError {
    AppError::Validation {
        message: message.to_string(),
        field: Some("birth_date".to_string()),
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
        .map_err(|_| birth_date_error("Date of birth must be in YYYY-MM-DD format"))?;

    // chrono's `%Y-%m-%d` accepts unpadded components, so "1985-3-14" parses.
    // Round-tripping is what keeps the stored string canonically zero-padded.
    if parsed.format("%Y-%m-%d").to_string() != trimmed {
        return Err(birth_date_error(
            "Date of birth must be in YYYY-MM-DD format",
        ));
    }

    if parsed > today {
        return Err(birth_date_error("Date of birth cannot be in the future"));
    }

    let mut age = today.year() - parsed.year();
    if (today.month(), today.day()) < (parsed.month(), parsed.day()) {
        age -= 1;
    }

    if age < MIN_AGE_YEARS {
        return Err(birth_date_error("You must be at least 18 years old"));
    }

    if age > MAX_AGE_YEARS {
        return Err(birth_date_error("Date of birth is too far in the past"));
    }

    Ok(Some(trimmed.to_string()))
}

// Rust is the authority: a code the frontend never offered is still rejected
// here. The offending value is echoed because it is an opaque ISO code, not PII
// like `cognito_sub`.
fn validate_country_code(country_code: Option<&str>) -> Result<(), AppError> {
    if let Some(code) = country_code {
        if !country_exists(code) {
            return Err(AppError::Validation {
                message: format!("Invalid country code: {code}"),
                field: Some("country_code".to_string()),
            });
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
        "Select a country before selecting a state, province, or region",
    )?;

    if subdivisions_for_country.is_empty() {
        return Err(subdivision_code_error(format!(
            "No state, province, or region is available for the selected country: {trimmed}"
        )));
    }

    if !subdivisions_for_country.iter().any(|s| s.code == trimmed) {
        return Err(subdivision_code_error(format!(
            "Invalid state, province, or region code: {trimmed}"
        )));
    }

    Ok(Some(trimmed.to_string()))
}

fn subdivision_code_error(message: String) -> AppError {
    AppError::Validation {
        message,
        field: Some("subdivision_code".to_string()),
    }
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
    message: &str,
) -> Result<(), AppError> {
    let is_set = |value: Option<&str>| value.map(str::trim).is_some_and(|v| !v.is_empty());

    if is_set(dependent) && !is_set(companion) {
        return Err(AppError::Validation {
            message: message.to_string(),
            field: Some(error_field.to_string()),
        });
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
        return Err(AppError::Validation {
            message: format!("Invalid income bracket: {trimmed}"),
            field: Some("income_bracket".to_string()),
        });
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
        return Err(AppError::Validation {
            message: format!("Invalid income bracket currency: {normalized}"),
            field: Some("income_bracket_currency".to_string()),
        });
    }

    Ok(Some(normalized))
}

// Full replace: every field comes from `input`, so `None` clears it. `created_at`
// is carried forward verbatim from any existing document — regenerating it would
// silently destroy it — while `updated_at` is bumped on every save.
pub fn save_profile(
    dir: &Path,
    sub: &str,
    input: &UpdateUserProfileInput,
) -> Result<UserProfile, AppError> {
    validate_sub(sub)?;

    let birth_date =
        validate_birth_date_at(input.birth_date.as_deref(), Local::now().date_naive())?;

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
        "Select the currency your income bracket is in",
    )?;

    std::fs::create_dir_all(dir).map_err(|e| AppError::File {
        message: format!("Failed to create profiles dir: {}", e),
    })?;

    let existing = load_profile(dir, sub)?;
    let now = Utc::now().to_rfc3339();

    let profile = UserProfile {
        schema_version: PROFILE_SCHEMA_VERSION,
        cognito_sub: sub.to_string(),
        first_name: normalize(&input.first_name),
        last_name: normalize(&input.last_name),
        birth_date,
        income_bracket,
        income_bracket_currency,
        country_code,
        subdivision_code,
        created_at: existing.map(|p| p.created_at).unwrap_or_else(|| now.clone()),
        updated_at: now,
    };

    crate::json_store::write_json_atomic(&profile_path(dir, sub), &profile)?;

    Ok(profile)
}

// The whole directory goes recursively: a `*.json` glob would leave
// `.json.corrupt` and `.json.tmp` PII behind.
pub fn delete_all_profiles(dir: &Path) -> Result<(), AppError> {
    match std::fs::remove_dir_all(dir) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(AppError::File {
            message: format!("Failed to delete profiles: {}", e),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const SUB: &str = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

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

        match error {
            AppError::Validation { field, message } => {
                assert_eq!(field.as_deref(), Some(expected_field));
                assert!(!message.is_empty(), "the message reaches the UI verbatim");
            }
            other => panic!("expected a validation error, got {other:?}"),
        }
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

        match error {
            AppError::Validation { field, message } => {
                assert_eq!(
                    field.as_deref(),
                    Some("subdivision_code"),
                    "the error must be scoped to the subdivision_code form field"
                );
                assert!(!message.is_empty(), "the message reaches the UI verbatim");
            }
            other => panic!("expected a validation error, got {other:?}"),
        }
    }

    fn pinned_today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 8, 10).expect("valid date")
    }

    fn assert_birth_date_rejected(candidate: &str) {
        let error = validate_birth_date_at(Some(candidate), pinned_today())
            .expect_err("candidate must be rejected");

        match error {
            AppError::Validation { field, message } => {
                assert_eq!(
                    field.as_deref(),
                    Some("birth_date"),
                    "the error must be scoped to the birth_date form field"
                );
                assert!(!message.is_empty(), "the message reaches the UI verbatim");
            }
            other => panic!("expected a validation error, got {other:?}"),
        }
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
        assert_birth_date_rejected("2027-01-01");
    }

    #[test]
    fn an_age_under_the_minimum_is_rejected() {
        assert_birth_date_rejected("2015-06-01");
    }

    #[test]
    fn an_age_over_the_maximum_is_rejected() {
        assert_birth_date_rejected("1890-01-01");
    }

    #[test]
    fn a_malformed_birth_date_is_rejected() {
        for candidate in ["not-a-date", "14/03/1985", "1985-3-14", "1985-13-01", "1985"] {
            assert_birth_date_rejected(candidate);
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
        assert_birth_date_rejected("2008-08-11");
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
        assert!(matches!(error, AppError::Validation { .. }));

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

        match error {
            AppError::Validation { field, .. } => {
                assert_eq!(field.as_deref(), Some("birth_date"))
            }
            other => panic!("expected a validation error, got {other:?}"),
        }
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

    // The assertion is deliberately "absent or empty", never "no *.json files
    // remain": a `*.json` glob implementation would pass the weaker form while
    // leaving `.json.corrupt` and `.json.tmp` PII on disk (NFR4).
    #[test]
    fn delete_all_profiles_removes_every_extension() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());
        save_profile(&dir, SUB, &named_input(Some("Ada"), None)).expect("save succeeds");
        std::fs::write(corrupt_path(&dir, SUB), b"quarantined pii").expect("file written");
        std::fs::write(dir.join(format!("{SUB}.json.tmp")), b"crashed-write pii")
            .expect("file written");
        let nested = dir.join("sub-dir");
        std::fs::create_dir_all(&nested).expect("nested dir created");
        std::fs::write(nested.join("orphan.json"), b"nested pii").expect("file written");

        for seeded in [
            profile_path(&dir, SUB),
            corrupt_path(&dir, SUB),
            dir.join(format!("{SUB}.json.tmp")),
            nested.join("orphan.json"),
        ] {
            assert!(seeded.exists(), "fixture must exist before the delete");
        }

        delete_all_profiles(&dir).expect("delete succeeds");

        assert!(
            !dir.exists()
                || std::fs::read_dir(&dir)
                    .expect("read_dir")
                    .next()
                    .is_none(),
            "the profiles directory must be absent or empty after delete-all"
        );
    }

    #[test]
    fn delete_all_profiles_is_ok_when_directory_absent() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        delete_all_profiles(&dir).expect("absent dir is not an error");
        delete_all_profiles(&dir).expect("the delete is idempotent");
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

        match error {
            AppError::Validation { field, message } => {
                assert_eq!(field.as_deref(), Some("country_code"));
                assert!(message.contains("ZZ"));
            }
            other => panic!("expected a validation error, got {other:?}"),
        }
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

        match error {
            AppError::Validation { field, .. } => {
                assert_eq!(field.as_deref(), Some("subdivision_code"))
            }
            other => panic!("expected a validation error, got {other:?}"),
        }
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
        match error {
            AppError::Validation { field, .. } => {
                assert_eq!(field.as_deref(), Some("subdivision_code"))
            }
            other => panic!("expected a validation error, got {other:?}"),
        }

        let after = std::fs::read_to_string(profile_path(&dir, SUB)).expect("file readable");
        assert_eq!(before, after, "a rejected save must not modify the document");
    }

    #[test]
    fn an_unknown_country_reports_the_country_field_not_the_subdivision() {
        let root = TempDir::new().expect("temp dir");
        let dir = profiles_dir(root.path());

        let error = save_profile(&dir, SUB, &location_input(Some("ZZ"), Some("CA-QC")))
            .expect_err("save rejects");

        match error {
            AppError::Validation { field, .. } => {
                assert_eq!(field.as_deref(), Some("country_code"))
            }
            other => panic!("expected a validation error, got {other:?}"),
        }
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
            assert!(require_companion(Some("x"), companion, "f", "m").is_err());
            assert!(require_companion(companion, Some("y"), "f", "m").is_ok());
            assert!(require_companion(companion, companion, "f", "m").is_ok());
        }
        assert!(require_companion(Some("x"), Some("y"), "f", "m").is_ok());
    }
}
