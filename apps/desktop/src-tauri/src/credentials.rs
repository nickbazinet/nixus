use std::sync::Mutex;

use keyring_core::{Entry, Error};

use crate::error::AppError;
use crate::models::CognitoSession;

const KEYRING_SERVICE: &str = "nkbaz-finance";
const KEYRING_AUTH_SERVICE: &str = "nixus-auth";

/// Keyring service owning `dataset_id`'s AI-provider credentials (Story 34.2).
///
/// Default keeps the bare `KEYRING_SERVICE` literal byte-for-byte so every
/// entry written before datasets existed keeps loading with no migration; every
/// other dataset gets its own suffixed service, which is what keeps one
/// profile's provider key out of another's.
///
/// Deliberately *not* applied to `KEYRING_AUTH_SERVICE`: the Cognito session is
/// the machine's identity, not a profile's, and stays dataset-independent.
fn ai_service(dataset_id: &str) -> String {
    if dataset_id == crate::datasets::DEFAULT_DATASET_ID {
        KEYRING_SERVICE.to_string()
    } else {
        format!("{KEYRING_SERVICE}-{dataset_id}")
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

pub fn store_aws_credentials(
    dataset_id: &str,
    access_key: &str,
    secret_key: &str,
    region: &str,
) -> Result<(), Error> {
    let service = ai_service(dataset_id);
    Entry::new(&service, "aws_access_key_id")?.set_password(access_key)?;
    Entry::new(&service, "aws_secret_access_key")?.set_password(secret_key)?;
    Entry::new(&service, "aws_region")?.set_password(region)?;
    Ok(())
}

pub fn load_aws_credentials(dataset_id: &str) -> Option<(String, String, String)> {
    let service = ai_service(dataset_id);
    let access_key = Entry::new(&service, "aws_access_key_id")
        .ok()?
        .get_password()
        .ok()?;
    let secret_key = Entry::new(&service, "aws_secret_access_key")
        .ok()?
        .get_password()
        .ok()?;
    let region = Entry::new(&service, "aws_region")
        .ok()?
        .get_password()
        .ok()?;
    Some((access_key, secret_key, region))
}

pub fn store_openai_key(dataset_id: &str, api_key: &str) -> Result<(), Error> {
    Entry::new(&ai_service(dataset_id), "openai_api_key")?.set_password(api_key)?;
    Ok(())
}

pub fn load_openai_key(dataset_id: &str) -> Option<String> {
    Entry::new(&ai_service(dataset_id), "openai_api_key")
        .ok()?
        .get_password()
        .ok()
}

/// Every per-dataset AI-provider credential name, enumerated because a keyring
/// cannot be listed at runtime: `clear_credentials` and `copy_ai_credentials`
/// both have to know the whole set, and a name missing here is a key that
/// silently survives a wipe or fails to follow a migration (AD-12).
const AI_CREDENTIAL_NAMES: [&str; 4] = [
    "aws_access_key_id",
    "aws_secret_access_key",
    "aws_region",
    "openai_api_key",
];

pub fn clear_credentials(dataset_id: &str) {
    let service = ai_service(dataset_id);
    for name in AI_CREDENTIAL_NAMES {
        if let Ok(entry) = Entry::new(&service, name) {
            let _ = entry.delete_credential();
        }
    }
}

/// Copies every AI-provider credential `source_dataset_id` holds into
/// `destination_dataset_id`'s own service (Story 35.3's Migrate branch).
///
/// Lives here because `credentials.rs` is the sole caller of `keyring_core::Entry`
/// — a copy loop anywhere else would be a second accessor. A credential the
/// source simply does not have is skipped, which is the normal case for a profile
/// that only ever configured one provider; every other failure — a read the
/// keyring refused as much as a write it rejected — is fatal, because silently
/// dropping a key would leave the migrated profile unable to reach the AI it was
/// configured for with nothing anywhere reporting why.
///
/// Returns how many entries were copied, which is what the caller logs.
pub fn copy_ai_credentials(
    source_dataset_id: &str,
    destination_dataset_id: &str,
) -> Result<usize, AppError> {
    let source = ai_service(source_dataset_id);
    let destination = ai_service(destination_dataset_id);
    let mut copied = 0;

    for name in AI_CREDENTIAL_NAMES {
        let value = match Entry::new(&source, name).and_then(|entry| entry.get_password()) {
            Ok(value) => value,
            // Genuinely absent: skipped, and the destination is left without it.
            Err(Error::NoEntry) => continue,
            // Anything else is the keyring declining to answer — a locked
            // keychain, a denied access prompt, an unusable store. Skipping it
            // would be indistinguishable from absence, which is how a migration
            // reports success and still hands back an AI-keyless profile.
            Err(e) => {
                return Err(AppError::File {
                    message: format!("Failed to read the AI credentials to copy: {}", e),
                })
            }
        };

        Entry::new(&destination, name)
            .and_then(|entry| entry.set_password(&value))
            .map_err(|e| AppError::File {
                message: format!("Failed to copy AI credentials: {}", e),
            })?;
        copied += 1;
    }

    Ok(copied)
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
        (KEYRING_AUTH_ACCOUNT_ACCESS_TOKEN, session.access_token.as_str()),
        (KEYRING_AUTH_ACCOUNT_ID_TOKEN, session.id_token.as_str()),
        (KEYRING_AUTH_ACCOUNT_REFRESH_TOKEN, session.refresh_token.as_str()),
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
    let mut cache = SESSION_CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    *cache = Some(session);
}

pub fn store_cognito_session(session: &CognitoSession) -> Result<(), AppError> {
    store_cognito_session_uncached(session)?;
    cache_session(Some(session.clone()));
    Ok(())
}

pub fn load_cognito_session() -> Result<Option<CognitoSession>, AppError> {
    {
        let cache = SESSION_CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
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
    let mut cache = SESSION_CACHE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
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

        let second = load_cognito_session().unwrap().expect("cache still holds it");
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

    /// The zero-migration guarantee: Default's service name is the exact literal
    /// every pre-dataset build wrote under, so entries already in a user's
    /// keychain must still load through the dataset-aware readers. Asserted
    /// against a raw `Entry` write rather than through `store_*` so a change to
    /// the naming scheme cannot make the test agree with itself.
    #[test]
    fn the_default_dataset_reads_the_pre_dataset_service_name_unchanged() {
        let _g = guard();
        assert_eq!(ai_service(DEFAULT_DATASET_ID), "nkbaz-finance");

        Entry::new("nkbaz-finance", "openai_api_key")
            .unwrap()
            .set_password("sk-legacy")
            .unwrap();
        Entry::new("nkbaz-finance", "aws_access_key_id")
            .unwrap()
            .set_password("legacy-access")
            .unwrap();
        Entry::new("nkbaz-finance", "aws_secret_access_key")
            .unwrap()
            .set_password("legacy-secret")
            .unwrap();
        Entry::new("nkbaz-finance", "aws_region")
            .unwrap()
            .set_password("us-east-1")
            .unwrap();

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
    }

    #[test]
    fn a_non_default_dataset_gets_its_own_suffixed_service_name() {
        assert_eq!(ai_service(DATASET_A), "nkbaz-finance-local-1");
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

        assert_eq!(copied, AI_CREDENTIAL_NAMES.len());
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
    /// The mock's injected error is consumed by the first call that hits it, which
    /// is why the key with the error armed is the last name in the loop: the three
    /// before it are genuinely absent, so this asserts the abort came from the
    /// fault and not from the absence.
    #[test]
    fn a_keyring_that_refuses_a_read_aborts_the_copy_instead_of_skipping_it() {
        let _g = guard();
        store_openai_key(DATASET_A, "sk-a").unwrap();

        let entry = Entry::new(&ai_service(DATASET_A), "openai_api_key").unwrap();
        let cred: &keyring_core::mock::Cred = entry
            .as_any()
            .downcast_ref()
            .expect("the test store is the mock store");
        cred.set_error(Error::Invalid(
            "openai_api_key".to_string(),
            "the keyring is locked".to_string(),
        ));

        let error = copy_ai_credentials(DATASET_A, DATASET_B).expect_err("the copy must abort");

        assert!(matches!(error, AppError::File { .. }), "got {error:?}");
        assert_eq!(
            load_openai_key(DATASET_B),
            None,
            "an aborted copy must not leave a half-migrated key behind"
        );
    }

    /// The enumerated list is the whole contract: a name missing from it is a key
    /// that silently fails to follow a migration and one a wipe leaves behind.
    #[test]
    fn the_enumerated_names_cover_every_key_the_writers_can_store() {
        let _g = guard();
        store_aws_credentials(DATASET_A, "access-a", "secret-a", "ca-central-1").unwrap();
        store_openai_key(DATASET_A, "sk-a").unwrap();

        clear_credentials(DATASET_A);

        assert_eq!(load_aws_credentials(DATASET_A), None);
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
