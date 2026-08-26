import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

import {
  createBedrockPort,
  setRuntimeClientForTesting,
  modelId,
  normalizeConverseStream,
  normalizeStopReason,
  toConverseMessages,
  toConverseSystem,
  type BedrockStreamEvent,
} from "./bedrock-client.ts";
import {
  FIXED_DOCUMENT_NAME,
  OPERATION_LIMITS,
  type PreparedMessage,
} from "./validation.ts";

/*
 * The server-owned model: a cross-region inference profile, which is legal again now
 * that the service makes no Runtime CountTokens call - the one capability profiles do
 * not carry. Streaming is all this adapter does.
 */
const MODEL_ID = "us.anthropic.claude-sonnet-4-6";

async function collect(
  events: Record<string, unknown>[]
): Promise<BedrockStreamEvent[]> {
  const out: BedrockStreamEvent[] = [];
  for await (const event of normalizeConverseStream(toAsync(events))) {
    out.push(event);
  }
  return out;
}

async function* toAsync(
  events: Record<string, unknown>[]
): AsyncGenerator<Record<string, unknown>> {
  for (const event of events) yield event;
}

describe("stop reason normalization is a closed mapping", () => {
  it("passes through every reason the client union names", () => {
    expect(normalizeStopReason("end_turn")).toBe("end_turn");
    expect(normalizeStopReason("max_tokens")).toBe("max_tokens");
    expect(normalizeStopReason("stop_sequence")).toBe("stop_sequence");
    expect(normalizeStopReason("content_filtered")).toBe("content_filtered");
    expect(normalizeStopReason("guardrail_intervened")).toBe("guardrail_intervened");
    expect(normalizeStopReason("model_context_window_exceeded")).toBe(
      "model_context_window_exceeded"
    );
  });

  it("maps every other AWS reason to other rather than leaking a new literal", () => {
    // These are real AWS StopReason values with no client-union counterpart.
    for (const reason of [
      "tool_use",
      "malformed_tool_use",
      "malformed_model_output",
    ]) {
      expect(normalizeStopReason(reason)).toBe("other");
    }
  });

  it("maps an absent or unrecognized reason to other", () => {
    expect(normalizeStopReason(undefined)).toBe("other");
    expect(normalizeStopReason("a_reason_aws_adds_next_year")).toBe("other");
    expect(normalizeStopReason("")).toBe("other");
  });

  /* Regression: an object-literal lookup inherits from Object.prototype, so these
   * keys resolved to inherited functions, slipped past `?? "other"`, and put a
   * non-CloudAiStopReason value on the wire. */
  it("never resolves an inherited Object.prototype key to a non-stop-reason", () => {
    for (const inherited of [
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "__proto__",
      "__defineGetter__",
      "isPrototypeOf",
      "propertyIsEnumerable",
    ]) {
      const resolved = normalizeStopReason(inherited);
      expect(resolved, `${inherited} must not leak a prototype member`).toBe(
        "other"
      );
      expect(typeof resolved).toBe("string");
    }
  });
});

describe("system prompt translation", () => {
  it("wraps a non-empty prompt in a text block", () => {
    expect(toConverseSystem("be helpful")).toEqual([{ text: "be helpful" }]);
  });

  it("omits the system block entirely for an empty prompt", () => {
    expect(toConverseSystem("")).toBeUndefined();
  });
});

