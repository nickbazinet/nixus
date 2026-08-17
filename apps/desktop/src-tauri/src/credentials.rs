use std::sync::Mutex;

use keyring_core::{Entry, Error};

use crate::error::AppError;
use crate::models::CognitoSession;

const KEYRING_SERVICE: &str = "nkbaz-finance";
const KEYRING_AUTH_SERVICE: &str = "nixus-auth";

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
    access_key: &str,
    secret_key: &str,
    region: &str,
) -> Result<(), Error> {
    Entry::new(KEYRING_SERVICE, "aws_access_key_id")?.set_password(access_key)?;
    Entry::new(KEYRING_SERVICE, "aws_secret_access_key")?.set_password(secret_key)?;
    Entry::new(KEYRING_SERVICE, "aws_region")?.set_password(region)?;
    Ok(())
}

pub fn load_aws_credentials() -> Option<(String, String, String)> {
    let access_key = Entry::new(KEYRING_SERVICE, "aws_access_key_id")
        .ok()?
        .get_password()
        .ok()?;
    let secret_key = Entry::new(KEYRING_SERVICE, "aws_secret_access_key")
        .ok()?
        .get_password()
        .ok()?;
    let region = Entry::new(KEYRING_SERVICE, "aws_region")
        .ok()?
        .get_password()
        .ok()?;
    Some((access_key, secret_key, region))
}

pub fn store_openai_key(api_key: &str) -> Result<(), Error> {
    Entry::new(KEYRING_SERVICE, "openai_api_key")?.set_password(api_key)?;
    Ok(())
}

pub fn load_openai_key() -> Option<String> {
    Entry::new(KEYRING_SERVICE, "openai_api_key")
        .ok()?
        .get_password()
        .ok()
}

pub fn clear_credentials() {
    let names = [
        "aws_access_key_id",
        "aws_secret_access_key",
        "aws_region",
        "openai_api_key",
    ];
    for name in &names {
        if let Ok(entry) = Entry::new(KEYRING_SERVICE, name) {
            let _ = entry.delete_credential();
        }
    }
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

pub fn clear_cognito_session() -> Result<(), AppError> {
    clear_cognito_session_uncached()?;
    cache_session(None);
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, MutexGuard, Once, OnceLock};

    static STORE_INIT: Once = Once::new();
    static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    // Serializes tests: the mock store is process-global and every test targets the same fixed
    // keyring entry, so concurrent tests would clobber each other.
    fn guard() -> MutexGuard<'static, ()> {
        STORE_INIT.call_once(|| {
            keyring_core::set_default_store(keyring_core::mock::Store::new().unwrap());
        });
        let lock = TEST_LOCK.get_or_init(|| Mutex::new(()));
        let g = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let _ = clear_cognito_session();
        clear_credentials();
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

    #[test]
    fn clear_cognito_session_leaves_ai_credentials_intact() {
        let _g = guard();
        store_aws_credentials("access", "secret", "ca-central-1").unwrap();
        store_openai_key("sk-test").unwrap();
        store_cognito_session(&sample()).unwrap();

        clear_cognito_session().unwrap();

        assert_eq!(
            load_aws_credentials(),
            Some((
                "access".to_string(),
                "secret".to_string(),
                "ca-central-1".to_string()
            ))
        );
        assert_eq!(load_openai_key(), Some("sk-test".to_string()));
        assert!(load_cognito_session().unwrap().is_none());
    }
}
