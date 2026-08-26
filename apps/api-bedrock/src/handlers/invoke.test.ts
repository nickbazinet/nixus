import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BedrockPort,
  BedrockStreamEvent,
  ConverseStreamArgs,
  CountTokensArgs,
} from "../lib/bedrock-client.ts";
import { setDocumentClientForTesting } from "../lib/table.ts";
import { FakeDocumentClient, transactionCanceled } from "../lib/testing/fake-dynamo.ts";
import {
  JSON_CONTENT_TYPE,
  NDJSON_CONTENT_TYPE,
  SOFT_DEADLINE_MS,
  handleInvoke,
  type ResponseSink,
} from "./invoke.ts";

const SUB = "b7f1c2d3-0000-4000-8000-abcdef123456";
const REQUEST_ID = "req-1";
const CLIENT_REQUEST_ID = "9f8b1e0c-77a2-4f4e-8a1d-1c9f5b3e2d10";
const PERIOD = "2026-08";
const NOW = new Date("2026-08-26T10:00:00Z");

class RecordingSink implements ResponseSink {
  status: number | undefined;
  contentType: string | undefined;
  beginCalls = 0;
  ended = 0;
  readonly chunks: string[] = [];

  begin(status: number, contentType: string): void {
    this.beginCalls += 1;
    this.status = status;
    this.contentType = contentType;
  }

  write(chunk: string): void {
    if (this.beginCalls === 0) {
      throw new Error("wrote body before the streaming prelude");
    }
    this.chunks.push(chunk);
  }

  async end(): Promise<void> {
    this.ended += 1;
  }

  get body(): string {
    return this.chunks.join("");
  }

  get frames(): Record<string, unknown>[] {
    return this.body
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  get json(): Record<string, unknown> {
    return JSON.parse(this.body) as Record<string, unknown>;
  }
}

async function* streamOf(
  ...events: BedrockStreamEvent[]
): AsyncGenerator<BedrockStreamEvent> {
  for (const event of events) yield event;
}

interface FakeBedrockOptions {
  readonly inputTokens?: number;
  readonly countError?: Error;
  readonly streamError?: Error;
  readonly events?: BedrockStreamEvent[];
  readonly throwAfterCommit?: Error;
}

function fakeBedrock(options: FakeBedrockOptions = {}) {
  const counted: CountTokensArgs[] = [];
  const streamed: ConverseStreamArgs[] = [];

  const port: BedrockPort = {
    async countInputTokens(args) {
      counted.push(args);
      if (options.countError) throw options.countError;
      return options.inputTokens ?? 100;
    },
    converseStream(args) {
      streamed.push(args);
      if (options.streamError) {
        throw options.streamError;
      }
      if (options.throwAfterCommit) {
        return (async function* () {
          yield { kind: "message_start" } as const;
          yield { kind: "delta", text: "partial" } as const;
          throw options.throwAfterCommit;
        })();
      }
      return streamOf(
        ...(options.events ?? [
          { kind: "message_start" },
          { kind: "delta", text: "hello" },
          { kind: "stop", stopReason: "end_turn" },
          { kind: "usage", inputTokens: 100, outputTokens: 7 },
        ])
      );
    },
  };

  return { port, counted, streamed };
}

let client: FakeDocumentClient;
let sink: RecordingSink;

/* classifyEligibility fires four consistent reads concurrently in this order. */
function queueEligible(
  overrides: {
    user?: Record<string, unknown> | undefined;
    global?: Record<string, unknown> | undefined;
    userCharged?: number;
    globalCharged?: number;
  } = {}
): void {
  client
    .queueItem(
      "user" in overrides
        ? overrides.user
        : { premium: true, monthly_request_limit: 100 }
    )
    .queueItem(
      "global" in overrides
        ? overrides.global
        : { enabled: true, monthly_request_limit: 1000 }
    )
    .queueItem({ charged_count: overrides.userCharged ?? 0 })
    .queueItem({ charged_count: overrides.globalCharged ?? 0 });
}

function chatBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    operation: "chat",
    system: "You are a budgeting assistant.",
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    client_request_id: CLIENT_REQUEST_ID,
    ...overrides,
  });
}

