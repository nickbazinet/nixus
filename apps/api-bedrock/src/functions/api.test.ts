import type { APIGatewayProxyEvent, Context } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setDocumentClientForTesting } from "../lib/table.ts";
import { FakeDocumentClient } from "../lib/testing/fake-dynamo.ts";
import {
  PRELUDE_NUL_BYTE_COUNT,
  createResponseSink,
  dispatch,
  encodePreludeMetadata,
  handler,
  streamingHandler,
} from "./api.ts";

const SUB = "b7f1c2d3-0000-4000-8000-abcdef123456";
const REQUEST_ID = "apigw-request-1";
const CLIENT_REQUEST_ID = "9f8b1e0c-77a2-4f4e-8a1d-1c9f5b3e2d10";

class BufferStream {
  readonly writes: Buffer[] = [];
  endCalls = 0;

  write(chunk: Uint8Array | string): boolean {
    this.writes.push(
      typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk)
    );
    return true;
  }

  end(callback?: () => void): this {
    this.endCalls += 1;
    callback?.();
    return this;
  }

  get bytes(): Buffer {
    return Buffer.concat(this.writes);
  }

  /** Everything after the metadata JSON and its NUL separator. */
  get bodyAfterPrelude(): string {
    const bytes = this.bytes;
    const separator = Buffer.alloc(PRELUDE_NUL_BYTE_COUNT, 0);
    const index = bytes.indexOf(separator);
    if (index === -1) throw new Error("no prelude separator found");
    return bytes.subarray(index + PRELUDE_NUL_BYTE_COUNT).toString("utf8");
  }

  get preludeMetadata(): Record<string, unknown> {
    const bytes = this.bytes;
    const separator = Buffer.alloc(PRELUDE_NUL_BYTE_COUNT, 0);
    const index = bytes.indexOf(separator);
    if (index === -1) throw new Error("no prelude separator found");
    return JSON.parse(bytes.subarray(0, index).toString("utf8")) as Record<
      string,
      unknown
    >;
  }
}

function makeEvent(
  overrides: Partial<APIGatewayProxyEvent> & {
    claims?: Record<string, unknown> | undefined;
  } = {}
): APIGatewayProxyEvent {
  const { claims, ...rest } = overrides;
  return {
    httpMethod: "GET",
    resource: "/v1/ai/status",
    path: "/v1/ai/status",
    headers: {},
    body: null,
    isBase64Encoded: false,
    requestContext: {
      requestId: REQUEST_ID,
      authorizer:
        claims === undefined && !("claims" in overrides)
          ? { claims: { sub: SUB } }
          : claims
            ? { claims }
            : null,
    },
    ...rest,
  } as unknown as APIGatewayProxyEvent;
}

const context = {
  getRemainingTimeInMillis: () => 300_000,
} as Pick<Context, "getRemainingTimeInMillis">;

let client: FakeDocumentClient;
let stream: BufferStream;

beforeEach(() => {
  client = new FakeDocumentClient();
  setDocumentClientForTesting(client.asDocumentClient());
  process.env.TABLE_NAME = "nixus-hosted-ai";
  process.env.BEDROCK_MODEL_ID = "us.anthropic.claude-sonnet-4-6";
  stream = new BufferStream();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  setDocumentClientForTesting(undefined);
  delete process.env.TABLE_NAME;
  delete process.env.BEDROCK_MODEL_ID;
  vi.restoreAllMocks();
});

