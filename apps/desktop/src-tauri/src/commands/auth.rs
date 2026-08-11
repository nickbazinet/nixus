// Non-secret Cognito configuration, provisioned out-of-band in the AWS Console
// (see CONTRIBUTING.md § Account sign-in (Cognito)). These values are public by
// design: the client id, domain, and scopes travel in the browser's address bar
// on every /oauth2/authorize request. This feature currently involves no
// secret at all: the app client is public (no client secret) and Google
// federation is deferred, so no Google OAuth client secret exists yet. If
// Google is enabled later, its secret lives solely in the Cognito IdP config
// and must never enter this repository.
//
// DEVIATION from the story spec: this pool uses a CUSTOM domain
// (auth.nixusapp.com, Route53 + ACM) rather than a Cognito prefix domain, so
// COGNITO_HOSTED_UI_BASE_URL cannot be composed from a prefix + region. A
// prefix domain (us-east-17gfgq0emg.auth.us-east-1.amazoncognito.com) also
// exists as an unused fallback.

// WHY the allowance survives Story 26.4: the custom-domain deviation above means
// the region is never needed to compose an endpoint URL, so nothing in the app
// reads it. It stays as the recorded, human-readable pool region.
#[allow(dead_code)]
pub const COGNITO_REGION: &str = "us-east-1";

// WHY the allowance survives Story 26.4: read only by the drift-guard test below,
// which is #[cfg(test)]; COGNITO_HOSTED_UI_BASE_URL is what the app consumes.
#[allow(dead_code)]
pub const COGNITO_CUSTOM_DOMAIN: &str = "auth.nixusapp.com";

pub const COGNITO_CLIENT_ID: &str = "6525109r95las7odvuesf13joj";

// Pre-composed so Stories 26.4 and 26.5 never rebuild it and cannot disagree
// about the shape; the test below guarantees it stays in sync with the parts.
pub const COGNITO_HOSTED_UI_BASE_URL: &str = "https://auth.nixusapp.com";

pub const COGNITO_REDIRECT_URI: &str = "nixus://auth/callback";

#[allow(dead_code)] // WHY: registered on the app client, unused in v1 (sign-out is local-only, Story 26.5)
pub const COGNITO_SIGNOUT_URI: &str = "nixus://auth/signout";

pub const COGNITO_SCOPES: &str = "openid email profile";

/// Upper bound on the token exchange so a stalled network cannot hang sign-in.
/// Deliberately stricter than the repo's other `reqwest` calls, which have no
/// timeout at all — Story 26.5's launch refresh needs this precedent.
const TOKEN_EXCHANGE_TIMEOUT_SECS: u64 = 15;

use std::sync::Mutex;
use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tracing::info;

use crate::credentials;
use crate::error::AppError;
use crate::models::{AuthState, CognitoSession};

/// PKCE + CSRF material for one in-flight sign-in. Deliberately does **not**
/// derive `Debug`: the verifier and state are secrets for the lifetime of the
/// attempt, so there must be no way to format this into a log line at all.
pub struct PendingAttempt {
    code_verifier: String,
    code_challenge: String,
    state: String,
}

/// Managed state holding the single in-flight sign-in attempt. Memory only —
/// the verifier and state never reach the keyring, SQLite, a file, or a log.
#[derive(Default)]
pub struct PendingLogin(pub Mutex<Option<PendingAttempt>>);

struct CallbackParams {
    code: String,
    state: Option<String>,
}

/// Deliberately does **not** derive `Debug`: every field is a bearer credential.
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    id_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: i64,
}

/// `error_description` is intentionally absent: Cognito-supplied free text must
/// never reach the UI or the log file, so only the stable code is deserialized.
#[derive(Deserialize)]
struct TokenErrorResponse {
    error: Option<String>,
}

fn generate_pkce() -> PendingAttempt {
    // 32 random bytes -> 43-char base64url-no-pad verifier, inside RFC 7636's
    // 43-128 range and using only PKCE's unreserved alphabet (no '=', '+', '/').
    // rand::random draws from ThreadRng, which implements CryptoRng.
    let code_verifier = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
    let code_challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(code_verifier.as_bytes()));
    // Drawn independently of the verifier: deriving one from the other would let
    // anyone holding the callback URL reconstruct the other half.
    let state = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());

    PendingAttempt {
        code_verifier,
        code_challenge,
        state,
    }
}

fn build_authorize_url(code_challenge: &str, state: &str) -> String {
    format!(
        "{}/oauth2/authorize?response_type=code&client_id={}&redirect_uri={}&scope={}&code_challenge={}&code_challenge_method=S256&state={}",
        COGNITO_HOSTED_UI_BASE_URL,
        urlencoding::encode(COGNITO_CLIENT_ID),
        urlencoding::encode(COGNITO_REDIRECT_URI),
        urlencoding::encode(COGNITO_SCOPES),
        urlencoding::encode(code_challenge),
        urlencoding::encode(state),
    )
}

/// OAuth error codes are spec-restricted to a narrow charset, but a crafted
/// `nixus://` deep link can carry anything. The value is bounded and filtered
/// before it reaches the log file so a hostile URL cannot forge log lines.
fn sanitize_error_code(code: &str) -> String {
    code.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(40)
        .collect()
}

/// Maps an OAuth 2.0 `error` code to a fixed, user-presentable message and the
/// recoverable flag the UI acts on. Only the code is consulted — see
/// `TokenErrorResponse`. Unknown and absent codes stay recoverable so a user is
/// never told a retryable failure is permanent.
fn oauth_error_to_app_error(error_code: Option<&str>) -> AppError {
    let (message, recoverable) = match error_code {
        // Cognito codes live 5 minutes and are single-use, so this is routine.
        Some("invalid_grant") => (
            "Your sign-in link expired or was already used. Please sign in again.",
            true,
        ),
        Some("invalid_request") => (
            "The sign-in request was rejected. Please sign in again.",
            true,
        ),
        // App-client misconfiguration: retrying cannot help.
        Some("invalid_client") | Some("unauthorized_client") | Some("unsupported_grant_type") => (
            "Sign-in is not configured correctly for this app. Please contact support.",
            false,
        ),
        _ => ("Sign-in could not be completed. Please try again.", true),
    };

    AppError::Auth {
        message: message.to_string(),
        recoverable,
    }
}