function run(
  options: FakeBedrockOptions & {
    body?: string;
    headers?: Record<string, string | undefined>;
    remainingTimeMillis?: number;
  } = {}
) {
  const bedrock = fakeBedrock(options);
  const promise = handleInvoke(
    {
      sub: SUB,
      requestId: REQUEST_ID,
      periodKey: PERIOD,
      headers: options.headers,
      body: options.body ?? chatBody(),
    },
    {
      bedrock: bedrock.port,
      now: () => NOW,
      remainingTimeMillis: () => options.remainingTimeMillis ?? 300_000,
      newId: sequentialIds(),
    },
    sink
  );
  return { promise, bedrock };
}

function sequentialIds(): () => string {
  let index = 0;
  return () => `id-${++index}`;
}

beforeEach(() => {
  client = new FakeDocumentClient();
  setDocumentClientForTesting(client.asDocumentClient());
  process.env.TABLE_NAME = "nixus-hosted-ai";
  sink = new RecordingSink();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  setDocumentClientForTesting(undefined);
  delete process.env.TABLE_NAME;
  vi.restoreAllMocks();
});

describe("AD-8 step 0 and 1 reject before any AWS call", () => {
  it("rejects a compressed body with 415 and never touches DynamoDB or Bedrock", async () => {
    const { promise, bedrock } = run({ headers: { "Content-Encoding": "gzip" } });
    await promise;

    expect(sink.status).toBe(415);
    expect(sink.contentType).toBe(JSON_CONTENT_TYPE);
    expect(sink.json).toEqual({
      error: {
        code: "unsupported_encoding",
        message: expect.any(String),
        request_id: REQUEST_ID,
      },
    });
    expect(client.sent).toHaveLength(0);
    expect(bedrock.counted).toHaveLength(0);
    expect(bedrock.streamed).toHaveLength(0);
  });

  it("rejects an invalid schema with 400 and no quota mutation", async () => {
    const { promise, bedrock } = run({ body: chatBody({ model_id: "x" }) });
    await promise;

    expect(sink.status).toBe(400);
    expect(sink.json.error).toMatchObject({ code: "validation" });
    expect(client.transactions).toHaveLength(0);
    expect(bedrock.counted).toHaveLength(0);
  });

  it("rejects oversized media with 413 before any Bedrock call", async () => {
    const body = JSON.stringify({
      operation: "statement_import",
      system: "s",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "t" },
            {
              type: "document",
              format: "pdf",
              data_base64: Buffer.alloc(4 * 1024 * 1024 + 1).toString("base64"),
            },
          ],
        },
      ],
      client_request_id: CLIENT_REQUEST_ID,
    });

    const { promise, bedrock } = run({ body });
    await promise;

    expect(sink.status).toBe(413);
    expect(sink.json.error).toMatchObject({ code: "payload_too_large" });
    expect(bedrock.counted).toHaveLength(0);
    expect(client.sent).toHaveLength(0);
  });

  it("always closes the response exactly once", async () => {
    const { promise } = run({ headers: { "Content-Encoding": "br" } });
    await promise;
    expect(sink.ended).toBe(1);
  });
});

