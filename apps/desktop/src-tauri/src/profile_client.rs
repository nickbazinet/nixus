//! The sole Nixus Cloud profile network module (AD-9), and the only file in the crate
//! allowed to hold an HTTP client for `https://api.nixusapp.com/v1/profile` — asserted by
//! `commands/cloud_link.rs`'s network allowlist test.
//!
//! No credential of any kind is read here: the only one is a call-time access token from
//! `commands/auth.rs`, verified against `PROFILE_SCOPE`, so this module must never call
//! `credentials.rs` or `keyring_core`. Nothing it logs carries a token, a profile value,
//! avatar bytes, a response body or a URL — only statuses, byte sizes and booleans (AD-12).

use std::time::Duration;

use serde::de::DeserializeOwned;

use crate::account_contract::{normalize_error_code, VALIDATION_FIELDS, VALIDATION_REASONS};
use crate::commands::auth::{self, AccessTokenAuth, PROFILE_SCOPE};
use crate::error::AppError;
use crate::models::{
    AccountErrorEnvelopeWire, AccountErrorWire, CloudAvatarWire, CloudProfileWire,
    PutAvatarRequestWire, PutProfileRequestWire,
};

/// Compiled into every build, and the only base URL a release binary can reach (AD-9).
const PRODUCTION_BASE_URL: &str = "https://api.nixusapp.com/v1/profile";

#[cfg(debug_assertions)]
const OVERRIDE_ENV: &str = "NIXUS_PROFILE_API_BASE_URL";

/// Lets the tests below drive the real client against a loopback stub. `#[cfg(test)]`, so
/// it does not exist in any shipped binary — the same seam `auth::token_endpoint` uses, and
/// the reason the `debug_assertions` override can stay `https`-only with no exception.
#[cfg(test)]
const TEST_OVERRIDE_ENV: &str = "NIXUS_TEST_PROFILE_API_BASE_URL";

const REQUEST_TIMEOUT_SECS: u64 = 15;

fn base_url() -> String {
    #[cfg(test)]
    if let Ok(raw) = std::env::var(TEST_OVERRIDE_ENV) {
        let trimmed = raw.trim().trim_end_matches('/');
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    #[cfg(debug_assertions)]
    if let Ok(raw) = std::env::var(OVERRIDE_ENV) {
        if let Some(base) = https_override(&raw) {
            return base;
        }
    }

    PRODUCTION_BASE_URL.to_string()
}

/// The Bearer access token travels on this connection, so anything but `https` is refused
/// outright rather than honoured with a warning, and the caller falls back to production.
#[cfg(debug_assertions)]
fn https_override(raw: &str) -> Option<String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }

    if !trimmed.starts_with("https://") {
        tracing::warn!("Ignoring the profile API base URL override: it must be https");
        return None;
    }

    Some(trimmed.to_string())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum VersionedResource {
    Profile,
    Avatar,
}

impl VersionedResource {
    fn from_wire(value: &str) -> Option<Self> {
        match value {
            "profile" => Some(Self::Profile),
            "avatar" => Some(Self::Avatar),
            _ => None,
        }
    }

    pub(crate) fn wire_name(self) -> &'static str {
        match self {
            Self::Profile => "profile",
            Self::Avatar => "avatar",
        }
    }
}

/// Why a profile call failed.
///
/// `version_conflict` is the one refusal that carries structure the caller must act on —
/// Epic E reloads the named resource at the server's version — and `AppError::CloudProfile`
/// has nowhere to put either value under AD-13's closed shape. So it is kept here and
/// flattened by the `From` impl only when the error finally crosses IPC.
#[derive(Debug)]
pub(crate) enum ProfileClientError {
    VersionConflict {
        /// `None` when the server named no resource, which the contract allows only for a
        /// gateway-shaped 409 carrying no envelope.
        resource: Option<VersionedResource>,
        /// `None` when the resource does not exist, per the contract's own nullability.
        current_version: Option<u64>,
    },
    Failed(AppError),
}

impl From<ProfileClientError> for AppError {
    fn from(error: ProfileClientError) -> Self {
        match error {
            ProfileClientError::VersionConflict { .. } => {
                cloud_profile_error("version_conflict", None, None)
            }
            ProfileClientError::Failed(error) => error,
        }
    }
}

/// Fixed English sentences, one per contract code. Never interpolated, so no submitted
/// value, identifier or token can reach a message the UI or the log file sees (AD-12); the
/// UI resolves its own EN/FR copy from `code`, `field` and `reason`.
fn message_for(code: &str) -> &'static str {
    match code {
        "unauthorized" => "Sign in to your Nixus Cloud account to continue.",
        "reauthentication_required" => "Please sign in again to reach your Nixus Cloud profile.",
        "validation" => "A profile field was refused.",
        "version_conflict" => "Your Nixus Cloud profile changed since it was loaded.",
        "payload_too_large" => "That profile picture is too large.",
        "unsupported_media" => "That file type is not supported.",
        "rate_limited" => "Too many profile requests. Please try again shortly.",
        // `normalize_error_code` closes the set, so this arm is `unavailable` and nothing else.
        _ => "Your Nixus Cloud profile is temporarily unavailable.",
    }
}