/// Splits the OAuth parameters out of a callback URL. Pure, and never embeds a
/// query value in the returned message — `AppError::Auth`'s message crosses IPC
/// to the UI, and the query carries the authorization code.
fn parse_callback(url: &str) -> Result<CallbackParams, AppError> {
    let query = match url.split_once('?') {
        Some((_, query)) if !query.is_empty() => query,
        _ => {
            return Err(AppError::Auth {
                message: "The sign-in response was incomplete. Please sign in again.".to_string(),
                recoverable: true,
            })
        }
    };

    let mut code = None;
    let mut state = None;
    let mut error = None;

    for pair in query.split('&') {
        if let Some((name, raw_value)) = pair.split_once('=') {
            let value = urlencoding::decode(raw_value)
                .map(|decoded| decoded.into_owned())
                .unwrap_or_else(|_| raw_value.to_string());
            match name {
                "code" => code = Some(value),
                "state" => state = Some(value),
                "error" => error = Some(value),
                _ => {}
            }
        }
    }

    if let Some(error) = error {
        info!(
            "Auth callback carried an OAuth error (error={})",
            sanitize_error_code(&error)
        );
        return Err(oauth_error_to_app_error(Some(error.as_str())));
    }

    match code {
        Some(code) if !code.is_empty() => Ok(CallbackParams { code, state }),
        _ => Err(AppError::Auth {
            message: "The sign-in response was missing its authorization code. Please sign in again."
                .to_string(),
            recoverable: true,
        }),
    }
}

/// AC #6's benign case, kept separate from `verify_state` so the two carry
/// opposite `recoverable` values: relaunching between `start_login` and the
/// redirect, or a cold start by the deep link, is always fixed by retrying.
fn no_pending_attempt_error() -> AppError {
    AppError::Auth {
        message: "This sign-in link is no longer valid. Please sign in again.".to_string(),
        recoverable: true,
    }
}

/// AC #5's CSRF-signal case: a pending attempt exists but the callback's `state`
/// does not match it (or is absent). Unlike a missing pending attempt this is
/// **not** recoverable — a retry cannot make a forged redirect legitimate — so
/// the message promises no retry. Split out to be unit-testable without an
/// `AppHandle`.
fn verify_state(pending_state: &str, callback_state: Option<&str>) -> Result<(), AppError> {
    if callback_state == Some(pending_state) {
        return Ok(());
    }

    Err(AppError::Auth {
        message: "This sign-in response could not be verified and was rejected for your security."
            .to_string(),
        recoverable: false,
    })
}

/// Only the callback URL triggers a token exchange; `nixus://auth/signout`
/// (Story 26.5) and any future scheme path must not reach it.
fn is_auth_callback_url(url: &str) -> bool {
    let path = url.split_once('?').map(|(path, _)| path).unwrap_or(url);
    path.trim_end_matches('/')
        .eq_ignore_ascii_case(COGNITO_REDIRECT_URI)
}

/// `try_state` rather than `state` so a wiring mistake surfaces as a handled
/// error instead of a panic — a deep-link callback must never crash the app.
fn pending_login_state(app: &AppHandle) -> Result<State<'_, PendingLogin>, AppError> {
    app.try_state::<PendingLogin>()
        .ok_or_else(|| AppError::Auth {
            message: "Sign-in is unavailable. Please restart nixus.".to_string(),
            recoverable: false,
        })
}

fn lock_poisoned() -> AppError {
    AppError::Auth {
        message: "Sign-in state is unavailable. Please restart nixus and try again.".to_string(),
        recoverable: false,
    }
}

#[tauri::command(rename_all = "snake_case")]
pub async fn start_login(app: AppHandle) -> Result<(), AppError> {
    let attempt = generate_pkce();
    let authorize_url = build_authorize_url(&attempt.code_challenge, &attempt.state);

    {
        let pending = pending_login_state(&app)?;
        let mut slot = pending.0.lock().map_err(|_| lock_poisoned())?;
        // A second sign-in click supersedes the first: only the newest verifier
        // can complete an exchange.
        *slot = Some(attempt);
    }

    info!("Opening the Cognito Hosted UI in the system browser");
    if app.opener().open_url(&authorize_url, None::<&str>).is_err() {
        // The opener error is discarded on purpose: `Error::ForbiddenUrl`'s
        // Display embeds the URL, which carries the code_challenge and state.
        tracing::error!("Failed to open the system browser for sign-in");
        if let Ok(pending) = pending_login_state(&app) {
            if let Ok(mut slot) = pending.0.lock() {
                *slot = None;
            }
        }
        return Err(AppError::Auth {
            message: "Could not open your browser to sign in. Please try again.".to_string(),
            recoverable: true,
        });
    }

    Ok(())
}

async fn exchange_code_for_tokens(
    code: &str,
    code_verifier: &str,
) -> Result<TokenResponse, AppError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(TOKEN_EXCHANGE_TIMEOUT_SECS))
        .build()
        .map_err(|_| AppError::Auth {
            message: "Could not start the sign-in request. Please try again.".to_string(),
            recoverable: true,
        })?;

    // Public PKCE client: client_id travels in the body, and there is no
    // client_secret and no Authorization header.
    let form = [
        ("grant_type", "authorization_code"),
        ("client_id", COGNITO_CLIENT_ID),
        ("code", code),
        ("code_verifier", code_verifier),
        ("redirect_uri", COGNITO_REDIRECT_URI),
    ];

    let response = client
        .post(format!("{}/oauth2/token", COGNITO_HOSTED_UI_BASE_URL))
        .form(&form)
        .send()
        .await
        .map_err(|e| {
            // Only a boolean is logged: reqwest's Display can carry request detail.
            tracing::error!(
                "Cognito token exchange transport failure (timeout={})",
                e.is_timeout()
            );
            AppError::Auth {
                message: "Could not reach the sign-in service. Check your connection and try again."
                    .to_string(),
                recoverable: true,
            }
        })?;

    // reqwest does not error on 4xx/5xx, so the status is checked explicitly.
    let status = response.status();
    if !status.is_success() {
        let error_code = response
            .json::<TokenErrorResponse>()
            .await
            .ok()
            .and_then(|body| body.error);
        tracing::error!(
            "Cognito token exchange returned status {} (error={})",
            status.as_u16(),
            error_code
                .as_deref()
                .map(sanitize_error_code)
                .unwrap_or_else(|| "none".to_string())
        );
        return Err(oauth_error_to_app_error(error_code.as_deref()));
    }

    response.json::<TokenResponse>().await.map_err(|_| {
        tracing::error!(
            "Cognito token response could not be deserialized (status {})",
            status.as_u16()
        );
        AppError::Auth {
            message: "The sign-in service returned an unexpected response. Please try again."
                .to_string(),
            recoverable: true,
        }
    })
}

