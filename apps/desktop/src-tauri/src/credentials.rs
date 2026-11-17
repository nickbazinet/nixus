use std::sync::Mutex;

use keyring_core::{Entry, Error};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::models::CognitoSession;

/// Installs the process-wide credential store. Must run before any credential access.
///
/// Release builds use the OS store (macOS Keychain, Windows Credential Manager).
/// Debug builds use a SQLite file in the app data dir instead: every `tauri dev`
/// rebuild is a new unsigned binary, which the macOS Keychain treats as a stranger
/// and re-prompts for on every access. The file holds secrets in plaintext, which
/// is why it is compiled out of release builds rather than merely switched off.
pub(crate) fn install_store(app_data_dir: &std::path::Path) -> Result<(), Error> {
    #[cfg(not(debug_assertions))]
    {
        let _ = app_data_dir;
        keyring::use_native_store(false)
    }

    #[cfg(debug_assertions)]
    {
        let path = app_data_dir.join("debug-credentials.sqlite3");
        let path_str = path.to_str().ok_or_else(|| {
            Error::Invalid(
                "path".to_string(),
                "the app data dir is not UTF-8".to_string(),
            )
        })?;
        keyring::use_sqlite_store(&std::collections::HashMap::from([("path", path_str)]))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if path.exists() {
                let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
            }
        }

        tracing::info!(
            "Debug build: credentials are stored in {:?}, not the OS keychain",
            path
        );
        Ok(())
    }
}

const KEYRING_SERVICE: &str = "nixus";
const KEYRING_AUTH_SERVICE: &str = "nixus-auth";

/// The AI keyring service every build shipped before the Nixus rename.
///
/// A compatibility constant read only by `migrate_legacy_ai_credentials`: nothing
/// else may reference it, and nothing ever writes under it again.
const LEGACY_KEYRING_SERVICE: &str = "nkbaz-finance";

/// Keyring service owning `dataset_id`'s AI-provider credentials (Story 34.2).
///
/// Default keeps the bare service name so its entries need no id in the service,
/// and every other dataset gets its own suffixed service, which is what keeps one
/// profile's provider key out of another's.
///
/// Deliberately *not* applied to `KEYRING_AUTH_SERVICE`: the Cognito session is
/// the machine's identity, not a profile's, and stays dataset-independent.
fn ai_service(dataset_id: &str) -> String {
    service_for(KEYRING_SERVICE, dataset_id)
}

fn legacy_ai_service(dataset_id: &str) -> String {
    service_for(LEGACY_KEYRING_SERVICE, dataset_id)
}

fn service_for(base: &str, dataset_id: &str) -> String {
    if dataset_id == crate::datasets::DEFAULT_DATASET_ID {
        base.to_string()
    } else {
        format!("{base}-{dataset_id}")
    }
}

// WHY chunked entries instead of one entry per field (the prior fix):
// Windows Credential Manager caps a single generic credential's password
// blob at 2560 UTF-16 code units. Splitting the combined session JSON into
// one entry per field (access_token, id_token, refresh_token, expires_at)
// was not enough: Cognito refresh tokens are opaque tokens, not compact
// JWTs, and can individually exceed 2560 chars on their own, so
// `store_cognito_session` still failed on real Windows logins with "Value
// of 'password encoded as UTF-16' is longer than the platform limit of
// 2560 chars" even after that fix. Each field is now split into fixed-size
// chunks, each its own entry (`<field>-0`, `<field>-1`, ...), so no single
// write ever approaches the limit regardless of token size. macOS/Linux
// have no such limit and are unaffected either way.
#[cfg(target_os = "windows")]
const KEYRING_AUTH_ACCOUNT_ACCESS_TOKEN: &str = "cognito-session-access-token";
#[cfg(target_os = "windows")]
const KEYRING_AUTH_ACCOUNT_ID_TOKEN: &str = "cognito-session-id-token";
#[cfg(target_os = "windows")]
const KEYRING_AUTH_ACCOUNT_REFRESH_TOKEN: &str = "cognito-session-refresh-token";
#[cfg(target_os = "windows")]
const KEYRING_AUTH_ACCOUNT_EXPIRES_AT: &str = "cognito-session-expires-at";

#[cfg(target_os = "windows")]
const COGNITO_SESSION_FIELDS: [&str; 4] = [
    KEYRING_AUTH_ACCOUNT_ACCESS_TOKEN,
    KEYRING_AUTH_ACCOUNT_ID_TOKEN,
    KEYRING_AUTH_ACCOUNT_REFRESH_TOKEN,
    KEYRING_AUTH_ACCOUNT_EXPIRES_AT,
];

// `CRED_MAX_CREDENTIAL_BLOB_SIZE` (the real Win32 constant behind the "2560"
// in the error message) is a limit of 2560 BYTES, not characters. The Windows
// keyring backend UTF-16-encodes the password before checking that limit (2
// bytes per ASCII char), so the real usable capacity for `set_password` is
// 2560 / 2 = 1280 chars, not 2560 - the previous `2_000` value here still
// exceeded it (4000 UTF-16 bytes per chunk) and failed identically to the
// unchunked version. 1000 leaves headroom below that real 1280-char ceiling.
#[cfg(target_os = "windows")]
const CHUNK_MAX_CHARS: usize = 1_000;

// Bounds the read/clear loops below so a persistent backend fault (a delete
// that never resolves to `NoEntry`) cannot spin forever; 500 chunks is far
// beyond any realistic token size (500,000 chars at `CHUNK_MAX_CHARS`).
#[cfg(target_os = "windows")]
const MAX_CHUNKS_PER_FIELD: usize = 500;

// WHY one entry per dataset instead of one per credential (the prior layout):
// on macOS every keychain item carries its own access list, so four items
// meant up to four "Nixus wants to access..." prompts per profile — and four
// more after every update an ad-hoc build shipped. One entry also makes a
// save all-or-nothing (a failed second write used to leave a profile
// half-configured) and turns wipe, copy and migrate into single operations.
// The blob is a few hundred characters, far under the Windows Credential
// Manager cap the Cognito session has to chunk around.
const AI_CREDENTIALS_ACCOUNT: &str = "ai-credentials";

/// Every AI-provider credential one dataset holds, stored as one JSON blob.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct AiCredentials {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    aws_access_key_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    aws_secret_access_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    aws_region: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    openai_api_key: Option<String>,
}

type FieldSlot = fn(&mut AiCredentials) -> &mut Option<String>;

/// Each field paired with the account name it had in the superseded per-entry
/// layout. The migration and the wipe both walk this, so a field added to the
/// struct without a row here is caught by `every_field_has_a_per_entry_name`.
const PER_ENTRY_FIELDS: [(&str, FieldSlot); 4] = [
    ("aws_access_key_id", |c| &mut c.aws_access_key_id),
    ("aws_secret_access_key", |c| &mut c.aws_secret_access_key),
    ("aws_region", |c| &mut c.aws_region),
    ("openai_api_key", |c| &mut c.openai_api_key),
];

impl AiCredentials {
    fn configured_count(&self) -> usize {
        [
            &self.aws_access_key_id,
            &self.aws_secret_access_key,
            &self.aws_region,
            &self.openai_api_key,
        ]
        .iter()
        .filter(|field| field.is_some())
        .count()
    }
}

fn ai_entry(dataset_id: &str) -> Result<Entry, Error> {
    Entry::new(&ai_service(dataset_id), AI_CREDENTIALS_ACCOUNT)
}

/// The fixed message a corrupt blob reports: never the blob itself, which may
/// still hold a readable secret.
const CORRUPT_AI_CREDENTIALS: &str = "the stored AI credentials are not readable";

fn decode_ai_credentials(blob: &str) -> Result<AiCredentials, Error> {
    serde_json::from_str(blob)
        .map_err(|_| Error::BadStoreFormat(CORRUPT_AI_CREDENTIALS.to_string()))
}

fn encode_ai_credentials(credentials: &AiCredentials) -> Result<String, Error> {
    serde_json::to_string(credentials)
        .map_err(|_| Error::BadStoreFormat("the AI credentials could not be encoded".to_string()))
}

