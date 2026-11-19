//! The sole Nixus Cloud billing network module (billing AD-7), and the only file in the crate
//! allowed to hold an HTTP client for `https://api.nixusapp.com/v1/billing` — asserted by
//! `commands/cloud_link.rs`'s network allowlist test.
//!
//! No credential of any kind is read here: the only one is a call-time access token from
//! `commands/auth.rs`, verified against `BILLING_SCOPE`, so this module must never call
//! `credentials.rs` or `keyring_core`. It holds no Stripe credential and calls Stripe never;
//! commerce is reached only by opening a server-issued URL in the **system browser** (AD-8).
//!
//! Two shapes in here are load-bearing rather than incidental:
//!
//! 1. **The entitlement response is read for its statement and nothing else.** AD-4 pins one
//!    representation per consumer class: a *device* consumer reads the AD-9 signed statement and
//!    never the record. So `EntitlementWire` deserialises `statement` and `statement_exp` and
//!    deliberately has no `capabilities` or `tier` member — a caller physically cannot derive a
//!    grant from the unsigned body, which is what keeps the device and the server from ever
//!    disagreeing about what may be trusted.
//! 2. **`client_too_old` is its own outcome and never a sign-out.** Signing the user out would be
//!    the wrong remedy for a build the server will not serve, and would recreate exactly the
//!    "a plan or client limitation read as an auth failure" confusion AD-12 exists to prevent.

use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use crate::commands::auth::{self, AccessTokenAuth, BILLING_SCOPE};
use crate::error::AppError;

/// Compiled into every build, and the only base URL a release binary can reach (AD-7, AD-15).
const PRODUCTION_BASE_URL: &str = "https://api.nixusapp.com/v1/billing";

#[cfg(debug_assertions)]
const OVERRIDE_ENV: &str = "NIXUS_BILLING_API_BASE_URL";

/// Lets the tests below drive the real client against a loopback stub. `#[cfg(test)]`, so it
/// does not exist in any shipped binary — the same seam `profile_client` uses, and the reason
/// the `debug_assertions` override can stay `https`-only with no exception.
#[cfg(test)]
const TEST_OVERRIDE_ENV: &str = "NIXUS_TEST_BILLING_API_BASE_URL";

const REQUEST_TIMEOUT_SECS: u64 = 15;

/// `BILLING_CLIENT_VERSION_HEADER` in the shared contract. The header the server's minimum-version
/// floor reads, which is half of AD-9's revocation path for a leaked signing key.
const CLIENT_VERSION_HEADER: &str = "x-nixus-client-version";

/// The closed billing error union, mirroring `BILLING_ERROR_CODES`. Pinned against the contract
/// source by a test, so a code added on either side fails here rather than at runtime.
const ERROR_CODES: [&str; 11] = [
    "unauthorized",
    "reauthentication_required",
    "validation",
    "premium_required",
    "version_conflict",
    "rate_limited",
    "unavailable",
    "promotion_invalid",
    "checkout_in_progress",
    "client_too_old",
    "no_subscription",
];

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
        tracing::warn!("Ignoring the billing API base URL override: it must be https");
        return None;
    }

    Some(trimmed.to_string())
}

/// This build's own version, for `CLIENT_VERSION_HEADER`. Read from the crate manifest rather
/// than restated, so the header can never disagree with the binary it was sent from.
fn client_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Why a billing call granted nothing.
///
/// Distinct variants rather than one error string, because the five classes are acted on
/// differently and conflating any two of them is a user-visible defect:
///
/// - `SignedOut` is the only one that may end the session.
/// - `ReauthenticationRequired` demands a fresh sign-in, which a refresh cannot substitute for:
///   Cognito's refresh grant replays the originally granted scopes and cannot add one.
/// - `ForcedUpgrade` must **not** sign the user out and must not be retried. The build is below
///   the server's floor, and only installing a newer one repairs it.
/// - `CapabilityRefused` is a plan limitation, never an error and never an auth failure (AD-12).
/// - `Rejected` is a refusal of this request's own contents; resending it unchanged cannot help.
/// - `Transient` is everything that a wait or a retry can repair, including an unknown code — an
///   outage must degrade, never strand (AD-13's additive evolution).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum BillingRefusal {
    SignedOut,
    ReauthenticationRequired,
    ForcedUpgrade {
        /// The lowest version the server will serve, when it named one.
        minimum_client_version: Option<String>,
    },
    CapabilityRefused,
    Rejected {
        code: &'static str,
    },
    Transient,
}

/// Maps any wire code — including one a newer server added — onto the closed union.
fn normalize_error_code(code: &str) -> &'static str {
    ERROR_CODES
        .iter()
        .find(|known| **known == code)
        .copied()
        .unwrap_or("unavailable")
}