/// The real callback logic, callable from both the Tauri command and Story
/// 26.3's synchronous deep-link seam.
pub async fn complete_auth_callback(app: &AppHandle, callback_url: &str) -> Result<(), AppError> {
    // Taken, not borrowed: every return path below — success and failure — leaves
    // the slot empty, so a replayed callback URL cannot re-run the exchange.
    let pending = {
        let state = pending_login_state(app)?;
        let mut slot = state.0.lock().map_err(|_| lock_poisoned())?;
        slot.take()
    };

    let pending = match pending {
        Some(pending) => pending,
        None => {
            info!("Auth callback ignored: no pending sign-in attempt");
            return Err(no_pending_attempt_error());
        }
    };

    let params = parse_callback(callback_url)?;
    verify_state(&pending.state, params.state.as_deref())?;

    let tokens = exchange_code_for_tokens(&params.code, &pending.code_verifier).await?;

    // A session without a refresh token is unusable: Story 26.5's
    // grant_type=refresh_token call would fail permanently. Reject the whole
    // response rather than persisting an empty-string refresh token.
    let (id_token, refresh_token) = match (tokens.id_token, tokens.refresh_token) {
        (Some(id_token), Some(refresh_token))
            if !id_token.is_empty() && !refresh_token.is_empty() =>
        {
            (id_token, refresh_token)
        }
        _ => {
            tracing::error!("Cognito token response omitted the id_token or the refresh_token");
            return Err(AppError::Auth {
                message: "Sign-in completed but the session was incomplete. Please sign in again."
                    .to_string(),
                recoverable: true,
            });
        }
    };

    let session = CognitoSession {
        access_token: tokens.access_token,
        id_token,
        refresh_token,
        expires_at: Utc::now().timestamp() + tokens.expires_in,
    };

    // Sole accessor: the keyring is only ever reached through credentials.rs.
    credentials::store_cognito_session(&session)?;

    info!("Auth callback completed; session stored");
    // Success only, and no payload: the frontend re-reads the session over IPC.
    let _ = app.emit("auth:callback-received", ());

    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub async fn handle_auth_callback(app: AppHandle, callback_url: String) -> Result<(), AppError> {
    complete_auth_callback(&app, &callback_url).await
}

/// Single entry point for every `nixus://` URL the OS hands to this app.
pub fn dispatch_deep_link_url(app: &AppHandle, url: &str, source: &str) {
    let (path, query) = url.split_once('?').unwrap_or((url, ""));
    let has = |name: &str| query.split('&').any(|p| p.starts_with(&format!("{name}=")));

    // Query values carry the single-use authorization code and CSRF state — never log them.
    info!(
        "Deep link received (source={}): {} [code={}, state={}, error={}]",
        source,
        path,
        has("code"),
        has("state"),
        has("error")
    );

    if !is_auth_callback_url(url) {
        info!("Deep link ignored: {} is not the auth callback", path);
        return;
    }

    // The plugin delivers URLs to a synchronous callback, so the exchange runs on
    // the Tauri runtime. Failures surface in the log only: there is no auth UI
    // yet (Epic 27) and no failure event is emitted by design.
    let app = app.clone();
    let url = url.to_string();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = complete_auth_callback(&app, &url).await {
            // AppError::Auth's message is user-presentable and secret-free by construction.
            tracing::error!("Deep link auth callback failed: {}", e);
        }
    });
}

/// The `id_token` claims nixus reads. `serde` ignores unknown fields, so the
/// dozen other Cognito claims (`aud`, `iss`, `exp`, `token_use`, …) need no
/// representation here. Unlike `TokenResponse` this may derive `Debug`: claims
/// are profile data, never bearer credentials.
#[derive(Debug, Clone, Deserialize)]
struct IdTokenClaims {
    email: Option<String>,
    // This pool's only required attribute is `email` and Google federation is
    // deferred, so `name` is legitimately absent for email/password users.
    name: Option<String>,
    sub: String,
}

/// Refresh-grant response. Deliberately does **not** derive `Debug`, matching
/// `TokenResponse`: every token field is a bearer credential and there must be
/// no way to format one into a log line at all.
#[derive(Deserialize)]
struct TokenRefreshResponse {
    access_token: String,
    id_token: String,
    refresh_token: Option<String>,
    expires_in: i64,
}

/// `expires_at` is the single source of truth for expiry — the `exp` claim is
/// deliberately not consulted, which would create two competing sources. No
/// clock-skew buffer either: AC 2 is literally "still in the future", and a v1
/// token is only ever used for a local claim read, so near-expiry is harmless.
/// `now_unix` is a parameter rather than an inner `Utc::now()` so this is pure.
fn is_session_expired(expires_at: i64, now_unix: i64) -> bool {
    now_unix >= expires_at
}

/// One message for every malformed-session shape: the UI's affordance is the
/// same (sign in again), and naming the specific defect would risk echoing token
/// material back across IPC. Recoverable — a fresh sign-in always fixes it.
fn unreadable_session_error() -> AppError {
    AppError::Auth {
        message: "Your saved session could not be read. Please sign in again.".to_string(),
        recoverable: true,
    }
}

