//! End-to-end driver for the hosted-AI path.
//!
//! Runs the real `ai/backend` + `ai/hosted_bedrock` code against a real local HTTP
//! server that speaks the canonical NDJSON contract. This is what proves the
//! desktop adapter and `apps/api-bedrock`'s wire format actually interoperate —
//! the unit tests on either side can agree with each other and still both be wrong.
//!
//! Serialized on `credentials::test_keyring_guard()` because the auth session, the
//! `NIXUS_CLOUD_AI_API_URL` override, and the process-wide status cache are all
//! shared state.

use std::io::Cursor;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use tiny_http::{Header, Response, Server};

use crate::ai::backend::{self, AiOperation, AiRequest, AiTurn};
use crate::ai::hosted_state;
use crate::credentials;
use crate::error::AppError;
use crate::models::CognitoSession;

const BASE_URL_ENV: &str = "NIXUS_CLOUD_AI_API_URL";
const TOKEN_BASE_URL_ENV: &str = "NIXUS_TEST_COGNITO_TOKEN_BASE_URL";
const SUBJECT: &str = "e2e-subject-0001";

fn jwt(json: &str) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    format!(
        "{}.{}.{}",
        URL_SAFE_NO_PAD.encode(r#"{"alg":"RS256"}"#),
        URL_SAFE_NO_PAD.encode(json),
        "c2ln"
    )
}

fn scoped_access_token(marker: &str) -> String {
    jwt(&format!(
        r#"{{"sub":"e2e-subject-0001","token_use":"access","scope":"openid nixus-api/ai.invoke","jti":"{}"}}"#,
        marker
    ))
}