describe("AD-8 step 2 never spends a CountTokens call on an ineligible caller", () => {
  it("returns 503 when the GLOBAL config was never seeded", async () => {
    queueEligible({ global: undefined });
    const { promise, bedrock } = run();
    await promise;

    expect(sink.status).toBe(503);
    expect(sink.json.error).toMatchObject({ code: "hosted_unavailable" });
    expect(bedrock.counted).toHaveLength(0);
    expect(client.transactions).toHaveLength(0);
  });

  it("returns 503 while the kill switch is off, even for a premium user with quota", async () => {
    queueEligible({ global: { enabled: false, monthly_request_limit: 1000 } });
    const { promise, bedrock } = run();
    await promise;

    expect(sink.status).toBe(503);
    expect(bedrock.counted).toHaveLength(0);
  });

  it("returns 503 when the global cap is exhausted", async () => {
    queueEligible({ globalCharged: 1000 });
    const { promise, bedrock } = run();
    await promise;

    expect(sink.status).toBe(503);
    expect(bedrock.counted).toHaveLength(0);
  });

  it("returns 403 for a missing, non-premium, or malformed user config", async () => {
    for (const user of [
      undefined,
      { premium: false, monthly_request_limit: 100 },
      { premium: true },
      { premium: true, monthly_request_limit: 0 },
    ]) {
      client = new FakeDocumentClient();
      setDocumentClientForTesting(client.asDocumentClient());
      sink = new RecordingSink();

      queueEligible({ user });
      const { promise, bedrock } = run();
      await promise;

      expect(sink.status, JSON.stringify(user)).toBe(403);
      expect(sink.json.error).toMatchObject({ code: "premium_required" });
      expect(bedrock.counted).toHaveLength(0);
    }
  });

  it("returns 429 once the user's own quota is exhausted", async () => {
    queueEligible({ userCharged: 100 });
    const { promise, bedrock } = run();
    await promise;

    expect(sink.status).toBe(429);
    expect(sink.json.error).toMatchObject({ code: "quota_exhausted" });
    expect(bedrock.counted).toHaveLength(0);
    expect(client.transactions).toHaveLength(0);
  });

  it("prefers the global 503 over a per-user 403 so the kill switch is unambiguous", async () => {
    queueEligible({
      user: undefined,
      global: { enabled: false, monthly_request_limit: 1000 },
    });
    const { promise } = run();
    await promise;

    expect(sink.status).toBe(503);
  });
});

describe("AD-8 step 3 CountTokens gate", () => {
  it("maps a CountTokens failure to pre-reservation 503 with no reservation", async () => {
    queueEligible();
    const { promise } = run({ countError: new Error("bedrock down") });
    await promise;

    expect(sink.status).toBe(503);
    expect(sink.json.error).toMatchObject({ code: "hosted_unavailable" });
    expect(client.transactions).toHaveLength(0);
  });

  it("maps an input-ceiling overage to pre-reservation 400 validation", async () => {
    queueEligible();
    const { promise } = run({ inputTokens: 32_769 });
    await promise;

    expect(sink.status).toBe(400);
    expect(sink.json.error).toMatchObject({ code: "validation" });
    expect(client.transactions).toHaveLength(0);
  });

  it("counts the finalized system prompt and messages, never a client-supplied count", async () => {
    queueEligible();
    client.queueOk().queueOk();
    const { promise, bedrock } = run();
    await promise;

    expect(bedrock.counted).toHaveLength(1);
    expect(bedrock.counted[0]!.system).toBe("You are a budgeting assistant.");
    expect(bedrock.counted[0]!.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ]);
  });

  it("counts PDF prompt text but streams the full bounded document", async () => {
    queueEligible();
    client.queueOk().queueOk();
    const body = JSON.stringify({
      operation: "statement_import",
      system: "Extract transactions.",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Read this statement." },
            { type: "document", format: "pdf", data_base64: "JVBERi0xLjQ=" },
          ],
        },
      ],
      client_request_id: CLIENT_REQUEST_ID,
    });

    const { promise, bedrock } = run({ body });
    await promise;

    expect(bedrock.counted[0]!.messages[0]!.content).toEqual([
      { type: "text", text: "Read this statement." },
    ]);
    expect(bedrock.streamed[0]!.messages[0]!.content).toEqual([
      { type: "text", text: "Read this statement." },
      {
        type: "document",
        format: "pdf",
        bytes: new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]),
      },
    ]);
  });
});