/// Whether re-sending the same request unchanged could plausibly succeed. A refused value
/// and a refused file will be refused again; a sign-in, a reload or a wait can all repair.
fn recoverable_for(code: &str) -> bool {
    !matches!(
        code,
        "validation" | "payload_too_large" | "unsupported_media"
    )
}

fn cloud_profile_error(code: &str, field: Option<String>, reason: Option<String>) -> AppError {
    AppError::CloudProfile {
        code: code.to_string(),
        message: message_for(code).to_string(),
        field,
        reason,
        recoverable: recoverable_for(code),
    }
}

fn failed(code: &str) -> ProfileClientError {
    ProfileClientError::Failed(cloud_profile_error(code, None, None))
}

/// Drops anything the shared contract does not define, so a newer server's unknown `field`
/// or `reason` degrades to an absent one rather than to a label the UI cannot resolve.
fn allow_listed(value: Option<&str>, allowed: &[&str]) -> Option<String> {
    value
        .filter(|member| allowed.contains(member))
        .map(str::to_string)
}

/// The inverse of the contract's `ACCOUNT_ERROR_HTTP_STATUS`, for a rejection whose body is
/// not a parsable envelope. An unmapped status is `unavailable`, never a guess.
fn code_for_status(status: u16) -> &'static str {
    match status {
        400 => "validation",
        401 => "unauthorized",
        403 => "reauthentication_required",
        409 => "version_conflict",
        413 => "payload_too_large",
        415 => "unsupported_media",
        429 => "rate_limited",
        _ => "unavailable",
    }
}

fn error_from_status(status: u16) -> ProfileClientError {
    if status == 409 {
        return ProfileClientError::VersionConflict {
            resource: None,
            current_version: None,
        };
    }

    failed(code_for_status(status))
}

/// AD-13: an insufficient-scope `403` is reclassified here rather than by the gateway,
/// which returns it as `unauthorized`. The distinction matters because a Cognito refresh
/// replays the granted scopes and can never repair a missing one — only a fresh sign-in can.
fn error_from_envelope(status: u16, error: &AccountErrorWire) -> ProfileClientError {
    if status == 403 {
        return failed("reauthentication_required");
    }

    let code = normalize_error_code(&error.code);
    if code == "version_conflict" {
        return ProfileClientError::VersionConflict {
            resource: error
                .resource
                .as_deref()
                .and_then(VersionedResource::from_wire),
            current_version: error.current_version,
        };
    }

    ProfileClientError::Failed(cloud_profile_error(
        code,
        allow_listed(error.field.as_deref(), &VALIDATION_FIELDS),
        allow_listed(error.reason.as_deref(), &VALIDATION_REASONS),
    ))
}

/// Resolves the accessor's answer into a usable token, or into the refusal that answer
/// means — without issuing any request, which is the point of verifying the scope locally.
///
/// `expected_sub` is mandatory rather than optional so Epic E cannot forget it: the keyring
/// holds one machine-wide session, so a token whose subject is not the resolved source's own
/// `sub` would serve another account's profile (H2).
fn credential_for(
    auth: Result<AccessTokenAuth, AppError>,
    expected_sub: &str,
) -> Result<String, ProfileClientError> {
    match auth {
        Ok(AccessTokenAuth::Ready {
            access_token,
            subject_sub,
        }) => {
            if subject_sub == expected_sub {
                Ok(access_token)
            } else {
                Err(failed("unauthorized"))
            }
        }
        Ok(AccessTokenAuth::ReauthenticationRequired) => Err(failed("reauthentication_required")),
        Ok(AccessTokenAuth::SignedOut) => Err(failed("unauthorized")),
        Err(error) => Err(ProfileClientError::Failed(error)),
    }
}

#[derive(Clone, Copy)]
enum Route {
    Profile,
    Avatar,
}

impl Route {
    fn url(self) -> String {
        match self {
            Self::Profile => base_url(),
            Self::Avatar => format!("{}/avatar", base_url()),
        }
    }
}

/// One profile call. `body` absent means `GET`, present means `PUT` — the contract has no
/// other method on any route, so the two cannot drift apart into separate code paths.
struct Call {
    route: Route,
    body: Option<String>,
}

impl Call {
    fn get(route: Route) -> Self {
        Self { route, body: None }
    }

    fn put<T: serde::Serialize>(route: Route, body: &T) -> Result<Self, ProfileClientError> {
        let body = serde_json::to_string(body).map_err(|_| failed("unavailable"))?;
        Ok(Self {
            route,
            body: Some(body),
        })
    }
}

/// Everything one HTTP attempt needs. A struct rather than four arguments because the
/// retry re-issues the identical call with nothing but a new token.
struct Attempt<'a> {
    client: &'a reqwest::Client,
    url: &'a str,
    body: Option<&'a str>,
    access_token: &'a str,
}

