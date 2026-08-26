use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::ai::backend::{AiAttachment, AiImageFormat, AiRequest, AiRole, DeltaSink};
use crate::ai::hosted_state::{self, HostedAiStatus};
use crate::commands::auth::{self, HostedAiAuth};

/// HTTP/NDJSON client for `apps/api-bedrock` (AD-1, AD-7).
///
/// No AWS credential of any kind exists on this path: the only credential is a
/// Cognito access token obtained from `commands/auth.rs`, which owns the keyring
/// boundary. This module must never call `credentials.rs` or `keyring_core`.

/// Stable production URL, compiled into release builds (AD-15).
const PRODUCTION_BASE_URL: &str = "https://api.nixusapp.com";
const BASE_URL_ENV: &str = "NIXUS_CLOUD_AI_API_URL";

/// Generous enough for a long chat completion; the server's own 300s Lambda
/// timeout and 10s soft deadline are the real bounds.
const REQUEST_TIMEOUT_SECS: u64 = 300;
const STATUS_TIMEOUT_SECS: u64 = 15;

/// Upper bound on a single un-terminated NDJSON line.
///
/// Frames are newline-delimited, so a response that never emits one would otherwise
/// grow the buffer without limit. The ceiling is well above any legitimate frame:
/// the largest is a `delta`, bounded by the 4096-8192 output-token ceiling, but a
/// server bug or a hostile proxy is not bounded by anything.
const MAX_NDJSON_LINE_BYTES: usize = 1024 * 1024;

/// The result of attempting a hosted invocation. The distinction between
/// `PreOutput` and `Committed` is the whole point: only the former may fall back.
pub enum HostedOutcome {
    Completed {
        text: String,
    },
    /// Failure before `messageStart`. Refunded server-side; fallback may be legal
    /// per the closed table.
    PreOutput {
        code: String,
        message: String,
    },
    /// Failure after `messageStart`. Charged, never refunded, never retried, and
    /// never falls back (AD-7).
    Committed {
        code: String,
        message: String,
    },
    /// Hosted was not attempted at all — not configured, no session, or the
    /// cached status says this user has no premium quota. Not a failure.
    Skipped,
}

/// `None` disables hosted AI entirely.
///
/// Local development defaults to disabled unless the env var is set explicitly, so
/// a dev build cannot quietly consume production quota (AD-15). Release builds
/// carry the production URL.
fn base_url() -> Option<String> {
    if let Ok(url) = std::env::var(BASE_URL_ENV) {
        let trimmed = url.trim().trim_end_matches('/').to_string();
        if !trimmed.is_empty() {
            if !is_transport_allowed(&trimmed) {
                // The Bearer token and the user's financial prompt both travel on
                // this connection, so a plaintext override is refused outright
                // rather than honoured with a warning.
                tracing::error!(
                    "Ignoring {} : hosted AI requires https, or http only on loopback",
                    BASE_URL_ENV
                );
                return None;
            }
            return Some(trimmed);
        }
    }

    if cfg!(debug_assertions) {
        None
    } else {
        Some(PRODUCTION_BASE_URL.to_string())
    }
}

