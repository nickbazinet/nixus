//! End-to-end driver for the Nixus Cloud profile path, and the home of AD-15's desktop gates.
//!
//! Runs the real `cloud_profile` orchestration, the real `profile_client`, the real
//! `profile_store` and the real `avatar_store` against a local HTTP server that implements the
//! Profile API's actual contract — routes, `expected_version` concurrency, `version_conflict`
//! envelopes and `avatar_version`. Unit tests on either side of that wire can agree with each
//! other and still both be wrong; only this proves the device half behaves.
//!
//! Serialized on `credentials::test_keyring_guard()` because the keyring session, the profile API
//! base URL override, the Cognito token endpoint override and `cloud_profile`'s per-subject state
//! are all process-global.

use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine as _;
use serde_json::{json, Value};
use tempfile::TempDir;
use tiny_http::{Header, Response, Server};

use crate::avatar_store;
use crate::cloud_profile::{
    self, OFFLINE_NO_COPY, OFFLINE_WITH_COPY, READY, REAUTHENTICATION_REQUIRED, SIGNED_OUT,
};
use crate::credentials;
use crate::error::AppError;
use crate::models::{CognitoSession, UpdateUserProfileInput};
use crate::profile_store::{self, CloudCopyState};

const SUBJECT: &str = "11111111-2222-3333-4444-555555555555";
const OTHER_SUBJECT: &str = "99999999-8888-7777-6666-555555555555";
const PROFILE_BASE_URL_ENV: &str = "NIXUS_TEST_PROFILE_API_BASE_URL";
const TOKEN_BASE_URL_ENV: &str = "NIXUS_TEST_COGNITO_TOKEN_BASE_URL";
const FULL_SCOPES: &str = "openid email profile nixus-api/ai.invoke nixus-api/profile";
const AI_ONLY_SCOPES: &str = "openid email profile nixus-api/ai.invoke";

fn jwt(payload: &str) -> String {
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

/// Far-future expiry so the 120 s skew never triggers a refresh of its own: the only refresh these
/// tests see is one a `401` forces, which is what makes the scope-retention gate meaningful.
fn install_session(scope: &str) {
    credentials::store_cognito_session(&CognitoSession {
        access_token: access_token(scope, "original"),
        id_token: id_token(),
        refresh_token: "refresh".to_string(),
        expires_at: 4_000_000_000,
    })
    .expect("session stored");
}

/// The granted `scope` claim of whatever session is stored right now.
fn stored_scope() -> String {
    let session = credentials::load_cognito_session()
        .expect("the keyring is readable")
        .expect("a session is stored");

    let payload = session
        .access_token
        .split('.')
        .nth(1)
        .expect("a JWT payload segment");
    let decoded = URL_SAFE_NO_PAD.decode(payload).expect("decodable payload");
    let claims: Value = serde_json::from_slice(&decoded).expect("parsable claims");

    claims["scope"].as_str().expect("a scope claim").to_string()
}

/// What the Profile API holds, and the versioning rules AD-4 gives it.
#[derive(Default)]
struct Store {
    profile: Option<Value>,
    profile_version: u64,
    avatar: Option<(String, String)>,
    avatar_version: u64,
    /// Applies the next `PUT` and then closes the connection without answering, which is the
    /// unobserved-response case AD-7 resolves by a read-back (adversary L1).
    swallow_next_put_response: bool,
    /// Rejects every request with a `401` once, forcing the client's single refresh-and-retry.
    reject_once_unauthorized: bool,
    /// Rejects every request with a `403`, which the desktop reclassifies as a missing scope.
    forbidden: bool,
}

impl Store {
    fn profile_body(&self) -> String {
        match &self.profile {
            None => "null".to_string(),
            Some(fields) => {
                let mut body = fields.clone();
                body["version"] = json!(self.profile_version);
                body["created_at"] = json!("2026-11-17T00:00:00Z");
                body["updated_at"] = json!("2026-11-17T00:00:00Z");
                body["avatar_version"] = match self.avatar {
                    Some(_) => json!(self.avatar_version),
                    None => Value::Null,
                };
                body.to_string()
            }
        }
    }

    fn avatar_body(&self) -> String {
        match &self.avatar {
            None => "null".to_string(),
            Some((mime_type, data)) => json!({
                "mime_type": mime_type,
                "data": data,
                "version": self.avatar_version,
                "updated_at": "2026-11-17T00:00:00Z",
            })
            .to_string(),
        }
    }
}

fn conflict(resource: &str, current_version: Option<u64>) -> (u16, String) {
    (
        409,
        json!({
            "error": {
                "code": "version_conflict",
                "message": "refused",
                "request_id": "req-1",
                "resource": resource,
                "current_version": current_version,
            }
        })
        .to_string(),
    )
}

/// Whether `expected_version` admits a write against the current version, per AD-4/H5: `null`
/// means create-only, a number means "must match", and neither is ever an unconditional overwrite.
fn admits(expected_version: Option<u64>, exists: bool, current_version: u64) -> bool {
    match expected_version {
        None => !exists,
        Some(version) => exists && version == current_version,
    }
}

struct Stub {
    server: Arc<Server>,
    store: Arc<Mutex<Store>>,
    requests: Arc<Mutex<Vec<String>>>,
    calls: Arc<AtomicUsize>,
}

impl Stub {
    fn paths(&self) -> Vec<String> {
        self.requests.lock().expect("requests lock").clone()
    }

    fn count(&self, needle: &str) -> usize {
        self.paths()
            .iter()
            .filter(|entry| entry.as_str() == needle)
            .count()
    }

    fn with_store(&self, mutate: impl FnOnce(&mut Store)) {
        mutate(&mut self.store.lock().expect("store lock"));
    }
}

fn json_header() -> Header {
    Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).expect("header")
}