describe("AD-8 step 4 reservation", () => {
  it("reserves once and streams on success", async () => {
    queueEligible();
    client.queueOk().queueOk();

    const { promise } = run();
    await promise;

    expect(sink.status).toBe(200);
    expect(client.transactions).toHaveLength(2);
  });

  it("rereads and retries exactly once when config changed mid-request", async () => {
    queueEligible();
    client.queueError(
      transactionCanceled("ConditionalCheckFailed", "None", "None", "None")
    );
    queueEligible();
    client.queueOk().queueOk();

    const { promise, bedrock } = run();
    await promise;

    expect(sink.status).toBe(200);
    // Two eligibility passes (4 reads each) plus reserve+finalize transactions.
    expect(client.gets).toHaveLength(8);
    // The retry must not pay for a second CountTokens call.
    expect(bedrock.counted).toHaveLength(1);
  });

  it("fails closed rather than looping when config changes twice", async () => {
    queueEligible();
    client.queueError(
      transactionCanceled("ConditionalCheckFailed", "None", "None", "None")
    );
    queueEligible();
    client.queueError(
      transactionCanceled("ConditionalCheckFailed", "None", "None", "None")
    );

    const { promise, bedrock } = run();
    await promise;

    expect(sink.status).toBe(403);
    expect(bedrock.streamed).toHaveLength(0);
  });

  it("maps a lost race on the user's own limit to 429 without invoking the model", async () => {
    queueEligible();
    client.queueError(
      transactionCanceled("None", "None", "ConditionalCheckFailed", "None")
    );

    const { promise, bedrock } = run();
    await promise;

    expect(sink.status).toBe(429);
    expect(bedrock.streamed).toHaveLength(0);
  });

  it("maps a lost race on the global limit to 503", async () => {
    queueEligible();
    client.queueError(
      transactionCanceled("None", "None", "None", "ConditionalCheckFailed")
    );

    const { promise } = run();
    await promise;

    expect(sink.status).toBe(503);
  });
});

describe("messageStart is the exact commit event", () => {
  it("writes nothing before messageStart, then the prelude and the meta frame", async () => {
    queueEligible();
    client.queueOk().queueOk();

    const { promise } = run();
    await promise;

    expect(sink.beginCalls).toBe(1);
    expect(sink.status).toBe(200);
    expect(sink.contentType).toBe(NDJSON_CONTENT_TYPE);
    expect(sink.frames[0]).toEqual({
      type: "meta",
      operation: "chat",
      request_id: REQUEST_ID,
    });
  });

  it("emits meta, delta, and end in that order with NDJSON line framing", async () => {
    queueEligible();
    client.queueOk().queueOk();

    const { promise } = run({
      events: [
        { kind: "message_start" },
        { kind: "delta", text: "a" },
        { kind: "delta", text: "b" },
        { kind: "stop", stopReason: "end_turn" },
        { kind: "usage", inputTokens: 120, outputTokens: 9 },
      ],
    });
    await promise;

    expect(sink.frames).toEqual([
      { type: "meta", operation: "chat", request_id: REQUEST_ID },
      { type: "delta", text: "a" },
      { type: "delta", text: "b" },
      { type: "end", stop_reason: "end_turn", input_tokens: 120, output_tokens: 9 },
    ]);
    expect(sink.body.endsWith("\n")).toBe(true);
    for (const line of sink.body.split("\n").filter(Boolean)) {
      expect(line).not.toContain("\n");
    }
  });

  it("reports a max_tokens stop explicitly in the end frame", async () => {
    queueEligible();
    client.queueOk().queueOk();

    const { promise } = run({
      events: [
        { kind: "message_start" },
        { kind: "delta", text: "truncated" },
        { kind: "stop", stopReason: "max_tokens" },
        { kind: "usage", inputTokens: 10, outputTokens: 4096 },
      ],
    });
    await promise;

    expect(sink.frames.at(-1)).toMatchObject({
      type: "end",
      stop_reason: "max_tokens",
    });
  });

  it("treats a stream that never reaches messageStart as a refundable pre-output failure", async () => {
    queueEligible();
    client.queueOk();
    client.queueOk();

    const { promise } = run({ events: [{ kind: "delta", text: "orphan" }] });
    await promise;

    expect(sink.status).toBe(503);
    expect(sink.contentType).toBe(JSON_CONTENT_TYPE);
    expect(client.transactions).toHaveLength(2);
    const refund = client.transactions[1]!.input.TransactItems as {
      Update: { UpdateExpression: string };
    }[];
    expect(refund[0]!.Update.UpdateExpression).toContain("charged_count :minus_one");
  });

  it("refunds exactly once when ConverseStream fails before commit", async () => {
    queueEligible();
    client.queueOk().queueOk();

    const { promise } = run({ streamError: new Error("bedrock refused") });
    await promise;

    expect(sink.status).toBe(503);
    expect(client.transactions).toHaveLength(2);
    expect(client.transactions[1]!.input.ClientRequestToken).toBe("id-3");
  });

  it("passes the server-owned output ceiling for the operation, never a client value", async () => {
    queueEligible();
    client.queueOk().queueOk();

    const { promise, bedrock } = run();
    await promise;

    expect(bedrock.streamed[0]!.maxOutputTokens).toBe(4096);
  });
});