/// HTTPS everywhere, with a loopback exception so `sam local` and a stub gateway
/// remain usable in development. Loopback is safe because the traffic never leaves
/// the machine; any other plaintext host would expose the access token on the wire.
fn is_transport_allowed(url: &str) -> bool {
    if url.starts_with("https://") {
        return true;
    }

    let Some(authority) = url.strip_prefix("http://") else {
        return false;
    };

    // Strip any path, then the port, leaving the host.
    let authority = authority.split('/').next().unwrap_or("");
    let host = if let Some(rest) = authority.strip_prefix('[') {
        // An IPv6 literal is bracketed, so the host ends at the closing bracket and
        // its internal colons must not be mistaken for a port separator.
        match rest.find(']') {
            Some(end) => &authority[..=end + 1],
            None => return false,
        }
    } else {
        authority.split(':').next().unwrap_or("")
    };

    matches!(host, "localhost" | "127.0.0.1" | "[::1]")
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum WireContent {
    Text {
        text: String,
    },
    Image {
        format: &'static str,
        data_base64: String,
    },
    Document {
        format: &'static str,
        data_base64: String,
    },
}

#[derive(Serialize)]
struct WireMessage {
    role: &'static str,
    content: Vec<WireContent>,
}

#[derive(Serialize)]
struct WireInvokeRequest {
    operation: &'static str,
    system: String,
    messages: Vec<WireMessage>,
    client_request_id: String,
}

#[derive(Deserialize)]
struct WireErrorBody {
    error: WireError,
}

#[derive(Deserialize)]
struct WireError {
    code: String,
    #[serde(default)]
    message: String,
}

#[derive(Deserialize)]
struct WireStatus {
    premium: bool,
    monthly_request_limit: i64,
    charged_count: i64,
    period: String,
}

/// NDJSON frame. `#[serde(tag = "type")]` makes an unknown frame a parse error
/// rather than a silently ignored one.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum WireFrame {
    Meta {},
    Delta {
        text: String,
    },
    End {
        #[allow(dead_code)]
        stop_reason: String,
    },
    Error {
        code: String,
        #[serde(default)]
        message: String,
    },
}

fn new_client_request_id() -> String {
    // UUIDv4 shape, tracing-only. Never an idempotency or auth token: the server
    // generates its own idempotency tokens.
    let mut bytes = rand::random::<[u8; 16]>();
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    let hex: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..32]
    )
}

fn wire_body(request: &AiRequest) -> WireInvokeRequest {
    let mut messages: Vec<WireMessage> = Vec::with_capacity(request.turns.len());

    for (index, turn) in request.turns.iter().enumerate() {
        let mut content = vec![WireContent::Text {
            text: turn.text.clone(),
        }];

        // Text first, then the media block: matches the contract's
        // statement_import example, which the server validates positionally by
        // count rather than order.
        if index == 0 {
            if let Some(attachment) = &request.attachment {
                content.push(match attachment {
                    AiAttachment::Image { format, bytes } => WireContent::Image {
                        format: match format {
                            AiImageFormat::Png => "png",
                            AiImageFormat::Jpeg => "jpeg",
                        },
                        data_base64: STANDARD.encode(bytes),
                    },
                    AiAttachment::Document { bytes } => WireContent::Document {
                        format: "pdf",
                        data_base64: STANDARD.encode(bytes),
                    },
                });
            }
        }

        messages.push(WireMessage {
            role: match turn.role {
                AiRole::User => "user",
                AiRole::Assistant => "assistant",
            },
            content,
        });
    }

    WireInvokeRequest {
        operation: request.operation.wire_name(),
        system: request.system.clone(),
        messages,
        client_request_id: new_client_request_id(),
    }
}

fn unavailable(message: &str) -> HostedOutcome {
    HostedOutcome::PreOutput {
        code: "hosted_unavailable".to_string(),
        message: message.to_string(),
    }
}

/// Applies the cache rules for an error response (AD-9 Conventions): any 403, 429,
/// or 503 invalidates the cached status immediately so a console premium/limit
/// change or a kill-switch flip is observed on the next call.
fn apply_error_cache_rules(status: u16, subject_sub: &str) {
    match status {
        403 | 429 => hosted_state::invalidate_status(),
        503 => hosted_state::mark_unavailable(subject_sub),
        _ => {}
    }
}

pub async fn try_invoke(request: &AiRequest, on_delta: DeltaSink<'_>) -> HostedOutcome {
    invoke_with_auth(request, on_delta, false).await
}

/// The single refresh+retry the closed table permits for a `401`.
pub async fn retry_after_refresh(request: &AiRequest, on_delta: DeltaSink<'_>) -> HostedOutcome {
    invoke_with_auth(request, on_delta, true).await
}