describe("message translation into Converse shapes", () => {
  it("maps text blocks and preserves roles and order", () => {
    const messages: PreparedMessage[] = [
      { role: "user", content: [{ type: "text", text: "one" }] },
      { role: "assistant", content: [{ type: "text", text: "two" }] },
    ];

    expect(toConverseMessages(messages)).toEqual([
      { role: "user", content: [{ text: "one" }] },
      { role: "assistant", content: [{ text: "two" }] },
    ]);
  });

  it("maps an image block to a bytes source with its declared format", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const converse = toConverseMessages([
      { role: "user", content: [{ type: "image", format: "jpeg", bytes }] },
    ]);

    expect(converse[0]!.content).toEqual([
      { image: { format: "jpeg", source: { bytes } } },
    ]);
  });

  it("always supplies the fixed neutral document name", () => {
    const bytes = new Uint8Array([9]);
    const converse = toConverseMessages([
      { role: "user", content: [{ type: "document", format: "pdf", bytes }] },
    ]);

    expect(converse[0]!.content).toEqual([
      {
        document: {
          format: "pdf",
          name: FIXED_DOCUMENT_NAME,
          source: { bytes },
        },
      },
    ]);
    expect(FIXED_DOCUMENT_NAME).toBe("statement");
  });

  it("keeps a mixed statement_import message in wire order", () => {
    const bytes = new Uint8Array([4]);
    const converse = toConverseMessages([
      {
        role: "user",
        content: [
          { type: "text", text: "categorize" },
          { type: "document", format: "pdf", bytes },
        ],
      },
    ]);

    expect(converse[0]!.content?.map((block) => Object.keys(block)[0])).toEqual([
      "text",
      "document",
    ]);
  });
});