describe("post-commit failures are charged, in-band, and never refunded", () => {
  it("emits an in-band error frame instead of an HTTP error status", async () => {
    queueEligible();
    client.queueOk().queueOk();

    const { promise } = run({ throwAfterCommit: new Error("stream broke") });
    await promise;

    expect(sink.status).toBe(200);
    expect(sink.beginCalls).toBe(1);
    expect(sink.frames).toEqual([
      { type: "meta", operation: "chat", request_id: REQUEST_ID },
      { type: "delta", text: "partial" },
      {
        type: "error",
        code: "hosted_unavailable",
        message: expect.any(String),
      },
    ]);
  });

  it("never writes an end frame alongside an error frame", async () => {
    queueEligible();
    client.queueOk().queueOk();

    const { promise } = run({ throwAfterCommit: new Error("stream broke") });
    await promise;

    expect(sink.frames.filter((frame) => frame.type === "end")).toHaveLength(0);
  });

  it("never refunds and instead finalizes as failed_after_commit", async () => {
    queueEligible();
    client.queueOk().queueOk();

    const { promise } = run({ throwAfterCommit: new Error("stream broke") });
    await promise;

    expect(client.transactions).toHaveLength(2);
    const finalize = client.transactions[1]!.input.TransactItems as {
      Update: {
        UpdateExpression: string;
        ExpressionAttributeNames: Record<string, string>;
      };
    }[];
    for (const item of finalize) {
      expect(item.Update.ExpressionAttributeNames["#outcome_counter"]).toBe(
        "failed_after_commit_count"
      );
      expect(item.Update.UpdateExpression).not.toContain("charged_count");
    }
  });
});

describe("finalize settles a completed invocation", () => {
  it("records completed_count and the observed token usage on both items", async () => {
    queueEligible();
    client.queueOk().queueOk();

    const { promise } = run({
      events: [
        { kind: "message_start" },
        { kind: "stop", stopReason: "end_turn" },
        { kind: "usage", inputTokens: 111, outputTokens: 22 },
      ],
    });
    await promise;

    const finalize = client.transactions[1]!.input.TransactItems as {
      Update: {
        Key: { pk: string; sk: string };
        ExpressionAttributeNames: Record<string, string>;
        ExpressionAttributeValues: Record<string, unknown>;
      };
    }[];

    expect(finalize.map((item) => item.Update.Key)).toEqual([
      { pk: `USER#${SUB}`, sk: "USAGE#2026-08" },
      { pk: "GLOBAL", sk: "USAGE#2026-08" },
    ]);
    for (const item of finalize) {
      expect(item.Update.ExpressionAttributeNames["#outcome_counter"]).toBe(
        "completed_count"
      );
      expect(item.Update.ExpressionAttributeNames["#settled_counter"]).toBe(
        "settled_chat_count"
      );
      expect(item.Update.ExpressionAttributeValues[":input_tokens"]).toBe(111);
      expect(item.Update.ExpressionAttributeValues[":output_tokens"]).toBe(22);
    }
  });

  it("falls back to the CountTokens figure when the stream reports no usage", async () => {
    queueEligible();
    client.queueOk().queueOk();

    const { promise } = run({
      inputTokens: 77,
      events: [
        { kind: "message_start" },
        { kind: "stop", stopReason: "end_turn" },
      ],
    });
    await promise;

    expect(sink.frames.at(-1)).toEqual({
      type: "end",
      stop_reason: "end_turn",
      input_tokens: 77,
      output_tokens: 0,
    });
  });

  it("defaults an absent stop reason to other rather than omitting it", async () => {
    queueEligible();
    client.queueOk().queueOk();

    const { promise } = run({
      events: [{ kind: "message_start" }, { kind: "delta", text: "x" }],
    });
    await promise;

    expect(sink.frames.at(-1)).toMatchObject({
      type: "end",
      stop_reason: "other",
    });
  });

  it("uses three distinct idempotency tokens across reserve and finalize", async () => {
    queueEligible();
    client.queueOk().queueOk();

    const { promise } = run();
    await promise;

    const tokens = client.transactions.map(
      (command) => command.input.ClientRequestToken
    );
    expect(tokens).toEqual(["id-2", "id-4"]);
  });
});