/// The one place a contract code becomes a desktop outcome.
///
/// `unauthorized` resolves to `SignedOut` here because the single refresh-and-retry has already
/// been spent by the time this is reached for that code: a second rejection of a token minted
/// seconds earlier is not staleness.
fn refusal_for(code: &str, minimum_client_version: Option<String>) -> BillingRefusal {
    match normalize_error_code(code) {
        "unauthorized" => BillingRefusal::SignedOut,
        "reauthentication_required" => BillingRefusal::ReauthenticationRequired,
        "client_too_old" => BillingRefusal::ForcedUpgrade {
            minimum_client_version,
        },
        "premium_required" => BillingRefusal::CapabilityRefused,
        "validation" => BillingRefusal::Rejected { code: "validation" },
        "version_conflict" => BillingRefusal::Rejected {
            code: "version_conflict",
        },
        "promotion_invalid" => BillingRefusal::Rejected {
            code: "promotion_invalid",
        },
        "checkout_in_progress" => BillingRefusal::Rejected {
            code: "checkout_in_progress",
        },
        // Rejected, never Transient: a hand-granted account has no subscription to manage and a
        // retry cannot create one, so this must not reach the wait-and-retry copy below.
        "no_subscription" => BillingRefusal::Rejected {
            code: "no_subscription",
        },
        // `normalize_error_code` closes the set, so this arm is `rate_limited` and `unavailable`.
        _ => BillingRefusal::Transient,
    }
}

/// The inverse of the contract's `BILLING_ERROR_HTTP_STATUS`, for a rejection whose body is not
/// a parsable envelope. An unmapped status is `unavailable`, never a guess.
///
/// `403` cannot be resolved by status alone: the contract pins `reauthentication_required`,
/// `premium_required` and `client_too_old` to it, distinguished by their `code` and not by their
/// status. With no envelope to read, the conservative answer is the one that neither signs the
/// user out nor claims anything about their plan.
fn code_for_status(status: u16) -> &'static str {
    match status {
        400 => "validation",
        401 => "unauthorized",
        403 => "reauthentication_required",
        409 => "version_conflict",
        413 => "validation",
        429 => "rate_limited",
        _ => "unavailable",
    }
}

#[derive(Deserialize)]
struct BillingErrorEnvelopeWire {
    error: BillingErrorWire,
}

#[derive(Deserialize)]
struct BillingErrorWire {
    code: String,
    #[serde(default)]
    minimum_client_version: Option<String>,
}

/// `GET /entitlement`, read for the statement and nothing else — see this module's header.
///
/// `statement_exp` is deliberately absent too, even though the contract offers it: the desktop's
/// revalidation schedule is the hosted-status window, not an expiry countdown, and the statement
/// carries its own `exp` for the verifier anyway. A second copy of it here could only disagree
/// with the one that was signed.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct EntitlementWire {
    /// The compact signed statement. Never logged (AD-14).
    pub statement: String,
}

/// `POST /checkout` and `POST /portal`. Both answer with a URL, and `destination` only names the
/// surface that URL leads to — the caller opens it either way (AD-18).
#[derive(Debug, Clone, Deserialize)]
struct CommerceUrlWire {
    url: String,
}

/// Resolves the accessor's answer into a usable token, or into the refusal that answer means —
/// without issuing any request, which is the point of verifying the scope locally.
///
/// `expected_sub` is mandatory rather than optional: the keyring holds one machine-wide session,
/// so a token whose subject is not the caller's own `sub` would fetch another account's
/// entitlement, and a statement bound to that other `sub` is exactly what the cache's
/// subject-binding check exists to refuse.
fn credential_for(
    auth: Result<AccessTokenAuth, AppError>,
    expected_sub: &str,
) -> Result<String, BillingRefusal> {
    match auth {
        Ok(AccessTokenAuth::Ready {
            access_token,
            subject_sub,
        }) => {
            if subject_sub == expected_sub {
                Ok(access_token)
            } else {
                Err(BillingRefusal::SignedOut)
            }
        }
        Ok(AccessTokenAuth::ReauthenticationRequired) => {
            Err(BillingRefusal::ReauthenticationRequired)
        }
        Ok(AccessTokenAuth::SignedOut) => Err(BillingRefusal::SignedOut),
        // An unreadable session blob is a local fault, not a statement that this account lost
        // its session, so it is transient rather than a sign-out.
        Err(_) => Err(BillingRefusal::Transient),
    }
}

#[derive(Clone, Copy)]
enum Route {
    Entitlement,
    Checkout,
    Portal,
}

