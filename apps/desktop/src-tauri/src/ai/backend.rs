use aws_sdk_bedrockruntime::types::{
    ContentBlock, ConversationRole, DocumentBlock, DocumentFormat, DocumentSource, ImageBlock,
    ImageFormat, ImageSource, Message, SystemContentBlock,
};
use aws_sdk_bedrockruntime::Client as BedrockClient;
use aws_sdk_bedrockruntime::primitives::Blob;
use async_openai::{
    config::OpenAIConfig,
    types::{
        ChatCompletionRequestAssistantMessageArgs, ChatCompletionRequestMessage,
        ChatCompletionRequestSystemMessageArgs, ChatCompletionRequestUserMessageArgs,
        CreateChatCompletionRequestArgs,
    },
    Client as OpenAIClient,
};
use tracing::info;

use crate::ai::hosted_bedrock::{self, HostedOutcome};
use crate::ai::AiProvider;
use crate::error::AppError;

/// The one provider port every AI surface crosses (AD-9). Hosted Bedrock and the
/// existing BYO Bedrock/OpenAI clients are interchangeable adapters behind it; no
/// surface talks to a concrete client directly any more.
const BEDROCK_MODEL_ID: &str = "us.anthropic.claude-sonnet-4-6";
const OPENAI_MODEL_ID: &str = "gpt-4o";

/// Closed operation set, mirroring `CloudAiOperation` in the shared contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiOperation {
    Chat,
    StatementImport,
    ProjectAdvice,
    TrendsInsight,
}

