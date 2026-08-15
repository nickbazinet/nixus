use keyring_core::{Entry, Error};

use crate::error::AppError;
use crate::models::CognitoSession;

const KEYRING_SERVICE: &str = "nkbaz-finance";
const KEYRING_AUTH_SERVICE: &str = "nixus-auth";

// WHY four entries instead of one combined JSON blob (the original design):
// Windows Credential Manager caps a single generic credential's password blob
// at 2560 UTF-16 code units. A combined `{access_token, id_token,
// refresh_token, expires_at}` JSON blob for a Cognito session routinely
// exceeds that (three JWTs plus JSON punctuation), so `store_cognito_session`
// failed on every real Windows login with "Value of 'password encoded as
// UTF-16' is longer than the platform limit of 2560 chars" while working
// fine on macOS Keychain, which has no such limit. Splitting into one entry
// per field keeps each individual blob (a single JWT, or a short integer)
// well under the Windows limit. macOS/Linux are unaffected either way.
const KEYRING_AUTH_ACCOUNT_ACCESS_TOKEN: &str = "cognito-session-access-token";
const KEYRING_AUTH_ACCOUNT_ID_TOKEN: &str = "cognito-session-id-token";
const KEYRING_AUTH_ACCOUNT_REFRESH_TOKEN: &str = "cognito-session-refresh-token";
const KEYRING_AUTH_ACCOUNT_EXPIRES_AT: &str = "cognito-session-expires-at";

const COGNITO_SESSION_ACCOUNTS: [&str; 4] = [
    KEYRING_AUTH_ACCOUNT_ACCESS_TOKEN,
    KEYRING_AUTH_ACCOUNT_ID_TOKEN,
    KEYRING_AUTH_ACCOUNT_REFRESH_TOKEN,
    KEYRING_AUTH_ACCOUNT_EXPIRES_AT,
];

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

/// Best-effort delete of every session account, ignoring `NoEntry`. Used both
/// by `clear_cognito_session` and as store-failure/load-corruption cleanup so
/// a partial write or a partial read never leaves stale fields behind.
fn clear_all_session_accounts() -> Result<(), AppError> {
    let mut first_error = None;
    for account in COGNITO_SESSION_ACCOUNTS {
        match auth_entry(account)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => {}
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

pub fn store_cognito_session(session: &CognitoSession) -> Result<(), AppError> {
    let fields = [
        (KEYRING_AUTH_ACCOUNT_ACCESS_TOKEN, session.access_token.as_str()),
        (KEYRING_AUTH_ACCOUNT_ID_TOKEN, session.id_token.as_str()),
        (KEYRING_AUTH_ACCOUNT_REFRESH_TOKEN, session.refresh_token.as_str()),
    ];
    let expires_at = session.expires_at.to_string();

    for (account, value) in fields {
        if let Err(e) = auth_entry(account)?.set_password(value) {
            let _ = clear_all_session_accounts();
            return Err(AppError::Auth {
                message: format!("Failed to save session to secure storage: {}", e),
                recoverable: false,
            });
        }
    }
    if let Err(e) = auth_entry(KEYRING_AUTH_ACCOUNT_EXPIRES_AT)?.set_password(&expires_at) {
        let _ = clear_all_session_accounts();
        return Err(AppError::Auth {
            message: format!("Failed to save session to secure storage: {}", e),
            recoverable: false,
        });
    }

    Ok(())
}

pub fn load_cognito_session() -> Result<Option<CognitoSession>, AppError> {
    let read = |account: &str| match auth_entry(account)?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Auth {
            message: format!("Failed to read session from secure storage: {}", e),
            recoverable: true,
        }),
    };

    let access_token = read(KEYRING_AUTH_ACCOUNT_ACCESS_TOKEN)?;
    let id_token = read(KEYRING_AUTH_ACCOUNT_ID_TOKEN)?;
    let refresh_token = read(KEYRING_AUTH_ACCOUNT_REFRESH_TOKEN)?;
    let expires_at_raw = read(KEYRING_AUTH_ACCOUNT_EXPIRES_AT)?;

    // A prior single-blob session (pre-fix) or a corrupted partial write both
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
        clear_all_session_accounts()?;
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

pub fn clear_cognito_session() -> Result<(), AppError> {
    clear_all_session_accounts()
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
    fn load_with_a_partial_session_clears_it_and_returns_a_recoverable_auth_error() {
        let _g = guard();
        // Simulates a corrupted or half-written session: only one of the four
        // accounts present. No single-blob JSON exists to malform anymore, so
        // this is the realistic corruption shape under the split-entry design.
        auth_entry(KEYRING_AUTH_ACCOUNT_ACCESS_TOKEN)
            .unwrap()
            .set_password("at")
            .unwrap();

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
    fn store_rejects_no_single_field_over_the_windows_credential_manager_limit() {
        let _g = guard();
        // Windows Credential Manager's real limit is 2560 UTF-16 code units per
        // credential; the mock store has no such cap, so this exercises the
        // split-entry design's intent (each field stored and read back
        // independently) rather than the platform limit itself.
        let large_token = "a".repeat(3_000);
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