describe("stream normalization", () => {
  it("surfaces message_start as its own event so the handler can commit on it", async () => {
    const events = await collect([
      { messageStart: { role: "assistant" } },
      { contentBlockDelta: { delta: { text: "hi" } } },
      { messageStop: { stopReason: "end_turn" } },
      { metadata: { usage: { inputTokens: 12, outputTokens: 3 } } },
    ]);

    expect(events).toEqual([
      { kind: "message_start" },
      { kind: "delta", text: "hi" },
      { kind: "stop", stopReason: "end_turn" },
      { kind: "usage", inputTokens: 12, outputTokens: 3 },
    ]);
  });

  it("ignores block start and stop framing that carries no output", async () => {
    const events = await collect([
      { messageStart: {} },
      { contentBlockStart: { start: {} } },
      { contentBlockDelta: { delta: { text: "a" } } },
      { contentBlockStop: {} },
      { messageStop: { stopReason: "max_tokens" } },
    ]);

    expect(events.map((event) => event.kind)).toEqual([
      "message_start",
      "delta",
      "stop",
    ]);
  });

  it("drops non-text deltas rather than emitting empty output", async () => {
    const events = await collect([
      { messageStart: {} },
      { contentBlockDelta: { delta: { toolUse: { input: "{}" } } } },
      { contentBlockDelta: { delta: { text: "" } } },
      { contentBlockDelta: { delta: {} } },
      { contentBlockDelta: {} },
      { contentBlockDelta: { delta: { text: "real" } } },
    ]);

    expect(events).toEqual([
      { kind: "message_start" },
      { kind: "delta", text: "real" },
    ]);
  });

  it("defaults missing usage numbers to zero instead of undefined", async () => {
    const events = await collect([
      { messageStart: {} },
      { messageStop: { stopReason: "end_turn" } },
      { metadata: {} },
    ]);

    expect(events.at(-1)).toEqual({
      kind: "usage",
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("reports a max_tokens stop explicitly rather than as a silent truncation", async () => {
    const events = await collect([
      { messageStart: {} },
      { contentBlockDelta: { delta: { text: "partial" } } },
      { messageStop: { stopReason: "max_tokens" } },
      { metadata: { usage: { inputTokens: 5, outputTokens: 4096 } } },
    ]);

    expect(events).toContainEqual({ kind: "stop", stopReason: "max_tokens" });
  });

  it("throws on every in-stream AWS exception so the handler can classify it", async () => {
    const exceptions = [
      "internalServerException",
      "modelStreamErrorException",
      "validationException",
      "throttlingException",
      "serviceUnavailableException",
    ];

    for (const exception of exceptions) {
      await expect(
        collect([{ messageStart: {} }, { [exception]: { message: "x" } }])
      ).rejects.toThrow();
    }
  });

  it("throws before message_start when the failure arrives first, keeping it pre-output", async () => {
    await expect(
      collect([{ internalServerException: { message: "x" } }])
    ).rejects.toThrow(/internal server exception/);
  });
});

describe("model selection is server-owned", () => {
  it("reads the model from the environment and refuses to run without it", () => {
    const previous = process.env.BEDROCK_MODEL_ID;
    try {
      process.env.BEDROCK_MODEL_ID = MODEL_ID;
      expect(modelId()).toBe(MODEL_ID);

      delete process.env.BEDROCK_MODEL_ID;
      expect(() => modelId()).toThrow(/BEDROCK_MODEL_ID/);
    } finally {
      if (previous === undefined) delete process.env.BEDROCK_MODEL_ID;
      else process.env.BEDROCK_MODEL_ID = previous;
    }
  });

  /* Quota is per request, so there is no token-counting call to make and nothing left
   * that requires a bare foundation model. An inference profile is the deliberate
   * choice, and the adapter must not second-guess it. */
  it("accepts a cross-region inference profile id without special-casing it", () => {
    const previous = process.env.BEDROCK_MODEL_ID;
    try {
      process.env.BEDROCK_MODEL_ID = "us.anthropic.claude-sonnet-4-6";
      expect(modelId()).toBe("us.anthropic.claude-sonnet-4-6");
    } finally {
      if (previous === undefined) delete process.env.BEDROCK_MODEL_ID;
      else process.env.BEDROCK_MODEL_ID = previous;
    }
  });

  /* The region belongs to the SDK's own resolution now: the profile is a us-east-1
   * profile and the Lambda runs in us-east-1, so a second source of truth for it could
   * only ever disagree with the stack. */
  it("reads no region of its own from the environment", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./bedrock-client.ts", import.meta.url)),
      "utf8"
    );

    expect(source).not.toContain("BEDROCK_REGION");
    expect(source).not.toContain("CountTokensCommand");
    expect(source).not.toContain("countInputTokens");
  });
});

/*
 * Exercises the real `createBedrockPort` through the runtime-client seam, so the
 * actual SDK command inputs are asserted. The pure translation helpers above can
 * all be correct while the port still forgets to pass `system` to CountTokens or an
 * output ceiling to ConverseStream - neither of which any of them would catch.
 */
describe("createBedrockPort builds the real SDK commands", () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  class FakeRuntimeClient {
    readonly sent: { input: any; options: any }[] = [];
    private readonly queued: any[] = [];

    queue(response: any): this {
      this.queued.push(response);
      return this;
    }

    async send(command: { input: any }, options?: any): Promise<any> {
      this.sent.push({ input: command.input, options });
      const next = this.queued.shift();
      if (next instanceof Error) throw next;
      return next ?? {};
    }

    asClient(): BedrockRuntimeClient {
      return this as unknown as BedrockRuntimeClient;
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  let client: FakeRuntimeClient;

  const messages: PreparedMessage[] = [
    { role: "user", content: [{ type: "text", text: "how is my budget?" }] },
  ];

  beforeEach(() => {
    client = new FakeRuntimeClient();
    setRuntimeClientForTesting(client.asClient());
    process.env.BEDROCK_MODEL_ID = MODEL_ID;
  });

  afterEach(() => {
    setRuntimeClientForTesting(undefined);
    delete process.env.BEDROCK_MODEL_ID;
  });

  it("sends ConverseStream with the operation's server-owned output ceiling", async () => {
    async function* stream() {
      yield { messageStart: { role: "assistant" } };
      yield { contentBlockDelta: { delta: { text: "ok" } } };
      yield { messageStop: { stopReason: "end_turn" } };
    }
    client.queue({ stream: stream() });

    const events: BedrockStreamEvent[] = [];
    for await (const event of createBedrockPort().converseStream({
      system: "You are a budgeting assistant.",
      messages,
      maxOutputTokens: OPERATION_LIMITS.chat.outputTokens,
    })) {
      events.push(event);
    }

    const input = client.sent[0]!.input;
    expect(input.modelId).toBe(MODEL_ID);
    expect(input.system).toEqual([{ text: "You are a budgeting assistant." }]);
    // Without maxTokens the model would use its own default, silently ignoring the
    // per-operation ceiling the architecture makes server-owned (AD-8).
    expect(input.inferenceConfig).toEqual({ maxTokens: 4096 });

    expect(events.map((event) => event.kind)).toEqual([
      "message_start",
      "delta",
      "stop",
    ]);
  });

  it("passes each operation's own ceiling through unchanged", async () => {
    for (const [operation, limits] of Object.entries(OPERATION_LIMITS)) {
      client = new FakeRuntimeClient();
      setRuntimeClientForTesting(client.asClient());

      async function* empty() {
        yield { messageStop: { stopReason: "end_turn" } };
      }
      client.queue({ stream: empty() });

      for await (const _event of createBedrockPort().converseStream({
        system: "s",
        messages,
        maxOutputTokens: limits.outputTokens,
      })) {
        void _event;
      }

      expect(
        client.sent[0]!.input.inferenceConfig.maxTokens,
        `${operation} ceiling`
      ).toBe(limits.outputTokens);
    }
  });

  /* One Bedrock call per request is the whole cost model: quota charges one unit per
   * ConverseStream, so a second upstream call would either be uncharged work or a
   * double charge. Asserting the count is what keeps a "cheap little preflight" from
   * being added back. */
  it("makes exactly one Bedrock call per request, and it is ConverseStream", async () => {
    async function* stream() {
      yield { messageStart: { role: "assistant" } };
      yield { messageStop: { stopReason: "end_turn" } };
    }
    client.queue({ stream: stream() });

    for await (const _event of createBedrockPort().converseStream({
      system: "s",
      messages,
      maxOutputTokens: OPERATION_LIMITS.chat.outputTokens,
    })) {
      void _event;
    }

    expect(client.sent).toHaveLength(1);
    const input = client.sent[0]!.input;
    expect(input.modelId).toBe(MODEL_ID);
    // A CountTokens command would carry `input.converse`; ConverseStream carries the
    // messages at the top level.
    expect(input.input).toBeUndefined();
    expect(input.messages).toBeDefined();
  });

  it("threads the abort signal into ConverseStream so the soft deadline can cancel it", async () => {
    async function* stream() {
      yield { messageStop: { stopReason: "end_turn" } };
    }
    client.queue({ stream: stream() });
    const controller = new AbortController();

    for await (const _event of createBedrockPort().converseStream({
      system: "s",
      messages,
      maxOutputTokens: 1024,
      abortSignal: controller.signal,
    })) {
      void _event;
    }

    expect(client.sent[0]!.options.abortSignal).toBe(controller.signal);
  });

  it("refuses a ConverseStream response carrying no event stream", async () => {
    client.queue({});

    await expect(async () => {
      for await (const _event of createBedrockPort().converseStream({
        system: "s",
        messages,
        maxOutputTokens: 1024,
      })) {
        void _event;
      }
    }).rejects.toThrow(/no event stream/);
  });

  it("never lets a client-supplied field reach the SDK command", async () => {
    async function* stream() {
      yield { messageStop: { stopReason: "end_turn" } };
    }
    client.queue({ stream: stream() });
    for await (const _event of createBedrockPort().converseStream({
      system: "s",
      messages,
      maxOutputTokens: 1024,
    })) {
      void _event;
    }

    const serialized = JSON.stringify(client.sent[0]!.input);
    expect(serialized).not.toContain("client_request_id");
    expect(serialized).not.toContain("max_tokens");
    expect(serialized).not.toContain("temperature");
  });
});