async fn invoke_with_auth(
    request: &AiRequest,
    on_delta: DeltaSink<'_>,
    force_refresh: bool,
) -> HostedOutcome {
    let Some(base) = base_url() else {
        return HostedOutcome::Skipped;
    };

    let auth_result = if force_refresh {
        auth::refresh_hosted_ai_token().await
    } else {
        auth::hosted_ai_token().await
    };

    let (access_token, subject_sub) = match auth_result {
        Ok(HostedAiAuth::Ready {
            access_token,
            subject_sub,
        }) => (access_token, subject_sub),
        Ok(HostedAiAuth::ReauthenticationRequired) => {
            return HostedOutcome::PreOutput {
                code: "reauthentication_required".to_string(),
                message: "Please sign in again to use Nixus Cloud AI.".to_string(),
            }
        }
        // Not signed in at all: hosted simply does not apply, which is a routing
        // decision rather than a hosted failure.
        Ok(HostedAiAuth::SignedOut) => return HostedOutcome::Skipped,
        Err(_) => return HostedOutcome::Skipped,
    };

    // Client-side courtesy backoff after a recent 503. Never a substitute for a
    // real check: the window is at most 60 seconds and the server stays
    // authoritative once it elapses.
    if hosted_state::is_unavailable(&subject_sub) {
        return unavailable("Hosted AI is temporarily unavailable.");
    }

    match ensure_status(&base, &access_token, &subject_sub).await {
        Some(status) if status.has_remaining_quota() => {}
        // Not premium, or out of quota: hosted is not selected, so the surface
        // uses its configured provider. Precedence, not fallback.
        Some(_) => return HostedOutcome::Skipped,
        None => return unavailable("Hosted AI status could not be read."),
    }

    post_invoke(&base, &access_token, &subject_sub, request, on_delta).await
}

/// Lazily refreshes the subject-scoped status cache when it is absent, older than
/// its TTL, or was fetched for a different `sub` (AD-9).
async fn ensure_status(
    base: &str,
    access_token: &str,
    subject_sub: &str,
) -> Option<HostedAiStatus> {
    if let Some(cached) = hosted_state::get_fresh(subject_sub) {
        return Some(cached);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(STATUS_TIMEOUT_SECS))
        .build()
        .ok()?;

    let response = client
        .get(format!("{}/v1/ai/status", base))
        .bearer_auth(access_token)
        .send()
        .await
        .ok()?;

    let status_code = response.status().as_u16();
    if status_code != 200 {
        tracing::error!("Hosted AI status read returned {}", status_code);
        if status_code == 503 {
            hosted_state::mark_unavailable(subject_sub);
        }
        return None;
    }

    let body = response.json::<WireStatus>().await.ok()?;
    let status = HostedAiStatus {
        premium: body.premium,
        monthly_request_limit: body.monthly_request_limit,
        charged_count: body.charged_count,
        period: body.period,
    };

    hosted_state::store(subject_sub, status.clone());
    Some(status)
}

async fn post_invoke(
    base: &str,
    access_token: &str,
    subject_sub: &str,
    request: &AiRequest,
    on_delta: DeltaSink<'_>,
) -> HostedOutcome {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
    {
        Ok(client) => client,
        Err(_) => return unavailable("Hosted AI client could not be created."),
    };

    let response = match client
        .post(format!("{}/v1/ai/invoke", base))
        .bearer_auth(access_token)
        .json(&wire_body(request))
        .send()
        .await
    {
        Ok(response) => response,
        Err(e) => {
            // Only the timeout flag is logged: reqwest's Display can carry the
            // request body's surrounding detail.
            tracing::error!(
                "Hosted AI invoke transport failure (operation={}, timeout={})",
                request.operation.wire_name(),
                e.is_timeout()
            );
            return unavailable("Hosted AI could not be reached.");
        }
    };

    let status_code = response.status().as_u16();
    if status_code != 200 {
        apply_error_cache_rules(status_code, subject_sub);

        let (code, message) = match response.json::<WireErrorBody>().await {
            Ok(body) => (body.error.code, body.error.message),
            // A non-canonical body still has to resolve to a canonical code, or
            // the closed table has nothing to key on.
            Err(_) => (
                code_for_status(status_code).to_string(),
                "Hosted AI rejected the request.".to_string(),
            ),
        };

        tracing::error!(
            "Hosted AI invoke rejected (operation={}, status={}, code={})",
            request.operation.wire_name(),
            status_code,
            code
        );

        return HostedOutcome::PreOutput { code, message };
    }

    read_ndjson_stream(response, request, on_delta).await
}

