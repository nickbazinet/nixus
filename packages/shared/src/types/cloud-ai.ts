/**
 * Canonical hosted-AI wire contract shared by the `@nixus/api-bedrock` Lambda and
 * the desktop `HostedBedrockAdapter`. Wire JSON is snake_case at the public API
 * boundary; the AWS SDK's own Converse payload naming is never part of this contract.
 *
 * Every union here is deliberately closed so that a new server-side literal cannot
 * reach a consumer without a compile error on both sides.
 */

export type CloudAiOperation =
  | "chat"
  | "statement_import"
  | "project_advice"
  | "trends_insight";

export type CloudAiImageFormat = "png" | "jpeg";

export type CloudAiDocumentFormat = "pdf";

export interface CloudAiTextContent {
  readonly type: "text";
  readonly text: string;
}

export interface CloudAiImageContent {
  readonly type: "image";
  readonly format: CloudAiImageFormat;
  readonly data_base64: string;
}

/** No client-supplied `name`: the Lambda always supplies a fixed, neutral document name. */
export interface CloudAiDocumentContent {
  readonly type: "document";
  readonly format: CloudAiDocumentFormat;
  readonly data_base64: string;
}

export type CloudAiContent =
  | CloudAiTextContent
  | CloudAiImageContent
  | CloudAiDocumentContent;

export type CloudAiRole = "user" | "assistant";

export interface CloudAiMessage {
  readonly role: CloudAiRole;
  readonly content: readonly CloudAiContent[];
}

/**
 * `POST /v1/ai/invoke` request body. Closed: unknown top-level fields are rejected
 * server-side, and neither a model id nor a token limit exists here — those are
 * server-owned. `client_request_id` is a UUIDv4 used for tracing only, never as an
 * auth or idempotency token.
 */
export interface CloudAiInvokeRequest {
  readonly operation: CloudAiOperation;
  readonly system: string;
  readonly messages: readonly CloudAiMessage[];
  readonly client_request_id: string;
}

/** `GET /v1/ai/status` response. `period` is a UTC `YYYY-MM` period key. */
export interface CloudAiStatusResponse {
  readonly premium: boolean;
  readonly monthly_request_limit: number;
  readonly charged_count: number;
  readonly period: string;
}

export type CloudAiErrorCode =
  | "validation"
  | "unauthorized"
  | "reauthentication_required"
  | "premium_required"
  | "payload_too_large"
  | "quota_exhausted"
  | "hosted_unavailable"
  | "unsupported_encoding";

/**
 * Pre-output error envelope: the only body a failure before the stream commit
 * point may return, carried alongside a real HTTP status. API Gateway's own
 * authorizer rejections are configured to emit this same shape.
 */
export interface CloudAiErrorResponse {
  readonly error: {
    readonly code: CloudAiErrorCode;
    readonly message: string;
    readonly request_id: string;
  };
}

/** Normalized stop reason: every Converse `stopReason` maps into this set, unknown ones to `other`. */
export type CloudAiStopReason =
  | "end_turn"
  | "max_tokens"
  | "stop_sequence"
  | "content_filtered"
  | "guardrail_intervened"
  | "model_context_window_exceeded"
  | "other";

/** First NDJSON frame; emitted only once `ConverseStream` reaches `messageStart`. */
export interface CloudAiMetaFrame {
  readonly type: "meta";
  readonly operation: CloudAiOperation;
  readonly request_id: string;
}

export interface CloudAiDeltaFrame {
  readonly type: "delta";
  readonly text: string;
}

export interface CloudAiEndFrame {
  readonly type: "end";
  readonly stop_reason: CloudAiStopReason;
  readonly input_tokens: number;
  readonly output_tokens: number;
}

/** Terminal in-band failure; only possible after `meta` has been sent. */
export interface CloudAiErrorFrame {
  readonly type: "error";
  readonly code: CloudAiErrorCode;
  readonly message: string;
}

export type CloudAiFrame =
  | CloudAiMetaFrame
  | CloudAiDeltaFrame
  | CloudAiEndFrame
  | CloudAiErrorFrame;
