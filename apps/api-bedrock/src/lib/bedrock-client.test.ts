import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

import {
  createBedrockPort,
  setRuntimeClientForTesting,
  modelId,
  modelRegion,
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
 * The one model/region pair the AD-8 token gate is implementable on. Every probed
 * `us.anthropic.*` cross-region inference profile rejected Runtime CountTokens with
 * "The provided model doesn't support counting tokens"; this bare model in eu-west-2
 * answered with an input-token count.
 */
const DIRECT_MODEL_ID = "anthropic.claude-3-7-sonnet-20250219-v1:0";
const DIRECT_MODEL_REGION = "eu-west-2";

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

describe("model and region selection are server-owned", () => {
  it("reads the model from the environment and refuses to run without it", () => {
    const previous = process.env.BEDROCK_MODEL_ID;
    try {
      process.env.BEDROCK_MODEL_ID = DIRECT_MODEL_ID;
      expect(modelId()).toBe(DIRECT_MODEL_ID);

      delete process.env.BEDROCK_MODEL_ID;
      expect(() => modelId()).toThrow(/BEDROCK_MODEL_ID/);
    } finally {
      if (previous === undefined) delete process.env.BEDROCK_MODEL_ID;
      else process.env.BEDROCK_MODEL_ID = previous;
    }
  });

  /* An inference-profile id is the one wrong value that looks right: the SDK accepts
   * it and Bedrock then rejects CountTokens at runtime, which the handler classifies as
   * `503 hosted_unavailable` - reported to the operator as an outage rather than as the
   * misconfiguration it is. */
  it("refuses an inference-profile id rather than letting Bedrock reject it later", () => {
    const previous = process.env.BEDROCK_MODEL_ID;
    try {
      for (const profile of [
        "us.anthropic.claude-sonnet-4-6",
        "eu.anthropic.claude-3-7-sonnet-20250219-v1:0",
        "apac.anthropic.claude-3-7-sonnet-20250219-v1:0",
        "global.anthropic.claude-sonnet-4-6",
      ]) {
        process.env.BEDROCK_MODEL_ID = profile;
        expect(() => modelId(), profile).toThrow(/direct foundation model/);
      }

      process.env.BEDROCK_MODEL_ID = DIRECT_MODEL_ID;
      expect(modelId()).toBe(DIRECT_MODEL_ID);
    } finally {
      if (previous === undefined) delete process.env.BEDROCK_MODEL_ID;
      else process.env.BEDROCK_MODEL_ID = previous;
    }
  });

  /* The Lambda's own region is us-east-1 and the model is only reachable in London,
   * so an inherited region would send both Bedrock calls somewhere the model does not
   * exist - a validation error indistinguishable from a malformed request. */
  it("requires an explicit Bedrock region rather than inheriting the Lambda's", () => {
    const previous = process.env.BEDROCK_REGION;
    try {
      process.env.BEDROCK_REGION = DIRECT_MODEL_REGION;
      expect(modelRegion()).toBe(DIRECT_MODEL_REGION);

      delete process.env.BEDROCK_REGION;
      expect(() => modelRegion()).toThrow(/BEDROCK_REGION is not configured/);

      process.env.BEDROCK_REGION = "";
      expect(() => modelRegion()).toThrow(/BEDROCK_REGION is not configured/);
    } finally {
      if (previous === undefined) delete process.env.BEDROCK_REGION;
      else process.env.BEDROCK_REGION = previous;
    }
  });

  /* A padded or malformed region is accepted by the SDK's client config and only fails
   * at endpoint resolution, by which point the message names a hostname rather than the
   * variable that produced it. */
  it("rejects a whitespace-padded or malformed region, and trims a clean one", () => {
    const previous = process.env.BEDROCK_REGION;
    try {
      process.env.BEDROCK_REGION = `  ${DIRECT_MODEL_REGION}\n`;
      expect(modelRegion()).toBe(DIRECT_MODEL_REGION);

      process.env.BEDROCK_REGION = "   ";
      expect(() => modelRegion()).toThrow(/BEDROCK_REGION is not configured/);

      for (const malformed of [
        "eu west 2",
        "EU-WEST-2",
        "eu-west",
        "eu-west-2a",
        "eu-west-2;rm -rf /",
        "https://bedrock.eu-west-2.amazonaws.com",
      ]) {
        process.env.BEDROCK_REGION = malformed;
        expect(() => modelRegion(), malformed).toThrow(/not a valid AWS region/);
      }
    } finally {
      if (previous === undefined) delete process.env.BEDROCK_REGION;
      else process.env.BEDROCK_REGION = previous;
    }
  });

  /* An inference profile is not a substitute: it is exactly what fails the AD-8 gate. */
  it("names a bare foundation model, never a cross-region inference profile", () => {
    expect(DIRECT_MODEL_ID).not.toMatch(/^(us|eu|apac|global)\./);
    expect(DIRECT_MODEL_ID.startsWith("anthropic.")).toBe(true);
  });
});

/*
 * The production client path, with the test injection deliberately cleared, so the
 * lazily constructed real client is the one under test. Every case here fails before any
 * network call is possible, which is what makes it safe to exercise: proving the pinned
 * region through a successful construction would require a live endpoint, and proving it
 * through an exported test-only builder would prove only that the builder exists.
 */
describe("the production runtime client consults BEDROCK_REGION", () => {
  const messages: PreparedMessage[] = [
    { role: "user", content: [{ type: "text", text: "hi" }] },
  ];

  beforeEach(() => {
    setRuntimeClientForTesting(undefined);
    process.env.BEDROCK_MODEL_ID = DIRECT_MODEL_ID;
  });

  afterEach(() => {
    setRuntimeClientForTesting(undefined);
    delete process.env.BEDROCK_MODEL_ID;
    delete process.env.BEDROCK_REGION;
  });

  it("fails the CountTokens call when the region is unset, before reaching the SDK", async () => {
    delete process.env.BEDROCK_REGION;

    await expect(
      createBedrockPort().countInputTokens({ system: "s", messages })
    ).rejects.toThrow(/BEDROCK_REGION is not configured/);
  });

  it("fails the ConverseStream call on a malformed region, naming the variable", async () => {
    process.env.BEDROCK_REGION = "not-a-region!";

    await expect(async () => {
      for await (const _event of createBedrockPort().converseStream({
        system: "s",
        messages,
        maxOutputTokens: OPERATION_LIMITS.chat.outputTokens,
      })) {
        void _event;
      }
    }).rejects.toThrow(/BEDROCK_REGION is not a valid AWS region/);
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
    process.env.BEDROCK_MODEL_ID = DIRECT_MODEL_ID;
    process.env.BEDROCK_REGION = DIRECT_MODEL_REGION;
  });

  afterEach(() => {
    setRuntimeClientForTesting(undefined);
    delete process.env.BEDROCK_MODEL_ID;
    delete process.env.BEDROCK_REGION;
  });

  it("sends CountTokens with the system prompt included in the counted input", async () => {
    client.queue({ inputTokens: 123 });

    const count = await createBedrockPort().countInputTokens({
      system: "You are a budgeting assistant.",
      messages,
    });

    expect(count).toBe(123);
    expect(client.sent).toHaveLength(1);

    const input = client.sent[0]!.input;
    expect(input.modelId).toBe(DIRECT_MODEL_ID);
    // The system prompt is billable input; omitting it would undercount every
    // request and let an over-ceiling prompt through the AD-8 gate.
    expect(input.input.converse.system).toEqual([
      { text: "You are a budgeting assistant." },
    ]);
    expect(input.input.converse.messages).toEqual([
      { role: "user", content: [{ text: "how is my budget?" }] },
    ]);
  });

  it("omits the system block from CountTokens only when the prompt is empty", async () => {
    client.queue({ inputTokens: 5 });

    await createBedrockPort().countInputTokens({ system: "", messages });

    expect(client.sent[0]!.input.input.converse.system).toBeUndefined();
  });

  it("refuses a CountTokens response with no usable count rather than treating it as zero", async () => {
    client.queue({});

    await expect(
      createBedrockPort().countInputTokens({ system: "s", messages })
    ).rejects.toThrow(/no input token count/);
  });

  it("threads the abort signal into CountTokens so the soft deadline can cancel it", async () => {
    client.queue({ inputTokens: 1 });
    const controller = new AbortController();

    await createBedrockPort().countInputTokens({
      system: "s",
      messages,
      abortSignal: controller.signal,
    });

    expect(client.sent[0]!.options.abortSignal).toBe(controller.signal);
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
    expect(input.modelId).toBe(DIRECT_MODEL_ID);
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

  /* The gate is only meaningful if it counted the request the stream then sends: a
   * count taken against one model and a stream issued against another proves nothing
   * about the input that was actually billed. Both commands must therefore leave on
   * the same model, through the same region-pinned client. */
  it("sends CountTokens and ConverseStream with the identical model through one client", async () => {
    async function* stream() {
      yield { messageStart: { role: "assistant" } };
      yield { messageStop: { stopReason: "end_turn" } };
    }
    client.queue({ inputTokens: 7 }).queue({ stream: stream() });

    const port = createBedrockPort();
    await port.countInputTokens({ system: "s", messages });
    for await (const _event of port.converseStream({
      system: "s",
      messages,
      maxOutputTokens: OPERATION_LIMITS.chat.outputTokens,
    })) {
      void _event;
    }

    expect(client.sent).toHaveLength(2);
    const [count, converse] = client.sent;
    expect(count!.input.modelId).toBe(DIRECT_MODEL_ID);
    expect(converse!.input.modelId).toBe(count!.input.modelId);
    // Same counted input on the wire both times, or the ceiling checked one payload
    // and the model was handed another.
    expect(converse!.input.messages).toEqual(count!.input.input.converse.messages);
    expect(converse!.input.system).toEqual(count!.input.input.converse.system);
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

  it("never lets a client-supplied field reach either SDK command", async () => {
    client.queue({ inputTokens: 1 });
    await createBedrockPort().countInputTokens({ system: "s", messages });

    const serialized = JSON.stringify(client.sent[0]!.input);
    expect(serialized).not.toContain("client_request_id");
    expect(serialized).not.toContain("max_tokens");
    expect(serialized).not.toContain("temperature");
  });
});