/// Maps an HTTP status with a non-canonical body onto the closed code union.
fn code_for_status(status: u16) -> &'static str {
    match status {
        400 => "validation",
        401 => "unauthorized",
        403 => "premium_required",
        413 => "payload_too_large",
        415 => "unsupported_encoding",
        429 => "quota_exhausted",
        _ => "hosted_unavailable",
    }
}

async fn read_ndjson_stream(
    response: reqwest::Response,
    request: &AiRequest,
    on_delta: DeltaSink<'_>,
) -> HostedOutcome {
    let mut stream = response.bytes_stream();
    let mut buffer: Vec<u8> = Vec::new();
    let mut text = String::new();
    let mut committed = false;
    let mut ended = false;

    loop {
        let chunk = match stream.next().await {
            Some(Ok(chunk)) => chunk,
            Some(Err(_)) => {
                return interrupted(committed, request);
            }
            None => break,
        };

        buffer.extend_from_slice(&chunk);

        // Checked before scanning for a newline: a response that never emits one
        // must be refused rather than buffered without limit.
        if buffer.len() > MAX_NDJSON_LINE_BYTES {
            tracing::error!(
                "Hosted AI sent an oversized NDJSON line (operation={}, bytes={})",
                request.operation.wire_name(),
                buffer.len()
            );
            return interrupted(committed, request);
        }

        while let Some(newline) = buffer.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = buffer.drain(..=newline).collect();
            let line = &line[..line.len() - 1];
            if line.is_empty() {
                continue;
            }

            match serde_json::from_slice::<WireFrame>(line) {
                Ok(WireFrame::Meta {}) => {
                    // The commit point. From here on nothing may fall back.
                    committed = true;
                }
                Ok(WireFrame::Delta { text: delta }) => {
                    // `meta` is the commit event, so output before it would be
                    // shown to the user from an invocation that never committed and
                    // is still eligible to fall back - duplicating the answer.
                    if !committed {
                        tracing::error!(
                            "Hosted AI sent a delta before meta (operation={})",
                            request.operation.wire_name()
                        );
                        return interrupted(false, request);
                    }
                    text.push_str(&delta);
                    on_delta(&delta);
                }
                Ok(WireFrame::End { .. }) => {
                    if !committed {
                        tracing::error!(
                            "Hosted AI sent end before meta (operation={})",
                            request.operation.wire_name()
                        );
                        return interrupted(false, request);
                    }
                    ended = true;
                }
                Ok(WireFrame::Error { code, message }) => {
                    hosted_state::invalidate_status();
                    // An error frame is only legal after `meta`; before it, the
                    // failure is still pre-output and fallback is still legal.
                    if !committed {
                        return HostedOutcome::PreOutput { code, message };
                    }
                    return HostedOutcome::Committed { code, message };
                }
                Err(_) => {
                    tracing::error!(
                        "Hosted AI emitted an unparseable frame (operation={})",
                        request.operation.wire_name()
                    );
                    return interrupted(committed, request);
                }
            }
        }
    }

    if !committed || !ended {
        return interrupted(committed, request);
    }

    HostedOutcome::Completed { text }
}