impl Route {
    fn url(self) -> String {
        let base = base_url();
        match self {
            Self::Entitlement => format!("{base}/entitlement"),
            Self::Checkout => format!("{base}/checkout"),
            Self::Portal => format!("{base}/portal"),
        }
    }
}

/// One billing call. `body` absent means `GET`, present means `POST` — the contract has no other
/// method on any route this client reaches, so the two cannot drift into separate code paths.
struct Call {
    route: Route,
    body: Option<String>,
}

impl Call {
    fn get(route: Route) -> Self {
        Self { route, body: None }
    }

    fn post<T: serde::Serialize>(route: Route, body: &T) -> Result<Self, BillingRefusal> {
        let body = serde_json::to_string(body).map_err(|_| BillingRefusal::Transient)?;
        Ok(Self {
            route,
            body: Some(body),
        })
    }
}

/// Everything one HTTP attempt needs. A struct rather than four arguments because the retry
/// re-issues the identical call with nothing but a new token.
struct Attempt<'a> {
    client: &'a reqwest::Client,
    url: &'a str,
    body: Option<&'a str>,
    access_token: &'a str,
}

enum Attempted {
    Body(String),
    /// The one status worth a refresh: the server rejected a token this device still considers
    /// live, which no local expiry check can detect.
    Unauthorized,
    Refused(BillingRefusal),
}

async fn attempt(call: Attempt<'_>) -> Attempted {
    let request = match call.body {
        Some(body) => call
            .client
            .post(call.url)
            .header("Content-Type", "application/json")
            .body(body.to_string()),
        None => call.client.get(call.url),
    };

    let response = match request
        .header(CLIENT_VERSION_HEADER, client_version())
        .bearer_auth(call.access_token)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            // Only a boolean: reqwest's Display carries the URL and request detail.
            tracing::error!(
                "Billing API transport failure (timeout={})",
                error.is_timeout()
            );
            return Attempted::Refused(BillingRefusal::Transient);
        }
    };

    let status = response.status().as_u16();
    if status == 401 {
        return Attempted::Unauthorized;
    }

    if !response.status().is_success() {
        tracing::error!("Billing API returned status {}", status);
        let body = response.text().await.unwrap_or_default();
        return Attempted::Refused(
            match serde_json::from_str::<BillingErrorEnvelopeWire>(&body) {
                Ok(envelope) => {
                    refusal_for(&envelope.error.code, envelope.error.minimum_client_version)
                }
                Err(_) => refusal_for(code_for_status(status), None),
            },
        );
    }

    match response.text().await {
        Ok(body) => Attempted::Body(body),
        Err(_) => Attempted::Refused(BillingRefusal::Transient),
    }
}

/// Sends one call, spending at most one refresh-and-retry, and only on a `401` (AD-9). A `403`
/// is never retried: whatever its code, no refresh can repair it.
async fn send<T: DeserializeOwned>(call: Call, expected_sub: &str) -> Result<T, BillingRefusal> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|_| BillingRefusal::Transient)?;

    let url = call.route.url();
    let access_token = credential_for(auth::access_token(BILLING_SCOPE).await, expected_sub)?;

    let mut outcome = attempt(Attempt {
        client: &client,
        url: &url,
        body: call.body.as_deref(),
        access_token: &access_token,
    })
    .await;

    if matches!(outcome, Attempted::Unauthorized) {
        let refreshed = credential_for(
            auth::refresh_access_token(BILLING_SCOPE).await,
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
        Attempted::Body(body) => serde_json::from_str::<T>(&body).map_err(|_| {
            // The body itself is never logged: it carries the signed statement (AD-14).
            tracing::error!(
                "Billing API response could not be deserialized ({} bytes)",
                body.len()
            );
            BillingRefusal::Transient
        }),
        Attempted::Unauthorized => Err(BillingRefusal::SignedOut),
        Attempted::Refused(refusal) => Err(refusal),
    }
}

/// The signed statement for `expected_sub`, as the server currently holds it (AD-9).
///
/// A signed-in account with no subscription receives a normal, verifiable statement with an empty
/// capability list, so a caller can tell *verified free* from *could not reach the server*: the
/// first is `Ok` and grants nothing, the second is `Err(Transient)`.
pub(crate) async fn get_entitlement(expected_sub: &str) -> Result<EntitlementWire, BillingRefusal> {
    send(Call::get(Route::Entitlement), expected_sub).await
}

#[derive(serde::Serialize)]
struct CheckoutRequestWire<'a> {
    plan_lookup_key: &'a str,
    promotion_code: Option<&'a str>,
}