fn spawn_profile_api() -> (String, Stub) {
    let server = Arc::new(Server::http("127.0.0.1:0").expect("stub binds"));
    let base = format!(
        "http://127.0.0.1:{}",
        server.server_addr().to_ip().expect("ip addr").port()
    );

    let store = Arc::new(Mutex::new(Store::default()));
    let requests = Arc::new(Mutex::new(Vec::new()));
    let calls = Arc::new(AtomicUsize::new(0));

    let stub = Stub {
        server: Arc::clone(&server),
        store: Arc::clone(&store),
        requests: Arc::clone(&requests),
        calls: Arc::clone(&calls),
    };

    std::thread::spawn(move || {
        while let Ok(mut request) = server.recv() {
            let method = request.method().as_str().to_string();
            let path = request.url().to_string();
            requests
                .lock()
                .expect("requests lock")
                .push(format!("{method} {path}"));
            calls.fetch_add(1, Ordering::SeqCst);

            let mut body = String::new();
            let _ = std::io::Read::read_to_string(request.as_reader(), &mut body);

            let mut store = store.lock().expect("store lock");

            if store.forbidden {
                let _ = request.respond(
                    Response::from_string(r#"{"error":{"code":"unauthorized","message":"no"}}"#)
                        .with_status_code(403)
                        .with_header(json_header()),
                );
                continue;
            }

            if store.reject_once_unauthorized {
                store.reject_once_unauthorized = false;
                let _ = request.respond(
                    Response::from_string(r#"{"error":{"code":"unauthorized","message":"no"}}"#)
                        .with_status_code(401)
                        .with_header(json_header()),
                );
                continue;
            }

            let (status, reply) = match (method.as_str(), path.as_str()) {
                ("GET", "/") => (200, store.profile_body()),
                ("GET", "/avatar") => (200, store.avatar_body()),
                ("PUT", "/") => {
                    let sent: Value = serde_json::from_str(&body).expect("a JSON body");
                    let expected = sent["expected_version"].as_u64();
                    if admits(expected, store.profile.is_some(), store.profile_version) {
                        let mut fields = sent.clone();
                        if let Some(object) = fields.as_object_mut() {
                            object.remove("expected_version");
                        }
                        store.profile = Some(fields);
                        store.profile_version = expected.unwrap_or(0) + 1;
                        (200, store.profile_body())
                    } else {
                        conflict("profile", Some(store.profile_version))
                    }
                }
                ("PUT", "/avatar") => {
                    let sent: Value = serde_json::from_str(&body).expect("a JSON body");
                    let expected = sent["expected_version"].as_u64();
                    if admits(expected, store.avatar.is_some(), store.avatar_version) {
                        store.avatar = Some((
                            sent["mime_type"].as_str().expect("a mime type").to_string(),
                            sent["data"].as_str().expect("avatar data").to_string(),
                        ));
                        store.avatar_version = expected.unwrap_or(0) + 1;
                        (200, store.avatar_body())
                    } else {
                        conflict("avatar", Some(store.avatar_version))
                    }
                }
                _ => (404, String::new()),
            };

            // After the write was applied, so the server and the device genuinely disagree —
            // which is the only way the read-back resolution is exercised rather than simulated.
            if method == "PUT" && store.swallow_next_put_response {
                store.swallow_next_put_response = false;
                drop(request);
                continue;
            }

            let _ = request.respond(
                Response::from_string(reply)
                    .with_status_code(status)
                    .with_header(json_header()),
            );
        }
    });

    (base, stub)
}

/// Cognito's refresh grant, answering with the full scope set — so a `401`-forced refresh can never
/// be the thing that narrows the stored session (adversary C5).
fn spawn_token_endpoint() -> Arc<Server> {
    let server = Arc::new(Server::http("127.0.0.1:0").expect("token stub binds"));
    let handle = Arc::clone(&server);

    std::thread::spawn(move || {
        while let Ok(request) = server.recv() {
            let body = json!({
                "access_token": access_token(FULL_SCOPES, "refreshed"),
                "id_token": id_token(),
                "expires_in": 3600,
            })
            .to_string();

            let _ = request.respond(
                Response::from_string(body)
                    .with_status_code(200)
                    .with_header(json_header()),
            );
        }
    });

    handle
}

struct Harness {
    _guard: std::sync::MutexGuard<'static, ()>,
    root: TempDir,
    stub: Stub,
    token_endpoint: Arc<Server>,
    token_base: String,
}

impl Harness {
    fn start(scope: &str) -> Self {
        let guard = credentials::test_keyring_guard();
        let _ = credentials::clear_cognito_session();
        cloud_profile::forget_state(SUBJECT);
        cloud_profile::forget_state(OTHER_SUBJECT);

        let (base, stub) = spawn_profile_api();
        let token_endpoint = spawn_token_endpoint();
        let token_base = format!(
            "http://127.0.0.1:{}",
            token_endpoint
                .server_addr()
                .to_ip()
                .expect("ip addr")
                .port()
        );

        std::env::set_var(PROFILE_BASE_URL_ENV, &base);
        std::env::set_var(TOKEN_BASE_URL_ENV, &token_base);
        install_session(scope);

        Self {
            _guard: guard,
            root: TempDir::new().expect("temp dir"),
            stub,
            token_endpoint,
            token_base,
        }
    }

    fn dir(&self) -> PathBuf {
        profile_store::profiles_dir(self.root.path())
    }

    /// Points the client at a port nothing is listening on, which is what "offline" means to a
    /// device: the connection is refused before any byte of a request is sent.
    fn go_offline(&self) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a free port");
        let port = listener.local_addr().expect("local addr").port();
        drop(listener);
        std::env::set_var(PROFILE_BASE_URL_ENV, format!("http://127.0.0.1:{port}"));
    }

    fn go_online(&self) {
        let base = format!(
            "http://127.0.0.1:{}",
            self.stub
                .server
                .server_addr()
                .to_ip()
                .expect("ip addr")
                .port()
        );
        std::env::set_var(PROFILE_BASE_URL_ENV, base);
        std::env::set_var(TOKEN_BASE_URL_ENV, &self.token_base);
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        std::env::remove_var(PROFILE_BASE_URL_ENV);
        std::env::remove_var(TOKEN_BASE_URL_ENV);
        self.stub.server.unblock();
        self.token_endpoint.unblock();
    }
}

fn block<T>(future: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(future)
}

fn legacy_document(dir: &Path, sub: &str, first_name: &str) -> String {
    std::fs::create_dir_all(dir).expect("profiles dir");
    let raw = format!(
        "{{\n  \"schema_version\": 1,\n  \"cognito_sub\": \"{sub}\",\n  \
         \"first_name\": \"{first_name}\",\n  \"last_name\": null,\n  \
         \"birth_date\": \"1985-03-14\",\n  \"income_bracket\": \"100k_149k\",\n  \
         \"income_bracket_currency\": \"CAD\",\n  \"country_code\": \"CA\",\n  \
         \"subdivision_code\": \"CA-QC\",\n  \"created_at\": \"2026-01-01T00:00:00+00:00\",\n  \
         \"updated_at\": \"2026-01-01T00:00:00+00:00\"\n}}\n"
    );
    std::fs::write(dir.join(format!("{sub}.json")), &raw).expect("the legacy document is written");
    raw
}

fn copy_bytes(dir: &Path, sub: &str) -> Option<String> {
    std::fs::read_to_string(dir.join(format!("{sub}.json"))).ok()
}

fn named_input(first_name: Option<&str>) -> UpdateUserProfileInput {
    UpdateUserProfileInput {
        first_name: first_name.map(str::to_string),
        last_name: None,
        birth_date: None,
        income_bracket: None,
        income_bracket_currency: None,
        country_code: None,
        subdivision_code: None,
    }
}

fn code_of(error: &AppError) -> String {
    match error {
        AppError::CloudProfile { code, .. } => code.clone(),
        other => format!("non-cloud-profile: {other}"),
    }
}

const AVATAR_PNG: &[u8] = b"a-bounded-png-derivative";

// --- GATE (a) — the scope upgrade -------------------------------------------------------------

/// AD-15: "an `ai.invoke`-only session shows re-sign-in, then the AD-8 prompt after re-sign-in."
///
/// Both halves in one test on purpose: the failure this gate exists for is the COMPOSITION —
/// a pre-upgrade user whose refresh is silently a no-op is never prompted and never told
/// (adversary C1). The legacy document must survive the first half untouched, because it is the
/// input the second half depends on.
#[test]
fn an_ai_invoke_only_session_shows_re_sign_in_then_the_upload_prompt_after_re_sign_in() {
    let harness = Harness::start(AI_ONLY_SCOPES);
    let dir = harness.dir();
    let original = legacy_document(&dir, SUBJECT, "Ada");

    let status = block(cloud_profile::refresh(&dir, SUBJECT));

    assert_eq!(status.state, REAUTHENTICATION_REQUIRED);
    assert!(
        !status.consent_pending,
        "a session that never reached the API must not be offered the upload prompt"
    );
    assert!(status.has_copy);
    assert_eq!(
        harness.stub.calls.load(Ordering::SeqCst),
        0,
        "a locally verifiable scope failure must not reach the network"
    );
    assert_eq!(
        copy_bytes(&dir, SUBJECT).as_deref(),
        Some(original.as_str()),
        "the legacy document must be byte-identical after a refused refresh"
    );

    install_session(FULL_SCOPES);
    let status = block(cloud_profile::refresh(&dir, SUBJECT));

    assert_eq!(status.state, READY);
    assert!(
        status.consent_pending,
        "a GET that answered null with a legacy document on disk owes the AD-8 prompt"
    );
    assert_eq!(
        copy_bytes(&dir, SUBJECT).as_deref(),
        Some(original.as_str()),
        "detecting a legacy document must not mutate it"
    );
}

/// The same refusal reached the other way: the API answers `403`, which only the desktop knows a
/// refresh grant cannot repair.
#[test]
fn a_forbidden_profile_route_is_recorded_as_needing_a_fresh_sign_in() {
    let harness = Harness::start(FULL_SCOPES);
    let dir = harness.dir();
    harness.stub.with_store(|store| store.forbidden = true);

    let status = block(cloud_profile::refresh(&dir, SUBJECT));

    assert_eq!(status.state, REAUTHENTICATION_REQUIRED);
    assert_eq!(
        cloud_profile::status(&dir, SUBJECT).state,
        REAUTHENTICATION_REQUIRED,
        "the Profile page must be able to read the state back without issuing a request"
    );
}

// --- GATE (b) — legacy survival through the full decline cycle --------------------------------

/// AD-15: "a v1 legacy document survives launch → `GET null` → decline byte-identical except for
/// `upload_declined`, and is never quarantined."
#[test]
fn a_legacy_document_survives_the_launch_get_null_decline_cycle() {
    let harness = Harness::start(FULL_SCOPES);
    let dir = harness.dir();
    let original = legacy_document(&dir, SUBJECT, "Ada");

    let refreshed = block(cloud_profile::refresh(&dir, SUBJECT));
    assert!(refreshed.consent_pending);
    assert_eq!(copy_bytes(&dir, SUBJECT).as_deref(), Some(original.as_str()));

    let declined = block(cloud_profile::answer_upload(&dir, SUBJECT, false))
        .expect("declining is always possible");

    assert!(!declined.consent_pending);
    assert!(declined.has_copy);

    let after = copy_bytes(&dir, SUBJECT).expect("the document is still there");
    assert_eq!(
        after.replace(",\n  \"upload_declined\": true", ""),
        original,
        "declining may add exactly one member and change nothing else"
    );
    assert!(after.contains("\"upload_declined\": true"));
    assert!(
        !dir.join(format!("{SUBJECT}.json.corrupt")).exists(),
        "the detection path must never quarantine the document it is looking for"
    );
    assert_eq!(
        profile_store::probe_cloud_copy(&dir, SUBJECT).expect("probe"),
        CloudCopyState::Declined
    );

    // Never asked again: a second refresh sees a declined document, not a legacy one.
    let again = block(cloud_profile::refresh(&dir, SUBJECT));
    assert!(!again.consent_pending);
    assert_eq!(
        copy_bytes(&dir, SUBJECT).as_deref(),
        Some(after.as_str()),
        "a declined document is never rewritten"
    );
}

// --- GATE (c) — accepting the first upload ----------------------------------------------------

/// AD-8: accept uploads with `expected_version: null` and the response replaces the file.
#[test]
fn accepting_the_prompt_uploads_create_only_and_replaces_the_file_with_the_response() {
    let harness = Harness::start(FULL_SCOPES);
    let dir = harness.dir();
    let original = legacy_document(&dir, SUBJECT, "Ada");

    assert!(block(cloud_profile::refresh(&dir, SUBJECT)).consent_pending);

    let status =
        block(cloud_profile::answer_upload(&dir, SUBJECT, true)).expect("the upload is accepted");

    assert!(!status.consent_pending);
    assert_eq!(status.state, READY);
    assert_eq!(
        profile_store::probe_cloud_copy(&dir, SUBJECT).expect("probe"),
        CloudCopyState::Synced(1),
        "the file is now the server's document, carrying the version it assigned"
    );

    let uploaded = harness
        .stub
        .store
        .lock()
        .expect("store lock")
        .profile
        .clone()
        .expect("the server holds a profile");
    assert_eq!(uploaded["first_name"], json!("Ada"));
    assert_eq!(uploaded["birth_date"], json!("1985-03-14"));
    assert_eq!(uploaded["country_code"], json!("CA"));

    assert_ne!(
        copy_bytes(&dir, SUBJECT).as_deref(),
        Some(original.as_str()),
        "the response replaces the legacy file"
    );
    assert_eq!(harness.stub.count("PUT /"), 1);
}

// --- GATE (d) — the cloud wins ----------------------------------------------------------------

/// AD-8: when the cloud already has a profile, the cloud wins and its copy replaces the legacy
/// file — the create-only upload is refused and never retried unconditionally.
#[test]
fn a_cloud_profile_that_appeared_meanwhile_wins_over_the_legacy_file() {
    let harness = Harness::start(FULL_SCOPES);
    let dir = harness.dir();
    legacy_document(&dir, SUBJECT, "Ada");

    assert!(block(cloud_profile::refresh(&dir, SUBJECT)).consent_pending);

    harness.stub.with_store(|store| {
        store.profile = Some(json!({
            "first_name": "Grace",
            "last_name": null,
            "birth_date": null,
            "income_bracket": null,
            "income_bracket_currency": null,
            "country_code": null,
            "subdivision_code": null,
        }));
        store.profile_version = 5;
    });

    let status =
        block(cloud_profile::answer_upload(&dir, SUBJECT, true)).expect("the cloud document wins");

    assert!(!status.consent_pending);
    assert_eq!(
        profile_store::probe_cloud_copy(&dir, SUBJECT).expect("probe"),
        CloudCopyState::Synced(5)
    );

    let copy = profile_store::load_profile(&dir, SUBJECT)
        .expect("readable")
        .expect("a copy");
    assert_eq!(copy.first_name.as_deref(), Some("Grace"));

    assert_eq!(
        harness
            .stub
            .store
            .lock()
            .expect("store lock")
            .profile_version,
        5,
        "the refused create must not have been applied"
    );
}

// --- GATE (e) — the copy is written only from a server response -------------------------------

/// AD-1: a failed `PUT` leaves the copy byte-identical, because nothing is written before the
/// server has accepted the value.
#[test]
fn a_failed_save_leaves_the_copy_byte_identical() {
    let harness = Harness::start(FULL_SCOPES);
    let dir = harness.dir();

    let saved = block(cloud_profile::save(&dir, SUBJECT, &named_input(Some("Ada"))))
        .expect("the first save creates the profile");
    assert_eq!(saved.version, Some(1));

    let before = copy_bytes(&dir, SUBJECT).expect("a copy exists");

    harness.go_offline();
    let error = block(cloud_profile::save(&dir, SUBJECT, &named_input(Some("Grace"))))
        .expect_err("an offline save cannot succeed");

    assert_eq!(code_of(&error), "unavailable");
    assert_eq!(
        copy_bytes(&dir, SUBJECT).as_deref(),
        Some(before.as_str()),
        "a refused save may not write a value the server never accepted"
    );
    assert_eq!(cloud_profile::status(&dir, SUBJECT).state, OFFLINE_WITH_COPY);
}

/// The same rule on the refusal the server itself raises: a validation refusal writes nothing.
#[test]
fn a_locally_refused_field_never_reaches_the_network_or_the_copy() {
    let harness = Harness::start(FULL_SCOPES);
    let dir = harness.dir();

    let error = block(cloud_profile::save(
        &dir,
        SUBJECT,
        &UpdateUserProfileInput {
            birth_date: Some("2030-01-01".to_string()),
            ..named_input(Some("Ada"))
        },
    ))
    .expect_err("a future date of birth is refused");

    assert_eq!(code_of(&error), "validation");
    assert!(copy_bytes(&dir, SUBJECT).is_none());
    assert_eq!(harness.stub.count("PUT /"), 0);
}

// --- GATE (f) — version conflict ---------------------------------------------------------------

/// AD-7: a `version_conflict` reloads that resource and reports the conflict — and the copy the
/// user is then looking at is the server's, so re-applying the edit is a legal next action.
#[test]
fn a_version_conflict_reloads_the_copy_and_reports_the_conflict() {
    let harness = Harness::start(FULL_SCOPES);
    let dir = harness.dir();

    block(cloud_profile::save(&dir, SUBJECT, &named_input(Some("Ada"))))
        .expect("the first save creates the profile");

    // Another surface moved the server on, exactly as the account app would.
    harness.stub.with_store(|store| {
        store.profile = Some(json!({
            "first_name": "Grace",
            "last_name": null,
            "birth_date": null,
            "income_bracket": null,
            "income_bracket_currency": null,
            "country_code": null,
            "subdivision_code": null,
        }));
        store.profile_version = 9;
    });

    let error = block(cloud_profile::save(&dir, SUBJECT, &named_input(Some("Hopper"))))
        .expect_err("a stale expected_version is refused");

    assert_eq!(code_of(&error), "version_conflict");
    assert_eq!(
        profile_store::probe_cloud_copy(&dir, SUBJECT).expect("probe"),
        CloudCopyState::Synced(9),
        "the copy is reloaded from the server at its current version"
    );
    let copy = profile_store::load_profile(&dir, SUBJECT)
        .expect("readable")
        .expect("a copy");
    assert_eq!(copy.first_name.as_deref(), Some("Grace"));
    assert_eq!(
        harness
            .stub
            .store
            .lock()
            .expect("store lock")
            .profile_version,
        9,
        "a conflict is never an overwrite"
    );
}

// --- GATE (g) — the unobserved response --------------------------------------------------------

/// AD-7/L1: a `PUT` that succeeded server-side whose response was never observed is resolved by a
/// `GET` and a comparison, and reported as the success it was — never as "someone else changed it".
#[test]
fn an_unobserved_save_response_is_resolved_by_a_read_back_and_reported_as_success() {
    let harness = Harness::start(FULL_SCOPES);
    let dir = harness.dir();
    harness
        .stub
        .with_store(|store| store.swallow_next_put_response = true);

    let saved = block(cloud_profile::save(&dir, SUBJECT, &named_input(Some("Ada"))))
        .expect("an applied-but-unobserved save reads back as a success");

    assert_eq!(saved.first_name.as_deref(), Some("Ada"));
    assert_eq!(saved.version, Some(1));
    assert_eq!(
        profile_store::probe_cloud_copy(&dir, SUBJECT).expect("probe"),
        CloudCopyState::Synced(1)
    );
    assert_eq!(harness.stub.count("PUT /"), 1);
    assert_eq!(
        harness.stub.count("GET /"),
        1,
        "exactly one read-back resolves the lost response"
    );
    assert_eq!(cloud_profile::status(&dir, SUBJECT).state, READY);
}

/// The other arm of the same resolution: the server holds something else, so the save is reported
/// as unavailable and the copy is refreshed from what is actually stored.
#[test]
fn an_unobserved_response_whose_read_back_disagrees_is_reported_as_unavailable() {
    let harness = Harness::start(FULL_SCOPES);
    let dir = harness.dir();

    harness.stub.with_store(|store| {
        store.profile = Some(json!({
            "first_name": "Grace",
            "last_name": null,
            "birth_date": null,
            "income_bracket": null,
            "income_bracket_currency": null,
            "country_code": null,
            "subdivision_code": null,
        }));
        store.profile_version = 4;
        // The conflict answer is the one that gets swallowed, so nothing was applied at all.
        store.swallow_next_put_response = true;
    });

    let error = block(cloud_profile::save(&dir, SUBJECT, &named_input(Some("Ada"))))
        .expect_err("a read-back that disagrees is not a success");

    assert_eq!(code_of(&error), "unavailable");
    let copy = profile_store::load_profile(&dir, SUBJECT)
        .expect("readable")
        .expect("a copy");
    assert_eq!(
        copy.first_name.as_deref(),
        Some("Grace"),
        "the copy is refreshed from what the server actually holds"
    );
}

// --- GATE (h) — the avatar is fetched only when its version moves ------------------------------

/// AD-4/H4: `GET /avatar` is issued only when the server's `avatar_version` differs from the
/// cached one, which is the whole reason the avatar is a separate item.
#[test]
fn the_avatar_is_fetched_only_when_its_version_changes() {
    let harness = Harness::start(FULL_SCOPES);
    let dir = harness.dir();

    harness.stub.with_store(|store| {
        store.profile = Some(json!({
            "first_name": "Ada",
            "last_name": null,
            "birth_date": null,
            "income_bracket": null,
            "income_bracket_currency": null,
            "country_code": null,
            "subdivision_code": null,
        }));
        store.profile_version = 1;
        store.avatar = Some(("image/png".to_string(), STANDARD.encode(AVATAR_PNG)));
        store.avatar_version = 1;
    });

    block(cloud_profile::refresh(&dir, SUBJECT));
    assert_eq!(harness.stub.count("GET /avatar"), 1);
    let cached = avatar_store::load_avatar(&dir, SUBJECT)
        .expect("readable")
        .expect("a cached avatar");
    assert_eq!(cached.version, Some(1));
    assert_eq!(cached.image_bytes, AVATAR_PNG);

    block(cloud_profile::refresh(&dir, SUBJECT));
    assert_eq!(
        harness.stub.count("GET /avatar"),
        1,
        "an unchanged avatar_version must not spend a second download"
    );

    harness.stub.with_store(|store| store.avatar_version = 2);
    block(cloud_profile::refresh(&dir, SUBJECT));
    assert_eq!(
        harness.stub.count("GET /avatar"),
        2,
        "a moved avatar_version is the one thing that fetches the bytes"
    );
    assert_eq!(
        avatar_store::load_avatar(&dir, SUBJECT)
            .expect("readable")
            .expect("a cached avatar")
            .version,
        Some(2)
    );
}

/// A server that reports no avatar deliberately leaves a cached one alone.
///
/// No surface can remove an avatar, so the only row that reaches this branch is one stored before
/// the service existed — the user's only copy of that picture. Mirroring the absence would destroy
/// it, which is the avatar version of the orphaning AD-8 exists to prevent.
#[test]
fn a_server_with_no_avatar_keeps_a_cached_picture_it_has_never_seen() {
    let harness = Harness::start(FULL_SCOPES);
    let dir = harness.dir();

    harness.stub.with_store(|store| {
        store.profile = Some(json!({
            "first_name": "Ada",
            "last_name": null,
            "birth_date": null,
            "income_bracket": null,
            "income_bracket_currency": null,
            "country_code": null,
            "subdivision_code": null,
        }));
        store.profile_version = 1;
        store.avatar = Some(("image/png".to_string(), STANDARD.encode(AVATAR_PNG)));
        store.avatar_version = 1;
    });

    block(cloud_profile::refresh(&dir, SUBJECT));
    assert!(avatar_store::load_avatar(&dir, SUBJECT)
        .expect("readable")
        .is_some());

    harness.stub.with_store(|store| store.avatar = None);
    block(cloud_profile::refresh(&dir, SUBJECT));

    assert!(
        avatar_store::load_avatar(&dir, SUBJECT)
            .expect("readable")
            .is_some(),
        "a cached picture is never destroyed by an absent avatar_version"
    );
    assert_eq!(
        harness.stub.count("GET /avatar"),
        1,
        "and no second download is spent discovering that"
    );
}

/// The avatar's own `expected_version` round-trip, and its own conflict: profile and avatar are
/// versioned independently and are never written in one operation (AD-4/H6).
#[test]
fn an_avatar_save_sends_its_own_expected_version_and_stores_the_response() {
    let harness = Harness::start(FULL_SCOPES);
    let dir = harness.dir();

    let stored = block(cloud_profile::save_avatar(
        &dir,
        SUBJECT,
        AVATAR_PNG,
        "image/png",
    ))
    .expect("the first avatar is created");
    assert_eq!(stored.version, Some(1));

    let replaced = block(cloud_profile::save_avatar(
        &dir,
        SUBJECT,
        b"a-second-derivative",
        "image/jpeg",
    ))
    .expect("the replacement carries the cached version");
    assert_eq!(replaced.version, Some(2));
    assert_eq!(replaced.mime_type, "image/jpeg");

    harness.stub.with_store(|store| store.avatar_version = 11);
    let error = block(cloud_profile::save_avatar(
        &dir,
        SUBJECT,
        AVATAR_PNG,
        "image/png",
    ))
    .expect_err("a stale avatar version is refused");

    assert_eq!(code_of(&error), "version_conflict");
    assert_eq!(
        avatar_store::load_avatar(&dir, SUBJECT)
            .expect("readable")
            .expect("a cached avatar")
            .version,
        Some(11),
        "the conflict reloads the avatar at the server's version"
    );
}

// --- GATE (i) — cross-account ------------------------------------------------------------------

/// AD-15's desktop cross-account gate at the orchestration level: with A's session live, no path
/// may read or write B's files. The resolver half of the same rule is covered in `commands/profile`.
#[test]
fn another_accounts_subject_is_never_refreshed_or_saved_under_this_session() {
    let harness = Harness::start(FULL_SCOPES);
    let dir = harness.dir();

    block(cloud_profile::save(&dir, SUBJECT, &named_input(Some("Ada"))))
        .expect("A's own save succeeds");
    let mine = copy_bytes(&dir, SUBJECT).expect("A has a copy");

    let status = block(cloud_profile::refresh(&dir, OTHER_SUBJECT));
    assert_eq!(status.state, SIGNED_OUT);
    assert!(!status.has_copy);

    let error = block(cloud_profile::save(
        &dir,
        OTHER_SUBJECT,
        &named_input(Some("Mallory")),
    ))
    .expect_err("A's session may not write B's profile");
    assert_eq!(code_of(&error), "unauthorized");

    assert!(
        copy_bytes(&dir, OTHER_SUBJECT).is_none(),
        "no file may be created for a subject this session does not own"
    );
    assert_eq!(
        copy_bytes(&dir, SUBJECT).as_deref(),
        Some(mine.as_str()),
        "A's own copy is untouched"
    );
}

// --- GATE (j) — hosted AI keeps working --------------------------------------------------------

/// AD-9/C5: the profile path verifies a scope and never requests one, so a refresh — including the
/// one a `401` forces — can never leave the stored session without `nixus-api/ai.invoke`.
#[test]
fn the_stored_session_still_carries_ai_invoke_after_a_profile_refresh() {
    let harness = Harness::start(FULL_SCOPES);
    let dir = harness.dir();
    harness
        .stub
        .with_store(|store| store.reject_once_unauthorized = true);

    assert!(stored_scope().contains("nixus-api/ai.invoke"));

    let status = block(cloud_profile::refresh(&dir, SUBJECT));
    assert_eq!(status.state, READY);
    assert!(
        harness.stub.calls.load(Ordering::SeqCst) >= 2,
        "the 401 must have forced a refresh, or this gate proves nothing"
    );

    let scope = stored_scope();
    assert!(
        scope.contains("nixus-api/ai.invoke"),
        "hosted AI must keep working after a profile refresh, but the stored scope is {scope}"
    );
    assert!(scope.contains("nixus-api/profile"));
}

// --- GATE (k) — offline ------------------------------------------------------------------------

/// AD-7: a network failure keeps the last copy silently, and the Profile page is told it is offline
/// so Save can be disabled rather than failing on submit.
#[test]
fn an_unreachable_api_keeps_the_copy_byte_identical_and_reports_offline() {
    let harness = Harness::start(FULL_SCOPES);
    let dir = harness.dir();

    block(cloud_profile::save(&dir, SUBJECT, &named_input(Some("Ada"))))
        .expect("the first save creates the profile");
    let before = copy_bytes(&dir, SUBJECT).expect("a copy exists");

    harness.go_offline();
    let status = block(cloud_profile::refresh(&dir, SUBJECT));

    assert_eq!(status.state, OFFLINE_WITH_COPY);
    assert!(status.has_copy);
    assert_eq!(
        copy_bytes(&dir, SUBJECT).as_deref(),
        Some(before.as_str()),
        "an unreachable API must leave the last copy exactly as it was"
    );

    harness.go_online();
    assert_eq!(block(cloud_profile::refresh(&dir, SUBJECT)).state, READY);
}

/// The other offline row: no copy to render, so the page asks for a connection rather than showing
/// an empty form that cannot be saved.
#[test]
fn an_unreachable_api_with_no_copy_reports_a_connection_is_needed() {
    let harness = Harness::start(FULL_SCOPES);
    let dir = harness.dir();
    harness.go_offline();

    let status = block(cloud_profile::refresh(&dir, SUBJECT));

    assert_eq!(status.state, OFFLINE_NO_COPY);
    assert!(!status.has_copy);
    assert!(copy_bytes(&dir, SUBJECT).is_none());
}

// --- the happy path, end to end ----------------------------------------------------------------

/// One full cycle against the real contract: create, read back, replace, and the copy carrying the
/// server's version at every step.
#[test]
fn a_save_and_refresh_cycle_keeps_the_copy_at_the_servers_version() {
    let harness = Harness::start(FULL_SCOPES);
    let dir = harness.dir();

    let created = block(cloud_profile::save(&dir, SUBJECT, &named_input(Some("Ada"))))
        .expect("create succeeds");
    assert_eq!(created.version, Some(1));

    let refreshed = block(cloud_profile::refresh(&dir, SUBJECT));
    assert_eq!(refreshed.state, READY);
    assert!(refreshed.has_copy);
    assert!(!refreshed.consent_pending);

    let replaced = block(cloud_profile::save(&dir, SUBJECT, &named_input(Some("Grace"))))
        .expect("the update carries the copy's version");
    assert_eq!(replaced.version, Some(2));
    assert_eq!(replaced.first_name.as_deref(), Some("Grace"));

    assert_eq!(
        profile_store::probe_cloud_copy(&dir, SUBJECT).expect("probe"),
        CloudCopyState::Synced(2)
    );
    assert_eq!(
        harness.stub.count("GET /avatar"),
        0,
        "an account with no avatar must never fetch one"
    );
}