/// Decodes the `id_token` payload only. The signature is **not** verified, by
/// design: the token was obtained by this app directly from Cognito over TLS
/// (Story 26.4) and lives in the OS keyring, and no authorization decision is
/// made from these claims — they populate a display-only profile panel. A JWKS
/// fetch would add both a dependency (AC 13) and network I/O this story avoids.
fn decode_id_token_claims(id_token: &str) -> Result<IdTokenClaims, AppError> {
    let segments: Vec<&str> = id_token.split('.').collect();
    if segments.len() != 3 {
        return Err(unreadable_session_error());
    }

    // Cognito emits unpadded base64url, but padding is stripped rather than
    // assumed absent: `URL_SAFE_NO_PAD` rejects '=' outright, so a padded
    // payload would otherwise fail on an encoding detail that is not an error.
    let payload = URL_SAFE_NO_PAD
        .decode(segments[1].trim_end_matches('='))
        .map_err(|_| unreadable_session_error())?;

    serde_json::from_slice::<IdTokenClaims>(&payload).map_err(|_| unreadable_session_error())
}

/// Builds the profile half of `AuthState::LoggedIn` from the token in hand, at
/// request time — no profile field is ever persisted separately (AC 2).
fn logged_in_from_id_token(id_token: &str) -> Result<AuthState, AppError> {
    let claims = decode_id_token_claims(id_token)?;

    // `email` is the pool's one required attribute, so its absence means the
    // token is not one this app can have issued: a hard, recoverable error.
    let email = claims
        .email
        .filter(|email| !email.is_empty())
        .ok_or_else(unreadable_session_error)?;

    Ok(AuthState::LoggedIn {
        email,
        // Absent *and* empty both degrade to `None` so Story 27.3 falls back to
        // email-only rather than rendering a blank name.
        name: claims.name.filter(|name| !name.is_empty()),
    })
}

/// Split out so the exact wire body is drift-guarded by a unit test: a public
/// PKCE client sends no client secret, and a refresh grant sends no
/// `redirect_uri` and no `code_verifier`.
fn refresh_form(refresh_token: &str) -> [(&'static str, &str); 3] {
    [
        ("grant_type", "refresh_token"),
        ("client_id", COGNITO_CLIENT_ID),
        ("refresh_token", refresh_token),
    ]
}

/// Refresh-token rotation is disabled on this pool (Story 26.1), so a successful
/// response omits `refresh_token`. Carrying the previous one forward is
/// load-bearing: `CognitoSession::refresh_token` is a non-optional `String`, so
/// persisting `""` here would permanently brick every later refresh.
fn merge_refreshed_session(
    previous: &CognitoSession,
    response: TokenRefreshResponse,
    now_unix: i64,
) -> CognitoSession {
    CognitoSession {
        access_token: response.access_token,
        id_token: response.id_token,
        refresh_token: response
            .refresh_token
            .filter(|token| !token.is_empty())
            .unwrap_or_else(|| previous.refresh_token.clone()),
        expires_at: now_unix + response.expires_in,
    }
}

/// `Ok(None)` means "the refresh did not complete" — transport failure, timeout,
/// non-2xx, or an unparseable body. All four resolve to `SessionExpired` (AC 4),
/// never to an error that could block app startup, so each is logged here and
/// then deliberately swallowed. `Err` is reserved for the one local fault that
/// is not a refresh outcome at all: the HTTP client failing to build.
async fn refresh_session(previous: &CognitoSession) -> Result<Option<CognitoSession>, AppError> {
    // AC 6: the bound that keeps an offline launch from hanging startup. Reuses
    // Story 26.4's budget rather than introducing a second, competing timeout.
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(TOKEN_EXCHANGE_TIMEOUT_SECS))
        .build()
        .map_err(|_| AppError::Auth {
            message: "Could not check your session. Please try again.".to_string(),
            recoverable: true,
        })?;

    let form = refresh_form(&previous.refresh_token);

    let response = match client
        .post(format!("{}/oauth2/token", COGNITO_HOSTED_UI_BASE_URL))
        .form(&form)
        .send()
        .await
    {
        Ok(response) => response,
        Err(e) => {
            // Only a boolean is logged: reqwest's Display can carry request detail.
            tracing::error!(
                "Cognito session refresh transport failure (timeout={})",
                e.is_timeout()
            );
            return Ok(None);
        }
    };

    // reqwest does not error on 4xx/5xx, so the status is checked explicitly.
    // A rejected or expired refresh token arrives here as 400 invalid_grant.
    let status = response.status();
    if !status.is_success() {
        let error_code = response
            .json::<TokenErrorResponse>()
            .await
            .ok()
            .and_then(|body| body.error);
        tracing::error!(
            "Cognito session refresh returned status {} (error={})",
            status.as_u16(),
            error_code
                .as_deref()
                .map(sanitize_error_code)
                .unwrap_or_else(|| "none".to_string())
        );
        return Ok(None);
    }

    match response.json::<TokenRefreshResponse>().await {
        Ok(refreshed) => {
            // Mirrors Story 26.4's callback-path guard: an empty id_token would
            // be persisted and then fail to decode on every later launch, so it
            // is treated as a refresh that did not complete, not as a session.
            if refreshed.id_token.is_empty() || refreshed.access_token.is_empty() {
                tracing::error!(
                    "Cognito session refresh returned an empty token (status {})",
                    status.as_u16()
                );
                return Ok(None);
            }
            Ok(Some(merge_refreshed_session(
                previous,
                refreshed,
                Utc::now().timestamp(),
            )))
        }
        Err(_) => {
            tracing::error!(
                "Cognito session refresh response could not be deserialized (status {})",
                status.as_u16()
            );
            Ok(None)
        }
    }
}

/// The outcome of the keyring-load-and-refresh path, extracted so
/// `get_auth_session` and `current_subject` cannot disagree about what "signed
/// in" means.
enum ResolvedSession {
    None,
    Live(CognitoSession),
    Refreshed(CognitoSession),
    Expired,
}