/// Opens Stripe-hosted Checkout for `plan_lookup_key` in the **system browser** (AD-8).
///
/// Returning `()` is the enforcement, not a convenience: the URL never leaves this module, so
/// there is no value a caller could hand to the webview even by mistake. Nixus renders no card
/// field on any surface, and this is the only path by which commerce is reached at all.
pub(crate) async fn open_checkout(
    app: &AppHandle,
    expected_sub: &str,
    plan_lookup_key: &str,
    promotion_code: Option<&str>,
) -> Result<(), BillingRefusal> {
    let request = CheckoutRequestWire {
        plan_lookup_key,
        promotion_code,
    };
    let wire: CommerceUrlWire = send(Call::post(Route::Checkout, &request)?, expected_sub).await?;

    open_externally(app, &wire.url)
}

/// Opens the Stripe-hosted Customer Portal in the **system browser** (AD-8). Same enforcement,
/// same reason as `open_checkout`.
pub(crate) async fn open_portal(app: &AppHandle, expected_sub: &str) -> Result<(), BillingRefusal> {
    let wire: CommerceUrlWire = send(
        Call::post(Route::Portal, &serde_json::json!({}))?,
        expected_sub,
    )
    .await?;

    open_externally(app, &wire.url)
}

/// The app's existing external-link opener, which is the same one the Cognito Hosted UI is
/// launched through. No new plugin and no new capability: `opener:default` is already granted.
fn open_externally(app: &AppHandle, url: &str) -> Result<(), BillingRefusal> {
    if app.opener().open_url(url, None::<&str>).is_err() {
        // The opener error is discarded on purpose: `Error::ForbiddenUrl`'s Display embeds the
        // URL, which carries a single-use Stripe session identifier.
        tracing::error!("Failed to open the system browser for a billing surface");
        return Err(BillingRefusal::Transient);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::credentials;
    use crate::models::CognitoSession;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    const SUBJECT: &str = "11111111-2222-3333-4444-555555555555";
    const TOKEN_BASE_URL_ENV: &str = "NIXUS_TEST_COGNITO_TOKEN_BASE_URL";
    const FULL_SCOPES: &str =
        "openid email profile nixus-api/ai.invoke nixus-api/profile nixus-api/billing";

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
            r#"{{"sub":"{SUBJECT}","token_use":"access","scope":"{scope}","jti":"{marker}"}}"#
        ))
    }

    fn id_token() -> String {
        jwt(&format!(
            r#"{{"sub":"{SUBJECT}","email":"user@example.com","token_use":"id"}}"#
        ))
    }

    /// A live, billing-scoped session written through the sole keyring accessor, exactly as
    /// production does. Far-future expiry so the 120s skew never triggers its own refresh.
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
        client_versions: Arc<Mutex<Vec<String>>>,
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
        let client_versions = Arc::new(Mutex::new(Vec::new()));

        let stub = Stub {
            server: Arc::clone(&server),
            calls: Arc::clone(&calls),
            paths: Arc::clone(&paths),
            authorizations: Arc::clone(&authorizations),
            client_versions: Arc::clone(&client_versions),
        };

        std::thread::spawn(move || {
            while let Ok(request) = server.recv() {
                let index = calls.fetch_add(1, Ordering::SeqCst);
                paths
                    .lock()
                    .expect("paths lock")
                    .push(request.url().to_string());

                let header_value = |name: &'static str| {
                    request
                        .headers()
                        .iter()
                        .find(|header| header.field.equiv(name))
                        .map(|header| header.value.as_str().to_string())
                        .unwrap_or_default()
                };
                authorizations
                    .lock()
                    .expect("auth lock")
                    .push(header_value("Authorization"));
                client_versions
                    .lock()
                    .expect("version lock")
                    .push(header_value(CLIENT_VERSION_HEADER));

                let (status, reply) = script
                    .get(index)
                    .or_else(|| script.last())
                    .cloned()
                    .unwrap_or((503, String::new()));

                let header =
                    tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
                        .expect("header");
                let _ = request.respond(
                    tiny_http::Response::from_string(reply)
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

    /// A full `EntitlementResponse` as the contract declares it, so the "read the statement and
    /// nothing else" claim is tested against the real body rather than a trimmed one.
    fn entitlement_body(statement: &str) -> String {
        serde_json::json!({
            "tier": "advance",
            "capabilities": ["hosted_ai", "household_net_worth", "multi_device_sync"],
            "status": "active",
            "current_period_end": 1_800_086_400_i64,
            "monthly_request_limit": 500,
            "source": "stripe",
            "statement": statement,
            "statement_exp": 1_800_086_400_i64,
            "version": 3,
            "stripe_state": {
                "tier": "advance",
                "status": "active",
                "current_period_end": 1_800_086_400_i64,
            },
        })
        .to_string()
    }

    // --- base URL and the release-build override gate -----------------------------------

    #[test]
    #[cfg(debug_assertions)]
    fn an_override_that_is_not_https_is_refused() {
        assert_eq!(
            https_override("https://stub.example.com/v1/billing/").as_deref(),
            Some("https://stub.example.com/v1/billing")
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
                .join("billing_client.rs"),
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
    /// Both overrides are reachable only from a `cfg`-gated line, so a release binary compiles
    /// to `PRODUCTION_BASE_URL` and nothing else. Asserted on the source because the
    /// alternative — trusting review — is exactly how a token-exfiltration primitive would get
    /// in: one un-gated env read sends a Bearer token anywhere.
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

    /// The other half of the same gate: whatever the override machinery allows, the only host
    /// this module can name in its own source is the production API.
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
        assert_eq!(PRODUCTION_BASE_URL, "https://api.nixusapp.com/v1/billing");
    }

    // --- the shared contract, read from its source ---------------------------------------

    fn billing_contract() -> String {
        std::fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../../packages/shared/src/types/billing.ts"),
        )
        .expect("billing.ts is readable")
    }

    /// The quoted members of `export const <name> = [ ... ] as const`, comments skipped.
    /// Mirrors `entitlements.rs`'s reader so both contract tests parse the same way.
    fn ts_array(source: &str, name: &str) -> Vec<String> {
        let start_marker = format!("export const {name} = [");
        let start = source
            .find(&start_marker)
            .unwrap_or_else(|| panic!("{name} is declared in billing.ts"))
            + start_marker.len();
        let end = start + source[start..].find("] as const").expect("array is closed");

        source[start..end]
            .lines()
            .map(str::trim)
            .filter(|line| !line.starts_with("/**") && !line.starts_with('*'))
            .flat_map(|line| line.split(','))
            .filter_map(|item| {
                let item = item.trim();
                item.strip_prefix('"')
                    .and_then(|rest| rest.strip_suffix('"'))
                    .map(str::to_string)
            })
            .collect()
    }

    #[test]
    fn the_error_union_matches_the_shared_contract_exactly() {
        let shared = ts_array(&billing_contract(), "BILLING_ERROR_CODES");
        let rust: Vec<String> = ERROR_CODES.iter().map(|code| code.to_string()).collect();

        assert_eq!(
            rust, shared,
            "the closed error union is the same on both sides"
        );
    }

    /// The status map read back out of the canonical contract rather than restated, so a status
    /// moving in `billing.ts` fails here instead of silently mislabelling a refusal.
    ///
    /// Asserted as "maps back to A code that carries this status", not to one particular code,
    /// because the contract deliberately shares statuses: `400` carries `validation` and
    /// `promotion_invalid`, `409` carries `version_conflict` and `checkout_in_progress`, and
    /// `403` carries three. Where a status is shared the envelope decides and this inverse is
    /// only the no-envelope fallback, so the requirement on it is that it never invents a code
    /// the status cannot mean.
    #[test]
    fn every_contract_status_maps_back_to_a_code_that_carries_it() {
        let source = billing_contract();
        let marker = "export const BILLING_ERROR_HTTP_STATUS = {";
        let start = source.find(marker).expect("the status map is declared") + marker.len();
        let end = start + source[start..].find('}').expect("the map is closed");

        let mut by_status: std::collections::BTreeMap<u16, Vec<String>> = Default::default();
        for line in source[start..end].lines() {
            let Some((code, status)) = line.trim().trim_end_matches(',').split_once(": ") else {
                continue;
            };
            let status: u16 = status.trim().parse().expect("a numeric status");
            by_status
                .entry(status)
                .or_default()
                .push(code.trim().to_string());
        }

        assert_eq!(
            by_status.values().map(Vec::len).sum::<usize>(),
            ERROR_CODES.len(),
            "every code carries a status"
        );

        for (status, codes) in &by_status {
            let mapped = code_for_status(*status).to_string();
            assert!(
                codes.contains(&mapped),
                "status {status} may mean {codes:?}, and this build maps it to {mapped}"
            );
        }

        // `403`'s fallback specifically must be the one of its three codes that neither signs
        // the user out nor claims anything about their plan (AD-12).
        assert_eq!(code_for_status(403), "reauthentication_required");
        assert_eq!(
            by_status.get(&403).map(Vec::len),
            Some(3),
            "403 is shared by exactly three codes, which is why it needs its own rule"
        );
    }

    #[test]
    fn an_unmapped_status_degrades_to_a_transient_refusal() {
        for status in [402, 418, 500, 502, 504, 200] {
            assert_eq!(code_for_status(status), "unavailable");
            assert_eq!(
                refusal_for(code_for_status(status), None),
                BillingRefusal::Transient
            );
        }
    }

    /// An unknown code must degrade rather than strand (AD-13's additive evolution).
    #[test]
    fn an_unknown_code_degrades_to_a_transient_refusal() {
        for code in ["teapot_overheated", "", "PREMIUM_REQUIRED"] {
            assert_eq!(normalize_error_code(code), "unavailable");
            assert_eq!(refusal_for(code, None), BillingRefusal::Transient);
        }
    }

    #[test]
    fn every_contract_code_maps_onto_a_named_outcome() {
        let expected: Vec<(&str, BillingRefusal)> = vec![
            ("unauthorized", BillingRefusal::SignedOut),
            (
                "reauthentication_required",
                BillingRefusal::ReauthenticationRequired,
            ),
            (
                "validation",
                BillingRefusal::Rejected { code: "validation" },
            ),
            ("premium_required", BillingRefusal::CapabilityRefused),
            (
                "version_conflict",
                BillingRefusal::Rejected {
                    code: "version_conflict",
                },
            ),
            ("rate_limited", BillingRefusal::Transient),
            ("unavailable", BillingRefusal::Transient),
            (
                "promotion_invalid",
                BillingRefusal::Rejected {
                    code: "promotion_invalid",
                },
            ),
            (
                "checkout_in_progress",
                BillingRefusal::Rejected {
                    code: "checkout_in_progress",
                },
            ),
            (
                "client_too_old",
                BillingRefusal::ForcedUpgrade {
                    minimum_client_version: None,
                },
            ),
            (
                "no_subscription",
                BillingRefusal::Rejected {
                    code: "no_subscription",
                },
            ),
        ];

        for (code, outcome) in &expected {
            assert_eq!(&refusal_for(code, None), outcome, "code {code}");
        }
        assert_eq!(
            expected.len(),
            ERROR_CODES.len(),
            "every member of the closed union has an explicit outcome"
        );
    }

    /// AD-9's revocation path, and the one refusal that must never end a session: a build below
    /// the server's floor is repaired by installing a newer one, and signing the user out would
    /// be both useless and exactly the auth-failure confusion AD-12 forbids.
    #[test]
    fn a_client_too_old_refusal_is_a_forced_upgrade_and_never_a_sign_out() {
        let refusal = refusal_for("client_too_old", Some("0.4.0".to_string()));

        assert_eq!(
            refusal,
            BillingRefusal::ForcedUpgrade {
                minimum_client_version: Some("0.4.0".to_string())
            }
        );
        assert_ne!(refusal, BillingRefusal::SignedOut);
        assert_ne!(refusal, BillingRefusal::ReauthenticationRequired);
        assert_ne!(refusal, BillingRefusal::Transient);
    }

    /// A plan limitation is its own outcome, and specifically not an auth failure (AD-12).
    #[test]
    fn a_premium_required_refusal_is_a_capability_refusal_and_never_an_auth_failure() {
        let refusal = refusal_for("premium_required", None);

        assert_eq!(refusal, BillingRefusal::CapabilityRefused);
        assert_ne!(refusal, BillingRefusal::SignedOut);
        assert_ne!(refusal, BillingRefusal::ReauthenticationRequired);
    }

    // --- the accessor seam ----------------------------------------------------------------

    #[test]
    fn a_token_for_another_subject_is_never_used() {
        assert_eq!(
            credential_for(
                Ok(AccessTokenAuth::Ready {
                    access_token: "at".to_string(),
                    subject_sub: "some-other-account".to_string(),
                }),
                SUBJECT
            )
            .expect_err("a foreign subject must be refused"),
            BillingRefusal::SignedOut
        );
    }

    #[test]
    fn the_accessors_outcomes_map_onto_the_named_refusals() {
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
            credential_for(Ok(AccessTokenAuth::ReauthenticationRequired), SUBJECT).expect_err("x"),
            BillingRefusal::ReauthenticationRequired
        );
        assert_eq!(
            credential_for(Ok(AccessTokenAuth::SignedOut), SUBJECT).expect_err("x"),
            BillingRefusal::SignedOut
        );
        assert_eq!(
            credential_for(
                Err(AppError::Auth {
                    message: "secure storage access was canceled".to_string(),
                    recoverable: true,
                }),
                SUBJECT
            )
            .expect_err("a storage fault cannot yield a credential"),
            BillingRefusal::Transient,
            "a local fault is not a statement that this account lost its session"
        );
    }

    // --- the real client against a loopback stub ------------------------------------------

    #[test]
    fn a_missing_billing_scope_issues_no_request_at_all() {
        let (outcome, stub) = with_stub(vec![(200, entitlement_body("NXS1.a.b"))], || {
            install_session("openid email profile nixus-api/ai.invoke nixus-api/profile");
            tauri::async_runtime::block_on(get_entitlement(SUBJECT))
        });

        assert_eq!(
            outcome.expect_err("refused"),
            BillingRefusal::ReauthenticationRequired
        );
        assert_eq!(
            stub.calls.load(Ordering::SeqCst),
            0,
            "a locally verifiable scope failure must not reach the network"
        );
    }

    #[test]
    fn an_entitlement_is_fetched_with_a_bearer_token_and_this_builds_version() {
        let (outcome, stub) = with_stub(vec![(200, entitlement_body("NXS1.payload.sig"))], || {
            install_session(FULL_SCOPES);
            tauri::async_runtime::block_on(get_entitlement(SUBJECT))
        });

        let wire = outcome.expect("fetched");
        assert_eq!(wire.statement, "NXS1.payload.sig");
        assert_eq!(stub.calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            stub.paths.lock().expect("paths").as_slice(),
            ["/entitlement"]
        );
        assert!(stub.authorizations.lock().expect("auth")[0].starts_with("Bearer "));
        assert_eq!(
            stub.client_versions.lock().expect("versions")[0],
            env!("CARGO_PKG_VERSION"),
            "the version header must be this build's, not a second literal"
        );
    }

    /// AD-4's canonical read path: a device consumer reads the statement and never the record.
    /// The wire type has no member for the unsigned `capabilities[]` or `tier`, so a grant
    /// cannot be derived from the body even by a caller that tries.
    #[test]
    fn the_response_body_contributes_no_capability_and_no_label() {
        let wire: EntitlementWire =
            serde_json::from_str(&entitlement_body("NXS1.a.b")).expect("parses");

        assert_eq!(wire.statement, "NXS1.a.b");

        let debug = format!("{wire:?}");
        for forbidden in [
            "capabilities",
            "advance",
            "hosted_ai",
            "monthly_request_limit",
            "current_period_end",
            "active",
        ] {
            assert!(
                !debug.contains(forbidden),
                "{forbidden} must not be readable from the response body"
            );
        }
    }

    /// AD-9's single refresh-and-retry: the second attempt must carry a *different* token, or
    /// the retry is a replay that cannot repair anything.
    #[test]
    fn a_401_is_retried_exactly_once_with_a_refreshed_token() {
        let (outcome, stub) = with_stub(
            vec![
                (401, envelope("unauthorized")),
                (200, entitlement_body("NXS1.a.b")),
            ],
            || {
                install_session(FULL_SCOPES);
                tauri::async_runtime::block_on(get_entitlement(SUBJECT))
            },
        );

        assert!(outcome.is_ok());
        assert_eq!(stub.calls.load(Ordering::SeqCst), 2);

        let authorizations = stub.authorizations.lock().expect("auth");
        assert_ne!(
            authorizations[0], authorizations[1],
            "the retry must spend the refreshed token, not replay the rejected one"
        );
    }

    #[test]
    fn a_second_401_signs_out_rather_than_retrying_again() {
        let (outcome, stub) = with_stub(vec![(401, envelope("unauthorized"))], || {
            install_session(FULL_SCOPES);
            tauri::async_runtime::block_on(get_entitlement(SUBJECT))
        });

        assert_eq!(outcome.expect_err("refused"), BillingRefusal::SignedOut);
        assert_eq!(
            stub.calls.load(Ordering::SeqCst),
            2,
            "one attempt plus one retry, never a third"
        );
    }

    /// A `403` carries three different codes, so the envelope decides and the refresh budget is
    /// never spent on an answer that cannot change.
    #[test]
    fn a_403_is_never_retried_and_its_code_decides_the_outcome() {
        for (code, expected) in [
            ("premium_required", BillingRefusal::CapabilityRefused),
            (
                "reauthentication_required",
                BillingRefusal::ReauthenticationRequired,
            ),
            (
                "client_too_old",
                BillingRefusal::ForcedUpgrade {
                    minimum_client_version: None,
                },
            ),
        ] {
            let (outcome, stub) = with_stub(vec![(403, envelope(code))], || {
                install_session(FULL_SCOPES);
                tauri::async_runtime::block_on(get_entitlement(SUBJECT))
            });

            assert_eq!(outcome.expect_err("refused"), expected, "code {code}");
            assert_eq!(stub.calls.load(Ordering::SeqCst), 1, "code {code}");
        }
    }

    /// A forced upgrade has to reach the caller carrying the version to install, or the user is
    /// told to update with nothing to update to.
    #[test]
    fn a_forced_upgrade_carries_the_servers_minimum_version() {
        let body = serde_json::json!({
            "error": {
                "code": "client_too_old",
                "message": "refused",
                "request_id": "req-1",
                "minimum_client_version": "1.0.0",
            }
        })
        .to_string();

        let (outcome, _stub) = with_stub(vec![(403, body)], || {
            install_session(FULL_SCOPES);
            tauri::async_runtime::block_on(get_entitlement(SUBJECT))
        });

        assert_eq!(
            outcome.expect_err("refused"),
            BillingRefusal::ForcedUpgrade {
                minimum_client_version: Some("1.0.0".to_string())
            }
        );
    }

    #[test]
    fn a_gateway_shaped_body_still_maps_by_status() {
        let (outcome, _stub) = with_stub(
            vec![(429, r#"{"message":"Too Many Requests"}"#.to_string())],
            || {
                install_session(FULL_SCOPES);
                tauri::async_runtime::block_on(get_entitlement(SUBJECT))
            },
        );

        assert_eq!(outcome.expect_err("refused"), BillingRefusal::Transient);
    }

    /// With no envelope, a `403` must not be read as a plan limitation or a sign-out: the
    /// conservative answer is the one that claims nothing about the account's plan.
    #[test]
    fn a_403_without_an_envelope_claims_nothing_about_the_plan() {
        let (outcome, _stub) = with_stub(vec![(403, String::new())], || {
            install_session(FULL_SCOPES);
            tauri::async_runtime::block_on(get_entitlement(SUBJECT))
        });

        assert_eq!(
            outcome.expect_err("refused"),
            BillingRefusal::ReauthenticationRequired
        );
    }

    #[test]
    fn an_unparseable_success_body_is_transient_rather_than_a_grant() {
        let (outcome, _stub) = with_stub(vec![(200, "{\"nope\":1}".to_string())], || {
            install_session(FULL_SCOPES);
            tauri::async_runtime::block_on(get_entitlement(SUBJECT))
        });

        assert_eq!(outcome.expect_err("refused"), BillingRefusal::Transient);
    }

    /// The checkout body is the contract's two members and nothing else: an extra field is a
    /// `400` server-side, and `promotion_code` is `null` rather than omitted when absent.
    #[test]
    fn the_checkout_body_carries_exactly_the_contract_members() {
        let body = serde_json::to_value(CheckoutRequestWire {
            plan_lookup_key: "classic_monthly_cad",
            promotion_code: None,
        })
        .expect("serializes");

        let object = body.as_object().expect("object");
        let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(keys, ["plan_lookup_key", "promotion_code"]);
        assert!(body["promotion_code"].is_null());

        let with_code = serde_json::to_value(CheckoutRequestWire {
            plan_lookup_key: "advance_monthly_cad",
            promotion_code: Some("LAUNCH"),
        })
        .expect("serializes");
        assert_eq!(with_code["promotion_code"], "LAUNCH");
    }

    /// AD-8's enforcement, as a type-level fact rather than a convention: neither commerce call
    /// returns a URL, so no caller can hand one to the webview.
    #[test]
    fn neither_commerce_call_can_hand_a_url_to_a_caller() {
        let production = production_source();

        for signature in [
            "pub(crate) async fn open_checkout(",
            "pub(crate) async fn open_portal(",
        ] {
            let start = production
                .find(signature)
                .unwrap_or_else(|| panic!("{signature} is declared"));
            let end = start
                + production[start..]
                    .find('{')
                    .expect("the signature is followed by a body");
            assert!(
                production[start..end].contains("Result<(), BillingRefusal>"),
                "{signature} must answer with no URL at all"
            );
        }

        assert!(
            !production.contains("pub(crate) async fn checkout_url")
                && !production.contains("pub(crate) fn checkout_url"),
            "a URL-returning commerce accessor would reintroduce the webview path AD-8 forbids"
        );
    }

    /// Nothing in this module may reach the secret store or Stripe directly: the one credential
    /// is a call-time token from the accessor, and commerce is Stripe-hosted behind a server URL.
    ///
    /// The needles are assembled at runtime so this guard's own source does not contain them and
    /// the scan cannot trip over the module header that *names* the prohibition in prose.
    #[test]
    fn this_module_reaches_no_secret_store_and_no_payment_api() {
        let production = production_source();

        let forbidden = [
            format!("credentials{}", "::"),
            format!("key{}::", "ring"),
            format!("key{}::Entry", "ring"),
            format!("{}::Client", "stripe"),
            format!("sk_{}", "live"),
            format!("sk_{}", "test"),
        ];

        for needle in forbidden {
            assert!(
                !production.contains(&needle),
                "{needle} must not appear in the sole billing client's shipped source"
            );
        }
    }
}