enum Attempted {
    Body(String),
    /// The one status worth a refresh: the server rejected a token this device still
    /// considers live, which no local expiry check can detect.
    Unauthorized,
    Refused(ProfileClientError),
}

async fn attempt(call: Attempt<'_>) -> Attempted {
    let request = match call.body {
        Some(body) => call
            .client
            .put(call.url)
            .header("Content-Type", "application/json")
            .body(body.to_string()),
        None => call.client.get(call.url),
    };

    let response = match request.bearer_auth(call.access_token).send().await {
        Ok(response) => response,
        Err(error) => {
            // Only a boolean: reqwest's Display carries the URL and request detail.
            tracing::error!(
                "Profile API transport failure (timeout={})",
                error.is_timeout()
            );
            return Attempted::Refused(failed("unavailable"));
        }
    };

    let status = response.status().as_u16();
    if status == 401 {
        return Attempted::Unauthorized;
    }

    if !response.status().is_success() {
        tracing::error!("Profile API returned status {}", status);
        let body = response.text().await.unwrap_or_default();
        return Attempted::Refused(
            match serde_json::from_str::<AccountErrorEnvelopeWire>(&body) {
                Ok(envelope) => error_from_envelope(status, &envelope.error),
                Err(_) => error_from_status(status),
            },
        );
    }

    match response.text().await {
        Ok(body) => Attempted::Body(body),
        Err(_) => Attempted::Refused(failed("unavailable")),
    }
}

/// A `null` or empty 200 body is the contract's "no such document", not a parse failure.
fn parse_body<T: DeserializeOwned>(body: &str) -> Result<Option<T>, ProfileClientError> {
    let body = body.trim();
    if body.is_empty() || body == "null" {
        return Ok(None);
    }

    serde_json::from_str::<T>(body).map(Some).map_err(|_| {
        // The body itself is never logged: it is the user's profile.
        tracing::error!(
            "Profile API response could not be deserialized ({} bytes)",
            body.len()
        );
        failed("unavailable")
    })
}

/// Sends one call, spending at most one refresh-and-retry, and only on a `401` (AD-9). A
/// `403` is never retried: it means a scope the refresh grant cannot add.
async fn send<T: DeserializeOwned>(
    call: Call,
    expected_sub: &str,
) -> Result<Option<T>, ProfileClientError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|_| failed("unavailable"))?;

    let url = call.route.url();
    let access_token = credential_for(auth::access_token(PROFILE_SCOPE).await, expected_sub)?;

    let mut outcome = attempt(Attempt {
        client: &client,
        url: &url,
        body: call.body.as_deref(),
        access_token: &access_token,
    })
    .await;

    if matches!(outcome, Attempted::Unauthorized) {
        let refreshed = credential_for(
            auth::refresh_access_token(PROFILE_SCOPE).await,
            expected_sub,
        )?;
        outcome = attempt(Attempt {
            client: &client,
            url: &url,
            body: call.body.as_deref(),
            access_token: &refreshed,
        })
        .await;
    }

    match outcome {
        Attempted::Body(body) => parse_body(&body),
        // A second 401 carrying a token minted seconds earlier is not staleness.
        Attempted::Unauthorized => Err(failed("unauthorized")),
        Attempted::Refused(error) => Err(error),
    }
}

/// A 200 with no document is a contract violation on a `PUT`, which always returns one.
fn required<T>(value: Option<T>) -> Result<T, ProfileClientError> {
    value.ok_or_else(|| failed("unavailable"))
}

pub(crate) async fn get_profile(
    expected_sub: &str,
) -> Result<Option<CloudProfileWire>, ProfileClientError> {
    send(Call::get(Route::Profile), expected_sub).await
}

pub(crate) async fn put_profile(
    expected_sub: &str,
    request: &PutProfileRequestWire,
) -> Result<CloudProfileWire, ProfileClientError> {
    required(send(Call::put(Route::Profile, request)?, expected_sub).await?)
}

pub(crate) async fn get_avatar(
    expected_sub: &str,
) -> Result<Option<CloudAvatarWire>, ProfileClientError> {
    send(Call::get(Route::Avatar), expected_sub).await
}