/// `Ok(None)` is genuine absence; a keyring that declines to answer and a blob
/// that does not decode are both errors, so no caller mistakes them for it.
fn read_ai_credentials(entry: &Entry) -> Result<Option<AiCredentials>, Error> {
    match entry.get_password() {
        Ok(blob) => decode_ai_credentials(&blob).map(Some),
        Err(Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Read-modify-write, so saving one provider keeps the other's keys.
///
/// A corrupt blob is replaced rather than refused: nothing in it is usable, and
/// refusing would leave the user unable to reconfigure AI at all. A keyring
/// that declines the read still fails the save, because overwriting what it
/// would not show us could destroy the other provider's keys.
fn update_ai_credentials(
    dataset_id: &str,
    apply: impl FnOnce(&mut AiCredentials),
) -> Result<(), Error> {
    let entry = ai_entry(dataset_id)?;
    let mut credentials = match read_ai_credentials(&entry) {
        Ok(existing) => existing.unwrap_or_default(),
        Err(Error::BadStoreFormat(_)) => AiCredentials::default(),
        Err(e) => return Err(e),
    };
    apply(&mut credentials);
    entry.set_password(&encode_ai_credentials(&credentials)?)
}

fn load_ai_credentials(dataset_id: &str) -> Option<AiCredentials> {
    read_ai_credentials(&ai_entry(dataset_id).ok()?).ok()?
}

pub fn store_aws_credentials(
    dataset_id: &str,
    access_key: &str,
    secret_key: &str,
    region: &str,
) -> Result<(), Error> {
    update_ai_credentials(dataset_id, |credentials| {
        credentials.aws_access_key_id = Some(access_key.to_string());
        credentials.aws_secret_access_key = Some(secret_key.to_string());
        credentials.aws_region = Some(region.to_string());
    })
}

pub fn load_aws_credentials(dataset_id: &str) -> Option<(String, String, String)> {
    let credentials = load_ai_credentials(dataset_id)?;
    Some((
        credentials.aws_access_key_id?,
        credentials.aws_secret_access_key?,
        credentials.aws_region?,
    ))
}

pub fn store_openai_key(dataset_id: &str, api_key: &str) -> Result<(), Error> {
    update_ai_credentials(dataset_id, |credentials| {
        credentials.openai_api_key = Some(api_key.to_string());
    })
}

pub fn load_openai_key(dataset_id: &str) -> Option<String> {
    load_ai_credentials(dataset_id)?.openai_api_key
}

/// Removes the dataset's AI entry and anything either superseded per-entry
/// layout left behind, so a credential whose migration was interrupted cannot
/// survive a wipe and resurface on the next launch's migration.
pub fn clear_credentials(dataset_id: &str) {
    if let Ok(entry) = ai_entry(dataset_id) {
        let _ = entry.delete_credential();
    }
    for service in [ai_service(dataset_id), legacy_ai_service(dataset_id)] {
        for (name, _) in PER_ENTRY_FIELDS {
            if let Ok(entry) = Entry::new(&service, name) {
                let _ = entry.delete_credential();
            }
        }
    }
}

/// Copies every AI-provider credential `source_dataset_id` holds into
/// `destination_dataset_id`'s own service (Story 35.3's Migrate branch).
///
/// Lives here because `credentials.rs` is the sole caller of `keyring_core::Entry`
/// — a copy anywhere else would be a second accessor. A source with nothing
/// configured copies nothing, which is the normal case; every other failure — a
/// read the keyring refused, a blob that does not decode, a write it rejected —
/// is fatal, because silently dropping the keys would leave the migrated profile
/// unable to reach the AI it was configured for with nothing reporting why.
///
/// Returns how many credentials were copied, which is what the caller logs.
pub fn copy_ai_credentials(
    source_dataset_id: &str,
    destination_dataset_id: &str,
) -> Result<usize, AppError> {
    let source = ai_entry(source_dataset_id)
        .and_then(|entry| read_ai_credentials(&entry))
        .map_err(|e| AppError::File {
            message: format!("Failed to read the AI credentials to copy: {}", e),
        })?;

    let Some(credentials) = source else {
        return Ok(0);
    };
    let copied = credentials.configured_count();
    if copied == 0 {
        return Ok(0);
    }

    ai_entry(destination_dataset_id)
        .and_then(|entry| entry.set_password(&encode_ai_credentials(&credentials)?))
        .map_err(|e| AppError::File {
            message: format!("Failed to copy AI credentials: {}", e),
        })?;

    Ok(copied)
}

/// What one credential-migration run did, for the caller to log.
///
/// A failure is carried as a message rather than returned as an `Err` because a
/// keyring that cannot be reached must never block launch: the run is retried on
/// the next one, and the app degrades to "AI not configured" in the meantime.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct CredentialMigration {
    pub(crate) moved: usize,
    pub(crate) superseded: usize,
    pub(crate) failures: Vec<String>,
}

impl CredentialMigration {
    pub(crate) fn is_noop(&self) -> bool {
        *self == Self::default()
    }
}

/// Folds every per-entry AI credential — the Nixus per-entry layout and the
/// pre-rename `nkbaz-finance` one before it — into each dataset's single entry.
///
/// Convergent and per-credential. A field the single entry lacks is filled from
/// the newest per-entry layout that has it; a field it already holds wins
/// outright and the per-entry copies beside it are discarded as superseded. No
/// per-entry source is deleted until the merged entry has been written and read
/// back identically — the delete being the one irreversible step, it never runs
/// on an unverified write. Either way nothing is left for a later launch to
/// find, which is what makes the second launch a genuine no-op.
///
/// Nothing here can fail the caller: an unreachable or locked keyring yields a
/// message, and whatever it prevented is retried on the next launch.
pub(crate) fn migrate_legacy_ai_credentials(dataset_ids: &[String]) -> CredentialMigration {
    let mut outcome = CredentialMigration::default();
    for dataset_id in dataset_ids {
        migrate_dataset_ai_credentials(dataset_id, &mut outcome);
    }
    outcome
}

fn migrate_dataset_ai_credentials(dataset_id: &str, outcome: &mut CredentialMigration) {
    let destination = match ai_entry(dataset_id) {
        Ok(entry) => entry,
        Err(e) => {
            outcome
                .failures
                .push(format!("{AI_CREDENTIALS_ACCOUNT}: {e}"));
            return;
        }
    };
    // A destination the keyring will not show us is never written over: it may
    // hold the newer value of every field.
    let previous = match read_ai_credentials(&destination) {
        Ok(previous) => previous,
        Err(e) => {
            outcome
                .failures
                .push(format!("{AI_CREDENTIALS_ACCOUNT}: {e}"));
            return;
        }
    };

    let mut merged = previous.clone().unwrap_or_default();
    let mut moved = Vec::new();
    let mut superseded = Vec::new();

    // Newest layout first: a per-entry value under the Nixus service was written
    // after any pre-rename one, so it is the one that fills an empty field.
    for service in [ai_service(dataset_id), legacy_ai_service(dataset_id)] {
        for (name, slot) in PER_ENTRY_FIELDS {
            let entry = match Entry::new(&service, name) {
                Ok(entry) => entry,
                Err(e) => {
                    outcome.failures.push(format!("{name}: {e}"));
                    continue;
                }
            };
            match entry.get_password() {
                Err(Error::NoEntry) => {}
                // The name, never the value: a message is logged verbatim.
                Err(e) => outcome.failures.push(format!("{name}: {e}")),
                Ok(value) => {
                    let field = slot(&mut merged);
                    if field.is_some() {
                        superseded.push((name, entry));
                    } else {
                        *field = Some(value);
                        moved.push((name, entry));
                    }
                }
            }
        }
    }

    if !moved.is_empty() {
        let written = encode_ai_credentials(&merged).map_err(|e| e.to_string());
        let previous_blob = previous
            .as_ref()
            .map(encode_ai_credentials)
            .transpose()
            .map_err(|e| e.to_string());
        let verified = written.and_then(|written| {
            let previous_blob = previous_blob?;
            store_verified_copy(&destination, &written, previous_blob.as_deref(), || {
                ai_entry(dataset_id)
                    .and_then(|entry| entry.get_password())
                    .map_err(|e| e.to_string())
            })
        });
        if let Err(message) = verified {
            // Every source survives untouched, so the retry has everything it needs.
            outcome
                .failures
                .push(format!("{AI_CREDENTIALS_ACCOUNT}: {message}"));
            return;
        }
    }

    for (name, entry) in moved {
        match entry.delete_credential() {
            Ok(()) => outcome.moved += 1,
            // The value is already in the single entry; the leftover is
            // discarded as superseded on the next launch.
            Err(e) => outcome.failures.push(format!("{name}: {e}")),
        }
    }
    for (name, entry) in superseded {
        match entry.delete_credential() {
            Ok(()) => outcome.superseded += 1,
            Err(e) => outcome.failures.push(format!("{name}: {e}")),
        }
    }
}

/// Writes `value` into `destination`, keeping it only if `read_back` proves it landed.
///
/// Rolling the write back on *any* unverified outcome — a mismatch as much as a read
/// the keyring refused — is what keeps the destination-wins rule honest. The migration
/// treats every field the destination holds as authoritative and discards the
/// per-entry sources beside it, so a half-written or wrong value left behind here
/// would be adopted as the winner on the next launch and would then cause the real
/// credential to be deleted as a redundant duplicate. Rolling back restores the
/// destination to `previous` (or removes it when there was none), so the next launch
/// retries from sources this function never touches.
///
/// The rollback is best-effort: the error the caller needs is the verification failure
/// that caused it, not whatever went wrong undoing it. A rollback that itself fails
/// leaves exactly the state a retry already handles.
///
/// `read_back` is injected because the mock keyring store cannot be made to return a
/// value different from the one just written, so a mismatch is unreachable through the
/// real lookup and this ordering is only worth having if it is tested.
fn store_verified_copy(
    destination: &Entry,
    value: &str,
    previous: Option<&str>,
    read_back: impl FnOnce() -> Result<String, String>,
) -> Result<(), String> {
    destination.set_password(value).map_err(|e| e.to_string())?;

    let verified = match read_back() {
        Ok(stored) if stored == value => return Ok(()),
        Ok(_) => "the copied credentials did not read back identically".to_string(),
        Err(e) => format!("the copied credentials could not be read back: {e}"),
    };

    let _ = match previous {
        Some(previous) => destination.set_password(previous),
        None => destination.delete_credential(),
    };

    Err(verified)
}

fn auth_entry(account: &str) -> Result<Entry, AppError> {
    Entry::new(KEYRING_AUTH_SERVICE, account).map_err(|e| AppError::Auth {
        message: format!("Secure storage is unavailable: {}", e),
        recoverable: false,
    })
}

#[cfg(target_os = "windows")]
fn chunk_account(field: &str, index: usize) -> String {
    format!("{field}-{index}")
}

#[cfg(target_os = "windows")]
fn chunk_str(value: &str, max_chars: usize) -> Vec<String> {
    // A field is only ever `None` when every chunk is absent (see
    // `read_field`), so an empty string still needs exactly one chunk to
    // remain distinguishable from "not stored at all".
    if value.is_empty() {
        return vec![String::new()];
    }
    let chars: Vec<char> = value.chars().collect();
    chars
        .chunks(max_chars)
        .map(|c| c.iter().collect())
        .collect()
}

#[cfg(target_os = "windows")]
fn write_field(field: &str, value: &str) -> Result<(), AppError> {
    // A shrinking value (e.g. a shorter token on re-login) must not leave the
    // previous write's trailing chunks behind — `read_field` would otherwise
    // concatenate stale data onto the end of the new value.
    delete_field(field)?;

    for (index, chunk) in chunk_str(value, CHUNK_MAX_CHARS).iter().enumerate() {
        auth_entry(&chunk_account(field, index))?
            .set_password(chunk)
            .map_err(|e| AppError::Auth {
                message: format!("Failed to save session to secure storage: {}", e),
                recoverable: false,
            })?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn read_field(field: &str) -> Result<Option<String>, AppError> {
    let mut value = String::new();
    for index in 0..MAX_CHUNKS_PER_FIELD {
        match auth_entry(&chunk_account(field, index))?.get_password() {
            Ok(chunk) => value.push_str(&chunk),
            Err(Error::NoEntry) if index == 0 => return Ok(None),
            Err(Error::NoEntry) => return Ok(Some(value)),
            Err(e) => {
                return Err(AppError::Auth {
                    message: format!("Failed to read session from secure storage: {}", e),
                    recoverable: true,
                })
            }
        }
    }
    Ok(Some(value))
}

#[cfg(target_os = "windows")]
fn delete_field(field: &str) -> Result<(), AppError> {
    let mut first_error = None;
    for index in 0..MAX_CHUNKS_PER_FIELD {
        match auth_entry(&chunk_account(field, index))?.delete_credential() {
            Ok(()) => {}
            Err(Error::NoEntry) => break,
            Err(e) if first_error.is_none() => first_error = Some(e),
            Err(_) => {}
        }
    }
    match first_error {
        None => Ok(()),
        Some(e) => Err(AppError::Auth {
            message: format!("Failed to clear session from secure storage: {}", e),
            recoverable: false,
        }),
    }
}

/// Best-effort delete of every session field, ignoring `NoEntry`. Used both
/// by `clear_cognito_session` and as store-failure/load-corruption cleanup so
/// a partial write or a partial read never leaves stale chunks behind.
#[cfg(target_os = "windows")]
fn clear_all_session_fields() -> Result<(), AppError> {
    let mut first_error = None;
    for field in COGNITO_SESSION_FIELDS {
        if let Err(e) = delete_field(field) {
            if first_error.is_none() {
                first_error = Some(e);
            }
        }
    }
    match first_error {
        None => Ok(()),
        Some(e) => Err(e),
    }
}

// WHY macOS/Linux get a single combined entry instead of the Windows chunking
// above: each chunked field is its own macOS Keychain item, and each item
// independently prompts the user for Keychain access on first read/write —
// 4 fields meant 4 separate "Nixus wants to access..." prompts on every
// launch. macOS/Linux have no credential-size limit (the chunking exists
// solely for Windows Credential Manager's 2560-byte cap), so the whole
// session round-trips as one JSON blob under one keychain item instead.
#[cfg(not(target_os = "windows"))]
const KEYRING_AUTH_ACCOUNT_SESSION: &str = "cognito-session";

#[cfg(not(target_os = "windows"))]
fn store_cognito_session_uncached(session: &CognitoSession) -> Result<(), AppError> {
    let blob = serde_json::to_string(session).map_err(|e| AppError::Auth {
        message: format!("Failed to save session to secure storage: {}", e),
        recoverable: false,
    })?;

    auth_entry(KEYRING_AUTH_ACCOUNT_SESSION)?
        .set_password(&blob)
        .map_err(|e| AppError::Auth {
            message: format!("Failed to save session to secure storage: {}", e),
            recoverable: false,
        })
}

#[cfg(not(target_os = "windows"))]
fn load_cognito_session_uncached() -> Result<Option<CognitoSession>, AppError> {
    let blob = match auth_entry(KEYRING_AUTH_ACCOUNT_SESSION)?.get_password() {
        Ok(blob) => blob,
        Err(Error::NoEntry) => return Ok(None),
        Err(e) => {
            return Err(AppError::Auth {
                message: format!("Failed to read session from secure storage: {}", e),
                recoverable: true,
            })
        }
    };

    match serde_json::from_str::<CognitoSession>(&blob) {
        Ok(session) => Ok(Some(session)),
        Err(_) => {
            // A corrupted blob is not a usable session; clear it so the
            // caller is asked to sign in again rather than resolving to a
            // session with garbage tokens.
            let _ = auth_entry(KEYRING_AUTH_ACCOUNT_SESSION)?.delete_credential();
            Err(AppError::Auth {
                message: "Stored session could not be read. Please sign in again.".to_string(),
                recoverable: true,
            })
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn clear_cognito_session_uncached() -> Result<(), AppError> {
    match auth_entry(KEYRING_AUTH_ACCOUNT_SESSION)?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Auth {
            message: format!("Failed to clear session from secure storage: {}", e),
            recoverable: false,
        }),
    }
}

#[cfg(target_os = "windows")]
fn store_cognito_session_uncached(session: &CognitoSession) -> Result<(), AppError> {
    let expires_at = session.expires_at.to_string();
    let fields = [
        (
            KEYRING_AUTH_ACCOUNT_ACCESS_TOKEN,
            session.access_token.as_str(),
        ),
        (KEYRING_AUTH_ACCOUNT_ID_TOKEN, session.id_token.as_str()),
        (
            KEYRING_AUTH_ACCOUNT_REFRESH_TOKEN,
            session.refresh_token.as_str(),
        ),
        (KEYRING_AUTH_ACCOUNT_EXPIRES_AT, expires_at.as_str()),
    ];

    for (field, value) in fields {
        if let Err(e) = write_field(field, value) {
            let _ = clear_all_session_fields();
            return Err(e);
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn load_cognito_session_uncached() -> Result<Option<CognitoSession>, AppError> {
    let access_token = read_field(KEYRING_AUTH_ACCOUNT_ACCESS_TOKEN)?;
    let id_token = read_field(KEYRING_AUTH_ACCOUNT_ID_TOKEN)?;
    let refresh_token = read_field(KEYRING_AUTH_ACCOUNT_REFRESH_TOKEN)?;
    let expires_at_raw = read_field(KEYRING_AUTH_ACCOUNT_EXPIRES_AT)?;

    // A prior storage design's leftovers or a corrupted partial write both
    // land here: some fields present, some absent. Neither is a usable
    // session, so every field is cleared and the caller is asked to sign in
    // again rather than risk resolving to a session with an empty token.
    let all_present = access_token.is_some()
        && id_token.is_some()
        && refresh_token.is_some()
        && expires_at_raw.is_some();
    let all_absent = access_token.is_none()
        && id_token.is_none()
        && refresh_token.is_none()
        && expires_at_raw.is_none();

    if all_absent {
        return Ok(None);
    }
    if !all_present {
        clear_all_session_fields()?;
        return Err(AppError::Auth {
            message: "Stored session could not be read. Please sign in again.".to_string(),
            recoverable: true,
        });
    }

    // Every value is `Some` here by the `all_present` check above, and the
    // expires_at digits were written by `store_cognito_session` itself.
    let expires_at = expires_at_raw
        .expect("checked present above")
        .parse::<i64>()
        .map_err(|_| AppError::Auth {
            message: "Stored session could not be read. Please sign in again.".to_string(),
            recoverable: true,
        })?;

    Ok(Some(CognitoSession {
        access_token: access_token.expect("checked present above"),
        id_token: id_token.expect("checked present above"),
        refresh_token: refresh_token.expect("checked present above"),
        expires_at,
    }))
}

#[cfg(target_os = "windows")]
fn clear_cognito_session_uncached() -> Result<(), AppError> {
    clear_all_session_fields()
}

// WHY an in-process cache in front of the keyring: `resolve_session()` is
// called independently by `get_auth_session` (once per launch) and by
// `current_subject()` (once per profile/TFSA command), with no shared state
// between them, so every one of those commands re-read the keychain from
// scratch. On macOS that is a fresh Keychain access check per call, not just
// per launch. `credentials.rs` is the sole accessor of the Cognito session
// (every mutation goes through `store_cognito_session`/
// `clear_cognito_session` below), so caching here keeps every reader and
// writer in sync without a TTL: the cache is authoritative until the next
// write.
static SESSION_CACHE: Mutex<Option<Option<CognitoSession>>> = Mutex::new(None);

fn cache_session(session: Option<CognitoSession>) {
    let mut cache = SESSION_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *cache = Some(session);
}

pub fn store_cognito_session(session: &CognitoSession) -> Result<(), AppError> {
    store_cognito_session_uncached(session)?;
    cache_session(Some(session.clone()));
    Ok(())
}

pub fn load_cognito_session() -> Result<Option<CognitoSession>, AppError> {
    {
        let cache = SESSION_CACHE
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(cached) = cache.as_ref() {
            return Ok(cached.clone());
        }
    }

    let session = load_cognito_session_uncached()?;
    cache_session(session.clone());
    Ok(session)
}

/// Clears the session, dropping the in-process cache whatever the keyring does,
/// and still reporting the keyring's own failure.
///
/// The ordering is load-bearing for security. `SESSION_CACHE` is authoritative for
/// every reader — `load_cognito_session` answers from it before touching the
/// keyring — so a delete that fails must not leave the outgoing session cached, or
/// `current_subject` and `get_auth_session` go on serving an account that has been
/// signed out or rolled back. Caching `None` is the fail-closed choice over merely
/// invalidating: an invalidated cache re-reads the keyring and resurrects the entry
/// the delete could not remove.
///
/// The error still propagates, so `sign_out` surfaces a keyring fault rather than
/// silently claiming success.
///
/// `delete` is injected because the mock keyring store cannot be made to fail a
/// deletion, and this ordering is only worth having if it is tested.
fn clear_session_and_cache(delete: impl FnOnce() -> Result<(), AppError>) -> Result<(), AppError> {
    let deleted = delete();
    cache_session(None);
    deleted
}

pub fn clear_cognito_session() -> Result<(), AppError> {
    clear_session_and_cache(clear_cognito_session_uncached)
}

// Test-only escape hatch: a few tests below write directly to the mock
// keyring (bypassing `store_cognito_session`) to simulate corruption that
// happened outside this process. Without this, the cache populated by
// `guard()`'s own `clear_cognito_session()` call would shadow that write.
#[cfg(test)]
fn reset_session_cache_for_test() {
    let mut cache = SESSION_CACHE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *cache = None;
}

/// Installs the process-global mock keyring store once and serializes every test
/// that touches it — `ai`'s per-profile isolation test included.
///
/// Shared rather than per-module on purpose: a second `set_default_store` call
/// would swap a *fresh* empty store in under an in-flight test in another thread,
/// so both the store installation and the exclusion have to be process-wide.
#[cfg(test)]
pub(crate) fn test_keyring_guard() -> std::sync::MutexGuard<'static, ()> {
    use std::sync::{Once, OnceLock};

    static STORE_INIT: Once = Once::new();
    static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    STORE_INIT.call_once(|| {
        keyring_core::set_default_store(keyring_core::mock::Store::new().unwrap());
    });

    TEST_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::MutexGuard;

    use crate::datasets::DEFAULT_DATASET_ID;

    const DATASET_A: &str = "local-1";
    const DATASET_B: &str = "local-2";

    fn guard() -> MutexGuard<'static, ()> {
        let g = test_keyring_guard();
        let _ = clear_cognito_session();
        for dataset_id in [DEFAULT_DATASET_ID, DATASET_A, DATASET_B] {
            // Also removes both per-entry layouts: the mock store is process-global,
            // so an entry seeded by one test would otherwise be migrated by the next.
            clear_credentials(dataset_id);
        }
        g
    }

    fn sample() -> CognitoSession {
        CognitoSession {
            access_token: "at".to_string(),
            id_token: "it".to_string(),
            refresh_token: "rt".to_string(),
            expires_at: 1_800_000_000,
        }
    }

    #[test]
    fn load_returns_none_when_nothing_stored() {
        let _g = guard();
        assert!(load_cognito_session().unwrap().is_none());
    }

    #[test]
    fn store_then_load_round_trips() {
        let _g = guard();
        store_cognito_session(&sample()).unwrap();

        let loaded = load_cognito_session().unwrap().expect("session stored");
        assert_eq!(loaded.access_token, "at");
        assert_eq!(loaded.id_token, "it");
        assert_eq!(loaded.refresh_token, "rt");
        assert_eq!(loaded.expires_at, 1_800_000_000);
    }

    #[test]
    fn store_twice_overwrites_in_place() {
        let _g = guard();
        store_cognito_session(&sample()).unwrap();

        let second = CognitoSession {
            access_token: "at2".to_string(),
            id_token: "it2".to_string(),
            refresh_token: "rt2".to_string(),
            expires_at: 1_900_000_000,
        };
        store_cognito_session(&second).unwrap();

        let loaded = load_cognito_session().unwrap().expect("session stored");
        assert_eq!(loaded.access_token, "at2");
        assert_eq!(loaded.expires_at, 1_900_000_000);
    }

    #[test]
    fn overwriting_with_a_shorter_multi_chunk_value_drops_the_stale_trailing_chunk() {
        let _g = guard();
        store_cognito_session(&CognitoSession {
            access_token: "a".repeat(6_000),
            id_token: "it".to_string(),
            refresh_token: "rt".to_string(),
            expires_at: 1_800_000_000,
        })
        .unwrap();

        let shorter = "short-token".to_string();
        store_cognito_session(&CognitoSession {
            access_token: shorter.clone(),
            id_token: "it".to_string(),
            refresh_token: "rt".to_string(),
            expires_at: 1_800_000_000,
        })
        .unwrap();

        let loaded = load_cognito_session().unwrap().expect("session stored");
        assert_eq!(loaded.access_token, shorter);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn load_with_a_partial_session_clears_it_and_returns_a_recoverable_auth_error() {
        let _g = guard();
        // Simulates a corrupted or half-written session: only one of the four
        // fields present.
        write_field(KEYRING_AUTH_ACCOUNT_ACCESS_TOKEN, "at").unwrap();
        reset_session_cache_for_test();

        match load_cognito_session() {
            Err(AppError::Auth {
                message,
                recoverable,
            }) => {
                assert!(recoverable);
                assert!(!message.contains("at"));
            }
            other => panic!("expected recoverable AppError::Auth, got {:?}", other),
        }

        // The partial remnant must not resurface on a later load.
        assert!(load_cognito_session().unwrap().is_none());
    }

    #[test]
    #[cfg(not(target_os = "windows"))]
    fn load_with_a_corrupted_blob_clears_it_and_returns_a_recoverable_auth_error() {
        let _g = guard();
        // Simulates a corrupted keychain entry: not valid session JSON.
        auth_entry(KEYRING_AUTH_ACCOUNT_SESSION)
            .unwrap()
            .set_password("not valid json")
            .unwrap();
        reset_session_cache_for_test();

        match load_cognito_session() {
            Err(AppError::Auth {
                message,
                recoverable,
            }) => {
                assert!(recoverable);
                assert!(!message.contains("not valid json"));
            }
            other => panic!("expected recoverable AppError::Auth, got {:?}", other),
        }

        // The corrupted entry must not resurface on a later load.
        assert!(load_cognito_session().unwrap().is_none());
    }

    /// Proves `load_cognito_session()` serves the in-process cache on repeat
    /// calls rather than re-reading the keyring every time: after the first
    /// load populates the cache, deleting the underlying entry out-of-band
    /// must not make a second load see it as absent.
    #[test]
    fn repeated_loads_serve_the_cache_instead_of_re_reading_the_keyring() {
        let _g = guard();
        store_cognito_session(&sample()).unwrap();

        let first = load_cognito_session().unwrap().expect("session stored");
        assert_eq!(first.access_token, "at");

        // Deletes the underlying entry directly, bypassing the cache. If the
        // second `load_cognito_session()` below re-read the keyring instead
        // of the cache, it would now see `None`.
        clear_cognito_session_uncached().unwrap();

        let second = load_cognito_session()
            .unwrap()
            .expect("cache still holds it");
        assert_eq!(second.access_token, "at");
    }

    #[test]
    fn a_token_larger_than_the_windows_credential_manager_limit_round_trips_via_chunking() {
        let _g = guard();
        // Larger than the real 2560 UTF-16 code unit Windows limit that this
        // chunking exists to stay under — proves a single oversized token (the
        // real-world failure was a Cognito refresh token) still round-trips.
        let large_token = "a".repeat(6_000);
        let session = CognitoSession {
            access_token: large_token.clone(),
            id_token: large_token.clone(),
            refresh_token: large_token.clone(),
            expires_at: 1_800_000_000,
        };

        store_cognito_session(&session).unwrap();

        let loaded = load_cognito_session().unwrap().expect("session stored");
        assert_eq!(loaded.access_token, large_token);
        assert_eq!(loaded.id_token, large_token);
        assert_eq!(loaded.refresh_token, large_token);
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn no_single_chunk_exceeds_the_configured_maximum() {
        let _g = guard();
        let large_token = "b".repeat(6_000);
        store_cognito_session(&CognitoSession {
            access_token: large_token,
            id_token: "it".to_string(),
            refresh_token: "rt".to_string(),
            expires_at: 1_800_000_000,
        })
        .unwrap();

        for index in 0..6 {
            let chunk = auth_entry(&chunk_account(KEYRING_AUTH_ACCOUNT_ACCESS_TOKEN, index))
                .unwrap()
                .get_password()
                .unwrap();
            assert!(chunk.chars().count() <= CHUNK_MAX_CHARS);
        }
    }

    /// The mock store used by every other test in this module has no size
    /// cap, so it cannot catch a `CHUNK_MAX_CHARS` regression toward the real
    /// Windows limit - this is exactly how the `2_000` value shipped in an
    /// earlier fix despite passing every round-trip test here. This test
    /// checks the real Win32 constraint directly: `set_password` UTF-16-encodes
    /// the string (2 bytes/ASCII char) before Windows compares it against
    /// `CRED_MAX_CREDENTIAL_BLOB_SIZE` (2560 bytes), so the chunk size must
    /// leave headroom under 2560 / 2 = 1280 chars, not just under 2560.
    #[test]
    #[cfg(target_os = "windows")]
    fn chunk_max_chars_stays_under_the_real_windows_utf16_byte_limit() {
        const CRED_MAX_CREDENTIAL_BLOB_SIZE_BYTES: usize = 2_560;
        let worst_case_utf16_bytes = CHUNK_MAX_CHARS * 2;
        assert!(worst_case_utf16_bytes <= CRED_MAX_CREDENTIAL_BLOB_SIZE_BYTES);
    }

    #[test]
    fn clear_is_idempotent_when_absent() {
        let _g = guard();
        assert!(clear_cognito_session().is_ok());
        assert!(clear_cognito_session().is_ok());
    }

    #[test]
    fn clear_removes_session() {
        let _g = guard();
        store_cognito_session(&sample()).unwrap();
        clear_cognito_session().unwrap();

        assert!(load_cognito_session().unwrap().is_none());
    }

    /// A keyring deletion that fails must still leave nothing usable in-process.
    ///
    /// `SESSION_CACHE` is what every reader consults first, so a failed delete that
    /// left it populated would keep `current_subject` and `get_auth_session`
    /// serving the account that was just signed out — or, on the callback's
    /// rollback path, the account whose dataset could not be activated.
    #[test]
    fn a_failed_keyring_delete_still_leaves_no_usable_session_and_reports_the_failure() {
        let _g = guard();
        store_cognito_session(&sample()).unwrap();
        assert!(
            load_cognito_session().unwrap().is_some(),
            "the fixture must start from a readable session, or this proves nothing"
        );

        let outcome = clear_session_and_cache(|| {
            Err(AppError::Auth {
                message: "the keyring refused the delete".to_string(),
                recoverable: false,
            })
        });

        // The keyring's own failure is still reported: `sign_out` has to be able to
        // tell the user the entry may survive, rather than claim success.
        match outcome {
            Err(AppError::Auth { message, .. }) => {
                assert_eq!(message, "the keyring refused the delete")
            }
            other => panic!("the delete failure must propagate, got {other:?}"),
        }

        // And nothing in-process can still serve it, even though the entry itself
        // was never removed.
        assert!(
            load_cognito_session().unwrap().is_none(),
            "a failed delete left the outgoing session readable"
        );
    }

    #[test]
    fn clear_cognito_session_leaves_ai_credentials_intact() {
        let _g = guard();
        store_aws_credentials(DEFAULT_DATASET_ID, "access", "secret", "ca-central-1").unwrap();
        store_openai_key(DEFAULT_DATASET_ID, "sk-test").unwrap();
        store_cognito_session(&sample()).unwrap();

        clear_cognito_session().unwrap();

        assert_eq!(
            load_aws_credentials(DEFAULT_DATASET_ID),
            Some((
                "access".to_string(),
                "secret".to_string(),
                "ca-central-1".to_string()
            ))
        );
        assert_eq!(
            load_openai_key(DEFAULT_DATASET_ID),
            Some("sk-test".to_string())
        );
        assert!(load_cognito_session().unwrap().is_none());
    }

    #[test]
    fn the_default_dataset_owns_the_bare_nixus_service_name() {
        assert_eq!(ai_service(DEFAULT_DATASET_ID), "nixus");
    }

    #[test]
    fn a_non_default_dataset_gets_its_own_suffixed_service_name() {
        assert_eq!(ai_service(DATASET_A), "nixus-local-1");
    }

    /// The legacy service is derived with the same suffixing rule as the live one, so a
    /// non-default profile's pre-rename keys are looked for where they were actually
    /// written rather than only under the bare legacy name.
    #[test]
    fn the_legacy_service_mirrors_the_live_suffixing_rule() {
        assert_eq!(legacy_ai_service(DEFAULT_DATASET_ID), "nkbaz-finance");
        assert_eq!(legacy_ai_service(DATASET_A), "nkbaz-finance-local-1");
    }

    /// Writes through raw `Entry` at the legacy service, never through `store_*`, so a
    /// change to the naming scheme cannot make the test agree with itself.
    fn seed_legacy(dataset_id: &str, values: &[(&str, &str)]) {
        let service = legacy_ai_service(dataset_id);
        for (name, value) in values {
            Entry::new(&service, name)
                .unwrap()
                .set_password(value)
                .unwrap();
        }
    }

    fn legacy_value(dataset_id: &str, name: &str) -> Option<String> {
        Entry::new(&legacy_ai_service(dataset_id), name)
            .ok()?
            .get_password()
            .ok()
    }

    /// The Nixus per-entry layout every build shipped before the single entry.
    fn seed_per_entry(dataset_id: &str, values: &[(&str, &str)]) {
        let service = ai_service(dataset_id);
        for (name, value) in values {
            Entry::new(&service, name)
                .unwrap()
                .set_password(value)
                .unwrap();
        }
    }

    fn per_entry_value(dataset_id: &str, name: &str) -> Option<String> {
        Entry::new(&ai_service(dataset_id), name)
            .ok()?
            .get_password()
            .ok()
    }

    fn arm_read_error(entry: &Entry, name: &str) {
        let cred: &keyring_core::mock::Cred = entry
            .as_any()
            .downcast_ref()
            .expect("the test store is the mock store");
        cred.set_error(Error::Invalid(
            name.to_string(),
            "the keyring is locked".to_string(),
        ));
    }

    /// The upgrade path: keys written by every pre-rename build must be readable through
    /// the ordinary dataset-aware readers after one launch, with no legacy entry left.
    #[test]
    fn every_legacy_credential_is_moved_to_the_nixus_service() {
        let _g = guard();
        seed_legacy(
            DEFAULT_DATASET_ID,
            &[
                ("openai_api_key", "sk-legacy"),
                ("aws_access_key_id", "legacy-access"),
                ("aws_secret_access_key", "legacy-secret"),
                ("aws_region", "us-east-1"),
            ],
        );
        assert_eq!(
            load_openai_key(DEFAULT_DATASET_ID),
            None,
            "the fixture must start unreadable through the live service"
        );

        let outcome = migrate_legacy_ai_credentials(&[DEFAULT_DATASET_ID.to_string()]);

        assert_eq!(outcome.moved, PER_ENTRY_FIELDS.len());
        assert_eq!(outcome.superseded, 0);
        assert!(outcome.failures.is_empty(), "{:?}", outcome.failures);
        assert_eq!(
            load_openai_key(DEFAULT_DATASET_ID),
            Some("sk-legacy".to_string())
        );
        assert_eq!(
            load_aws_credentials(DEFAULT_DATASET_ID),
            Some((
                "legacy-access".to_string(),
                "legacy-secret".to_string(),
                "us-east-1".to_string()
            ))
        );
        for (name, _) in PER_ENTRY_FIELDS {
            assert_eq!(
                legacy_value(DEFAULT_DATASET_ID, name),
                None,
                "{name} must not survive under the legacy service"
            );
        }
    }

    /// Each profile's keys live under its own suffixed service, so a migration that only
    /// handled Default would silently strip every other profile's provider key.
    #[test]
    fn each_profiles_legacy_credentials_land_in_that_profiles_own_service() {
        let _g = guard();
        seed_legacy(DATASET_A, &[("openai_api_key", "sk-a")]);
        seed_legacy(DATASET_B, &[("openai_api_key", "sk-b")]);

        let outcome =
            migrate_legacy_ai_credentials(&[DATASET_A.to_string(), DATASET_B.to_string()]);

        assert_eq!(outcome.moved, 2);
        assert_eq!(load_openai_key(DATASET_A), Some("sk-a".to_string()));
        assert_eq!(load_openai_key(DATASET_B), Some("sk-b".to_string()));
    }

    #[test]
    fn a_profile_with_no_legacy_credentials_migrates_nothing() {
        let _g = guard();

        let outcome =
            migrate_legacy_ai_credentials(&[DEFAULT_DATASET_ID.to_string(), DATASET_A.to_string()]);

        assert!(outcome.is_noop(), "{outcome:?}");
    }

    /// A populated destination always wins: it is never overwritten, and the legacy copy
    /// it supersedes is discarded so the pair converges on the first run.
    #[test]
    fn a_populated_destination_is_never_overwritten_by_a_legacy_credential() {
        let _g = guard();
        store_openai_key(DEFAULT_DATASET_ID, "sk-current").unwrap();
        seed_legacy(DEFAULT_DATASET_ID, &[("openai_api_key", "sk-legacy")]);

        let outcome = migrate_legacy_ai_credentials(&[DEFAULT_DATASET_ID.to_string()]);

        assert_eq!(outcome.moved, 0);
        assert_eq!(outcome.superseded, 1);
        assert!(outcome.failures.is_empty(), "{:?}", outcome.failures);
        assert_eq!(
            load_openai_key(DEFAULT_DATASET_ID),
            Some("sk-current".to_string()),
            "a legacy credential must never overwrite a newer Nixus one"
        );
        assert_eq!(
            legacy_value(DEFAULT_DATASET_ID, "openai_api_key"),
            None,
            "the superseded legacy copy must be removed, or the pair never converges"
        );
    }

    /// The convergence guarantee for the collision path specifically: a second launch
    /// must find nothing to do at all, rather than re-reporting the same collision
    /// forever, and must still leave the winning destination value intact.
    #[test]
    fn a_superseded_collision_converges_so_the_second_launch_is_a_true_no_op() {
        let _g = guard();
        store_openai_key(DEFAULT_DATASET_ID, "sk-current").unwrap();
        store_aws_credentials(DEFAULT_DATASET_ID, "access", "secret", "ca-central-1").unwrap();
        seed_legacy(
            DEFAULT_DATASET_ID,
            &[
                ("openai_api_key", "sk-legacy"),
                ("aws_access_key_id", "legacy-access"),
                ("aws_secret_access_key", "legacy-secret"),
                ("aws_region", "us-east-1"),
            ],
        );

        let first = migrate_legacy_ai_credentials(&[DEFAULT_DATASET_ID.to_string()]);
        assert_eq!(first.superseded, PER_ENTRY_FIELDS.len());
        assert_eq!(first.moved, 0);

        let second = migrate_legacy_ai_credentials(&[DEFAULT_DATASET_ID.to_string()]);

        assert!(
            second.is_noop(),
            "a converged pair must give a silent second launch, got {second:?}"
        );
        assert_eq!(
            load_openai_key(DEFAULT_DATASET_ID),
            Some("sk-current".to_string()),
            "the winning destination value must survive both runs"
        );
        assert_eq!(
            load_aws_credentials(DEFAULT_DATASET_ID),
            Some((
                "access".to_string(),
                "secret".to_string(),
                "ca-central-1".to_string()
            ))
        );
    }

    /// Mixed state, which is the realistic collision: the profile configured OpenAI after
    /// the rename but its AWS keys are still only under the legacy service. The one gets
    /// superseded, the other three get moved, and the next launch is silent.
    #[test]
    fn a_profile_with_one_colliding_and_three_absent_credentials_fully_converges() {
        let _g = guard();
        store_openai_key(DATASET_A, "sk-current").unwrap();
        seed_legacy(
            DATASET_A,
            &[
                ("openai_api_key", "sk-legacy"),
                ("aws_access_key_id", "legacy-access"),
                ("aws_secret_access_key", "legacy-secret"),
                ("aws_region", "us-east-1"),
            ],
        );

        let first = migrate_legacy_ai_credentials(&[DATASET_A.to_string()]);

        assert_eq!(first.superseded, 1);
        assert_eq!(first.moved, 3);
        assert_eq!(load_openai_key(DATASET_A), Some("sk-current".to_string()));
        assert_eq!(
            load_aws_credentials(DATASET_A),
            Some((
                "legacy-access".to_string(),
                "legacy-secret".to_string(),
                "us-east-1".to_string()
            ))
        );
        for (name, _) in PER_ENTRY_FIELDS {
            assert_eq!(
                legacy_value(DATASET_A, name),
                None,
                "{name} must not survive under the legacy service"
            );
        }

        assert!(
            migrate_legacy_ai_credentials(&[DATASET_A.to_string()]).is_noop(),
            "a fully converged profile must give a silent second launch"
        );
    }

    /// Partial configuration is the ordinary case: a profile that only ever set up OpenAI
    /// must not have its migration blocked by the three AWS names it never had.
    #[test]
    fn a_partially_configured_profile_migrates_only_what_exists() {
        let _g = guard();
        seed_legacy(DATASET_A, &[("openai_api_key", "sk-a")]);

        let outcome = migrate_legacy_ai_credentials(&[DATASET_A.to_string()]);

        assert_eq!(outcome.moved, 1);
        assert!(outcome.failures.is_empty(), "{:?}", outcome.failures);
        assert_eq!(load_openai_key(DATASET_A), Some("sk-a".to_string()));
        assert_eq!(load_aws_credentials(DATASET_A), None);
    }

    #[test]
    fn migrating_twice_is_a_no_op_the_second_time() {
        let _g = guard();
        seed_legacy(DATASET_A, &[("openai_api_key", "sk-a")]);

        let first = migrate_legacy_ai_credentials(&[DATASET_A.to_string()]);
        let second = migrate_legacy_ai_credentials(&[DATASET_A.to_string()]);

        assert_eq!(first.moved, 1);
        assert!(second.is_noop(), "{second:?}");
        assert_eq!(load_openai_key(DATASET_A), Some("sk-a".to_string()));
    }

    /// A write that cannot be verified must leave no trace, because the destination-wins
    /// branch treats any present destination value as authoritative — and then deletes
    /// the legacy original as a redundant duplicate. A wrong value left behind would
    /// therefore be promoted to the winner on the next launch and take the real
    /// credential with it.
    ///
    /// The read-back is injected because the mock store cannot be made to hand back a
    /// value different from the one just written; everything else here is the real mock
    /// keyring, and the "next run" half drives the actual production entry point.
    #[test]
    fn an_unverified_destination_write_is_rolled_back_so_it_cannot_become_the_winner() {
        let _g = guard();
        seed_legacy(DATASET_A, &[("openai_api_key", "sk-legacy")]);
        let destination = ai_entry(DATASET_A).unwrap();
        let blob = r#"{"openai_api_key":"sk-legacy"}"#;

        let error = store_verified_copy(&destination, blob, None, || {
            Ok(r#"{"openai_api_key":"sk-corrupted-by-the-backend"}"#.to_string())
        })
        .expect_err("a mismatched read-back must fail");

        assert!(
            !error.contains("sk-legacy") && !error.contains("sk-corrupted"),
            "a failure message must never carry a credential value: {error}"
        );
        assert_eq!(
            load_openai_key(DATASET_A),
            None,
            "the unverified write must be rolled back, not left for the next launch"
        );
        assert_eq!(
            legacy_value(DATASET_A, "openai_api_key"),
            Some("sk-legacy".to_string()),
            "the legacy source must survive a failed copy untouched"
        );

        // The next run must treat this as a fresh move from the surviving legacy source,
        // never as a destination that already won.
        let outcome = migrate_legacy_ai_credentials(&[DATASET_A.to_string()]);

        assert_eq!(outcome.moved, 1);
        assert_eq!(
            outcome.superseded, 0,
            "a rolled-back write must not be adopted as the destination-wins value"
        );
        assert_eq!(load_openai_key(DATASET_A), Some("sk-legacy".to_string()));
    }

    /// A read-back the keyring refuses is just as unverified as a mismatch: the write may
    /// or may not have landed, so it is rolled back on the same grounds.
    #[test]
    fn a_destination_write_whose_read_back_fails_is_also_rolled_back() {
        let _g = guard();
        seed_legacy(DATASET_A, &[("openai_api_key", "sk-legacy")]);
        let destination = ai_entry(DATASET_A).unwrap();
        let blob = r#"{"openai_api_key":"sk-legacy"}"#;

        let error = store_verified_copy(&destination, blob, None, || Err("locked".to_string()))
            .expect_err("an unreadable read-back must fail");

        assert!(
            error.contains("locked"),
            "the cause must be reported: {error}"
        );
        assert_eq!(load_openai_key(DATASET_A), None);
        assert_eq!(
            legacy_value(DATASET_A, "openai_api_key"),
            Some("sk-legacy".to_string())
        );
    }

    /// The success path of the same seam, so the rollback tests above cannot be passing
    /// because the function simply never keeps anything.
    #[test]
    fn a_verified_destination_write_is_kept() {
        let _g = guard();
        let destination = ai_entry(DATASET_A).unwrap();
        let blob = r#"{"openai_api_key":"sk-a"}"#;

        store_verified_copy(&destination, blob, None, || Ok(blob.to_string()))
            .expect("a matching read-back must succeed");

        assert_eq!(load_openai_key(DATASET_A), Some("sk-a".to_string()));
    }

    /// A keyring that refuses to answer must not cost the user their credential: the
    /// legacy entry stays exactly where it is, the launch is not blocked, and the whole
    /// move is retried next time.
    #[test]
    fn a_keyring_that_refuses_a_read_leaves_the_legacy_credential_in_place() {
        let _g = guard();
        seed_legacy(DATASET_A, &[("openai_api_key", "sk-a")]);

        arm_read_error(
            &Entry::new(&legacy_ai_service(DATASET_A), "openai_api_key").unwrap(),
            "openai_api_key",
        );

        let outcome = migrate_legacy_ai_credentials(&[DATASET_A.to_string()]);

        assert_eq!(outcome.moved, 0);
        assert_eq!(outcome.failures.len(), 1);
        assert!(
            !outcome.failures[0].contains("sk-a"),
            "a failure message must never carry the credential value: {}",
            outcome.failures[0]
        );
        assert_eq!(
            load_openai_key(DATASET_A),
            None,
            "a refused read must not have produced a destination entry"
        );

        // The retry on the next launch completes the move the fault interrupted.
        let retried = migrate_legacy_ai_credentials(&[DATASET_A.to_string()]);
        assert_eq!(retried.moved, 1);
        assert_eq!(load_openai_key(DATASET_A), Some("sk-a".to_string()));
    }

    /// The Cognito session is the machine's identity, not a profile's, and already lived
    /// under `nixus-auth` before this rename — an AI-credential migration must not touch it.
    #[test]
    fn migrating_ai_credentials_leaves_the_cognito_session_alone() {
        let _g = guard();
        store_cognito_session(&sample()).unwrap();
        seed_legacy(DEFAULT_DATASET_ID, &[("openai_api_key", "sk-legacy")]);

        migrate_legacy_ai_credentials(&[DEFAULT_DATASET_ID.to_string()]);

        let session = load_cognito_session()
            .unwrap()
            .expect("the migration must never sign the user out");
        assert_eq!(session.access_token, "at");
    }

    #[test]
    fn two_non_default_datasets_keep_separate_credentials() {
        let _g = guard();
        store_aws_credentials(DATASET_A, "access-a", "secret-a", "ca-central-1").unwrap();
        store_openai_key(DATASET_A, "sk-a").unwrap();
        store_aws_credentials(DATASET_B, "access-b", "secret-b", "us-east-1").unwrap();
        store_openai_key(DATASET_B, "sk-b").unwrap();

        assert_eq!(load_openai_key(DATASET_A), Some("sk-a".to_string()));
        assert_eq!(load_openai_key(DATASET_B), Some("sk-b".to_string()));
        assert_eq!(
            load_aws_credentials(DATASET_A),
            Some((
                "access-a".to_string(),
                "secret-a".to_string(),
                "ca-central-1".to_string()
            ))
        );

        clear_credentials(DATASET_A);

        assert_eq!(load_openai_key(DATASET_A), None);
        assert_eq!(load_aws_credentials(DATASET_A), None);
        assert_eq!(load_openai_key(DATASET_B), Some("sk-b".to_string()));
        assert_eq!(
            load_aws_credentials(DATASET_B),
            Some((
                "access-b".to_string(),
                "secret-b".to_string(),
                "us-east-1".to_string()
            ))
        );
    }

    #[test]
    fn copying_moves_every_configured_key_into_the_destinations_own_service() {
        let _g = guard();
        store_aws_credentials(DATASET_A, "access-a", "secret-a", "ca-central-1").unwrap();
        store_openai_key(DATASET_A, "sk-a").unwrap();

        let copied = copy_ai_credentials(DATASET_A, DATASET_B).expect("copy succeeds");

        assert_eq!(copied, PER_ENTRY_FIELDS.len());
        assert_eq!(load_openai_key(DATASET_B), Some("sk-a".to_string()));
        assert_eq!(
            load_aws_credentials(DATASET_B),
            Some((
                "access-a".to_string(),
                "secret-a".to_string(),
                "ca-central-1".to_string()
            ))
        );
        // The source is only ever read: a migration must leave it fully usable.
        assert_eq!(load_openai_key(DATASET_A), Some("sk-a".to_string()));
    }

    #[test]
    fn copying_a_partially_configured_profile_copies_only_what_exists() {
        let _g = guard();
        store_openai_key(DATASET_A, "sk-a").unwrap();

        let copied = copy_ai_credentials(DATASET_A, DATASET_B).expect("copy succeeds");

        assert_eq!(copied, 1);
        assert_eq!(load_openai_key(DATASET_B), Some("sk-a".to_string()));
        assert_eq!(load_aws_credentials(DATASET_B), None);
    }

    #[test]
    fn copying_a_profile_with_no_credentials_at_all_is_not_a_failure() {
        let _g = guard();

        assert_eq!(
            copy_ai_credentials(DATASET_A, DATASET_B).expect("copy succeeds"),
            0
        );
        assert_eq!(load_openai_key(DATASET_B), None);
    }

    /// A keyring that refuses to answer is not a profile with nothing configured,
    /// and a copy that could not tell them apart reported success while handing
    /// back an AI-keyless migrated profile.
    ///
    #[test]
    fn a_keyring_that_refuses_a_read_aborts_the_copy_instead_of_skipping_it() {
        let _g = guard();
        store_openai_key(DATASET_A, "sk-a").unwrap();
        arm_read_error(&ai_entry(DATASET_A).unwrap(), AI_CREDENTIALS_ACCOUNT);

        let error = copy_ai_credentials(DATASET_A, DATASET_B).expect_err("the copy must abort");

        assert!(matches!(error, AppError::File { .. }), "got {error:?}");
        assert_eq!(
            load_openai_key(DATASET_B),
            None,
            "an aborted copy must not leave a half-migrated key behind"
        );
    }

    /// The per-entry table is the migration's and the wipe's whole contract: a field
    /// missing from it is a key that silently fails to follow a migration. Listing
    /// every field in a struct literal makes adding one a compile error here, which
    /// is what forces the table to be revisited.
    #[test]
    fn every_field_has_a_per_entry_name() {
        let every_field = AiCredentials {
            aws_access_key_id: Some("aws_access_key_id".to_string()),
            aws_secret_access_key: Some("aws_secret_access_key".to_string()),
            aws_region: Some("aws_region".to_string()),
            openai_api_key: Some("openai_api_key".to_string()),
        };

        let mut filled = AiCredentials::default();
        for (name, slot) in PER_ENTRY_FIELDS {
            *slot(&mut filled) = Some(name.to_string());
        }

        assert_eq!(filled, every_field);
        assert_eq!(filled.configured_count(), PER_ENTRY_FIELDS.len());
    }

    #[test]
    fn clearing_removes_every_key_the_writers_can_store() {
        let _g = guard();
        store_aws_credentials(DATASET_A, "access-a", "secret-a", "ca-central-1").unwrap();
        store_openai_key(DATASET_A, "sk-a").unwrap();

        clear_credentials(DATASET_A);

        assert_eq!(load_aws_credentials(DATASET_A), None);
        assert_eq!(load_openai_key(DATASET_A), None);
    }

    /// One keychain item per profile is the point of the layout: every extra item
    /// is another macOS access prompt.
    #[test]
    fn every_ai_credential_of_a_profile_lives_in_one_keyring_entry() {
        let _g = guard();
        store_aws_credentials(DATASET_A, "access-a", "secret-a", "ca-central-1").unwrap();
        store_openai_key(DATASET_A, "sk-a").unwrap();

        for (name, _) in PER_ENTRY_FIELDS {
            assert_eq!(
                per_entry_value(DATASET_A, name),
                None,
                "{name} got its own entry"
            );
        }
        let stored = read_ai_credentials(&ai_entry(DATASET_A).unwrap())
            .unwrap()
            .expect("the single entry exists");
        assert_eq!(stored.configured_count(), PER_ENTRY_FIELDS.len());
    }

    /// Saving is a read-modify-write: configuring one provider must not erase the other.
    #[test]
    fn saving_one_provider_keeps_the_others_keys() {
        let _g = guard();
        store_openai_key(DATASET_A, "sk-a").unwrap();
        store_aws_credentials(DATASET_A, "access-a", "secret-a", "ca-central-1").unwrap();
        store_openai_key(DATASET_A, "sk-a2").unwrap();

        assert_eq!(load_openai_key(DATASET_A), Some("sk-a2".to_string()));
        assert_eq!(
            load_aws_credentials(DATASET_A),
            Some((
                "access-a".to_string(),
                "secret-a".to_string(),
                "ca-central-1".to_string()
            ))
        );
    }

    /// A save the keyring would not let us read first must not overwrite the entry:
    /// doing so would silently drop the other provider's keys.
    #[test]
    fn a_save_whose_read_is_refused_fails_instead_of_overwriting() {
        let _g = guard();
        store_aws_credentials(DATASET_A, "access-a", "secret-a", "ca-central-1").unwrap();
        arm_read_error(&ai_entry(DATASET_A).unwrap(), AI_CREDENTIALS_ACCOUNT);

        assert!(store_openai_key(DATASET_A, "sk-a").is_err());
        assert!(load_aws_credentials(DATASET_A).is_some());
    }

    /// Nothing in an undecodable entry is usable, so it reads as unconfigured and the
    /// next save replaces it rather than leaving the user unable to reconfigure AI.
    #[test]
    fn a_corrupted_entry_reads_as_unconfigured_and_the_next_save_replaces_it() {
        let _g = guard();
        ai_entry(DATASET_A)
            .unwrap()
            .set_password("not valid json")
            .unwrap();

        assert_eq!(load_openai_key(DATASET_A), None);
        assert!(copy_ai_credentials(DATASET_A, DATASET_B).is_err());

        store_openai_key(DATASET_A, "sk-a").unwrap();
        assert_eq!(load_openai_key(DATASET_A), Some("sk-a".to_string()));
    }

    /// Windows Credential Manager caps one credential at 2560 bytes of UTF-16 (1280
    /// chars), which is why the Cognito session is chunked there. The AI entry is
    /// not, so a realistically oversized one must stay well under that ceiling.
    #[test]
    fn a_fully_configured_entry_fits_in_one_windows_credential() {
        let generous = AiCredentials {
            aws_access_key_id: Some("A".repeat(128)),
            aws_secret_access_key: Some("s".repeat(128)),
            aws_region: Some("ap-southeast-5".to_string()),
            openai_api_key: Some("k".repeat(400)),
        };

        let blob = encode_ai_credentials(&generous).unwrap();

        assert!(blob.encode_utf16().count() <= 1_000, "{} chars", blob.len());
    }

    /// The layout every Nixus build shipped before the single entry: one item per key
    /// under the Nixus service. An upgrade folds them in and leaves none behind.
    #[test]
    fn nixus_per_entry_credentials_are_folded_into_the_single_entry() {
        let _g = guard();
        seed_per_entry(
            DATASET_A,
            &[
                ("openai_api_key", "sk-a"),
                ("aws_access_key_id", "access-a"),
                ("aws_secret_access_key", "secret-a"),
                ("aws_region", "ca-central-1"),
            ],
        );

        let outcome = migrate_legacy_ai_credentials(&[DATASET_A.to_string()]);

        assert_eq!(outcome.moved, PER_ENTRY_FIELDS.len());
        assert!(outcome.failures.is_empty(), "{:?}", outcome.failures);
        assert_eq!(load_openai_key(DATASET_A), Some("sk-a".to_string()));
        assert_eq!(
            load_aws_credentials(DATASET_A),
            Some((
                "access-a".to_string(),
                "secret-a".to_string(),
                "ca-central-1".to_string()
            ))
        );
        for (name, _) in PER_ENTRY_FIELDS {
            assert_eq!(per_entry_value(DATASET_A, name), None, "{name} survived");
        }
        assert!(migrate_legacy_ai_credentials(&[DATASET_A.to_string()]).is_noop());
    }

    /// An install that went through the rename while still on the per-entry layout can
    /// hold both: the Nixus per-entry value is the newer one and must be the one kept.
    #[test]
    fn a_nixus_per_entry_value_wins_over_its_pre_rename_twin() {
        let _g = guard();
        seed_per_entry(DATASET_A, &[("openai_api_key", "sk-new")]);
        seed_legacy(DATASET_A, &[("openai_api_key", "sk-old")]);

        let outcome = migrate_legacy_ai_credentials(&[DATASET_A.to_string()]);

        assert_eq!(outcome.moved, 1);
        assert_eq!(outcome.superseded, 1);
        assert_eq!(load_openai_key(DATASET_A), Some("sk-new".to_string()));
        assert_eq!(per_entry_value(DATASET_A, "openai_api_key"), None);
        assert_eq!(legacy_value(DATASET_A, "openai_api_key"), None);
    }

    /// A destination the keyring refuses to show may hold newer values for every
    /// field, so it is never written over and no source is deleted.
    #[test]
    fn a_destination_the_keyring_refuses_to_read_is_left_alone() {
        let _g = guard();
        store_openai_key(DATASET_A, "sk-current").unwrap();
        seed_per_entry(DATASET_A, &[("aws_region", "us-east-1")]);
        arm_read_error(&ai_entry(DATASET_A).unwrap(), AI_CREDENTIALS_ACCOUNT);

        let outcome = migrate_legacy_ai_credentials(&[DATASET_A.to_string()]);

        assert_eq!(outcome.moved, 0);
        assert_eq!(outcome.failures.len(), 1);
        assert_eq!(load_openai_key(DATASET_A), Some("sk-current".to_string()));
        assert_eq!(
            per_entry_value(DATASET_A, "aws_region"),
            Some("us-east-1".to_string())
        );
    }

    /// An interrupted migration can leave a per-entry key behind; a wipe must not let
    /// it resurface through the next launch's migration.
    #[test]
    fn clearing_also_removes_leftover_per_entry_keys_of_both_layouts() {
        let _g = guard();
        seed_per_entry(DATASET_A, &[("openai_api_key", "sk-a")]);
        seed_legacy(DATASET_A, &[("aws_region", "us-east-1")]);

        clear_credentials(DATASET_A);

        assert!(migrate_legacy_ai_credentials(&[DATASET_A.to_string()]).is_noop());
        assert_eq!(load_openai_key(DATASET_A), None);
    }

    #[test]
    fn a_non_default_dataset_never_sees_or_clears_defaults_credentials() {
        let _g = guard();
        store_openai_key(DEFAULT_DATASET_ID, "sk-default").unwrap();

        assert_eq!(load_openai_key(DATASET_A), None);

        store_openai_key(DATASET_A, "sk-a").unwrap();
        clear_credentials(DATASET_A);

        assert_eq!(
            load_openai_key(DEFAULT_DATASET_ID),
            Some("sk-default".to_string())
        );
    }

    /// The wipe a profile deletion performs, from the other side of
    /// `clear_cognito_session_leaves_ai_credentials_intact` above: the Cognito
    /// session lives under `nixus-auth`, which is the machine's identity rather
    /// than any profile's (AD-10), so removing a profile must leave the user
    /// signed in. Every sibling profile's own keys have to survive too — the whole
    /// point of the per-dataset service suffix.
    #[test]
    fn clearing_one_datasets_credentials_leaves_every_sibling_and_the_session_intact() {
        let _g = guard();
        store_cognito_session(&sample()).unwrap();
        store_aws_credentials(DATASET_A, "access-a", "secret-a", "ca-central-1").unwrap();
        store_openai_key(DATASET_A, "sk-a").unwrap();
        store_aws_credentials(DATASET_B, "access-b", "secret-b", "us-east-1").unwrap();
        store_openai_key(DATASET_B, "sk-b").unwrap();
        store_openai_key(DEFAULT_DATASET_ID, "sk-default").unwrap();

        clear_credentials(DATASET_A);

        assert_eq!(load_openai_key(DATASET_A), None);
        assert_eq!(load_aws_credentials(DATASET_A), None);

        assert_eq!(load_openai_key(DATASET_B), Some("sk-b".to_string()));
        assert_eq!(
            load_aws_credentials(DATASET_B),
            Some((
                "access-b".to_string(),
                "secret-b".to_string(),
                "us-east-1".to_string()
            ))
        );
        assert_eq!(
            load_openai_key(DEFAULT_DATASET_ID),
            Some("sk-default".to_string()),
            "Default's keys live under the unsuffixed service and must survive"
        );

        let session = load_cognito_session()
            .unwrap()
            .expect("deleting a profile must never sign the user out");
        assert_eq!(session.access_token, "at");
        assert_eq!(session.refresh_token, "rt");
    }

    /// A profile that never configured a provider is the ordinary case, and the
    /// deletion path calls this unconditionally, so it must not be a failure —
    /// and a retry after a partially-completed deletion calls it a second time.
    #[test]
    fn clearing_is_idempotent_and_silent_when_a_dataset_has_no_credentials() {
        let _g = guard();
        store_openai_key(DATASET_B, "sk-b").unwrap();

        clear_credentials(DATASET_A);
        clear_credentials(DATASET_A);

        assert_eq!(load_openai_key(DATASET_A), None);
        assert_eq!(
            load_openai_key(DATASET_B),
            Some("sk-b".to_string()),
            "a no-op wipe must not reach a sibling"
        );
    }
}
