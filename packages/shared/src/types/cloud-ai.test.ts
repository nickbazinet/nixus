import { describe, expect, it } from "vitest";

import type {
  CloudAiContent,
  CloudAiErrorCode,
  CloudAiErrorResponse,
  CloudAiFrame,
  CloudAiInvokeRequest,
  CloudAiMessage,
  CloudAiOperation,
  CloudAiStatusResponse,
  CloudAiStopReason,
} from "./cloud-ai";

/* A `Record<Union, true>` is the compile-time lock on a closed union: adding a
 * member makes the literal below miss a key, removing one makes it excess. The
 * single `as` recovers the literal key type that `Object.keys` erases. */
function unionMembers<T extends string>(coverage: Record<T, true>): readonly T[] {
  return Object.keys(coverage) as T[];
}

const OPERATIONS = unionMembers<CloudAiOperation>({
  chat: true,
  statement_import: true,
  project_advice: true,
  trends_insight: true,
});

const STOP_REASONS = unionMembers<CloudAiStopReason>({
  end_turn: true,
  max_tokens: true,
  stop_sequence: true,
  content_filtered: true,
  guardrail_intervened: true,
  model_context_window_exceeded: true,
  other: true,
});

const ERROR_CODES = unionMembers<CloudAiErrorCode>({
  validation: true,
  unauthorized: true,
  reauthentication_required: true,
  premium_required: true,
  payload_too_large: true,
  quota_exhausted: true,
  hosted_unavailable: true,
  unsupported_encoding: true,
});

function assertNever(value: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(value)}`);
}

function frameFamily(frame: CloudAiFrame): string {
  switch (frame.type) {
    case "meta":
      return `meta:${frame.operation}:${frame.request_id}`;
    case "delta":
      return `delta:${frame.text}`;
    case "end":
      return `end:${frame.stop_reason}:${frame.input_tokens}:${frame.output_tokens}`;
    case "error":
      return `error:${frame.code}:${frame.message}`;
    default:
      return assertNever(frame);
  }
}

function contentPayload(content: CloudAiContent): string {
  switch (content.type) {
    case "text":
      return `text:${content.text}`;
    case "image":
      return `${content.format}:${content.data_base64}`;
    case "document":
      return `${content.format}:${content.data_base64}`;
    default:
      return assertNever(content);
  }
}

const CLIENT_REQUEST_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const TEXT_BLOCK: CloudAiContent = { type: "text", text: "Budget check-in" };
const TURNS: readonly CloudAiMessage[] = [
  { role: "user", content: [TEXT_BLOCK] },
  { role: "assistant", content: [{ type: "text", text: "12% over." }] },
];

function invokeRequest(
  operation: CloudAiOperation,
  messages: readonly CloudAiMessage[] = TURNS
): CloudAiInvokeRequest {
  return {
    operation,
    system: "You are the Nixus finance assistant.",
    messages,
    client_request_id: CLIENT_REQUEST_ID,
  };
}

describe("CloudAiInvokeRequest", () => {
  it("accepts every closed operation with role/content messages and a UUID request id", () => {
    const requests = OPERATIONS.map((operation) => invokeRequest(operation));

    expect(requests.map((request) => request.operation)).toEqual([
      "chat",
      "statement_import",
      "project_advice",
      "trends_insight",
    ]);
    expect(requests.map((request) => request.messages.map((m) => m.role))).toEqual(
      OPERATIONS.map(() => ["user", "assistant"])
    );
    expect(requests.every((r) => r.client_request_id === CLIENT_REQUEST_ID)).toBe(
      true
    );
  });

  it("carries no client-selected model or token controls", () => {
    expect(Object.keys(invokeRequest("chat")).sort()).toEqual([
      "client_request_id",
      "messages",
      "operation",
      "system",
    ]);
  });
});

describe("CloudAiContent", () => {
  it("represents statement media as base64 message content, documents unnamed", () => {
    const media: readonly CloudAiContent[] = [
      { type: "image", format: "png", data_base64: "aW1hZ2UtcG5n" },
      { type: "image", format: "jpeg", data_base64: "aW1hZ2UtanBlZw==" },
      { type: "document", format: "pdf", data_base64: "ZG9jLXBkZg==" },
    ];
    const request = invokeRequest("statement_import", [
      { role: "user", content: [TEXT_BLOCK, media[2]] },
    ]);

    expect([TEXT_BLOCK, ...media].map(contentPayload)).toEqual([
      "text:Budget check-in",
      "png:aW1hZ2UtcG5n",
      "jpeg:aW1hZ2UtanBlZw==",
      "pdf:ZG9jLXBkZg==",
    ]);
    expect(Object.keys(media[2]).sort()).toEqual([
      "data_base64",
      "format",
      "type",
    ]);
    expect(request.messages[0].content).toHaveLength(2);
  });
});

describe("CloudAiFrame", () => {
  it("discriminates meta, delta, end, and error frames on `type`", () => {
    const frames: readonly CloudAiFrame[] = [
      { type: "meta", operation: "chat", request_id: "req-1" },
      { type: "delta", text: "Groceries" },
      {
        type: "end",
        stop_reason: "end_turn",
        input_tokens: 1200,
        output_tokens: 340,
      },
      { type: "error", code: "hosted_unavailable", message: "upstream failed" },
    ];

    expect(frames.map(frameFamily)).toEqual([
      "meta:chat:req-1",
      "delta:Groceries",
      "end:end_turn:1200:340",
      "error:hosted_unavailable:upstream failed",
    ]);
  });

  it("closes the stop-reason union used by the end frame", () => {
    const ends = STOP_REASONS.map<CloudAiFrame>((stop_reason) => ({
      type: "end",
      stop_reason,
      input_tokens: 1,
      output_tokens: 1,
    }));

    expect(ends.map(frameFamily)).toEqual([
      "end:end_turn:1:1",
      "end:max_tokens:1:1",
      "end:stop_sequence:1:1",
      "end:content_filtered:1:1",
      "end:guardrail_intervened:1:1",
      "end:model_context_window_exceeded:1:1",
      "end:other:1:1",
    ]);
  });
});

describe("CloudAiErrorCode", () => {
  it("closes the pre-output error envelope code set", () => {
    const envelopes = ERROR_CODES.map<CloudAiErrorResponse>((code) => ({
      error: { code, message: `rejected: ${code}`, request_id: "req-2" },
    }));

    expect(envelopes.map((envelope) => envelope.error.code)).toEqual([
      "validation",
      "unauthorized",
      "reauthentication_required",
      "premium_required",
      "payload_too_large",
      "quota_exhausted",
      "hosted_unavailable",
      "unsupported_encoding",
    ]);
    expect(Object.keys(envelopes[0].error).sort()).toEqual([
      "code",
      "message",
      "request_id",
    ]);
  });
});

describe("CloudAiStatusResponse", () => {
  it("exposes snake_case quota fields with `charged_count` as the net authority", () => {
    const status: CloudAiStatusResponse = {
      premium: true,
      monthly_request_limit: 1000,
      charged_count: 40,
      period: "2026-08",
    };

    expect(
      Math.max(0, status.monthly_request_limit - status.charged_count)
    ).toBe(960);
    expect(Object.keys(status).sort()).toEqual([
      "charged_count",
      "monthly_request_limit",
      "period",
      "premium",
    ]);
  });
});