describe("soft deadline", () => {
  it("arms the abort signal with the architecture's 10-second margin", async () => {
    queueEligible();
    client.queueOk().queueOk();

    const { promise, bedrock } = run({ remainingTimeMillis: 30_000 });
    await promise;

    expect(SOFT_DEADLINE_MS).toBe(10_000);
    expect(bedrock.streamed[0]!.abortSignal?.aborted).toBe(false);
  });

  it("refuses up front when less than the margin remains, spending nothing", async () => {
    const { promise, bedrock } = run({ remainingTimeMillis: SOFT_DEADLINE_MS });
    await promise;

    expect(sink.status).toBe(503);
    expect(sink.json.error).toMatchObject({ code: "hosted_unavailable" });
    expect(client.sent).toHaveLength(0);
    expect(bedrock.counted).toHaveLength(0);
    expect(bedrock.streamed).toHaveLength(0);
  });

  it("proceeds normally with more than the margin remaining", async () => {
    queueEligible();
    client.queueOk().queueOk();

    const { promise } = run({ remainingTimeMillis: SOFT_DEADLINE_MS + 1 });
    await promise;

    expect(sink.status).toBe(200);
  });
});

describe("privacy-safe failures (AD-11)", () => {
  it("never puts prompt or response text in a log line", async () => {
    const logged: string[] = [];
    vi.mocked(console.error).mockImplementation((line: unknown) => {
      logged.push(String(line));
    });
    vi.mocked(console.log).mockImplementation((line: unknown) => {
      logged.push(String(line));
    });

    queueEligible();
    client.queueOk().queueOk();

    const { promise } = run({
      body: chatBody({
        system: "SECRET-SYSTEM-PROMPT",
        messages: [
          { role: "user", content: [{ type: "text", text: "BALANCE-4242" }] },
        ],
      }),
      events: [
        { kind: "message_start" },
        { kind: "delta", text: "MODEL-SAID-9999" },
        { kind: "stop", stopReason: "end_turn" },
      ],
    });
    await promise;

    const combined = logged.join("\n");
    expect(combined).not.toContain("SECRET-SYSTEM-PROMPT");
    expect(combined).not.toContain("BALANCE-4242");
    expect(combined).not.toContain("MODEL-SAID-9999");
    expect(combined).toContain("invoke_completed");
  });

  it("emits structured JSON logs carrying only sub, operation, status, and counts", async () => {
    const logged: string[] = [];
    vi.mocked(console.log).mockImplementation((line: unknown) => {
      logged.push(String(line));
    });

    queueEligible();
    client.queueOk().queueOk();

    const { promise } = run();
    await promise;

    const completed = logged
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.event === "invoke_completed");

    expect(completed).toEqual({
      event: "invoke_completed",
      request_id: REQUEST_ID,
      sub: SUB,
      operation: "chat",
      status: 200,
      stop_reason: "end_turn",
      input_tokens: 100,
      output_tokens: 7,
    });
  });

  it("never echoes a rejected payload back in the error envelope", async () => {
    const { promise } = run({
      body: chatBody({ secret_field: "ACCOUNT-99887766" }),
    });
    await promise;

    expect(sink.body).not.toContain("ACCOUNT-99887766");
    expect(sink.json.error).toMatchObject({ code: "validation" });
  });
});

/*
 * Quota accounting is best-effort observability once the caller's outcome is
 * decided. A DynamoDB failure here must never (a) leak the item or its expression
 * values into a log, (b) replace an already-committed response, or (c) skip sink
 * termination and leave the stream hanging.
 */