impl AiOperation {
    pub fn wire_name(self) -> &'static str {
        match self {
            AiOperation::Chat => "chat",
            AiOperation::StatementImport => "statement_import",
            AiOperation::ProjectAdvice => "project_advice",
            AiOperation::TrendsInsight => "trends_insight",
        }
    }

    /// Only chat surfaces incremental output to the user, so only chat needs a
    /// streaming BYO call. The hosted path always streams NDJSON regardless.
    pub fn streams_incrementally(self) -> bool {
        matches!(self, AiOperation::Chat)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiRole {
    User,
    Assistant,
}

#[derive(Debug, Clone)]
pub struct AiTurn {
    pub role: AiRole,
    pub text: String,
}

impl AiTurn {
    pub fn user(text: impl Into<String>) -> Self {
        AiTurn {
            role: AiRole::User,
            text: text.into(),
        }
    }
}

/// A statement attachment, already read into memory. Deliberately carries no file
/// name or path: neither may reach a prompt, a log, or the wire (AD-11).
#[derive(Debug, Clone)]
pub enum AiAttachment {
    Image { format: AiImageFormat, bytes: Vec<u8> },
    Document { bytes: Vec<u8> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiImageFormat {
    Png,
    Jpeg,
}

/// A finalized request. The desktop owns the prompts and the parsing; the server
/// owns model selection, limits, and quota — so no model id or token limit exists
/// on this type at all.
pub struct AiRequest {
    pub operation: AiOperation,
    pub system: String,
    pub turns: Vec<AiTurn>,
    pub attachment: Option<AiAttachment>,
}

/// Receives incremental output. A no-op for the three non-streaming surfaces.
pub type DeltaSink<'a> = &'a (dyn Fn(&str) + Send + Sync);

pub fn ignore_deltas() -> impl Fn(&str) + Send + Sync {
    |_: &str| {}
}

/// The closed fallback table (AD-9), keyed on the pre-output failure code. Every
/// desktop fallback decision is one lookup here — there is no per-surface prose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FallbackDecision {
    /// Fall back to the surface's configured BYO provider.
    FallBackToByo,
    /// Refresh the access token once, then retry hosted exactly once.
    RefreshAndRetryHosted,
    /// A refresh cannot add a missing scope; require a full sign-in. BYO may
    /// still serve this call meanwhile.
    ReauthenticateThenByo,
    /// No fallback. Retrying against another provider cannot help.
    Fail,
}

pub fn fallback_for(code: &str) -> FallbackDecision {
    match code {
        // Malformed at the transport or schema layer, or simply too big: another
        // provider would reject the identical payload for the identical reason.
        "validation" | "unsupported_encoding" | "payload_too_large" => FallbackDecision::Fail,
        "unauthorized" => FallbackDecision::RefreshAndRetryHosted,
        "reauthentication_required" => FallbackDecision::ReauthenticateThenByo,
        "premium_required" | "quota_exhausted" | "hosted_unavailable" => {
            FallbackDecision::FallBackToByo
        }
        // An unrecognized code is treated as a hosted outage rather than silently
        // failing closed: the local app must keep working.
        _ => FallbackDecision::FallBackToByo,
    }
}

/// Whether a configured BYO provider can serve this operation at all.
///
/// `statement_import` is multimodal and therefore Bedrock-only: OpenAI is not a
/// valid fallback there, so absent BYO Bedrock the surface returns a typed error
/// instead of silently degrading (AD-9).
pub fn byo_supports(operation: AiOperation, provider: &AiProvider) -> bool {
    match (operation, provider) {
        (_, AiProvider::Bedrock(_)) => true,
        (AiOperation::ProjectAdvice, AiProvider::OpenAI(_)) => true,
        (AiOperation::TrendsInsight, AiProvider::OpenAI(_)) => true,
        // Chat's tool protocol and statement import's attachments are both
        // Bedrock-shaped in this codebase today.
        (AiOperation::Chat, AiProvider::OpenAI(_)) => false,
        (AiOperation::StatementImport, AiProvider::OpenAI(_)) => false,
    }
}

fn hosted_error(code: &str, message: &str) -> AppError {
    AppError::HostedAi {
        code: code.to_string(),
        message: message.to_string(),
        // Only the three no-fallback size/shape classes are unrecoverable; the
        // rest are worth another attempt later.
        recoverable: !matches!(
            code,
            "validation" | "unsupported_encoding" | "payload_too_large"
        ),
    }
}

/// What to do with a pre-output hosted failure, given whether the single permitted
/// refresh+retry has already been spent. Split out from `invoke` so the whole
/// matrix is testable without a network, an auth session, or a Bedrock account.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreOutputRoute {
    /// Surface the hosted error. No fallback.
    Fail,
    /// Try the surface's configured BYO provider.
    Byo,
    /// Refresh the token once, then retry hosted once.
    Refresh,
}

pub fn route_pre_output(code: &str, refresh_allowed: bool) -> PreOutputRoute {
    match fallback_for(code) {
        FallbackDecision::Fail => PreOutputRoute::Fail,
        FallbackDecision::RefreshAndRetryHosted if refresh_allowed => PreOutputRoute::Refresh,
        // The refresh budget is exactly one per call: a second 401 falls back
        // rather than looping (AD-10).
        FallbackDecision::RefreshAndRetryHosted => PreOutputRoute::Byo,
        FallbackDecision::FallBackToByo | FallbackDecision::ReauthenticateThenByo => {
            PreOutputRoute::Byo
        }
    }
}

/// The single entry point every AI surface calls.
///
/// Hosted Bedrock takes precedence whenever a signed-in premium user has quota —
/// even over an explicitly configured OpenAI provider — and each invocation is
/// evaluated independently, so two calls in one visible chat turn may resolve to
/// different providers if quota state changed between them (accepted v1 behavior).
pub async fn invoke(
    byo: Option<&AiProvider>,
    request: AiRequest,
    on_delta: DeltaSink<'_>,
) -> Result<String, AppError> {
    let outcome = hosted_bedrock::try_invoke(&request, on_delta).await;
    settle(byo, &request, on_delta, outcome, true).await
}

async fn settle(
    byo: Option<&AiProvider>,
    request: &AiRequest,
    on_delta: DeltaSink<'_>,
    outcome: HostedOutcome,
    refresh_allowed: bool,
) -> Result<String, AppError> {
    match outcome {
        HostedOutcome::Completed { text } => {
            log_selection(request.operation, "hosted");
            Ok(text)
        }

        // Post-`messageStart`. Charged, reported in band, never retried and never
        // fallen back from (AD-7).
        HostedOutcome::Committed { code, message } => Err(hosted_error(&code, &message)),

        // Hosted was never attempted, so there is no hosted error to report if BYO
        // is also unavailable: `NotConfigured` is the honest answer.
        HostedOutcome::Skipped => invoke_byo_or_fail(byo, request, on_delta).await,

        HostedOutcome::PreOutput { code, message } => {
            match route_pre_output(&code, refresh_allowed) {
                PreOutputRoute::Fail => Err(hosted_error(&code, &message)),

                PreOutputRoute::Refresh => {
                    let retried = hosted_bedrock::retry_after_refresh(request, on_delta).await;
                    // Boxed because this is a recursive async call; the recursion is
                    // depth-1 by construction since `refresh_allowed` is now false.
                    Box::pin(settle(byo, request, on_delta, retried, false)).await
                }

                PreOutputRoute::Byo => {
                    match invoke_byo_or_fail(byo, request, on_delta).await {
                        Ok(text) => Ok(text),
                        // Surface the hosted reason rather than "not configured":
                        // the hosted failure is why the user is here, and for a
                        // Bedrock-only surface with no BYO Bedrock it is the whole
                        // explanation.
                        Err(AppError::NotConfigured) => Err(hosted_error(&code, &message)),
                        Err(other) => Err(other),
                    }
                }
            }
        }
    }
}

async fn invoke_byo_or_fail(
    byo: Option<&AiProvider>,
    request: &AiRequest,
    on_delta: DeltaSink<'_>,
) -> Result<String, AppError> {
    let provider = byo.ok_or(AppError::NotConfigured)?;
    if !byo_supports(request.operation, provider) {
        return Err(AppError::NotConfigured);
    }
    log_selection(
        request.operation,
        match provider {
            AiProvider::Bedrock(_) => "byo_bedrock",
            AiProvider::OpenAI(_) => "byo_openai",
        },
    );
    invoke_byo(provider, request, on_delta).await
}

async fn invoke_byo(
    provider: &AiProvider,
    request: &AiRequest,
    on_delta: DeltaSink<'_>,
) -> Result<String, AppError> {
    match provider {
        AiProvider::Bedrock(client) => invoke_byo_bedrock(client, request, on_delta).await,
        AiProvider::OpenAI(client) => invoke_byo_openai(client, request).await,
    }
}

fn attachment_block(attachment: &AiAttachment) -> Result<ContentBlock, AppError> {
    let build_error = |message: String| AppError::AiService {
        message,
        recoverable: false,
    };

    match attachment {
        AiAttachment::Document { bytes } => Ok(ContentBlock::Document(
            DocumentBlock::builder()
                .format(DocumentFormat::Pdf)
                // Fixed, neutral name. A client-supplied file name is both a
                // prompt-injection vector and a path leak (AD-8/AD-11).
                .name("statement")
                .source(DocumentSource::Bytes(Blob::new(bytes.clone())))
                .build()
                .map_err(|e| build_error(format!("Failed to build document block: {}", e)))?,
        )),
        AiAttachment::Image { format, bytes } => Ok(ContentBlock::Image(
            ImageBlock::builder()
                .format(match format {
                    AiImageFormat::Png => ImageFormat::Png,
                    AiImageFormat::Jpeg => ImageFormat::Jpeg,
                })
                .source(ImageSource::Bytes(Blob::new(bytes.clone())))
                .build()
                .map_err(|e| build_error(format!("Failed to build image block: {}", e)))?,
        )),
    }
}

fn byo_bedrock_messages(request: &AiRequest) -> Result<Vec<Message>, AppError> {
    let mut messages: Vec<Message> = Vec::with_capacity(request.turns.len());

    for (index, turn) in request.turns.iter().enumerate() {
        let mut builder = Message::builder().role(match turn.role {
            AiRole::User => ConversationRole::User,
            AiRole::Assistant => ConversationRole::Assistant,
        });

        // The attachment rides on the first turn, matching the wire contract's
        // single-user-message shape for statement_import.
        if index == 0 {
            if let Some(attachment) = &request.attachment {
                builder = builder.content(attachment_block(attachment)?);
            }
        }

        messages.push(
            builder
                .content(ContentBlock::Text(turn.text.clone()))
                .build()
                .map_err(|e| AppError::AiService {
                    message: format!("Failed to build message: {}", e),
                    recoverable: false,
                })?,
        );
    }

    Ok(messages)
}

async fn invoke_byo_bedrock(
    client: &BedrockClient,
    request: &AiRequest,
    on_delta: DeltaSink<'_>,
) -> Result<String, AppError> {
    let messages = byo_bedrock_messages(request)?;

    if request.operation.streams_incrementally() {
        return byo_bedrock_stream(client, request, messages, on_delta).await;
    }

    let mut call = client
        .converse()
        .model_id(BEDROCK_MODEL_ID)
        .system(SystemContentBlock::Text(request.system.clone()));
    for message in messages {
        call = call.messages(message);
    }

    let response = call.send().await.map_err(|e| {
        // Only the error's own type name is logged: the SDK's Display/Debug can
        // carry request detail, which may include statement content (AD-11).
        tracing::error!(
            "BYO Bedrock converse failed (operation={})",
            request.operation.wire_name()
        );
        let _ = &e;
        AppError::AiService {
            message: "The AI provider could not be reached.".to_string(),
            recoverable: true,
        }
    })?;

    response
        .output()
        .and_then(|o| o.as_message().ok())
        .and_then(|m| m.content().first())
        .and_then(|c| c.as_text().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::AiService {
            message: "No text response from the AI provider.".to_string(),
            recoverable: true,
        })
}

async fn byo_bedrock_stream(
    client: &BedrockClient,
    request: &AiRequest,
    messages: Vec<Message>,
    on_delta: DeltaSink<'_>,
) -> Result<String, AppError> {
    let mut call = client
        .converse_stream()
        .model_id(BEDROCK_MODEL_ID)
        .system(SystemContentBlock::Text(request.system.clone()));
    for message in messages {
        call = call.messages(message);
    }

    let mut response = call.send().await.map_err(|e| {
        tracing::error!(
            "BYO Bedrock converse_stream failed (operation={})",
            request.operation.wire_name()
        );
        let _ = &e;
        AppError::AiService {
            message: "The AI provider could not be reached.".to_string(),
            recoverable: true,
        }
    })?;

    let mut full = String::new();
    loop {
        match response.stream.recv().await {
            Ok(Some(aws_sdk_bedrockruntime::types::ConverseStreamOutput::ContentBlockDelta(
                delta,
            ))) => {
                if let Some(text) = delta.delta().and_then(|d| d.as_text().ok()) {
                    full.push_str(text);
                    on_delta(text);
                }
            }
            Ok(Some(_)) => {}
            Ok(None) => break,
            Err(_) => {
                tracing::error!("BYO Bedrock stream interrupted");
                return Err(AppError::AiService {
                    message: "The AI response stream was interrupted.".to_string(),
                    recoverable: true,
                });
            }
        }
    }

    Ok(full)
}

async fn invoke_byo_openai(
    client: &OpenAIClient<OpenAIConfig>,
    request: &AiRequest,
) -> Result<String, AppError> {
    let build_error = |message: String| AppError::AiService {
        message,
        recoverable: false,
    };

    let mut messages: Vec<ChatCompletionRequestMessage> =
        vec![ChatCompletionRequestMessage::System(
            ChatCompletionRequestSystemMessageArgs::default()
                .content(request.system.as_str())
                .build()
                .map_err(|e| build_error(format!("Failed to build OpenAI system message: {}", e)))?,
        )];

    for turn in &request.turns {
        messages.push(match turn.role {
            AiRole::User => ChatCompletionRequestMessage::User(
                ChatCompletionRequestUserMessageArgs::default()
                    .content(turn.text.as_str())
                    .build()
                    .map_err(|e| {
                        build_error(format!("Failed to build OpenAI user message: {}", e))
                    })?,
            ),
            AiRole::Assistant => ChatCompletionRequestMessage::Assistant(
                ChatCompletionRequestAssistantMessageArgs::default()
                    .content(turn.text.as_str())
                    .build()
                    .map_err(|e| {
                        build_error(format!("Failed to build OpenAI assistant message: {}", e))
                    })?,
            ),
        });
    }

    let payload = CreateChatCompletionRequestArgs::default()
        .model(OPENAI_MODEL_ID)
        .messages(messages)
        .build()
        .map_err(|e| build_error(format!("Failed to build OpenAI request: {}", e)))?;

    let response = client.chat().create(payload).await.map_err(|e| {
        tracing::error!(
            "BYO OpenAI request failed (operation={})",
            request.operation.wire_name()
        );
        let _ = &e;
        AppError::AiService {
            message: "The AI provider could not be reached.".to_string(),
            recoverable: true,
        }
    })?;

    response
        .choices
        .first()
        .and_then(|c| c.message.content.clone())
        .ok_or_else(|| AppError::AiService {
            message: "No text response from the AI provider.".to_string(),
            recoverable: true,
        })
}

/// Logged once per invocation so an operator can see provider selection without
/// any prompt, response, or attachment content reaching the log (AD-11).
fn log_selection(operation: AiOperation, provider: &str) {
    info!(
        "AI invocation routed (operation={}, provider={})",
        operation.wire_name(),
        provider
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every code in the shared `CloudAiErrorCode` union, so a new server code
    /// cannot be added without a deliberate decision here.
    const ALL_CODES: [&str; 8] = [
        "validation",
        "unauthorized",
        "reauthentication_required",
        "premium_required",
        "payload_too_large",
        "quota_exhausted",
        "hosted_unavailable",
        "unsupported_encoding",
    ];

    #[test]
    fn validation_size_and_encoding_failures_never_fall_back() {
        assert_eq!(fallback_for("validation"), FallbackDecision::Fail);
        assert_eq!(fallback_for("payload_too_large"), FallbackDecision::Fail);
        assert_eq!(fallback_for("unsupported_encoding"), FallbackDecision::Fail);
    }

    #[test]
    fn premium_quota_and_outage_failures_fall_back_to_the_configured_provider() {
        assert_eq!(fallback_for("premium_required"), FallbackDecision::FallBackToByo);
        assert_eq!(fallback_for("quota_exhausted"), FallbackDecision::FallBackToByo);
        assert_eq!(
            fallback_for("hosted_unavailable"),
            FallbackDecision::FallBackToByo
        );
    }

    #[test]
    fn an_expired_token_refreshes_once_before_anything_else() {
        assert_eq!(
            fallback_for("unauthorized"),
            FallbackDecision::RefreshAndRetryHosted
        );
    }

    /// A refresh cannot add a scope to an existing grant, so this must never be
    /// classified as a retryable refresh.
    #[test]
    fn a_missing_scope_requires_full_reauthentication_not_a_refresh() {
        assert_eq!(
            fallback_for("reauthentication_required"),
            FallbackDecision::ReauthenticateThenByo
        );
        assert_ne!(
            fallback_for("reauthentication_required"),
            FallbackDecision::RefreshAndRetryHosted
        );
    }

    #[test]
    fn every_canonical_error_code_has_an_explicit_decision() {
        for code in ALL_CODES {
            let decision = fallback_for(code);
            // Exhaustive by construction: the match has no wildcard reachable
            // from a canonical code, so each maps to a named branch.
            assert!(
                matches!(
                    decision,
                    FallbackDecision::Fail
                        | FallbackDecision::FallBackToByo
                        | FallbackDecision::RefreshAndRetryHosted
                        | FallbackDecision::ReauthenticateThenByo
                ),
                "code {code} has no decision"
            );
        }
    }

    /// The three no-fallback classes must be exactly these three and no more: any
    /// additional Fail would strand a user who could have been served by BYO.
    #[test]
    fn exactly_three_canonical_codes_forbid_fallback() {
        let failing: Vec<&str> = ALL_CODES
            .iter()
            .copied()
            .filter(|code| fallback_for(code) == FallbackDecision::Fail)
            .collect();

        assert_eq!(
            failing,
            vec!["validation", "payload_too_large", "unsupported_encoding"]
        );
    }

    /// An outage must degrade to BYO, never strand the local app.
    #[test]
    fn an_unknown_code_degrades_to_fallback_rather_than_failing_closed() {
        assert_eq!(fallback_for("teapot"), FallbackDecision::FallBackToByo);
        assert_eq!(fallback_for(""), FallbackDecision::FallBackToByo);
    }

    /// The closed fallback matrix, driven end to end through the routing decision
    /// rather than only the table lookup: code x refresh-budget -> action.
    #[test]
    fn the_closed_matrix_routes_every_code_on_a_fresh_refresh_budget() {
        let expected = [
            ("validation", PreOutputRoute::Fail),
            ("unsupported_encoding", PreOutputRoute::Fail),
            ("payload_too_large", PreOutputRoute::Fail),
            ("unauthorized", PreOutputRoute::Refresh),
            ("reauthentication_required", PreOutputRoute::Byo),
            ("premium_required", PreOutputRoute::Byo),
            ("quota_exhausted", PreOutputRoute::Byo),
            ("hosted_unavailable", PreOutputRoute::Byo),
        ];

        for (code, route) in expected {
            assert_eq!(route_pre_output(code, true), route, "code {code}");
        }
    }

    /// The refresh budget is exactly one. A second `401` in the same call must fall
    /// back rather than refresh again, or an expired grant becomes an infinite loop.
    #[test]
    fn a_spent_refresh_budget_turns_an_unauthorized_into_a_fallback() {
        assert_eq!(route_pre_output("unauthorized", true), PreOutputRoute::Refresh);
        assert_eq!(route_pre_output("unauthorized", false), PreOutputRoute::Byo);
    }

    /// Spending the refresh budget must not weaken the no-fallback classes.
    #[test]
    fn the_no_fallback_classes_stay_terminal_regardless_of_the_refresh_budget() {
        for code in ["validation", "unsupported_encoding", "payload_too_large"] {
            assert_eq!(route_pre_output(code, true), PreOutputRoute::Fail, "{code}");
            assert_eq!(route_pre_output(code, false), PreOutputRoute::Fail, "{code}");
        }
    }

    /// Only `unauthorized` is refresh-eligible: every other code must resolve on
    /// the first pass, so the budget cannot be spent on the wrong failure.
    #[test]
    fn only_an_expired_token_consumes_the_refresh_budget() {
        let refreshable: Vec<&str> = ALL_CODES
            .iter()
            .copied()
            .filter(|code| route_pre_output(code, true) == PreOutputRoute::Refresh)
            .collect();

        assert_eq!(refreshable, vec!["unauthorized"]);
    }

    /// Statement import is Bedrock-only: OpenAI is never a valid fallback there, so
    /// a premium user out of quota with only OpenAI configured gets a typed error
    /// rather than a silently degraded parse (AD-9).
    #[test]
    fn statement_import_never_falls_back_to_openai() {
        let openai = AiProvider::OpenAI(OpenAIClient::with_config(OpenAIConfig::new()));

        assert!(!byo_supports(AiOperation::StatementImport, &openai));
        assert!(!byo_supports(AiOperation::Chat, &openai));
        assert!(byo_supports(AiOperation::ProjectAdvice, &openai));
        assert!(byo_supports(AiOperation::TrendsInsight, &openai));
    }

    /// A hosted failure that reaches an unsupported BYO provider must surface the
    /// hosted code, not a generic "not configured" — otherwise a premium user out
    /// of quota is told they never set anything up.
    #[test]
    fn an_unsupported_byo_provider_surfaces_the_hosted_reason() {
        let error = hosted_error("quota_exhausted", "limit reached");

        match error {
            AppError::HostedAi {
                code,
                recoverable,
                ..
            } => {
                assert_eq!(code, "quota_exhausted");
                assert!(recoverable);
            }
            other => panic!("expected HostedAi, got {other:?}"),
        }
    }

    #[test]
    fn only_the_size_and_shape_classes_are_unrecoverable() {
        for code in ["validation", "unsupported_encoding", "payload_too_large"] {
            match hosted_error(code, "m") {
                AppError::HostedAi { recoverable, .. } => {
                    assert!(!recoverable, "{code} must be unrecoverable")
                }
                other => panic!("expected HostedAi, got {other:?}"),
            }
        }

        for code in [
            "unauthorized",
            "reauthentication_required",
            "premium_required",
            "quota_exhausted",
            "hosted_unavailable",
        ] {
            match hosted_error(code, "m") {
                AppError::HostedAi { recoverable, .. } => {
                    assert!(recoverable, "{code} must be recoverable")
                }
                other => panic!("expected HostedAi, got {other:?}"),
            }
        }
    }

    #[test]
    fn operation_wire_names_match_the_shared_contract() {
        assert_eq!(AiOperation::Chat.wire_name(), "chat");
        assert_eq!(
            AiOperation::StatementImport.wire_name(),
            "statement_import"
        );
        assert_eq!(AiOperation::ProjectAdvice.wire_name(), "project_advice");
        assert_eq!(AiOperation::TrendsInsight.wire_name(), "trends_insight");
    }

    #[test]
    fn only_chat_streams_incrementally() {
        assert!(AiOperation::Chat.streams_incrementally());
        assert!(!AiOperation::StatementImport.streams_incrementally());
        assert!(!AiOperation::ProjectAdvice.streams_incrementally());
        assert!(!AiOperation::TrendsInsight.streams_incrementally());
    }

    #[test]
    fn only_the_attachment_carrying_operation_builds_a_media_block() {
        let request = AiRequest {
            operation: AiOperation::StatementImport,
            system: "s".to_string(),
            turns: vec![AiTurn::user("extract")],
            attachment: Some(AiAttachment::Document {
                bytes: vec![1, 2, 3],
            }),
        };

        let messages = byo_bedrock_messages(&request).expect("messages build");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content().len(), 2, "media block plus text block");
    }

    #[test]
    fn a_text_only_request_builds_one_block_per_turn() {
        let request = AiRequest {
            operation: AiOperation::Chat,
            system: "s".to_string(),
            turns: vec![
                AiTurn::user("hi"),
                AiTurn {
                    role: AiRole::Assistant,
                    text: "hello".to_string(),
                },
                AiTurn::user("more"),
            ],
            attachment: None,
        };

        let messages = byo_bedrock_messages(&request).expect("messages build");
        assert_eq!(messages.len(), 3);
        for message in &messages {
            assert_eq!(message.content().len(), 1);
        }
        assert_eq!(*messages[1].role(), ConversationRole::Assistant);
    }

    #[test]
    fn an_attachment_never_carries_a_file_name_or_path() {
        // The type has no field for one, which is the point: a path cannot be
        // threaded to a prompt or a log even by accident.
        let attachment = AiAttachment::Image {
            format: AiImageFormat::Png,
            bytes: vec![0],
        };
        let debug = format!("{:?}", attachment);
        assert!(!debug.contains('/'));
        assert!(!debug.contains(".png"));
    }
}

/// Architectural boundary guards. These read the crate's own source because the
/// invariants they protect are "this module must never reach for that", which no
/// type signature can express.
#[cfg(test)]
mod boundary_guards {
    use std::path::PathBuf;

    fn read_source(relative: &str) -> String {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join(relative);
        std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
    }

    /// Production source with comments stripped. Both exclusions are load-bearing:
    /// a test fixture may legitimately name a forbidden symbol, and these modules
    /// deliberately *document* the symbols they must never call, so a raw text scan
    /// would match its own prohibition.
    fn production_source(relative: &str) -> String {
        let source = read_source(relative);
        let production = match source.split_once("#[cfg(test)]") {
            Some((production, _)) => production,
            None => &source,
        };

        production
            .lines()
            .filter(|line| {
                let trimmed = line.trim_start();
                !(trimmed.starts_with("//") || trimmed.starts_with("*") || trimmed.starts_with("/*"))
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// `credentials.rs` is the sole keyring accessor. The hosted adapter reaches
    /// its token exclusively through `commands/auth.rs` (AD-10).
    #[test]
    fn the_hosted_adapter_never_touches_the_keyring_or_credentials_directly() {
        let source = production_source("ai/hosted_bedrock.rs");

        assert!(!source.contains("keyring_core"));
        assert!(!source.contains("keyring::"));
        assert!(!source.contains("credentials::load"));
        assert!(!source.contains("credentials::store"));
        assert!(
            source.contains("commands::auth"),
            "the adapter must obtain its token through commands/auth.rs"
        );
    }

    /// No AWS credential may reach a device on the hosted path (AD-1): the adapter
    /// speaks HTTP to the gateway and never constructs an AWS SDK client.
    #[test]
    fn the_hosted_adapter_never_constructs_an_aws_client() {
        let source = production_source("ai/hosted_bedrock.rs");

        assert!(!source.contains("aws_sdk_"));
        assert!(!source.contains("aws_config"));
        assert!(!source.contains("Credentials"));
    }

    /// `test_ai_connection` tests the BYO credentials the user entered. Routing it
    /// through the port would make it silently pass on a premium account whose BYO
    /// credentials are wrong (AD-10).
    #[test]
    fn credential_testing_stays_byo_only() {
        let source = production_source("commands/settings.rs");

        assert!(!source.contains("ai::backend"));
        assert!(!source.contains("hosted_bedrock"));
        assert!(!source.contains("backend::invoke"));
        assert!(
            source.contains("AiProvider::Bedrock") && source.contains("AiProvider::OpenAI"),
            "it must still exercise the configured BYO client directly"
        );
    }

    /// Narrowed from "hosted-AI status has no IPC surface at all": the account-status
    /// feature exposes exactly one boolean, and only through `commands/cloud_ai.rs`.
    /// Everything that made the original prohibition worth having still holds — the
    /// cache, the adapter and the port stay command-free, so no surface can grow a
    /// second, richer status read behind them.
    #[test]
    fn hosted_status_exposes_no_ipc_surface_beyond_the_entitlement_command() {
        for module in ["ai/hosted_state.rs", "ai/hosted_bedrock.rs", "ai/backend.rs"] {
            let source = production_source(module);
            assert!(
                !source.contains("#[tauri::command"),
                "{module} must expose no Tauri command"
            );
        }

        let lib = production_source("lib.rs");
        for symbol in ["hosted_state", "hosted_ai_status", "hosted_bedrock"] {
            assert!(
                !lib.contains(symbol),
                "lib.rs must not register {symbol} as a command"
            );
        }
    }

    /// The counterpart to the prohibitions above, and the one they cannot cover: every
    /// other guard here proves a symbol is ABSENT, so a command that exists, compiles
    /// and is fully tested but was never added to `generate_handler!` passes all of
    /// them and then fails only at runtime, as an "Unknown command" rejection the
    /// frontend is built to swallow silently.
    #[test]
    fn the_entitlement_command_is_registered_for_ipc() {
        let lib = production_source("lib.rs");

        assert!(
            lib.contains("commands::cloud_ai::get_cloud_ai_premium"),
            "lib.rs must register the entitlement command"
        );
    }

    /// The entitlement command reads ONE boolean. A usage figure reaching the webview
    /// is the failure this guards: the frontend has no legitimate use for the limit,
    /// the charged count or the period, and shipping one would create the quota
    /// surface the architecture defers.
    #[test]
    fn the_entitlement_command_carries_no_usage_figure() {
        let source = production_source("commands/cloud_ai.rs");

        assert!(
            source.contains("-> Result<bool, AppError>"),
            "the command must answer with a bare boolean"
        );
        for symbol in [
            "monthly_request_limit",
            "charged_count",
            "period",
            "HostedAiStatus",
            "hosted_state",
        ] {
            assert!(
                !source.contains(symbol),
                "{symbol} must never cross IPC (AD-9)"
            );
        }
    }

    /// Collapses each logging macro invocation onto one logical line, so a call
    /// spread across several source lines is scanned as a whole.
    ///
    /// A single-line scan is what let the multi-line form hide: `tracing::error!(`
    /// on one line and its arguments on the next means neither line contains both
    /// the macro and the forbidden binding.
    fn logging_statements(source: &str) -> Vec<String> {
        const MACROS: [&str; 5] = ["info!", "error!", "warn!", "debug!", "trace!"];

        let mut statements = Vec::new();
        let mut current: Option<String> = None;
        let mut depth: i32 = 0;

        for line in source.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("//") {
                continue;
            }

            if current.is_none() && MACROS.iter().any(|name| trimmed.contains(name)) {
                current = Some(String::new());
                depth = 0;
            }

            if let Some(buffer) = current.as_mut() {
                buffer.push(' ');
                buffer.push_str(trimmed);
                depth += trimmed.matches('(').count() as i32;
                depth -= trimmed.matches(')').count() as i32;

                if depth <= 0 {
                    statements.push(buffer.trim().to_string());
                    current = None;
                }
            }
        }

        if let Some(buffer) = current {
            statements.push(buffer.trim().to_string());
        }

        statements
    }

    /// Only the argument list and inline `{capture}` slots carry data; a forbidden
    /// word inside the literal message text is prose.
    fn assert_no_forbidden_argument(module: &str, statement: &str, forbidden: &[&str]) {
        let arguments = statement
            .rsplit_once('"')
            .map(|(_, tail)| tail)
            .unwrap_or("");

        for name in forbidden {
            assert!(
                !arguments.contains(name),
                "{module} logs `{name}` as an argument: {statement}"
            );
            assert!(
                !statement.contains(&format!("{{{name}}}")),
                "{module} inline-captures `{name}`: {statement}"
            );
        }
    }

    /// The statement path must not reach a log line or an error message anywhere in
    /// the AI chain, including the command layer that owns the path (AD-11).
    #[test]
    fn no_ai_module_logs_a_statement_path() {
        for module in [
            "ai/cc_parser.rs",
            "ai/backend.rs",
            "ai/hosted_bedrock.rs",
            "ai/chat.rs",
            "ai/project_advice.rs",
            "ai/trends_insight.rs",
            // The command layer is where `file_path` actually lives, so omitting it
            // left the most likely leak site unguarded.
            "commands/import.rs",
            "commands/chat.rs",
        ] {
            let source = production_source(module);
            for statement in logging_statements(&source) {
                assert_no_forbidden_argument(
                    module,
                    &statement,
                    &["file_path", "path", "staging_path", "source_path"],
                );
            }
        }
    }

    /// Transaction content must not reach an app log anywhere in the AI chain. The
    /// user's own audit-log rows are deliberately excluded: those are the local
    /// record of their own action, not Nixus-controlled logging (AD-11).
    #[test]
    fn no_ai_command_logs_transaction_content() {
        for module in [
            "commands/chat.rs",
            "commands/import.rs",
            "commands/spending_trends.rs",
        ] {
            let source = production_source(module);
            for statement in logging_statements(&source) {
                assert_no_forbidden_argument(
                    module,
                    &statement,
                    &[
                        "result_msg",
                        "merchant",
                        "amount_cents",
                        "output_text",
                        "full_response",
                        "transactions",
                    ],
                );
            }
        }
    }

    /// Raw model output must never be embedded in an `AppError`, which crosses IPC
    /// and can be surfaced or logged (AD-11).
    #[test]
    fn no_ai_module_puts_raw_model_output_in_an_error() {
        for module in [
            "ai/cc_parser.rs",
            "ai/project_advice.rs",
            "ai/trends_insight.rs",
            "ai/backend.rs",
            "ai/hosted_bedrock.rs",
        ] {
            let source = production_source(module);
            assert!(
                !source.contains("Raw: {}"),
                "{module} still embeds raw model output in an error"
            );
            // Precise: `extract_json(&output_text)` is legitimate, so only an error
            // *message* interpolating the output is a violation.
            for line in source.lines() {
                let mentions_output = line.contains("output_text") || line.contains("full_response");
                let is_error_message = line.contains("message:") || line.contains("message,");
                assert!(
                    !(mentions_output && is_error_message),
                    "{module} formats raw model output into an error message: {line}"
                );
            }
        }
    }

    /// The surfaces must reach a provider only through the port; a concrete client
    /// call site is exactly the fragmentation this feature removed (AD-9).
    #[test]
    fn no_surface_calls_a_concrete_provider_directly() {
        for module in [
            "ai/cc_parser.rs",
            "ai/chat.rs",
            "ai/project_advice.rs",
            "ai/trends_insight.rs",
        ] {
            let source = production_source(module);
            assert!(
                !source.contains(".converse()"),
                "{module} calls Bedrock converse directly"
            );
            assert!(
                !source.contains(".converse_stream()"),
                "{module} calls Bedrock converse_stream directly"
            );
            assert!(
                !source.contains("client.chat()"),
                "{module} calls OpenAI directly"
            );
            assert!(
                source.contains("backend::invoke"),
                "{module} must route through the port"
            );
        }
    }

    /// Both Bedrock invocations of one visible chat turn are routed separately, so
    /// each obeys the closed table on its own (AD-9).
    #[test]
    fn the_chat_tool_loop_routes_each_invocation_independently() {
        let source = production_source("commands/chat.rs");
        let calls = source.matches("stream_chat_response(").count();

        assert_eq!(
            calls, 2,
            "expected the first call and the post-tool-call follow-up to be routed separately"
        );
        assert_eq!(
            source.matches("build_history_turns(&db_state, conv_id)").count(),
            2,
            "each invocation must rebuild history rather than reuse a stale routing decision"
        );
    }
}