/// A broken stream before the commit point is still a refundable pre-output
/// failure; after it, the unit is charged and no fallback is legal.
fn interrupted(committed: bool, request: &AiRequest) -> HostedOutcome {
    tracing::error!(
        "Hosted AI stream ended abnormally (operation={}, committed={})",
        request.operation.wire_name(),
        committed
    );

    if committed {
        HostedOutcome::Committed {
            code: "hosted_unavailable".to_string(),
            message: "The hosted AI response was interrupted.".to_string(),
        }
    } else {
        unavailable("Hosted AI could not complete the request.")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::backend::{AiOperation, AiTurn};

    /// `base_url()` reads a process-wide env var, so the tests that set it must not
    /// run concurrently with each other or they observe one another's value.
    fn env_guard() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
        LOCK.get_or_init(|| std::sync::Mutex::new(()))
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Sets the override, evaluates `base_url()`, and always restores the previous
    /// value - so a failing assertion cannot leak state into another test.
    fn base_url_with(value: Option<&str>) -> Option<String> {
        let _guard = env_guard();
        let previous = std::env::var(BASE_URL_ENV).ok();

        match value {
            Some(value) => std::env::set_var(BASE_URL_ENV, value),
            None => std::env::remove_var(BASE_URL_ENV),
        }

        let resolved = base_url();

        match previous {
            Some(previous) => std::env::set_var(BASE_URL_ENV, previous),
            None => std::env::remove_var(BASE_URL_ENV),
        }

        resolved
    }

    fn chat_request() -> AiRequest {
        AiRequest {
            operation: AiOperation::Chat,
            system: "You are helpful.".to_string(),
            turns: vec![AiTurn::user("hello")],
            attachment: None,
        }
    }

    fn statement_request() -> AiRequest {
        AiRequest {
            operation: AiOperation::StatementImport,
            system: "Extract.".to_string(),
            turns: vec![AiTurn::user("Extract all transactions.")],
            attachment: Some(AiAttachment::Document {
                bytes: vec![1, 2, 3, 4],
            }),
        }
    }

    fn body_json(request: &AiRequest) -> serde_json::Value {
        serde_json::to_value(wire_body(request)).expect("serializes")
    }

    #[test]
    fn a_chat_body_matches_the_closed_wire_contract() {
        let body = body_json(&chat_request());

        assert_eq!(body["operation"], "chat");
        assert_eq!(body["system"], "You are helpful.");
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["messages"][0]["content"][0]["type"], "text");
        assert_eq!(body["messages"][0]["content"][0]["text"], "hello");
    }

    /// The contract is closed: any extra top-level field is a 400 server-side.
    #[test]
    fn the_body_carries_exactly_the_four_contract_fields() {
        let body = body_json(&chat_request());
        let object = body.as_object().expect("object");

        let mut keys: Vec<&str> = object.keys().map(|k| k.as_str()).collect();
        keys.sort();
        assert_eq!(
            keys,
            vec!["client_request_id", "messages", "operation", "system"]
        );
    }

    /// No model id and no token limit may ever be client-supplied (AD-8).
    #[test]
    fn the_body_never_carries_a_model_or_token_limit() {
        let serialized = serde_json::to_string(&wire_body(&chat_request())).unwrap();

        assert!(!serialized.contains("model"));
        assert!(!serialized.contains("max_tokens"));
        assert!(!serialized.contains("maxTokens"));
        assert!(!serialized.contains("temperature"));
    }

    #[test]
    fn a_statement_body_sends_exactly_one_text_and_one_document_block() {
        let body = body_json(&statement_request());

        assert_eq!(body["operation"], "statement_import");
        let content = body["messages"][0]["content"]
            .as_array()
            .expect("content array");
        assert_eq!(content.len(), 2);
        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[1]["type"], "document");
        assert_eq!(content[1]["format"], "pdf");
        assert_eq!(content[1]["data_base64"], STANDARD.encode([1u8, 2, 3, 4]));
    }

    #[test]
    fn an_image_attachment_sends_its_declared_format() {
        for (format, expected) in [(AiImageFormat::Png, "png"), (AiImageFormat::Jpeg, "jpeg")] {
            let request = AiRequest {
                operation: AiOperation::StatementImport,
                system: "s".to_string(),
                turns: vec![AiTurn::user("t")],
                attachment: Some(AiAttachment::Image {
                    format,
                    bytes: vec![9],
                }),
            };
            let body = body_json(&request);
            assert_eq!(body["messages"][0]["content"][1]["type"], "image");
            assert_eq!(body["messages"][0]["content"][1]["format"], expected);
        }
    }

    /// A media block must never carry a client-supplied document name.
    #[test]
    fn a_document_block_carries_no_name_field() {
        let body = body_json(&statement_request());
        let media = &body["messages"][0]["content"][1];

        assert!(media.get("name").is_none());
        let mut keys: Vec<&str> = media.as_object().unwrap().keys().map(|k| k.as_str()).collect();
        keys.sort();
        assert_eq!(keys, vec!["data_base64", "format", "type"]);
    }

    #[test]
    fn assistant_turns_round_trip_as_assistant_role() {
        let request = AiRequest {
            operation: AiOperation::Chat,
            system: "s".to_string(),
            turns: vec![
                AiTurn::user("one"),
                AiTurn {
                    role: AiRole::Assistant,
                    text: "two".to_string(),
                },
            ],
            attachment: None,
        };

        let body = body_json(&request);
        assert_eq!(body["messages"][0]["role"], "user");
        assert_eq!(body["messages"][1]["role"], "assistant");
    }

    #[test]
    fn client_request_ids_are_distinct_uuid_v4_shapes() {
        let a = new_client_request_id();
        let b = new_client_request_id();

        assert_ne!(a, b);
        assert_eq!(a.len(), 36);
        // Version nibble 4 and RFC 4122 variant, so the server's UUID check passes.
        assert_eq!(&a[14..15], "4");
        assert!(["8", "9", "a", "b"].contains(&&a[19..20]));
    }

    #[test]
    fn status_codes_without_a_canonical_body_still_map_into_the_closed_union() {
        assert_eq!(code_for_status(400), "validation");
        assert_eq!(code_for_status(401), "unauthorized");
        assert_eq!(code_for_status(403), "premium_required");
        assert_eq!(code_for_status(413), "payload_too_large");
        assert_eq!(code_for_status(415), "unsupported_encoding");
        assert_eq!(code_for_status(429), "quota_exhausted");
        assert_eq!(code_for_status(500), "hosted_unavailable");
        assert_eq!(code_for_status(503), "hosted_unavailable");
    }

    #[test]
    fn frames_parse_into_the_closed_union() {
        assert!(matches!(
            serde_json::from_str::<WireFrame>(r#"{"type":"meta","operation":"chat","request_id":"r"}"#),
            Ok(WireFrame::Meta {})
        ));
        assert!(matches!(
            serde_json::from_str::<WireFrame>(r#"{"type":"delta","text":"hi"}"#),
            Ok(WireFrame::Delta { .. })
        ));
        assert!(matches!(
            serde_json::from_str::<WireFrame>(
                r#"{"type":"end","stop_reason":"end_turn","input_tokens":1,"output_tokens":2}"#
            ),
            Ok(WireFrame::End { .. })
        ));
        assert!(matches!(
            serde_json::from_str::<WireFrame>(r#"{"type":"error","code":"hosted_unavailable","message":"x"}"#),
            Ok(WireFrame::Error { .. })
        ));
    }

    #[test]
    fn an_unknown_frame_type_is_a_parse_error_rather_than_being_ignored() {
        assert!(serde_json::from_str::<WireFrame>(r#"{"type":"surprise"}"#).is_err());
    }

    /// A dev build must not consume production quota by accident (AD-15).
    #[test]
    fn local_development_defaults_hosted_ai_disabled() {
        let resolved = base_url_with(None);

        if cfg!(debug_assertions) {
            assert!(
                resolved.is_none(),
                "a debug build with no override must disable hosted AI"
            );
        } else {
            assert_eq!(resolved.as_deref(), Some(PRODUCTION_BASE_URL));
        }
    }

    #[test]
    fn an_explicit_override_is_honoured_and_trimmed() {
        assert_eq!(
            base_url_with(Some("  http://127.0.0.1:3000/  ")).as_deref(),
            Some("http://127.0.0.1:3000")
        );
    }

    #[test]
    fn a_blank_override_does_not_enable_hosted_ai_in_a_debug_build() {
        let resolved = base_url_with(Some("   "));

        if cfg!(debug_assertions) {
            assert!(resolved.is_none());
        }
    }


    /// The Bearer token and the user's financial prompt both travel on this
    /// connection, so plaintext is refused unless it cannot leave the machine.
    #[test]
    fn only_https_or_loopback_http_is_an_allowed_transport() {
        for allowed in [
            "https://api.nixusapp.com",
            "https://localhost:3000",
            "http://localhost:3000",
            "http://localhost",
            "http://127.0.0.1:3000",
            "http://127.0.0.1",
            "http://[::1]:3000",
            "http://[::1]",
        ] {
            assert!(is_transport_allowed(allowed), "{allowed} must be allowed");
        }

        for refused in [
            "http://api.nixusapp.com",
            "http://evil.example.com",
            "http://192.168.1.10:3000",
            "http://10.0.0.1",
            "http://localhost.evil.com",
            "http://127.0.0.1.evil.com",
            "http://notlocalhost",
            "ws://localhost:3000",
            "ftp://localhost",
            "api.nixusapp.com",
            "",
        ] {
            assert!(!is_transport_allowed(refused), "{refused} must be refused");
        }
    }

    #[test]
    fn a_plaintext_override_disables_hosted_ai_rather_than_being_honoured() {
        assert!(
            base_url_with(Some("http://api.nixusapp.com")).is_none(),
            "a plaintext non-loopback override must not be used"
        );
    }

    #[test]
    fn a_loopback_override_is_honoured_for_local_development() {
        assert_eq!(
            base_url_with(Some("http://127.0.0.1:3000")).as_deref(),
            Some("http://127.0.0.1:3000")
        );
    }

    #[test]
    fn the_ndjson_line_ceiling_is_bounded_and_generous() {
        // Comfortably above the largest legitimate frame (a delta bounded by the
        // 8192-token output ceiling) and far below unbounded growth.
        assert_eq!(MAX_NDJSON_LINE_BYTES, 1024 * 1024);
    }

    #[test]
    fn the_production_url_is_the_architecture_mandated_host() {
        assert_eq!(PRODUCTION_BASE_URL, "https://api.nixusapp.com");
    }

    #[test]
    fn error_statuses_apply_the_architecture_cache_rules() {
        let _guard = crate::credentials::test_keyring_guard();
        let sub = "cache-rules-subject";

        for status in [403u16, 429] {
            hosted_state::store(sub, HostedAiStatus {
                premium: true,
                monthly_request_limit: 10,
                charged_count: 0,
                period: "2026-08".to_string(),
            });
            apply_error_cache_rules(status, sub);
            assert!(
                hosted_state::get_fresh(sub).is_none(),
                "status {status} must invalidate the cached status"
            );
            assert!(!hosted_state::is_unavailable(sub));
        }

        hosted_state::clear();
        apply_error_cache_rules(503, sub);
        assert!(hosted_state::is_unavailable(sub));
        assert!(hosted_state::get_fresh(sub).is_none());
        hosted_state::clear();
    }

    #[test]
    fn a_success_status_touches_neither_cache() {
        let _guard = crate::credentials::test_keyring_guard();
        let sub = "success-subject";
        hosted_state::clear();

        let status = HostedAiStatus {
            premium: true,
            monthly_request_limit: 10,
            charged_count: 1,
            period: "2026-08".to_string(),
        };
        hosted_state::store(sub, status.clone());

        apply_error_cache_rules(200, sub);

        assert_eq!(hosted_state::get_fresh(sub), Some(status));
        assert!(!hosted_state::is_unavailable(sub));
        hosted_state::clear();
    }
}