describe("refund and finalize failures are observable, privacy-safe, and non-fatal", () => {
  function ddbFailure(): Error {
    const error = new Error(
      "ConditionalCheckFailedException: item {pk: USER#b7f1c2d3-..., charged_count: 7}"
    );
    error.name = "ProvisionedThroughputExceededException";
    return error;
  }

  function loggedEvents(): Record<string, unknown>[] {
    return vi
      .mocked(console.error)
      .mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
  }

  it("emits refund_failed and still returns the pre-output error to the caller", async () => {
    queueEligible();
    client.queueOk().queueError(ddbFailure());

    const { promise } = run({ streamError: new Error("bedrock refused") });
    await promise;

    expect(sink.status).toBe(503);
    expect(sink.json.error).toMatchObject({ code: "hosted_unavailable" });
    expect(sink.ended).toBe(1);

    const refundFailed = loggedEvents().find(
      (entry) => entry.event === "refund_failed"
    );
    expect(refundFailed).toMatchObject({
      event: "refund_failed",
      request_id: REQUEST_ID,
      sub: SUB,
      operation: "chat",
      reservation_id: "id-1",
      period: PERIOD,
      error_name: "ProvisionedThroughputExceededException",
    });
  });

  /* A DynamoDB SDK error's message echoes the item and its expression values, and
   * the item is keyed by `sub` (AD-11). */
  it("keeps the DynamoDB error message and item contents out of the log", async () => {
    queueEligible();
    client.queueOk().queueError(ddbFailure());

    const { promise } = run({ streamError: new Error("bedrock refused") });
    await promise;

    const serialized = JSON.stringify(loggedEvents());
    expect(serialized).not.toContain("charged_count: 7");
    expect(serialized).not.toContain("ConditionalCheckFailedException:");
    expect(serialized).not.toContain("USER#b7f1c2d3-...");
  });

  it("emits finalize_failed without replacing the already-committed stream", async () => {
    queueEligible();
    client.queueOk().queueError(ddbFailure());

    const { promise } = run();
    await promise;

    // The committed response is intact: prelude written once, end frame delivered.
    expect(sink.status).toBe(200);
    expect(sink.beginCalls).toBe(1);
    expect(sink.contentType).toBe(NDJSON_CONTENT_TYPE);
    expect(sink.frames.at(-1)).toMatchObject({ type: "end" });
    expect(sink.frames.filter((frame) => frame.type === "error")).toHaveLength(0);

    const finalizeFailed = loggedEvents().find(
      (entry) => entry.event === "finalize_failed"
    );
    expect(finalizeFailed).toMatchObject({
      event: "finalize_failed",
      request_id: REQUEST_ID,
      operation: "chat",
      outcome: "completed",
      error_name: "ProvisionedThroughputExceededException",
    });
  });

  it("terminates the sink exactly once even when finalize throws", async () => {
    queueEligible();
    client.queueOk().queueError(ddbFailure());

    const { promise } = run();
    await promise;

    expect(sink.ended).toBe(1);
  });

  it("records a post-commit failure's own outcome when finalize also fails", async () => {
    queueEligible();
    client.queueOk().queueError(ddbFailure());

    const { promise } = run({ throwAfterCommit: new Error("stream broke") });
    await promise;

    // The in-band error frame still reached the caller.
    expect(sink.frames.at(-1)).toMatchObject({ type: "error" });
    expect(sink.ended).toBe(1);

    expect(
      loggedEvents().find((entry) => entry.event === "finalize_failed")
    ).toMatchObject({ outcome: "failed_after_commit" });
  });

  /* Only reserve and refund move the net authority, so a finalize failure cannot
   * have changed it (AD-5). */
  it("never issues a charged_count write while finalizing", async () => {
    queueEligible();
    client.queueOk().queueError(ddbFailure());

    const { promise } = run();
    await promise;

    const finalize = client.transactions[1]!.input.TransactItems as {
      Update: { UpdateExpression: string };
    }[];
    for (const item of finalize) {
      expect(item.Update.UpdateExpression).not.toContain("charged_count");
    }
  });

  it("still uses the once-computed idempotency tokens on the failing calls", async () => {
    queueEligible();
    client.queueOk().queueError(ddbFailure());

    const { promise } = run({ streamError: new Error("bedrock refused") });
    await promise;

    const tokens = client.transactions.map(
      (command) => command.input.ClientRequestToken
    );
    // reserve then refund, distinct and generated once at request start.
    expect(tokens).toEqual(["id-2", "id-3"]);
  });
});