describe("streaming prelude contract", () => {
  it("encodes the metadata as statusCode plus a Content-Type header", () => {
    expect(JSON.parse(encodePreludeMetadata(200, "application/x-ndjson"))).toEqual({
      statusCode: 200,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  });

  it("writes exactly eight NUL bytes between the metadata and the body", async () => {
    const sink = createResponseSink(stream);
    sink.begin(200, "application/x-ndjson");
    sink.write("payload");
    await sink.end();

    const bytes = stream.bytes;
    const metadata = encodePreludeMetadata(200, "application/x-ndjson");
    const separator = bytes.subarray(
      metadata.length,
      metadata.length + PRELUDE_NUL_BYTE_COUNT
    );

    expect(PRELUDE_NUL_BYTE_COUNT).toBe(8);
    expect(separator).toEqual(Buffer.alloc(8, 0));
    expect(bytes[metadata.length + 8]).not.toBe(0);
    expect(stream.bodyAfterPrelude).toBe("payload");
  });

  it("refuses to write a body before the prelude", () => {
    const sink = createResponseSink(stream);
    expect(() => sink.write("early")).toThrow(/before the streaming prelude/);
  });

  it("refuses to write the prelude twice", () => {
    const sink = createResponseSink(stream);
    sink.begin(200, "application/json");
    expect(() => sink.begin(200, "application/json")).toThrow(/already/);
  });

  it("turns a missing prelude into a well-formed 500 rather than a broken stream", async () => {
    const sink = createResponseSink(stream);
    await sink.end();

    expect(stream.preludeMetadata).toEqual({
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(stream.bodyAfterPrelude)).toEqual({
      error: {
        code: "hosted_unavailable",
        message: expect.any(String),
        request_id: "unknown",
      },
    });
  });

  it("closes the underlying stream exactly once even if end is called twice", async () => {
    const sink = createResponseSink(stream);
    sink.begin(200, "application/json");
    sink.write("{}");
    await sink.end();
    await sink.end();

    expect(stream.endCalls).toBe(1);
  });
});

describe("identity comes only from the authorizer", () => {
  it("rejects a request with no verified sub", async () => {
    const sink = createResponseSink(stream);
    await dispatch(makeEvent({ claims: undefined }), sink, context);

    expect(stream.preludeMetadata.statusCode).toBe(401);
    expect(JSON.parse(stream.bodyAfterPrelude).error).toMatchObject({
      code: "unauthorized",
      request_id: REQUEST_ID,
    });
    expect(client.sent).toHaveLength(0);
  });

  it("rejects a blank or non-string sub claim", async () => {
    for (const sub of ["", 42, null]) {
      stream = new BufferStream();
      const sink = createResponseSink(stream);
      await dispatch(makeEvent({ claims: { sub } }), sink, context);
      expect(stream.preludeMetadata.statusCode).toBe(401);
    }
  });

  it("ignores a body-supplied identity entirely", async () => {
    client
      .queueItem(undefined)
      .queueItem({ enabled: true, monthly_request_limit: 1000 });

    const sink = createResponseSink(stream);
    await dispatch(
      makeEvent({
        claims: { sub: SUB },
        body: JSON.stringify({ sub: "attacker" }),
      }),
      sink,
      context
    );

    const readKeys = client.gets.map((command) => command.input.Key);
    expect(readKeys).toContainEqual({ pk: `USER#${SUB}`, sk: "CONFIG" });
    expect(JSON.stringify(readKeys)).not.toContain("attacker");
  });
});

describe("routing", () => {
  it("serves GET /v1/ai/status as JSON with a 200 prelude", async () => {
    client
      .queueItem({ premium: true, monthly_request_limit: 250 })
      .queueItem({ enabled: true, monthly_request_limit: 1000 })
      .queueItem({ charged_count: 3 });

    const sink = createResponseSink(stream);
    await dispatch(makeEvent(), sink, context);

    expect(stream.preludeMetadata).toEqual({
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
    });
    const body = JSON.parse(stream.bodyAfterPrelude);
    expect(body).toEqual({
      premium: true,
      monthly_request_limit: 250,
      charged_count: 3,
      period: expect.stringMatching(/^\d{4}-\d{2}$/),
    });
  });

  it("routes POST /v1/ai/invoke through the invoke handler", async () => {
    client
      .queueItem(undefined)
      .queueItem({ enabled: true, monthly_request_limit: 1000 })
      .queueItem({ charged_count: 0 })
      .queueItem({ charged_count: 0 });

    const sink = createResponseSink(stream);
    await dispatch(
      makeEvent({
        httpMethod: "POST",
        resource: "/v1/ai/invoke",
        path: "/v1/ai/invoke",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "chat",
          system: "s",
          messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
          client_request_id: CLIENT_REQUEST_ID,
        }),
      }),
      sink,
      context
    );

    expect(stream.preludeMetadata.statusCode).toBe(403);
    expect(JSON.parse(stream.bodyAfterPrelude).error).toMatchObject({
      code: "premium_required",
    });
  });

  it("decodes a base64-encoded body before validating it", async () => {
    const sink = createResponseSink(stream);
    await dispatch(
      makeEvent({
        httpMethod: "POST",
        resource: "/v1/ai/invoke",
        path: "/v1/ai/invoke",
        isBase64Encoded: true,
        body: Buffer.from(
          JSON.stringify({ operation: "chat", surprise: 1 })
        ).toString("base64"),
      }),
      sink,
      context
    );

    // Reaching a schema rejection proves the body was decoded, not treated as JSON.
    expect(stream.preludeMetadata.statusCode).toBe(400);
    expect(JSON.parse(stream.bodyAfterPrelude).error.message).toContain("surprise");
  });

  it("rejects an unmapped route and method with the canonical envelope", async () => {
    for (const event of [
      makeEvent({ httpMethod: "DELETE", resource: "/v1/ai/status", path: "/v1/ai/status" }),
      makeEvent({ httpMethod: "GET", resource: "/v1/ai/invoke", path: "/v1/ai/invoke" }),
      makeEvent({ httpMethod: "GET", resource: "/admin", path: "/admin" }),
    ]) {
      stream = new BufferStream();
      const sink = createResponseSink(stream);
      await dispatch(event, sink, context);

      expect(stream.preludeMetadata.statusCode).toBe(400);
      expect(JSON.parse(stream.bodyAfterPrelude).error).toMatchObject({
        code: "validation",
      });
    }
  });

  it("matches the method case-insensitively", async () => {
    client
      .queueItem(undefined)
      .queueItem({ enabled: true, monthly_request_limit: 1000 });

    const sink = createResponseSink(stream);
    await dispatch(makeEvent({ httpMethod: "get" }), sink, context);

    expect(stream.preludeMetadata.statusCode).toBe(200);
  });
});

describe("one entry point, one handler", () => {
  it("exports a single handler that falls back to the raw function off-Lambda", () => {
    expect(handler).toBe(streamingHandler);
  });

  it("still produces a well-formed response when a handler throws", async () => {
    // No TABLE_NAME makes the status read throw inside the handler.
    delete process.env.TABLE_NAME;

    await streamingHandler(
      makeEvent(),
      stream as unknown as Parameters<typeof streamingHandler>[1],
      context as Context
    );

    expect(stream.preludeMetadata.statusCode).toBe(500);
    expect(JSON.parse(stream.bodyAfterPrelude).error).toMatchObject({
      code: "hosted_unavailable",
    });
    expect(stream.endCalls).toBe(1);
  });

  it("logs the unhandled failure without leaking a stack or content", async () => {
    const logged: string[] = [];
    vi.mocked(console.error).mockImplementation((line: unknown) => {
      logged.push(String(line));
    });
    delete process.env.TABLE_NAME;

    await streamingHandler(
      makeEvent(),
      stream as unknown as Parameters<typeof streamingHandler>[1],
      context as Context
    );

    const entry = logged
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((item) => item.event === "unhandled_error");
    expect(entry).toEqual({
      event: "unhandled_error",
      request_id: REQUEST_ID,
      status: 500,
      error_name: "Error",
    });
  });
});