async fn resolve_session() -> Result<ResolvedSession, AppError> {
    // A malformed keyring blob propagates as a recoverable error (AC 12) rather
    // than being smoothed into `LoggedOut`, which would hide the real problem.
    let session = match credentials::load_cognito_session()? {
        Some(session) => session,
        None => return Ok(ResolvedSession::None),
    };

    if !is_session_expired(session.expires_at, Utc::now().timestamp()) {
        return Ok(ResolvedSession::Live(session));
    }

    let refreshed = match refresh_session(&session).await? {
        Some(refreshed) => refreshed,
        // The keyring entry is left in place on purpose: an offline launch must
        // still be able to refresh successfully on a later online launch.
        // `sign_out` is the only path that removes the entry.
        None => return Ok(ResolvedSession::Expired),
    };

    // Same keyring service and account as the original entry, so this overwrites
    // it rather than creating a second one (AC 3's "in place"), and it goes
    // through the sole accessor.
    credentials::store_cognito_session(&refreshed)?;

    Ok(ResolvedSession::Refreshed(refreshed))
}

/// Resolves the session for the frontend. The network is touched only when the
/// stored token has already expired, which is what makes "refresh once on
/// launch" emergent rather than flag-driven: later invalidations (Story 26.4's
/// `auth:callback-received`, a `sign_out`) re-read the keyring with no network
/// call, so there is no launch guard, no `has_refreshed` flag, and no cached
/// `AuthState` to keep in sync. Takes no `State<DbState>` and writes no
/// audit-log row: auth performs no financial-data mutation.
#[tauri::command(rename_all = "snake_case")]
pub async fn get_auth_session() -> Result<AuthState, AppError> {
    match resolve_session().await? {
        ResolvedSession::None => {
            info!("Auth session resolved: LoggedOut");
            Ok(AuthState::LoggedOut)
        }
        ResolvedSession::Live(session) => {
            let state = logged_in_from_id_token(&session.id_token)?;
            info!("Auth session resolved: LoggedIn");
            Ok(state)
        }
        ResolvedSession::Expired => {
            info!("Auth session resolved: SessionExpired");
            Ok(AuthState::SessionExpired)
        }
        ResolvedSession::Refreshed(session) => {
            let state = logged_in_from_id_token(&session.id_token)?;
            info!("Auth session resolved: LoggedIn (session refreshed)");
            Ok(state)
        }
    }
}

/// The durable identity key of the active account, resolved server-side so the
/// `sub` never crosses IPC as a parameter and account isolation stays an
/// invariant rather than a convention the webview could bypass.
///
/// The charset check deliberately lives in `profile_store`, not here, so there
/// is exactly one validation point regardless of caller.
pub(crate) async fn current_subject() -> Result<String, AppError> {
    subject_from_resolved(resolve_session().await?)
}

/// Split from `current_subject` so the mapping is unit-testable without a
/// keyring: every branch that decides "signed in" is pure once the session is
/// in hand.
fn subject_from_resolved(resolved: ResolvedSession) -> Result<String, AppError> {
    let session = match resolved {
        ResolvedSession::Live(session) | ResolvedSession::Refreshed(session) => session,
        ResolvedSession::None | ResolvedSession::Expired => {
            return Err(AppError::Auth {
                message: "You need to be signed in to view your profile.".to_string(),
                recoverable: true,
            })
        }
    };

    let claims = decode_id_token_claims(&session.id_token)?;

    // An empty claim is a session defect, not user input, so it reuses the
    // unreadable-session error rather than surfacing as a validation failure.
    if claims.sub.is_empty() {
        return Err(unreadable_session_error());
    }

    Ok(claims.sub)
}

