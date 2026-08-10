use keyring_core::{Entry, Error};

use crate::error::AppError;
use crate::models::CognitoSession;

const KEYRING_SERVICE: &str = "nkbaz-finance";
const KEYRING_AUTH_SERVICE: &str = "nixus-auth";
const KEYRING_AUTH_ACCOUNT: &str = "cognito-session";

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

fn auth_entry() -> Result<Entry, AppError> {
    Entry::new(KEYRING_AUTH_SERVICE, KEYRING_AUTH_ACCOUNT).map_err(|e| AppError::Auth {
        message: format!("Secure storage is unavailable: {}", e),
        recoverable: false,
    })
}

// WHY: no caller until commands/auth.rs lands in Stories 26.4/26.5. Remove the allow then.
#[allow(dead_code)]
pub fn store_cognito_session(session: &CognitoSession) -> Result<(), AppError> {
    let json = serde_json::to_string(session).map_err(|_| AppError::Auth {
        message: "Failed to encode session for secure storage.".to_string(),
        recoverable: false,
    })?;
    auth_entry()?
        .set_password(&json)
        .map_err(|e| AppError::Auth {
            message: format!("Failed to save session to secure storage: {}", e),
            recoverable: false,
        })
}

// WHY: no caller until commands/auth.rs lands in Stories 26.4/26.5. Remove the allow then.
#[allow(dead_code)]
pub fn load_cognito_session() -> Result<Option<CognitoSession>, AppError> {
    let json = match auth_entry()?.get_password() {
        Ok(json) => json,
        Err(Error::NoEntry) => return Ok(None),
        Err(e) => {
            return Err(AppError::Auth {
                message: format!("Failed to read session from secure storage: {}", e),
                recoverable: true,
            })
        }
    };

    // The blob and the serde error are deliberately never interpolated: the blob holds tokens.
    serde_json::from_str::<CognitoSession>(&json)
        .map(Some)
        .map_err(|_| AppError::Auth {
            message: "Stored session could not be read. Please sign in again.".to_string(),
            recoverable: true,
        })
}

// WHY: no caller until commands/auth.rs lands in Stories 26.4/26.5. Remove the allow then.
#[allow(dead_code)]
pub fn clear_cognito_session() -> Result<(), AppError> {
    match auth_entry()?.delete_credential() {
        Ok(()) | Err(Error::NoEntry) => Ok(()),
        Err(e) => Err(AppError::Auth {
            message: format!("Failed to clear session from secure storage: {}", e),
            recoverable: false,
        }),
    }
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
    fn load_malformed_json_returns_recoverable_auth_error() {
        let _g = guard();
        Entry::new(KEYRING_AUTH_SERVICE, KEYRING_AUTH_ACCOUNT)
            .unwrap()
            .set_password("not-json-at-all")
            .unwrap();

        match load_cognito_session() {
            Err(AppError::Auth {
                message,
                recoverable,
            }) => {
                assert!(recoverable);
                assert!(!message.contains("not-json-at-all"));
            }
            other => panic!("expected recoverable AppError::Auth, got {:?}", other),
        }
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