pub(crate) async fn put_avatar(
    expected_sub: &str,
    request: &PutAvatarRequestWire,
) -> Result<CloudAvatarWire, ProfileClientError> {
    required(send(Call::put(Route::Avatar, request)?, expected_sub).await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credentials;
    use crate::models::{CognitoSession, ProfileFields};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    const SUBJECT: &str = "11111111-2222-3333-4444-555555555555";
    const TOKEN_BASE_URL_ENV: &str = "NIXUS_TEST_COGNITO_TOKEN_BASE_URL";

    fn jwt(payload: &str) -> String {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
        format!(
            "{}.{}.{}",
            URL_SAFE_NO_PAD.encode(r#"{"alg":"RS256"}"#),
            URL_SAFE_NO_PAD.encode(payload),
            "c2ln"
        )
    }

    fn access_token(scope: &str, marker: &str) -> String {
        jwt(&format!(
            r#"{{"sub":"{}","token_use":"access","scope":"{}","jti":"{}"}}"#,
            SUBJECT, scope, marker
        ))
    }

    fn id_token() -> String {
        jwt(&format!(
            r#"{{"sub":"{}","email":"user@example.com","token_use":"id"}}"#,
            SUBJECT
        ))
    }

    const FULL_SCOPES: &str = "openid email profile nixus-api/ai.invoke nixus-api/profile";

    /// A live, profile-scoped session written through the sole keyring accessor, exactly as
    /// production does. Far-future expiry so the 120s skew never triggers its own refresh:
    /// the only refresh these tests see is the forced one a 401 spends.
    fn install_session(scope: &str) {
        credentials::store_cognito_session(&CognitoSession {
            access_token: access_token(scope, "original"),
            id_token: id_token(),
            refresh_token: "refresh".to_string(),
            expires_at: 4_000_000_000,
        })
        .expect("session stored");
    }

    struct Stub {
        server: Arc<tiny_http::Server>,
        calls: Arc<AtomicUsize>,
        paths: Arc<Mutex<Vec<String>>>,
        authorizations: Arc<Mutex<Vec<String>>>,
    }

    /// Replies in order; the last one repeats once the script is exhausted, so a test that
    /// expects exactly one call fails loudly on a second rather than hanging.
    fn spawn_stub(script: Vec<(u16, String)>) -> (String, Stub) {
        let server = Arc::new(tiny_http::Server::http("127.0.0.1:0").expect("stub binds"));
        let base = format!(
            "http://127.0.0.1:{}",
            server.server_addr().to_ip().expect("ip addr").port()
        );

        let calls = Arc::new(AtomicUsize::new(0));
        let paths = Arc::new(Mutex::new(Vec::new()));
        let authorizations = Arc::new(Mutex::new(Vec::new()));

        let stub = Stub {
            server: Arc::clone(&server),
            calls: Arc::clone(&calls),
            paths: Arc::clone(&paths),
            authorizations: Arc::clone(&authorizations),
        };

        std::thread::spawn(move || {
            while let Ok(request) = server.recv() {
                let index = calls.fetch_add(1, Ordering::SeqCst);
                paths
                    .lock()
                    .expect("paths lock")
                    .push(request.url().to_string());
                authorizations.lock().expect("auth lock").push(
                    request
                        .headers()
                        .iter()
                        .find(|header| header.field.equiv("Authorization"))
                        .map(|header| header.value.as_str().to_string())
                        .unwrap_or_default(),
                );

                let (status, body) = script
                    .get(index)
                    .or_else(|| script.last())
                    .cloned()
                    .unwrap_or((503, String::new()));

                let header =
                    tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                        .expect("header");
                let _ = request.respond(
                    tiny_http::Response::from_string(body)
                        .with_status_code(status)
                        .with_header(header),
                );
            }
        });

        (base, stub)
    }

    /// Cognito's refresh grant, answering with a token that carries the full scope set and a
    /// different `jti`, so a retry can be told apart from a replay.
    fn spawn_token_stub() -> (String, Stub) {
        let body = serde_json::json!({
            "access_token": access_token(FULL_SCOPES, "refreshed"),
            "id_token": id_token(),
            "expires_in": 3600,
        })
        .to_string();

        spawn_stub(vec![(200, body)])
    }

    /// Runs `body` with the profile client pointed at a loopback stub and the Cognito token
    /// endpoint pointed at its own, under the keyring guard every session-touching test
    /// shares — which is what serializes these process-global env writes.
    fn with_stub<T>(script: Vec<(u16, String)>, body: impl FnOnce() -> T) -> (T, Stub) {
        let _guard = credentials::test_keyring_guard();
        let (base, stub) = spawn_stub(script);
        let (token_base, token_stub) = spawn_token_stub();

        std::env::set_var(TEST_OVERRIDE_ENV, &base);
        std::env::set_var(TOKEN_BASE_URL_ENV, &token_base);

        let outcome = body();

        std::env::remove_var(TEST_OVERRIDE_ENV);
        std::env::remove_var(TOKEN_BASE_URL_ENV);
        stub.server.unblock();
        token_stub.server.unblock();

        (outcome, stub)
    }

    fn envelope(code: &str) -> String {
        serde_json::json!({
            "error": { "code": code, "message": "refused", "request_id": "req-1" }
        })
        .to_string()
    }

    fn profile_body() -> String {
        serde_json::json!({
            "first_name": null,
            "last_name": null,
            "birth_date": null,
            "income_bracket": null,
            "income_bracket_currency": null,
            "country_code": null,
            "subdivision_code": null,
            "version": 1,
            "created_at": "2026-11-17T00:00:00Z",
            "updated_at": "2026-11-17T00:00:00Z",
            "avatar_version": null,
        })
        .to_string()
    }

    fn put_request() -> PutProfileRequestWire {
        PutProfileRequestWire {
            fields: ProfileFields {
                first_name: None,
                last_name: None,
                birth_date: None,
                income_bracket: None,
                income_bracket_currency: None,
                country_code: None,
                subdivision_code: None,
            },
            expected_version: None,
        }
    }

    fn code_of(error: &ProfileClientError) -> String {
        match error {
            ProfileClientError::VersionConflict { .. } => "version_conflict".to_string(),
            ProfileClientError::Failed(AppError::CloudProfile { code, .. }) => code.clone(),
            ProfileClientError::Failed(other) => format!("non-cloud-profile: {other}"),
        }
    }

    // --- base URL and the release-build override gate -----------------------------------

    #[test]
    #[cfg(debug_assertions)]
    fn an_override_that_is_not_https_is_refused() {
        assert_eq!(
            https_override("https://stub.example.com/v1/profile/").as_deref(),
            Some("https://stub.example.com/v1/profile")
        );
        assert!(https_override("http://stub.example.com").is_none());
        assert!(https_override("http://127.0.0.1:3000").is_none());
        assert!(https_override("stub.example.com").is_none());
        assert!(https_override("   ").is_none());
        assert!(https_override("").is_none());
    }

    fn production_source() -> String {
        let source = std::fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("src")
                .join("profile_client.rs"),
        )
        .expect("this module is readable");

        // Cut on the test module's own declaration, so the needles asserted below are never
        // matched against the fixtures and stub URLs in this very file.
        source
            .split_once("mod tests {")
            .map(|(production, _)| production.to_string())
            .expect("this module carries a test module")
    }

    /// GATE (AD-15): "release build has no override".
    ///
    /// Both overrides are reachable only from a `cfg`-gated line, so a release binary
    /// compiles to `PRODUCTION_BASE_URL` and nothing else. Asserted on the source because
    /// the alternative — trusting review — is exactly how H12's token-exfiltration
    /// primitive would get in: one un-gated env read sends a Bearer token anywhere.
    #[test]
    fn every_base_url_override_is_compiled_out_of_a_release_build() {
        let production = production_source();

        let reads: Vec<(usize, &str)> = production
            .lines()
            .enumerate()
            .filter(|(_, line)| line.contains("std::env::var"))
            .collect();
        assert_eq!(reads.len(), 2, "the module reads exactly two env overrides");

        let lines: Vec<&str> = production.lines().collect();
        for (index, line) in reads {
            let gate = lines[index - 1].trim();
            assert!(
                gate == "#[cfg(test)]" || gate == "#[cfg(debug_assertions)]",
                "an env override must sit directly under a cfg gate, but line {} reads {} \
                 under {}",
                index + 1,
                line.trim(),
                gate
            );
        }

        for name in ["OVERRIDE_ENV", "TEST_OVERRIDE_ENV"] {
            let declaration = production
                .find(&format!("const {name}: &str"))
                .unwrap_or_else(|| panic!("{name} is declared"));
            let preceding = production[..declaration].trim_end();
            assert!(
                preceding.ends_with("#[cfg(debug_assertions)]")
                    || preceding.ends_with("#[cfg(test)]"),
                "{name} must be declared under a cfg gate"
            );
        }
    }

    /// The other half of the same gate: whatever the override machinery allows, the only
    /// host this module can name in its own source is the production API.
    #[test]
    fn the_only_literal_host_is_the_production_api() {
        let production = production_source();

        assert!(
            !production.contains("http://"),
            "a plaintext URL must never appear in this module's shipped source"
        );

        let mut hosts: Vec<&str> = production
            .match_indices("https://")
            .map(|(index, _)| {
                let rest = &production[index + "https://".len()..];
                let end = rest
                    .find(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '-')
                    .unwrap_or(rest.len());
                &rest[..end]
            })
            .filter(|host| !host.is_empty())
            .collect();
        hosts.sort_unstable();
        hosts.dedup();

        assert_eq!(
            hosts,
            ["api.nixusapp.com"],
            "the set of hosts this module can address changed"
        );
        assert_eq!(PRODUCTION_BASE_URL, "https://api.nixusapp.com/v1/profile");
    }

    // --- status and envelope mapping ------------------------------------------------------

    /// The inverse map is read back out of the canonical contract rather than restated, so a
    /// status moving in `account.ts` fails here instead of silently mislabelling a refusal.
    #[test]
    fn every_contract_status_maps_back_to_its_own_code() {
        let source = std::fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../../packages/shared/src/types/account.ts"),
        )
        .expect("account.ts is readable");

        let marker = "export const ACCOUNT_ERROR_HTTP_STATUS = {";
        let start = source.find(marker).expect("the status map is declared") + marker.len();
        let end = start + source[start..].find('}').expect("the map is closed");

        let mut seen = 0;
        for line in source[start..end].lines() {
            let Some((code, status)) = line.trim().trim_end_matches(',').split_once(": ") else {
                continue;
            };
            let status: u16 = status.trim().parse().expect("a numeric status");
            assert_eq!(
                code_for_status(status),
                code.trim(),
                "status {status} must map back to {code}"
            );
            seen += 1;
        }
        assert_eq!(seen, 8, "every contract code carries a status");
    }

    #[test]
    fn an_unmapped_status_degrades_to_unavailable() {
        for status in [402, 418, 500, 502, 504, 200] {
            assert_eq!(code_for_status(status), "unavailable");
        }
    }

    #[test]
    fn a_status_without_a_parsable_envelope_is_mapped_by_status_alone() {
        assert_eq!(code_of(&error_from_status(413)), "payload_too_large");
        assert_eq!(code_of(&error_from_status(429)), "rate_limited");
        assert_eq!(code_of(&error_from_status(500)), "unavailable");

        match error_from_status(409) {
            ProfileClientError::VersionConflict {
                resource,
                current_version,
            } => {
                assert!(resource.is_none());
                assert!(current_version.is_none());
            }
            other => panic!("expected a version conflict, got {other:?}"),
        }
    }

    #[test]
    fn every_envelope_code_maps_onto_the_closed_union() {
        for code in crate::account_contract::ERROR_CODES {
            let wire = AccountErrorWire {
                code: code.to_string(),
                message: "refused".to_string(),
                request_id: None,
                field: None,
                reason: None,
                resource: None,
                current_version: None,
            };
            let status = match code {
                "validation" => 400,
                "unauthorized" => 401,
                "version_conflict" => 409,
                "payload_too_large" => 413,
                "unsupported_media" => 415,
                "rate_limited" => 429,
                // `reauthentication_required`'s own 403 is covered by the reclassification
                // test below, which must hold whatever the envelope says.
                _ => 503,
            };

            assert_eq!(code_of(&error_from_envelope(status, &wire)), code);
        }
    }

    #[test]
    fn an_unknown_envelope_code_degrades_to_unavailable() {
        let wire = AccountErrorWire {
            code: "teapot_overheated".to_string(),
            message: "refused".to_string(),
            request_id: None,
            field: None,
            reason: None,
            resource: None,
            current_version: None,
        };

        assert_eq!(code_of(&error_from_envelope(400, &wire)), "unavailable");
    }

    /// AD-13: the gateway returns an insufficient-scope 403 as `unauthorized`, and only the
    /// desktop knows a refresh cannot repair it. So the status decides, not the envelope.
    #[test]
    fn any_403_is_reclassified_as_reauthentication_required() {
        for code in ["unauthorized", "validation", "unavailable", "whatever"] {
            let wire = AccountErrorWire {
                code: code.to_string(),
                message: "refused".to_string(),
                request_id: None,
                field: None,
                reason: None,
                resource: None,
                current_version: None,
            };
            assert_eq!(
                code_of(&error_from_envelope(403, &wire)),
                "reauthentication_required"
            );
        }
        assert_eq!(
            code_of(&error_from_status(403)),
            "reauthentication_required"
        );
    }

    #[test]
    fn a_version_conflict_surfaces_its_resource_and_current_version() {
        let wire = AccountErrorWire {
            code: "version_conflict".to_string(),
            message: "refused".to_string(),
            request_id: None,
            field: None,
            reason: None,
            resource: Some("avatar".to_string()),
            current_version: Some(7),
        };

        match error_from_envelope(409, &wire) {
            ProfileClientError::VersionConflict {
                resource,
                current_version,
            } => {
                assert_eq!(resource, Some(VersionedResource::Avatar));
                assert_eq!(current_version, Some(7));
            }
            other => panic!("expected a version conflict, got {other:?}"),
        }
    }

    #[test]
    fn an_unknown_conflict_resource_is_dropped_rather_than_guessed() {
        let wire = AccountErrorWire {
            code: "version_conflict".to_string(),
            message: "refused".to_string(),
            request_id: None,
            field: None,
            reason: None,
            resource: Some("entitlement".to_string()),
            current_version: None,
        };

        match error_from_envelope(409, &wire) {
            ProfileClientError::VersionConflict { resource, .. } => assert!(resource.is_none()),
            other => panic!("expected a version conflict, got {other:?}"),
        }
    }

    #[test]
    fn a_validation_envelope_carries_only_contract_members() {
        let wire = AccountErrorWire {
            code: "validation".to_string(),
            message: "refused".to_string(),
            request_id: None,
            field: Some("birth_date".to_string()),
            reason: Some("too_young".to_string()),
            resource: None,
            current_version: None,
        };

        match error_from_envelope(400, &wire) {
            ProfileClientError::Failed(AppError::CloudProfile {
                field,
                reason,
                recoverable,
                ..
            }) => {
                assert_eq!(field.as_deref(), Some("birth_date"));
                assert_eq!(reason.as_deref(), Some("too_young"));
                assert!(!recoverable, "a refused value will be refused again");
            }
            other => panic!("expected a validation failure, got {other:?}"),
        }
    }

    #[test]
    fn an_unknown_field_or_reason_is_dropped_rather_than_passed_through() {
        let wire = AccountErrorWire {
            code: "validation".to_string(),
            message: "refused".to_string(),
            request_id: None,
            field: Some("favourite_colour".to_string()),
            reason: Some("vibes".to_string()),
            resource: None,
            current_version: None,
        };

        match error_from_envelope(400, &wire) {
            ProfileClientError::Failed(AppError::CloudProfile { field, reason, .. }) => {
                assert!(field.is_none());
                assert!(reason.is_none());
            }
            other => panic!("expected a validation failure, got {other:?}"),
        }
    }

    /// AD-12: no message this module can produce carries a submitted value, an identifier,
    /// a token or a URL. Asserted over every code because one interpolated message is all it
    /// takes, and the UI never renders these strings anyway.
    #[test]
    fn no_error_message_can_carry_a_value_or_an_identifier() {
        for code in crate::account_contract::ERROR_CODES {
            let message = message_for(code);
            assert!(!message.is_empty());
            for forbidden in ["{", "}", "://", "Bearer", "nixus-api/", SUBJECT] {
                assert!(
                    !message.contains(forbidden),
                    "the {code} message must not contain {forbidden}"
                );
            }
        }
    }

    #[test]
    fn only_a_refused_value_or_a_refused_file_is_unrecoverable() {
        for code in ["validation", "payload_too_large", "unsupported_media"] {
            assert!(!recoverable_for(code));
        }
        for code in [
            "unauthorized",
            "reauthentication_required",
            "version_conflict",
            "rate_limited",
            "unavailable",
        ] {
            assert!(recoverable_for(code));
        }
    }

    /// A version conflict still has to cross IPC as the one `AppError` shape the contract
    /// defines, so the structural members are dropped only at that boundary.
    #[test]
    fn a_version_conflict_flattens_into_the_contract_error_shape() {
        let error: AppError = ProfileClientError::VersionConflict {
            resource: Some(VersionedResource::Profile),
            current_version: Some(3),
        }
        .into();

        match error {
            AppError::CloudProfile {
                code, recoverable, ..
            } => {
                assert_eq!(code, "version_conflict");
                assert!(recoverable);
            }
            other => panic!("expected a cloud profile error, got {other}"),
        }
    }

    // --- the accessor seam ---------------------------------------------------------------

    #[test]
    fn a_token_for_another_subject_is_never_used() {
        let error = credential_for(
            Ok(AccessTokenAuth::Ready {
                access_token: "at".to_string(),
                subject_sub: "some-other-account".to_string(),
            }),
            SUBJECT,
        )
        .expect_err("a foreign subject must be refused");

        assert_eq!(code_of(&error), "unauthorized");
    }

    #[test]
    fn the_accessors_outcomes_map_onto_the_contract_codes() {
        assert_eq!(
            credential_for(
                Ok(AccessTokenAuth::Ready {
                    access_token: "at".to_string(),
                    subject_sub: SUBJECT.to_string(),
                }),
                SUBJECT
            )
            .expect("a matching subject is usable"),
            "at"
        );
        assert_eq!(
            code_of(
                &credential_for(Ok(AccessTokenAuth::ReauthenticationRequired), SUBJECT)
                    .expect_err("refused")
            ),
            "reauthentication_required"
        );
        assert_eq!(
            code_of(&credential_for(Ok(AccessTokenAuth::SignedOut), SUBJECT).expect_err("refused")),
            "unauthorized"
        );
    }

    #[test]
    fn a_json_null_body_reads_as_no_document() {
        assert!(parse_body::<CloudProfileWire>("null")
            .expect("null is a legal body")
            .is_none());
        assert!(parse_body::<CloudProfileWire>("   ")
            .expect("an empty body is a legal body")
            .is_none());
        assert!(parse_body::<CloudProfileWire>("{\"nope\":1}").is_err());
    }

    // --- the real client against a loopback stub -----------------------------------------

    #[test]
    fn a_missing_profile_scope_issues_no_request_at_all() {
        let (outcome, stub) = with_stub(vec![(200, profile_body())], || {
            install_session("openid email profile nixus-api/ai.invoke");
            tauri::async_runtime::block_on(get_profile(SUBJECT))
        });

        assert_eq!(
            code_of(&outcome.expect_err("refused")),
            "reauthentication_required"
        );
        assert_eq!(
            stub.calls.load(Ordering::SeqCst),
            0,
            "a locally verifiable scope failure must not reach the network"
        );
    }

    #[test]
    fn a_profile_is_fetched_with_a_bearer_token_from_the_accessor() {
        let (outcome, stub) = with_stub(vec![(200, profile_body())], || {
            install_session(FULL_SCOPES);
            tauri::async_runtime::block_on(get_profile(SUBJECT))
        });

        let profile = outcome.expect("fetched").expect("a document");
        assert_eq!(profile.version, 1);
        assert_eq!(stub.calls.load(Ordering::SeqCst), 1);
        assert_eq!(stub.paths.lock().expect("paths").as_slice(), ["/"]);
        assert!(stub.authorizations.lock().expect("auth")[0].starts_with("Bearer "));
    }

    #[test]
    fn a_null_body_reads_as_no_cloud_profile_yet() {
        let (outcome, _stub) = with_stub(vec![(200, "null".to_string())], || {
            install_session(FULL_SCOPES);
            tauri::async_runtime::block_on(get_profile(SUBJECT))
        });

        assert!(outcome.expect("fetched").is_none());
    }

    #[test]
    fn the_avatar_route_is_a_sibling_of_the_profile_route() {
        let (outcome, stub) = with_stub(vec![(200, "null".to_string())], || {
            install_session(FULL_SCOPES);
            tauri::async_runtime::block_on(get_avatar(SUBJECT))
        });

        assert!(outcome.expect("fetched").is_none());
        assert_eq!(stub.paths.lock().expect("paths").as_slice(), ["/avatar"]);
    }

    /// AD-9's single refresh-and-retry: the second attempt must carry a *different* token,
    /// or the retry is a replay that cannot repair anything.
    #[test]
    fn a_401_is_retried_exactly_once_with_a_refreshed_token() {
        let (outcome, stub) = with_stub(
            vec![(401, envelope("unauthorized")), (200, profile_body())],
            || {
                install_session(FULL_SCOPES);
                tauri::async_runtime::block_on(get_profile(SUBJECT))
            },
        );

        assert!(outcome.expect("fetched").is_some());
        assert_eq!(stub.calls.load(Ordering::SeqCst), 2);

        let authorizations = stub.authorizations.lock().expect("auth");
        assert_ne!(
            authorizations[0], authorizations[1],
            "the retry must spend the refreshed token, not replay the rejected one"
        );
    }

    #[test]
    fn a_second_401_is_not_retried_again() {
        let (outcome, stub) = with_stub(vec![(401, envelope("unauthorized"))], || {
            install_session(FULL_SCOPES);
            tauri::async_runtime::block_on(get_profile(SUBJECT))
        });

        assert_eq!(code_of(&outcome.expect_err("refused")), "unauthorized");
        assert_eq!(
            stub.calls.load(Ordering::SeqCst),
            2,
            "one attempt plus one retry, never a third"
        );
    }

    /// A 403 means a scope the refresh grant cannot add, so spending the refresh on it would
    /// cost a round-trip and a token for an answer that cannot change.
    #[test]
    fn a_403_is_never_retried() {
        let (outcome, stub) = with_stub(vec![(403, envelope("unauthorized"))], || {
            install_session(FULL_SCOPES);
            tauri::async_runtime::block_on(get_profile(SUBJECT))
        });

        assert_eq!(
            code_of(&outcome.expect_err("refused")),
            "reauthentication_required"
        );
        assert_eq!(stub.calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_put_sends_the_request_body_and_returns_the_server_document() {
        let (outcome, stub) = with_stub(vec![(200, profile_body())], || {
            install_session(FULL_SCOPES);
            tauri::async_runtime::block_on(async { put_profile(SUBJECT, &put_request()).await })
        });

        assert_eq!(outcome.expect("saved").version, 1);
        assert_eq!(stub.calls.load(Ordering::SeqCst), 1);
    }

    /// A `PUT` always answers with the stored document, so a `null` is a server contract
    /// violation rather than "there is no profile".
    #[test]
    fn a_put_answered_with_no_document_is_unavailable_rather_than_absent() {
        let (outcome, _stub) = with_stub(vec![(200, "null".to_string())], || {
            install_session(FULL_SCOPES);
            tauri::async_runtime::block_on(async { put_profile(SUBJECT, &put_request()).await })
        });

        assert_eq!(code_of(&outcome.expect_err("refused")), "unavailable");
    }

    #[test]
    fn a_version_conflict_reaches_the_caller_with_its_structure_intact() {
        let body = serde_json::json!({
            "error": {
                "code": "version_conflict",
                "message": "refused",
                "request_id": "req-1",
                "resource": "profile",
                "current_version": 4,
            }
        })
        .to_string();

        let (outcome, _stub) = with_stub(vec![(409, body)], || {
            install_session(FULL_SCOPES);
            tauri::async_runtime::block_on(async { put_profile(SUBJECT, &put_request()).await })
        });

        match outcome.expect_err("refused") {
            ProfileClientError::VersionConflict {
                resource,
                current_version,
            } => {
                assert_eq!(resource, Some(VersionedResource::Profile));
                assert_eq!(current_version, Some(4));
            }
            other => panic!("expected a version conflict, got {other:?}"),
        }
    }

    #[test]
    fn a_gateway_shaped_body_still_maps_by_status() {
        let (outcome, _stub) = with_stub(
            vec![(429, r#"{"message":"Too Many Requests"}"#.to_string())],
            || {
                install_session(FULL_SCOPES);
                tauri::async_runtime::block_on(get_profile(SUBJECT))
            },
        );

        assert_eq!(code_of(&outcome.expect_err("refused")), "rate_limited");
    }
}