/// Local-only by design: Cognito's `/oauth2/revoke` is deferred for v1 and
/// `COGNITO_SIGNOUT_URI` is deliberately never opened, so this performs no
/// network I/O and stays synchronous. Takes `AppHandle` rather than a
/// `State<PendingLogin>` parameter so that an unmanaged state cannot fail the
/// command *before* the keyring is cleared — clearing is the part AC 8 checks.
#[tauri::command(rename_all = "snake_case")]
pub fn sign_out(app: AppHandle) -> Result<(), AppError> {
    // A sign-in that was launched but never completed leaves PKCE material in
    // memory; signing out must not leave it usable by a late callback. Reuses
    // Story 26.4's single store — there is no second one. Discarded BEFORE the
    // keyring call so a keyring fault cannot leave a usable verifier behind.
    if let Ok(pending) = pending_login_state(&app) {
        if let Ok(mut slot) = pending.0.lock() {
            *slot = None;
        }
    }

    // Idempotent per Story 26.2: a missing entry is not an error.
    credentials::clear_cognito_session()?;

    info!("Sign-out completed; local session cleared");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosted_ui_base_url_matches_custom_domain() {
        assert_eq!(
            COGNITO_HOSTED_UI_BASE_URL,
            format!("https://{}", COGNITO_CUSTOM_DOMAIN)
        );
        assert!(!COGNITO_HOSTED_UI_BASE_URL.ends_with('/'));
    }

    #[test]
    fn redirect_and_signout_uris_use_the_nixus_scheme() {
        assert_eq!(COGNITO_REDIRECT_URI, "nixus://auth/callback");
        assert_eq!(COGNITO_SIGNOUT_URI, "nixus://auth/signout");
    }

    #[test]
    fn scopes_include_openid_email_and_profile() {
        let scopes: Vec<&str> = COGNITO_SCOPES.split(' ').collect();
        assert!(scopes.contains(&"openid"));
        assert!(scopes.contains(&"email"));
        assert!(scopes.contains(&"profile"));
    }

    #[test]
    fn client_id_is_populated() {
        assert!(!COGNITO_CLIENT_ID.starts_with("REPLACE_WITH"));
        assert!(!COGNITO_CLIENT_ID.is_empty());
    }

    fn recoverable_of(error: &AppError) -> bool {
        match error {
            AppError::Auth { recoverable, .. } => *recoverable,
            other => panic!("expected AppError::Auth, got {:?}", other),
        }
    }

    fn message_of(error: &AppError) -> String {
        match error {
            AppError::Auth { message, .. } => message.clone(),
            other => panic!("expected AppError::Auth, got {:?}", other),
        }
    }

    /// `CallbackParams` has no `Debug` (it holds the authorization code), so
    /// `expect_err` is unavailable here.
    fn reject_callback(url: &str) -> AppError {
        match parse_callback(url) {
            Ok(_) => panic!("expected the callback URL to be rejected"),
            Err(error) => error,
        }
    }

    #[test]
    fn verifier_is_43_chars_and_uses_only_the_pkce_alphabet() {
        let attempt = generate_pkce();

        assert_eq!(attempt.code_verifier.len(), 43);
        assert!(!attempt.code_verifier.contains('='));
        assert!(!attempt.code_verifier.contains('+'));
        assert!(!attempt.code_verifier.contains('/'));
    }

    #[test]
    fn challenge_is_base64url_no_pad_sha256_of_the_verifier() {
        let attempt = generate_pkce();

        let expected = URL_SAFE_NO_PAD.encode(Sha256::digest(attempt.code_verifier.as_bytes()));
        assert_eq!(attempt.code_challenge, expected);
    }

    #[test]
    fn state_is_generated_independently_of_the_verifier() {
        let attempt = generate_pkce();

        assert_ne!(attempt.state, attempt.code_verifier);
        assert_eq!(attempt.state.len(), 43);
    }

    #[test]
    fn two_successive_generations_differ() {
        let first = generate_pkce();
        let second = generate_pkce();

        assert_ne!(first.code_verifier, second.code_verifier);
        assert_ne!(first.code_challenge, second.code_challenge);
        assert_ne!(first.state, second.state);
    }

    #[test]
    fn authorize_url_contains_every_required_param() {
        let url = build_authorize_url("test-challenge", "test-state");

        assert!(url.starts_with("https://auth.nixusapp.com/oauth2/authorize?"));
        assert!(url.contains("response_type=code"));
        assert!(url.contains(&format!("client_id={}", COGNITO_CLIENT_ID)));
        assert!(url.contains("redirect_uri=nixus%3A%2F%2Fauth%2Fcallback"));
        assert!(url.contains("scope=openid%20email%20profile"));
        assert!(url.contains("code_challenge=test-challenge"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("state=test-state"));
    }

    /// Byte-exact guard: this literal is the URL that was verified live against
    /// the pool (302 to Managed Login, all seven params preserved).
    #[test]
    fn authorize_url_is_byte_exact() {
        assert_eq!(
            build_authorize_url("CHALLENGE", "STATE"),
            "https://auth.nixusapp.com/oauth2/authorize\
             ?response_type=code\
             &client_id=6525109r95las7odvuesf13joj\
             &redirect_uri=nixus%3A%2F%2Fauth%2Fcallback\
             &scope=openid%20email%20profile\
             &code_challenge=CHALLENGE\
             &code_challenge_method=S256\
             &state=STATE"
        );
    }

    #[test]
    fn authorize_url_never_emits_a_raw_space_or_a_forbidden_param() {        let url = build_authorize_url("test-challenge", "test-state");

        assert!(!url.contains(' '));
        assert!(!url.contains("client_secret"));
        assert!(!url.contains("nonce"));
        assert!(!url.contains("identity_provider"));
        assert!(!url.contains("prompt"));
        assert!(!url.contains("resource"));
    }

    #[test]
    fn callback_parsing_extracts_code_and_state() {
        let params =
            parse_callback("nixus://auth/callback?code=abc123&state=xyz789").expect("parses");

        assert_eq!(params.code, "abc123");
        assert_eq!(params.state.as_deref(), Some("xyz789"));
    }

    #[test]
    fn callback_parsing_percent_decodes_values() {
        let params =
            parse_callback("nixus://auth/callback?code=a%2Bb&state=c%2Fd").expect("parses");

        assert_eq!(params.code, "a+b");
        assert_eq!(params.state.as_deref(), Some("c/d"));
    }

    #[test]
    fn callback_parsing_surfaces_an_error_param() {
        let error = reject_callback(
            "nixus://auth/callback?error=invalid_request&error_description=Something%20broke",
        );

        assert!(recoverable_of(&error));
        // The Cognito-supplied description must not reach the user-facing message.
        assert!(!message_of(&error).contains("Something"));
    }

    #[test]
    fn callback_parsing_maps_a_misconfiguration_error_to_unrecoverable() {
        let error = reject_callback("nixus://auth/callback?error=unauthorized_client");

        assert!(!recoverable_of(&error));
    }

    #[test]
    fn callback_parsing_rejects_a_missing_code() {
        let error = reject_callback("nixus://auth/callback?state=xyz789");

        assert!(recoverable_of(&error));
    }

    #[test]
    fn callback_parsing_rejects_a_url_with_no_query() {
        let error = reject_callback("nixus://auth/callback");

        assert!(recoverable_of(&error));
    }

    #[test]
    fn state_verification_accepts_a_match() {
        assert!(verify_state("expected", Some("expected")).is_ok());
    }

    /// AC #5: a pending attempt exists but the callback's `state` does not match
    /// it. A retry cannot make a forged redirect legitimate.
    #[test]
    fn a_state_mismatch_is_unrecoverable() {
        let mismatched = verify_state("expected", Some("forged")).expect_err("rejects");
        assert!(!recoverable_of(&mismatched));

        let absent = verify_state("expected", None).expect_err("rejects");
        assert!(!recoverable_of(&absent));
    }

    /// AC #6: no pending attempt at all — the app relaunched between
    /// `start_login` and the redirect, or was cold-started by the deep link.
    /// Signing in again always fixes it, so this is the opposite of AC #5.
    #[test]
    fn an_absent_pending_attempt_is_recoverable() {
        let error = no_pending_attempt_error();

        assert!(recoverable_of(&error));
        assert!(message_of(&error).contains("sign in again"));
    }

    #[test]
    fn token_error_mapping_follows_the_recoverable_table() {
        assert!(recoverable_of(&oauth_error_to_app_error(Some(
            "invalid_grant"
        ))));
        assert!(recoverable_of(&oauth_error_to_app_error(Some(
            "invalid_request"
        ))));
        assert!(recoverable_of(&oauth_error_to_app_error(None)));
        assert!(!recoverable_of(&oauth_error_to_app_error(Some(
            "invalid_client"
        ))));
        assert!(!recoverable_of(&oauth_error_to_app_error(Some(
            "unauthorized_client"
        ))));
        assert!(!recoverable_of(&oauth_error_to_app_error(Some(
            "unsupported_grant_type"
        ))));
    }

    #[test]
    fn only_the_callback_path_is_treated_as_an_auth_callback() {
        assert!(is_auth_callback_url("nixus://auth/callback?code=a&state=b"));
        assert!(is_auth_callback_url("nixus://auth/callback"));
        assert!(is_auth_callback_url("nixus://auth/callback/"));
        assert!(!is_auth_callback_url(COGNITO_SIGNOUT_URI));
        assert!(!is_auth_callback_url("nixus://something/else?code=a"));
    }

    #[test]
    fn error_codes_are_bounded_and_stripped_of_log_forging_characters() {
        assert_eq!(sanitize_error_code("invalid_grant"), "invalid_grant");
        assert_eq!(
            sanitize_error_code("bad\ninjected INFO line"),
            "badinjectedINFOline"
        );
        assert_eq!(sanitize_error_code(&"x".repeat(200)).len(), 40);
    }

    fn id_token_with_payload(payload: &str) -> String {
        format!(
            "{}.{}.{}",
            URL_SAFE_NO_PAD.encode(r#"{"alg":"RS256","kid":"test"}"#),
            URL_SAFE_NO_PAD.encode(payload),
            "c2lnbmF0dXJl"
        )
    }

    fn sample_session() -> CognitoSession {
        CognitoSession {
            access_token: "previous-access".to_string(),
            id_token: "previous-id".to_string(),
            refresh_token: "previous-refresh".to_string(),
            expires_at: 1_000,
        }
    }

    fn email_of(state: &AuthState) -> String {
        match state {
            AuthState::LoggedIn { email, .. } => email.clone(),
            other => panic!("expected LoggedIn, got {:?}", other),
        }
    }

    fn name_of(state: &AuthState) -> Option<String> {
        match state {
            AuthState::LoggedIn { name, .. } => name.clone(),
            other => panic!("expected LoggedIn, got {:?}", other),
        }
    }

    #[test]
    fn a_session_is_live_while_now_is_before_expires_at() {
        assert!(!is_session_expired(1_700_000_000, 1_699_999_999));
    }

    /// AC 2 is "still in the future", so the boundary itself counts as expired
    /// and there is deliberately no early-refresh window.
    #[test]
    fn expiry_is_inclusive_at_the_boundary() {
        assert!(is_session_expired(1_700_000_000, 1_700_000_000));
        assert!(is_session_expired(1_700_000_000, 1_700_000_001));
    }

    #[test]
    fn claims_decode_from_an_unpadded_base64url_payload() {
        let token = id_token_with_payload(
            r#"{"sub":"abc-123","email":"user@example.com","name":"Nick","token_use":"id"}"#,
        );

        let claims = decode_id_token_claims(&token).expect("decodes");

        assert_eq!(claims.email.as_deref(), Some("user@example.com"));
        assert_eq!(claims.name.as_deref(), Some("Nick"));
        assert_eq!(claims.sub, "abc-123");
    }

    /// Real Cognito payloads are unpadded, but padding must not be assumed absent.
    #[test]
    fn claims_decode_from_a_padded_base64url_payload() {
        let payload = r#"{"sub":"abc-123","email":"user@example.com"}"#;
        let token = format!(
            "header.{}.signature",
            base64::engine::general_purpose::URL_SAFE.encode(payload)
        );

        let claims = decode_id_token_claims(&token).expect("decodes");

        assert_eq!(claims.email.as_deref(), Some("user@example.com"));
    }

    /// The `-` and `_` characters only base64url produces must survive decoding.
    #[test]
    fn claims_decode_a_payload_containing_base64url_specific_characters() {
        let payload = r#"{"sub":"a?b>c","email":"user@example.com"}"#;
        let encoded = URL_SAFE_NO_PAD.encode(payload);
        assert!(encoded.contains('-') || encoded.contains('_'));

        let claims =
            decode_id_token_claims(&format!("header.{}.signature", encoded)).expect("decodes");

        assert_eq!(claims.sub, "a?b>c");
    }

    #[test]
    fn a_two_segment_token_is_rejected_as_recoverable() {
        let error = decode_id_token_claims("header.payload").expect_err("rejects");

        assert!(recoverable_of(&error));
        assert!(message_of(&error).contains("sign in again"));
    }

    #[test]
    fn a_four_segment_token_is_rejected() {
        let error = decode_id_token_claims("a.b.c.d").expect_err("rejects");

        assert!(recoverable_of(&error));
    }

    #[test]
    fn a_non_base64url_payload_is_rejected() {
        let error = decode_id_token_claims("header.not base64!.signature").expect_err("rejects");

        assert!(recoverable_of(&error));
    }

    #[test]
    fn a_payload_that_decodes_but_is_not_json_is_rejected() {
        let error = decode_id_token_claims(&id_token_with_payload("not json at all"))
            .expect_err("rejects");

        assert!(recoverable_of(&error));
    }

    #[test]
    fn a_json_payload_without_sub_is_rejected() {
        let error = decode_id_token_claims(&id_token_with_payload(r#"{"email":"u@example.com"}"#))
            .expect_err("rejects");

        assert!(recoverable_of(&error));
    }

    #[test]
    fn logged_in_state_carries_the_email_and_name_claims() {
        let token =
            id_token_with_payload(r#"{"sub":"abc","email":"user@example.com","name":"Nick"}"#);

        let state = logged_in_from_id_token(&token).expect("resolves");

        assert_eq!(email_of(&state), "user@example.com");
        assert_eq!(name_of(&state).as_deref(), Some("Nick"));
    }

    /// This pool's only required attribute is `email`, so an email/password user
    /// legitimately has no `name`. Story 27.3 then falls back to email-only.
    #[test]
    fn an_absent_name_claim_degrades_to_none() {
        let token = id_token_with_payload(r#"{"sub":"abc","email":"user@example.com"}"#);

        let state = logged_in_from_id_token(&token).expect("resolves");

        assert_eq!(name_of(&state), None);
    }

    #[test]
    fn an_empty_name_claim_degrades_to_none_rather_than_a_blank_string() {
        let token = id_token_with_payload(r#"{"sub":"abc","email":"user@example.com","name":""}"#);

        let state = logged_in_from_id_token(&token).expect("resolves");

        assert_eq!(name_of(&state), None);
    }

    #[test]
    fn a_missing_email_claim_is_a_recoverable_error() {
        let token = id_token_with_payload(r#"{"sub":"abc","name":"Nick"}"#);

        let error = logged_in_from_id_token(&token).expect_err("rejects");

        assert!(recoverable_of(&error));
    }

    #[test]
    fn an_empty_email_claim_is_a_recoverable_error() {
        let token = id_token_with_payload(r#"{"sub":"abc","email":""}"#);

        let error = logged_in_from_id_token(&token).expect_err("rejects");

        assert!(recoverable_of(&error));
    }

    /// Rotation is disabled on this pool, so the live response omits
    /// `refresh_token`. Dropping it would brick every later refresh.
    #[test]
    fn refresh_without_rotation_preserves_previous_refresh_token() {
        let merged = merge_refreshed_session(
            &sample_session(),
            TokenRefreshResponse {
                access_token: "new-access".to_string(),
                id_token: "new-id".to_string(),
                refresh_token: None,
                expires_in: 3_600,
            },
            5_000,
        );

        assert_eq!(merged.refresh_token, "previous-refresh");
        assert!(!merged.refresh_token.is_empty());
        assert_eq!(merged.access_token, "new-access");
        assert_eq!(merged.id_token, "new-id");
    }

    #[test]
    fn refresh_with_rotation_adopts_the_rotated_refresh_token() {
        let merged = merge_refreshed_session(
            &sample_session(),
            TokenRefreshResponse {
                access_token: "new-access".to_string(),
                id_token: "new-id".to_string(),
                refresh_token: Some("rotated-refresh".to_string()),
                expires_in: 3_600,
            },
            5_000,
        );

        assert_eq!(merged.refresh_token, "rotated-refresh");
    }

    #[test]
    fn an_empty_rotated_refresh_token_falls_back_to_the_previous_one() {
        let merged = merge_refreshed_session(
            &sample_session(),
            TokenRefreshResponse {
                access_token: "new-access".to_string(),
                id_token: "new-id".to_string(),
                refresh_token: Some(String::new()),
                expires_in: 3_600,
            },
            5_000,
        );

        assert_eq!(merged.refresh_token, "previous-refresh");
    }

    #[test]
    fn refreshed_expiry_is_now_plus_expires_in() {
        let merged = merge_refreshed_session(
            &sample_session(),
            TokenRefreshResponse {
                access_token: "new-access".to_string(),
                id_token: "new-id".to_string(),
                refresh_token: None,
                expires_in: 3_600,
            },
            5_000,
        );

        assert_eq!(merged.expires_at, 8_600);
        assert!(!is_session_expired(merged.expires_at, 5_000));
    }

    /// Drift guard on the live-verified refresh body: a public PKCE client sends
    /// no client secret, and a refresh grant carries no `redirect_uri` and no
    /// `code_verifier`.
    #[test]
    fn the_refresh_form_carries_only_the_three_required_fields() {
        let form = refresh_form("stored-refresh-token");

        assert_eq!(
            form,
            [
                ("grant_type", "refresh_token"),
                ("client_id", "6525109r95las7odvuesf13joj"),
                ("refresh_token", "stored-refresh-token"),
            ]
        );
        assert!(!form.iter().any(|(name, _)| *name == "client_secret"));
        assert!(!form.iter().any(|(name, _)| *name == "redirect_uri"));
        assert!(!form.iter().any(|(name, _)| *name == "code_verifier"));
    }

    /// The endpoint verified live against the pool: it returned
    /// `400 {"error":"invalid_grant"}` for a bogus refresh token.
    #[test]
    fn the_refresh_endpoint_is_the_hosted_ui_token_endpoint() {
        assert_eq!(
            format!("{}/oauth2/token", COGNITO_HOSTED_UI_BASE_URL),
            "https://auth.nixusapp.com/oauth2/token"
        );
    }

    fn session_with_claims(payload: &str) -> CognitoSession {
        CognitoSession {
            id_token: id_token_with_payload(payload),
            ..sample_session()
        }
    }

    #[test]
    fn current_subject_returns_the_sub_claim_of_a_live_session() {        let resolved = ResolvedSession::Live(session_with_claims(
            r#"{"sub":"a1b2c3","email":"user@example.com"}"#,
        ));

        assert_eq!(subject_from_resolved(resolved).expect("resolves"), "a1b2c3");
    }

    #[test]
    fn current_subject_returns_the_sub_claim_of_a_refreshed_session() {
        let resolved = ResolvedSession::Refreshed(session_with_claims(
            r#"{"sub":"refreshed-sub","email":"user@example.com"}"#,
        ));

        assert_eq!(
            subject_from_resolved(resolved).expect("resolves"),
            "refreshed-sub"
        );
    }

    #[test]
    fn current_subject_maps_logged_out_to_a_recoverable_auth_error() {
        let error = subject_from_resolved(ResolvedSession::None).expect_err("rejects");
        assert!(recoverable_of(&error));
    }

    #[test]
    fn current_subject_maps_session_expired_to_a_recoverable_auth_error() {
        let error = subject_from_resolved(ResolvedSession::Expired).expect_err("rejects");
        assert!(recoverable_of(&error));
    }

    #[test]
    fn current_subject_rejects_an_empty_sub_claim_as_an_unreadable_session() {
        let resolved = ResolvedSession::Live(session_with_claims(
            r#"{"sub":"","email":"user@example.com"}"#,
        ));

        let error = subject_from_resolved(resolved).expect_err("rejects");
        assert!(recoverable_of(&error));
    }

    #[test]
    fn current_subject_does_not_require_the_email_claim() {
        // The `sub` is the identity key; `logged_in_from_id_token`'s email guard
        // is a display concern and must not gate profile storage.
        let resolved = ResolvedSession::Live(session_with_claims(r#"{"sub":"only-sub"}"#));

        assert_eq!(
            subject_from_resolved(resolved).expect("resolves"),
            "only-sub"
        );
    }
}