fn id_token() -> String {
    jwt(r#"{"sub":"e2e-subject-0001","email":"e2e@example.com","token_use":"id"}"#)
}

/// A scoped, comfortably-unexpired session, written through the sole keyring
/// accessor exactly as production does.
fn install_session() {
    credentials::store_cognito_session(&CognitoSession {
        access_token: scoped_access_token("original"),
        id_token: id_token(),
        refresh_token: "refresh".to_string(),
        // Far future so the 120s skew never triggers a network refresh: the only
        // refresh in these tests is the forced one the 401 path performs.
        expires_at: 4_000_000_000,
    })
    .expect("session stored");
}

/// Cognito's refresh-grant response, carrying a DIFFERENT access token so a test can
/// prove the retry used a new credential rather than replaying the old one.
fn refreshed_token_body() -> String {
    serde_json::json!({
        "access_token": scoped_access_token("refreshed"),
        "id_token": id_token(),
        "expires_in": 3600,
    })
    .to_string()
}

struct StubGateway {
    base_url: String,
    server: Arc<Server>,
    status_calls: Arc<AtomicUsize>,
    invoke_calls: Arc<AtomicUsize>,
    authorizations: Arc<Mutex<Vec<String>>>,
    bodies: Arc<Mutex<Vec<String>>>,
}

/// How the stub should answer `GET /v1/ai/status`.
#[derive(Clone)]
enum StatusReply {
    /// 200 with the given body, which a test may deliberately make unparseable.
    Body(String),
    Error {
        status: u16,
    },
    /// One reply per call, in order; the last repeats once exhausted. Lets a test
    /// script a 401-then-200 status sequence and assert the retry happened once.
    Scripted(Vec<StatusReply>),
}

/// How the stub should answer `POST /v1/ai/invoke`.
#[derive(Clone)]
enum InvokeReply {
    /// 200 with the given NDJSON body.
    Ndjson(String),
    /// A pre-output HTTP status carrying the canonical error envelope.
    Error { status: u16, code: &'static str },
    /// One reply per call, in order; the last repeats once exhausted. Lets a test
    /// script a 401-then-200 sequence and assert the retry happened exactly once.
    Scripted(Vec<InvokeReply>),
}

fn spawn_gateway(status_body: String, reply: InvokeReply) -> StubGateway {
    spawn_gateway_with(StatusReply::Body(status_body), reply)
}

fn spawn_gateway_with(status: StatusReply, reply: InvokeReply) -> StubGateway {
    let server = Arc::new(Server::http("127.0.0.1:0").expect("stub gateway binds"));
    let base_url = format!(
        "http://127.0.0.1:{}",
        server.server_addr().to_ip().expect("ip addr").port()
    );

    let status_calls = Arc::new(AtomicUsize::new(0));
    let invoke_calls = Arc::new(AtomicUsize::new(0));
    let authorizations = Arc::new(Mutex::new(Vec::new()));
    let bodies = Arc::new(Mutex::new(Vec::new()));

    {
        let server = Arc::clone(&server);
        let status_calls = Arc::clone(&status_calls);
        let invoke_calls = Arc::clone(&invoke_calls);
        let authorizations = Arc::clone(&authorizations);
        let bodies = Arc::clone(&bodies);

        std::thread::spawn(move || {
            while let Ok(mut request) = server.recv() {
                let url = request.url().to_string();

                let auth = request
                    .headers()
                    .iter()
                    .find(|h| h.field.equiv("Authorization"))
                    .map(|h| h.value.as_str().to_string())
                    .unwrap_or_default();
                authorizations.lock().unwrap().push(auth);

                let mut body = String::new();
                let _ = std::io::Read::read_to_string(request.as_reader(), &mut body);

                let json_header = "Content-Type: application/json".parse::<Header>().unwrap();

                if url.contains("/oauth2/token") {
                    // Cognito's refresh grant. The rotated access token is what lets
                    // the test prove the retry used a DIFFERENT credential.
                    let refreshed = refreshed_token_body();
                    let _ = request.respond(
                        Response::from_string(refreshed).with_header(json_header),
                    );
                    continue;
                }

                if url.starts_with("/v1/ai/status") {
                    // fetch_add returns the PREVIOUS value, which is this call's 0-based index.
                    let call_index = status_calls.fetch_add(1, Ordering::SeqCst);
                    let effective = match &status {
                        StatusReply::Scripted(replies) => replies
                            .get(call_index)
                            .or_else(|| replies.last())
                            .cloned()
                            .unwrap_or(StatusReply::Error { status: 500 }),
                        other => other.clone(),
                    };
                    let response = match &effective {
                        StatusReply::Scripted(_) => unreachable!("flattened above"),
                        StatusReply::Body(body) => {
                            Response::from_string(body.clone()).with_header(json_header)
                        }
                        StatusReply::Error { status } => Response::from_string(
                            r#"{"error":{"code":"unauthorized","message":"stub","request_id":"r"}}"#,
                        )
                        .with_status_code(*status)
                        .with_header(json_header),
                    };
                    let _ = request.respond(response);
                    continue;
                }

                // Anything that is not one of the two contract routes is a 404, as a
                // real gateway would answer. Returning the invoke reply for every
                // path made a BYO OpenAI fallback see a retryable 429 and back off
                // for minutes, stalling the whole suite behind the shared lock.
                if !url.starts_with("/v1/ai/invoke") {
                    let _ = request.respond(
                        Response::from_string(r#"{"message":"Not Found"}"#)
                            .with_status_code(404)
                            .with_header(json_header),
                    );
                    continue;
                }

                bodies.lock().unwrap().push(body);
                invoke_calls.fetch_add(1, Ordering::SeqCst);

                let call_index = invoke_calls.load(Ordering::SeqCst) - 1;
                let effective = match &reply {
                    InvokeReply::Scripted(replies) => replies
                        .get(call_index)
                        .or_else(|| replies.last())
                        .cloned()
                        .unwrap_or(InvokeReply::Error {
                            status: 500,
                            code: "hosted_unavailable",
                        }),
                    other => other.clone(),
                };

                match &effective {
                    InvokeReply::Scripted(_) => unreachable!("flattened above"),
                    InvokeReply::Ndjson(ndjson) => {
                        let ndjson_header =
                            "Content-Type: application/x-ndjson".parse::<Header>().unwrap();
                        let bytes = ndjson.clone().into_bytes();
                        let length = bytes.len();
                        let _ = request.respond(
                            Response::new(
                                tiny_http::StatusCode(200),
                                vec![ndjson_header],
                                Cursor::new(bytes),
                                Some(length),
                                None,
                            ),
                        );
                    }
                    InvokeReply::Error { status, code } => {
                        let envelope = format!(
                            r#"{{"error":{{"code":"{}","message":"stub","request_id":"r"}}}}"#,
                            code
                        );
                        let _ = request.respond(
                            Response::from_string(envelope)
                                .with_status_code(*status)
                                .with_header(json_header),
                        );
                    }
                }
            }
        });
    }

    StubGateway {
        base_url,
        server,
        status_calls,
        invoke_calls,
        authorizations,
        bodies,
    }
}

impl Drop for StubGateway {
    fn drop(&mut self) {
        self.server.unblock();
    }
}

fn premium_status() -> String {
    r#"{"premium":true,"monthly_request_limit":100,"charged_count":1,"period":"2026-08"}"#
        .to_string()
}

fn non_premium_status() -> String {
    r#"{"premium":false,"monthly_request_limit":0,"charged_count":0,"period":"2026-08"}"#.to_string()
}

fn chat_ndjson() -> String {
    [
        r#"{"type":"meta","operation":"chat","request_id":"r"}"#,
        r#"{"type":"delta","text":"Your "}"#,
        r#"{"type":"delta","text":"budget "}"#,
        r#"{"type":"delta","text":"looks fine."}"#,
        r#"{"type":"end","stop_reason":"end_turn","input_tokens":11,"output_tokens":4}"#,
        "",
    ]
    .join("\n")
}

struct Harness {
    _guard: std::sync::MutexGuard<'static, ()>,
    previous_url: Option<String>,
}

impl Harness {
    fn new(gateway: &StubGateway) -> Self {
        let guard = credentials::test_keyring_guard();
        let previous_url = std::env::var(BASE_URL_ENV).ok();

        hosted_state::clear();
        let _ = credentials::clear_cognito_session();
        install_session();
        std::env::set_var(BASE_URL_ENV, &gateway.base_url);
        std::env::set_var(TOKEN_BASE_URL_ENV, &gateway.base_url);

        Harness {
            _guard: guard,
            previous_url,
        }
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        match &self.previous_url {
            Some(value) => std::env::set_var(BASE_URL_ENV, value),
            None => std::env::remove_var(BASE_URL_ENV),
        }
        std::env::remove_var(TOKEN_BASE_URL_ENV);
        hosted_state::clear();
        let _ = credentials::clear_cognito_session();
    }
}

fn chat_request() -> AiRequest {
    AiRequest {
        operation: AiOperation::Chat,
        system: "You are helpful.".to_string(),
        turns: vec![AiTurn::user("How is my budget?")],
        attachment: None,
    }
}

fn statement_request() -> AiRequest {
    AiRequest {
        operation: AiOperation::StatementImport,
        system: "Extract.".to_string(),
        turns: vec![AiTurn::user("Extract all transactions.")],
        attachment: Some(crate::ai::backend::AiAttachment::Document {
            bytes: b"%PDF-1.7 fake".to_vec(),
        }),
    }
}

fn run(request: AiRequest, deltas: &Arc<Mutex<Vec<String>>>) -> Result<String, AppError> {
    let sink_deltas = Arc::clone(deltas);
    let sink = move |text: &str| {
        sink_deltas.lock().unwrap().push(text.to_string());
    };
    tauri::async_runtime::block_on(backend::invoke(None, request, &sink))
}

#[test]
fn an_eligible_premium_user_streams_hosted_output_end_to_end() {
    let gateway = spawn_gateway(premium_status(), InvokeReply::Ndjson(chat_ndjson()));
    let _harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    let result = run(chat_request(), &deltas);

    assert_eq!(
        result.expect("hosted invocation succeeds"),
        "Your budget looks fine."
    );
    assert_eq!(
        *deltas.lock().unwrap(),
        vec!["Your ", "budget ", "looks fine."],
        "each delta frame must surface incrementally, in order"
    );
    assert_eq!(gateway.invoke_calls.load(Ordering::SeqCst), 1);
}

#[test]
fn the_request_carries_the_bearer_token_and_the_closed_wire_body() {
    let gateway = spawn_gateway(premium_status(), InvokeReply::Ndjson(chat_ndjson()));
    let _harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    run(chat_request(), &deltas).expect("succeeds");

    for auth in gateway.authorizations.lock().unwrap().iter() {
        assert!(auth.starts_with("Bearer "), "every call is Bearer-authorized");
    }

    let body: serde_json::Value =
        serde_json::from_str(&gateway.bodies.lock().unwrap()[0]).expect("valid JSON body");

    assert_eq!(body["operation"], "chat");
    assert_eq!(body["system"], "You are helpful.");
    assert_eq!(body["messages"][0]["content"][0]["text"], "How is my budget?");
    assert!(body["client_request_id"].is_string());
    assert!(body.get("model_id").is_none());
    assert!(body.get("max_tokens").is_none());
}

#[test]
fn a_statement_import_sends_its_attachment_as_message_content() {
    let ndjson = [
        r#"{"type":"meta","operation":"statement_import","request_id":"r"}"#,
        r#"{"type":"delta","text":"{\"transactions\":[]}"}"#,
        r#"{"type":"end","stop_reason":"end_turn","input_tokens":9,"output_tokens":3}"#,
        "",
    ]
    .join("\n");
    let gateway = spawn_gateway(premium_status(), InvokeReply::Ndjson(ndjson));
    let _harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    let text = run(statement_request(), &deltas).expect("succeeds");

    assert_eq!(text, r#"{"transactions":[]}"#);

    let body: serde_json::Value =
        serde_json::from_str(&gateway.bodies.lock().unwrap()[0]).expect("valid JSON body");
    let content = body["messages"][0]["content"].as_array().unwrap();
    assert_eq!(content.len(), 2);
    assert_eq!(content[1]["type"], "document");
    assert_eq!(content[1]["format"], "pdf");
    assert!(content[1].get("name").is_none());
}

#[test]
fn the_status_read_populates_the_subject_scoped_cache() {
    let gateway = spawn_gateway(premium_status(), InvokeReply::Ndjson(chat_ndjson()));
    let _harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    run(chat_request(), &deltas).expect("succeeds");

    let cached = hosted_state::get_fresh(SUBJECT).expect("status cached for this subject");
    assert!(cached.premium);
    assert_eq!(cached.monthly_request_limit, 100);
    assert_eq!(cached.charged_count, 1);

    // A different subject must never read it.
    assert!(hosted_state::get_fresh("someone-else").is_none());
}

#[test]
fn a_non_premium_user_never_reaches_the_invoke_route() {
    let gateway = spawn_gateway(non_premium_status(), InvokeReply::Ndjson(chat_ndjson()));
    let _harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    let error = run(chat_request(), &deltas).expect_err("no BYO provider is configured");

    // Precedence, not fallback: hosted was not selected, and with no BYO provider
    // the honest answer is "not configured".
    assert!(matches!(error, AppError::NotConfigured), "got {error:?}");
    assert_eq!(gateway.invoke_calls.load(Ordering::SeqCst), 0);
}

#[test]
fn a_quota_exhausted_response_surfaces_the_hosted_code_and_invalidates_the_cache() {
    let gateway = spawn_gateway(
        premium_status(),
        InvokeReply::Error {
            status: 429,
            code: "quota_exhausted",
        },
    );
    let _harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    let error = run(chat_request(), &deltas).expect_err("fails without a BYO provider");

    match error {
        AppError::HostedAi { code, recoverable, .. } => {
            assert_eq!(code, "quota_exhausted");
            assert!(recoverable);
        }
        other => panic!("expected HostedAi, got {other:?}"),
    }
    assert!(
        hosted_state::get_fresh(SUBJECT).is_none(),
        "a 429 must invalidate the cached status immediately"
    );
}

#[test]
fn a_validation_rejection_is_terminal_and_unrecoverable() {
    let gateway = spawn_gateway(
        premium_status(),
        InvokeReply::Error {
            status: 400,
            code: "validation",
        },
    );
    let _harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    let error = run(chat_request(), &deltas).expect_err("validation never falls back");

    match error {
        AppError::HostedAi { code, recoverable, .. } => {
            assert_eq!(code, "validation");
            assert!(!recoverable, "a validation failure is not retryable");
        }
        other => panic!("expected HostedAi, got {other:?}"),
    }
}

#[test]
fn a_503_opens_the_sixty_second_courtesy_window() {
    let gateway = spawn_gateway(
        premium_status(),
        InvokeReply::Error {
            status: 503,
            code: "hosted_unavailable",
        },
    );
    let _harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    let _ = run(chat_request(), &deltas);

    assert!(
        hosted_state::is_unavailable(SUBJECT),
        "a 503 must open the backoff window so the gateway is not hammered"
    );

    // The second call must short-circuit on the window rather than call again.
    let before = gateway.invoke_calls.load(Ordering::SeqCst);
    let _ = run(chat_request(), &deltas);
    assert_eq!(
        gateway.invoke_calls.load(Ordering::SeqCst),
        before,
        "the courtesy window must suppress the follow-up invoke"
    );
}

/// The commit boundary: an `error` frame arriving after `meta` is charged, in band,
/// and must never fall back — even though the same code pre-output would.
#[test]
fn an_error_frame_after_meta_never_falls_back() {
    let ndjson = [
        r#"{"type":"meta","operation":"chat","request_id":"r"}"#,
        r#"{"type":"delta","text":"partial answer"}"#,
        r#"{"type":"error","code":"hosted_unavailable","message":"stream broke"}"#,
        "",
    ]
    .join("\n");
    let gateway = spawn_gateway(premium_status(), InvokeReply::Ndjson(ndjson));
    let _harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    let error = run(chat_request(), &deltas).expect_err("a committed failure is terminal");

    match error {
        AppError::HostedAi { code, .. } => assert_eq!(code, "hosted_unavailable"),
        other => panic!("expected HostedAi, got {other:?}"),
    }
    // The partial output was still delivered to the user before the failure.
    assert_eq!(*deltas.lock().unwrap(), vec!["partial answer"]);
    assert_eq!(
        gateway.invoke_calls.load(Ordering::SeqCst),
        1,
        "a committed failure must never be retried"
    );
}

/// A stream that stops before `end` is an interrupted invocation, not a success
/// with truncated text.
#[test]
fn a_truncated_stream_is_a_failure_rather_than_a_short_answer() {
    let ndjson = [
        r#"{"type":"meta","operation":"chat","request_id":"r"}"#,
        r#"{"type":"delta","text":"half"}"#,
        "",
    ]
    .join("\n");
    let gateway = spawn_gateway(premium_status(), InvokeReply::Ndjson(ndjson));
    let _harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    let error = run(chat_request(), &deltas).expect_err("a missing end frame is a failure");

    assert!(matches!(error, AppError::HostedAi { .. }), "got {error:?}");
}

/// Signing out must take the subject-bound status with it, so the next subject
/// cannot be routed against the previous one's quota.
#[test]
fn a_cleared_session_drops_the_cached_status() {
    let gateway = spawn_gateway(premium_status(), InvokeReply::Ndjson(chat_ndjson()));
    let harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    run(chat_request(), &deltas).expect("succeeds");
    assert!(hosted_state::get_fresh(SUBJECT).is_some());

    credentials::clear_cognito_session().expect("cleared");

    // With no session, the next invocation resolves to "hosted not applicable" and
    // the stale status must not survive to be consulted.
    let error = run(chat_request(), &deltas).expect_err("no session, no BYO provider");
    assert!(matches!(error, AppError::NotConfigured), "got {error:?}");
    assert!(hosted_state::get_fresh(SUBJECT).is_none());

    drop(harness);
}

/// Statement import is Bedrock-only. With hosted out of quota and only OpenAI
/// configured, the surface must report the hosted reason rather than silently
/// parsing a statement with a provider that cannot see the attachment (AD-9).
#[test]
fn statement_import_reports_the_hosted_reason_instead_of_degrading_to_openai() {
    use async_openai::{config::OpenAIConfig, Client as OpenAIClient};

    let gateway = spawn_gateway(
        premium_status(),
        InvokeReply::Error {
            status: 429,
            code: "quota_exhausted",
        },
    );
    let _harness = Harness::new(&gateway);

    let openai = crate::ai::AiProvider::OpenAI(OpenAIClient::with_config(OpenAIConfig::new()));
    let deltas: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let sink_deltas = Arc::clone(&deltas);
    let sink = move |text: &str| sink_deltas.lock().unwrap().push(text.to_string());

    let error = tauri::async_runtime::block_on(backend::invoke(
        Some(&openai),
        statement_request(),
        &sink,
    ))
    .expect_err("OpenAI is not a valid statement-import fallback");

    match error {
        AppError::HostedAi { code, .. } => assert_eq!(code, "quota_exhausted"),
        other => panic!("expected the hosted reason, got {other:?}"),
    }
    assert!(
        deltas.lock().unwrap().is_empty(),
        "no output may be produced by a provider that cannot serve this surface"
    );
}

/// The same 429 on a text-only surface DOES reach the OpenAI fallback, proving the
/// Bedrock-only rule above is specific to statement import rather than a blanket
/// refusal to fall back.
#[test]
fn a_text_only_surface_does_reach_the_openai_fallback() {
    use async_openai::{config::OpenAIConfig, Client as OpenAIClient};

    let gateway = spawn_gateway(
        premium_status(),
        InvokeReply::Error {
            status: 429,
            code: "quota_exhausted",
        },
    );
    let _harness = Harness::new(&gateway);

    // Pointed at the stub, whose non-contract routes answer 404: the call therefore
    // fails fast as a provider error, which is precisely what proves it was
    // attempted rather than refused by the support matrix.
    let openai = crate::ai::AiProvider::OpenAI(OpenAIClient::with_config(
        OpenAIConfig::new().with_api_base(format!("{}/openai", gateway.base_url)),
    ));

    let deltas: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let sink_deltas = Arc::clone(&deltas);
    let sink = move |text: &str| sink_deltas.lock().unwrap().push(text.to_string());

    let error = tauri::async_runtime::block_on(backend::invoke(
        Some(&openai),
        AiRequest {
            operation: AiOperation::TrendsInsight,
            system: "s".to_string(),
            turns: vec![AiTurn::user("u")],
            attachment: None,
        },
        &sink,
    ))
    .expect_err("the stub serves no OpenAI route");

    assert!(
        matches!(error, AppError::AiService { .. }),
        "reaching the BYO provider yields a provider error, not the hosted code; got {error:?}"
    );
}

/// A pre-output refusal resolves through the closed table to BYO; with no BYO
/// configured the hosted reason is surfaced, and it stays recoverable — which is
/// what distinguishes it from a charged, committed failure.
fn assert_pre_output_unavailable(error: AppError) {
    match error {
        AppError::HostedAi {
            code, recoverable, ..
        } => {
            assert_eq!(code, "hosted_unavailable");
            assert!(recoverable, "a pre-output refusal stays retryable");
        }
        other => panic!("expected a pre-output hosted_unavailable, got {other:?}"),
    }
}

/// `meta` is the commit event. A delta arriving before it would be shown to the user
/// from an invocation that never committed and is still eligible to fall back — so
/// the same answer could be rendered twice, once hosted and once from BYO.
#[test]
fn a_delta_before_meta_is_refused_and_never_surfaces_output() {
    let ndjson = [
        r#"{"type":"delta","text":"leaked before commit"}"#,
        r#"{"type":"meta","operation":"chat","request_id":"r"}"#,
        r#"{"type":"delta","text":"legitimate"}"#,
        r#"{"type":"end","stop_reason":"end_turn","input_tokens":1,"output_tokens":1}"#,
        "",
    ]
    .join("\n");
    let gateway = spawn_gateway(premium_status(), InvokeReply::Ndjson(ndjson));
    let _harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    let error = run(chat_request(), &deltas).expect_err("an out-of-order stream is refused");

    assert!(
        deltas.lock().unwrap().is_empty(),
        "no pre-commit output may reach the user; got {:?}",
        deltas.lock().unwrap()
    );
    // Refused before commit, so it resolves as a pre-output `hosted_unavailable`
    // which the closed table sends to BYO; with no BYO configured the hosted reason
    // is surfaced. Crucially it is NOT reported as a committed failure.
    assert_pre_output_unavailable(error);
}

#[test]
fn an_end_frame_before_meta_is_refused() {
    let ndjson = [
        r#"{"type":"end","stop_reason":"end_turn","input_tokens":1,"output_tokens":1}"#,
        "",
    ]
    .join("\n");
    let gateway = spawn_gateway(premium_status(), InvokeReply::Ndjson(ndjson));
    let _harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    let error = run(chat_request(), &deltas).expect_err("end before meta is refused");

    assert_pre_output_unavailable(error);
}

/// An error frame before `meta` is still pre-output, so it must keep its fallback
/// eligibility rather than being misreported as a charged, committed failure.
#[test]
fn an_error_frame_before_meta_stays_pre_output() {
    let ndjson = [
        r#"{"type":"error","code":"quota_exhausted","message":"stub"}"#,
        "",
    ]
    .join("\n");
    let gateway = spawn_gateway(premium_status(), InvokeReply::Ndjson(ndjson));
    let _harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    let error = run(chat_request(), &deltas).expect_err("no BYO provider is configured");

    // Routed through the closed table as a pre-output 429, which surfaces the hosted
    // code — not swallowed as an unexplained committed failure.
    match error {
        AppError::HostedAi { code, .. } => assert_eq!(code, "quota_exhausted"),
        other => panic!("expected the hosted code, got {other:?}"),
    }
}

/// Frames are newline-delimited, so a response that never emits one would grow the
/// read buffer without limit.
#[test]
fn an_unterminated_oversized_line_is_refused_rather_than_buffered_without_limit() {
    // Over the 1 MiB ceiling, with no newline anywhere.
    let flood = "x".repeat(2 * 1024 * 1024);
    let gateway = spawn_gateway(premium_status(), InvokeReply::Ndjson(flood));
    let _harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    let error = run(chat_request(), &deltas).expect_err("an oversized line is refused");

    assert!(deltas.lock().unwrap().is_empty());
    assert_pre_output_unavailable(error);
}

/// The ceiling must not clip a legitimately long single delta.
#[test]
fn a_large_but_newline_terminated_stream_still_succeeds() {
    let long_delta = "y".repeat(200_000);
    let ndjson = [
        r#"{"type":"meta","operation":"chat","request_id":"r"}"#,
        &format!(r#"{{"type":"delta","text":"{}"}}"#, long_delta),
        r#"{"type":"end","stop_reason":"end_turn","input_tokens":1,"output_tokens":1}"#,
        "",
    ]
    .join("\n");
    let gateway = spawn_gateway(premium_status(), InvokeReply::Ndjson(ndjson));
    let _harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    let text = run(chat_request(), &deltas).expect("a long legitimate delta succeeds");

    assert_eq!(text.len(), 200_000);
}

/// The closed table's one refresh: a `401` refreshes the access token once and
/// retries hosted exactly once. Both halves matter — a second refresh would loop an
/// expired grant, and a retry replaying the SAME token would never succeed.
#[test]
fn a_401_forces_exactly_one_refresh_and_retries_with_a_new_token() {
    let gateway = spawn_gateway(
        premium_status(),
        InvokeReply::Scripted(vec![
            InvokeReply::Error {
                status: 401,
                code: "unauthorized",
            },
            InvokeReply::Ndjson(chat_ndjson()),
        ]),
    );
    let _harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    let text = run(chat_request(), &deltas).expect("the retry succeeds");

    assert_eq!(text, "Your budget looks fine.");
    assert_eq!(
        gateway.invoke_calls.load(Ordering::SeqCst),
        2,
        "exactly one retry: the original call plus one, never a loop"
    );

    // Authorization headers, in order, for the two invoke calls. The status read may
    // sit between them, so they are compared as a set of distinct values.
    let auths = gateway.authorizations.lock().unwrap().clone();
    let bearers: Vec<String> = auths
        .iter()
        .filter(|value| value.starts_with("Bearer "))
        .cloned()
        .collect();

    let first = bearers.first().expect("a first bearer token");
    let last = bearers.last().expect("a last bearer token");
    assert_ne!(
        first, last,
        "the retry must present the refreshed token, not replay the rejected one"
    );
    assert!(last.contains(&scoped_access_token("refreshed")));
    assert!(first.contains(&scoped_access_token("original")));
}

/// A `401` that persists after the single refresh must NOT refresh again. With no BYO
/// provider configured the hosted reason surfaces instead.
#[test]
fn a_persistent_401_refreshes_only_once_and_then_stops() {
    let gateway = spawn_gateway(
        premium_status(),
        InvokeReply::Error {
            status: 401,
            code: "unauthorized",
        },
    );
    let _harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    let error = run(chat_request(), &deltas).expect_err("no BYO provider is configured");

    assert_eq!(
        gateway.invoke_calls.load(Ordering::SeqCst),
        2,
        "the refresh budget is exactly one, so there must be no third attempt"
    );
    match error {
        AppError::HostedAi { code, .. } => assert_eq!(code, "unauthorized"),
        other => panic!("expected the hosted code, got {other:?}"),
    }
}

/// A `403` is not refresh-eligible: refreshing a valid token cannot grant premium,
/// so the table sends it straight to fallback.
#[test]
fn a_403_never_triggers_a_refresh() {
    let gateway = spawn_gateway(
        premium_status(),
        InvokeReply::Error {
            status: 403,
            code: "premium_required",
        },
    );
    let _harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    let _ = run(chat_request(), &deltas);

    assert_eq!(
        gateway.invoke_calls.load(Ordering::SeqCst),
        1,
        "a 403 must not consume the refresh budget"
    );
}

/// The narrow read the account menu consumes. Driven through the same stub gateway as
/// the routing tests above, because the whole point of the extraction is that the two
/// share one `/v1/ai/status` path and one cache — a second HTTP path would be able to
/// answer `true` for an account the router would skip.
fn entitlement() -> bool {
    tauri::async_runtime::block_on(crate::ai::hosted_bedrock::premium_entitlement())
}

#[test]
fn an_eligible_account_reports_the_entitlement_from_the_authenticated_status_read() {
    let gateway = spawn_gateway(premium_status(), InvokeReply::Ndjson(chat_ndjson()));
    let _harness = Harness::new(&gateway);

    assert!(entitlement());
    assert_eq!(gateway.status_calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        gateway.invoke_calls.load(Ordering::SeqCst),
        0,
        "reading the entitlement must never invoke the model"
    );

    let bearers = gateway.authorizations.lock().unwrap().clone();
    assert!(
        bearers.iter().any(|value| value.starts_with("Bearer ")),
        "the status read must be authenticated"
    );
}

#[test]
fn an_ineligible_account_reports_no_entitlement() {
    let gateway = spawn_gateway(non_premium_status(), InvokeReply::Ndjson(chat_ndjson()));
    let _harness = Harness::new(&gateway);

    assert!(!entitlement());
    assert_eq!(gateway.status_calls.load(Ordering::SeqCst), 1);
}

/// The entitlement is what the account holds, so an exhausted month still reports it.
/// Routing would skip hosted here — that divergence is deliberate, and asserting both
/// in one test is what stops someone "fixing" the read to use `has_remaining_quota`.
#[test]
fn an_exhausted_month_still_reports_the_entitlement_while_routing_skips_hosted() {
    let exhausted =
        r#"{"premium":true,"monthly_request_limit":5,"charged_count":5,"period":"2026-08"}"#
            .to_string();
    let gateway = spawn_gateway(exhausted, InvokeReply::Ndjson(chat_ndjson()));
    let _harness = Harness::new(&gateway);

    assert!(entitlement());

    let deltas = Arc::new(Mutex::new(Vec::new()));
    let _ = run(chat_request(), &deltas);
    assert_eq!(
        gateway.invoke_calls.load(Ordering::SeqCst),
        0,
        "an exhausted month must still not be routed to hosted"
    );
}

#[test]
fn a_rejected_status_read_fails_closed() {
    let gateway = spawn_gateway_with(
        StatusReply::Error { status: 500 },
        InvokeReply::Ndjson(chat_ndjson()),
    );
    let _harness = Harness::new(&gateway);

    assert!(!entitlement());
    assert_eq!(
        gateway.status_calls.load(Ordering::SeqCst),
        1,
        "only a 401 is repairable, so a 500 must not spend the refresh budget"
    );
}

/// A 200 carrying a body this build cannot parse is the shape a server-side contract
/// change would take, and it must not be read as premium.
#[test]
fn a_malformed_status_body_fails_closed() {
    let gateway = spawn_gateway_with(
        StatusReply::Body(r#"{"premium":"yes"}"#.to_string()),
        InvokeReply::Ndjson(chat_ndjson()),
    );
    let _harness = Harness::new(&gateway);

    assert!(!entitlement());
}

/// A `503` opens the courtesy window, and the entitlement must respect it rather than
/// re-reading a gateway that just said it was unavailable.
#[test]
fn a_503_backoff_window_reports_no_entitlement_without_a_second_read() {
    let gateway = spawn_gateway_with(
        StatusReply::Error { status: 503 },
        InvokeReply::Ndjson(chat_ndjson()),
    );
    let _harness = Harness::new(&gateway);

    assert!(!entitlement());
    assert_eq!(gateway.status_calls.load(Ordering::SeqCst), 1);

    assert!(!entitlement());
    assert_eq!(
        gateway.status_calls.load(Ordering::SeqCst),
        1,
        "the backoff window must suppress the second read"
    );
}

/// The matrix's "no authenticated cloud account" row: no request may leave the machine
/// at all, so a signed-out process cannot even be observed asking.
#[test]
fn a_signed_out_process_makes_no_entitlement_request() {
    let gateway = spawn_gateway(premium_status(), InvokeReply::Ndjson(chat_ndjson()));
    let _harness = Harness::new(&gateway);
    let _ = credentials::clear_cognito_session();

    assert!(!entitlement());
    assert_eq!(gateway.status_calls.load(Ordering::SeqCst), 0);
}

/// A session whose grant structurally lacks `nixus-api/ai.invoke` can never be
/// repaired by a refresh, so it must fail closed without a network call rather than
/// spending one on a request the authorizer would reject.
#[test]
fn a_session_without_the_hosted_scope_makes_no_entitlement_request() {
    let gateway = spawn_gateway(premium_status(), InvokeReply::Ndjson(chat_ndjson()));
    let _harness = Harness::new(&gateway);

    credentials::store_cognito_session(&CognitoSession {
        access_token: jwt(
            r#"{"sub":"e2e-subject-0001","token_use":"access","scope":"openid email"}"#,
        ),
        id_token: id_token(),
        refresh_token: "refresh".to_string(),
        expires_at: 4_000_000_000,
    })
    .expect("session stored");

    assert!(!entitlement());
    assert_eq!(gateway.status_calls.load(Ordering::SeqCst), 0);
}

/// One cache, one answer: a read taken for the menu is the one an invocation is routed
/// against, so opening the menu cannot cost a second status round-trip.
#[test]
fn the_entitlement_and_the_routing_path_share_one_status_read() {
    let gateway = spawn_gateway(premium_status(), InvokeReply::Ndjson(chat_ndjson()));
    let _harness = Harness::new(&gateway);

    assert!(entitlement());

    let deltas = Arc::new(Mutex::new(Vec::new()));
    let text = run(chat_request(), &deltas).expect("hosted invocation succeeds");

    assert_eq!(text, "Your budget looks fine.");
    assert_eq!(
        gateway.status_calls.load(Ordering::SeqCst),
        1,
        "the cached status must serve both readers"
    );
}

/// The subject guard the cache already enforces, exercised through the entitlement:
/// signing in as someone else must re-derive the answer rather than serve the previous
/// account's cached `true`.
#[test]
fn a_different_subject_never_inherits_the_previous_accounts_entitlement() {
    let gateway = spawn_gateway(non_premium_status(), InvokeReply::Ndjson(chat_ndjson()));
    let _harness = Harness::new(&gateway);

    hosted_state::store(
        "some-other-subject",
        crate::ai::hosted_state::HostedAiStatus {
            premium: true,
            monthly_request_limit: 100,
            charged_count: 0,
            period: "2026-08".to_string(),
        },
    );

    assert!(
        !entitlement(),
        "the cached entry belongs to another subject and must not be read"
    );
    assert_eq!(gateway.status_calls.load(Ordering::SeqCst), 1);
}

/// The closed table's single refresh, on the status read this time: a `401` means the
/// server rejected a token this device still considers live, and the one repair is a
/// fresh grant. Both halves matter — without the retry an entitled account silently
/// stops showing as premium, and without the ceiling a rejected grant loops.
#[test]
fn a_401_status_read_refreshes_once_and_then_reports_the_entitlement() {
    let gateway = spawn_gateway_with(
        StatusReply::Scripted(vec![
            StatusReply::Error { status: 401 },
            StatusReply::Body(premium_status()),
        ]),
        InvokeReply::Ndjson(chat_ndjson()),
    );
    let _harness = Harness::new(&gateway);

    assert!(entitlement());
    assert_eq!(
        gateway.status_calls.load(Ordering::SeqCst),
        2,
        "the original read plus exactly one retry"
    );

    // The retry has to present the refreshed credential; replaying the rejected one would
    // be a round-trip that cannot succeed.
    let bearers: Vec<String> = gateway
        .authorizations
        .lock()
        .unwrap()
        .iter()
        .filter(|value| value.starts_with("Bearer "))
        .cloned()
        .collect();
    assert_eq!(bearers.len(), 2);
    assert!(bearers[0].contains(&scoped_access_token("original")));
    assert!(bearers[1].contains(&scoped_access_token("refreshed")));

    assert_eq!(
        gateway.invoke_calls.load(Ordering::SeqCst),
        0,
        "reading the entitlement must never invoke the model, refresh or not"
    );
}

#[test]
fn a_persistent_401_status_read_refreshes_only_once_and_fails_closed() {
    let gateway = spawn_gateway_with(
        StatusReply::Error { status: 401 },
        InvokeReply::Ndjson(chat_ndjson()),
    );
    let _harness = Harness::new(&gateway);

    assert!(!entitlement());
    assert_eq!(
        gateway.status_calls.load(Ordering::SeqCst),
        2,
        "a token minted seconds ago being rejected is not staleness: no second retry"
    );
}

/// The refresh belongs to the entitlement read alone. Routing keeps its single attempt,
/// so a `401` there still resolves to "hosted not selected" exactly as before.
#[test]
fn a_401_status_read_does_not_change_invoke_routing() {
    let gateway = spawn_gateway_with(
        StatusReply::Error { status: 401 },
        InvokeReply::Ndjson(chat_ndjson()),
    );
    let _harness = Harness::new(&gateway);

    let deltas = Arc::new(Mutex::new(Vec::new()));
    let error = run(chat_request(), &deltas).expect_err("no BYO provider is configured");

    assert_eq!(
        gateway.status_calls.load(Ordering::SeqCst),
        1,
        "routing must not spend a refresh on the status read"
    );
    assert_eq!(gateway.invoke_calls.load(Ordering::SeqCst), 0);
    assert_pre_output_unavailable(error);
}
