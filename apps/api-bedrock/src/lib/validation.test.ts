import { describe, expect, it } from "vitest";

import {
  FIXED_DOCUMENT_NAME,
  MAX_DECODED_MEDIA_BYTES,
  OPERATION_LIMITS,
  OPERATIONS,
  base64DecodedByteLength,
  checkContentEncoding,
  validateInvokeRequest,
} from "./validation.ts";

const REQUEST_ID = "9f8b1e0c-77a2-4f4e-8a1d-1c9f5b3e2d10";

function base64OfBytes(count: number): string {
  return Buffer.alloc(count, 7).toString("base64");
}

function chatBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    operation: "chat",
    system: "You are a budgeting assistant.",
    messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    client_request_id: REQUEST_ID,
    ...overrides,
  });
}

function statementBody(media: Record<string, unknown>): string {
  return JSON.stringify({
    operation: "statement_import",
    system: "Extract transactions.",
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "Categorize these." }, media],
      },
    ],
    client_request_id: REQUEST_ID,
  });
}

function expectFailure(body: string) {
  const result = validateInvokeRequest(body);
  if (result.ok) throw new Error("expected validation to fail");
  return result.failure;
}

function expectSuccess(body: string) {
  const result = validateInvokeRequest(body);
  if (!result.ok) {
    throw new Error(`expected validation to pass, got: ${result.failure.message}`);
  }
  return result.value;
}

describe("AD-8 step 0: transport guard", () => {
  it("accepts an absent, empty, or identity Content-Encoding", () => {
    expect(checkContentEncoding(undefined)).toBeUndefined();
    expect(checkContentEncoding({})).toBeUndefined();
    expect(checkContentEncoding({ "Content-Encoding": "identity" })).toBeUndefined();
    expect(checkContentEncoding({ "content-encoding": " IDENTITY " })).toBeUndefined();
    expect(checkContentEncoding({ "content-encoding": "" })).toBeUndefined();
  });

  it("rejects any real encoding with 415 and no fallback", () => {
    for (const encoding of ["gzip", "br", "deflate", "gzip, identity"]) {
      const failure = checkContentEncoding({ "Content-Encoding": encoding });
      expect(failure).toEqual({
        code: "unsupported_encoding",
        status: 415,
        message: expect.any(String),
      });
    }
  });

  it("matches the header case-insensitively as HTTP requires", () => {
    expect(checkContentEncoding({ "CONTENT-ENCODING": "gzip" })?.status).toBe(415);
  });
});

describe("closed top-level schema", () => {
  it("accepts the exact four-field contract", () => {
    const prepared = expectSuccess(chatBody());
    expect(prepared.operation).toBe("chat");
    expect(prepared.clientRequestId).toBe(REQUEST_ID);
    expect(prepared.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "hello" }] },
    ]);
  });

  it("rejects a missing or malformed body", () => {
    expect(expectFailure("").code).toBe("validation");
    expect(validateInvokeRequest(undefined).ok).toBe(false);
    expect(expectFailure("{").message).toMatch(/valid JSON/);
    expect(expectFailure("[]").message).toMatch(/JSON object/);
    expect(expectFailure('"a"').message).toMatch(/JSON object/);
  });

  it("rejects a client-supplied model id as an unknown field", () => {
    const failure = expectFailure(
      chatBody({ model_id: "us.anthropic.claude-sonnet-4-6" })
    );
    expect(failure.status).toBe(400);
    expect(failure.message).toContain("model_id");
  });

  it("rejects a client-supplied token limit override as an unknown field", () => {
    expect(expectFailure(chatBody({ max_tokens: 99999 })).message).toContain(
      "max_tokens"
    );
    expect(expectFailure(chatBody({ maxTokens: 1 })).message).toContain("maxTokens");
  });

  it("rejects a body-supplied identity, which is never trusted", () => {
    expect(expectFailure(chatBody({ user_id: "someone-else" })).message).toContain(
      "user_id"
    );
    expect(expectFailure(chatBody({ sub: "someone-else" })).message).toContain("sub");
  });

  it("rejects a legacy separate media field", () => {
    expect(expectFailure(chatBody({ media: {} })).message).toContain("media");
  });

  it("rejects an operation outside the closed enum", () => {
    expect(expectFailure(chatBody({ operation: "summarize" })).code).toBe(
      "validation"
    );
    expect(expectFailure(chatBody({ operation: "CHAT" })).code).toBe("validation");
    expect(expectFailure(chatBody({ operation: 1 })).code).toBe("validation");
  });

  it("accepts every operation in the closed enum", () => {
    expect(OPERATIONS).toEqual([
      "chat",
      "statement_import",
      "project_advice",
      "trends_insight",
    ]);
    for (const operation of ["chat", "project_advice", "trends_insight"] as const) {
      expect(expectSuccess(chatBody({ operation })).operation).toBe(operation);
    }
  });

  it("requires system to be a string but permits an empty one", () => {
    expect(expectFailure(chatBody({ system: 42 })).code).toBe("validation");
    expect(expectFailure(chatBody({ system: null })).code).toBe("validation");
    expect(expectSuccess(chatBody({ system: "" })).system).toBe("");
  });

  it("requires client_request_id to be a UUID and never uses it as an idempotency token", () => {
    expect(expectFailure(chatBody({ client_request_id: "abc" })).code).toBe(
      "validation"
    );
    expect(expectFailure(chatBody({ client_request_id: 1 })).code).toBe("validation");
    expect(
      expectSuccess(chatBody({ client_request_id: REQUEST_ID.toUpperCase() }))
        .clientRequestId
    ).toBe(REQUEST_ID.toUpperCase());
  });
});

describe("closed message and content schema", () => {
  it("rejects an empty or non-array messages field", () => {
    expect(expectFailure(chatBody({ messages: [] })).message).toMatch(/non-empty/);
    expect(expectFailure(chatBody({ messages: {} })).message).toMatch(/non-empty/);
  });

  it("rejects an unknown message field or an unknown role", () => {
    expect(
      expectFailure(
        chatBody({
          messages: [
            { role: "user", content: [{ type: "text", text: "x" }], name: "n" },
          ],
        })
      ).message
    ).toContain("name");
    expect(
      expectFailure(
        chatBody({ messages: [{ role: "system", content: [{ type: "text", text: "x" }] }] })
      ).message
    ).toMatch(/role must be one of/);
  });

  it("rejects empty content and an unknown content type", () => {
    expect(
      expectFailure(chatBody({ messages: [{ role: "user", content: [] }] })).message
    ).toMatch(/non-empty array/);
    expect(
      expectFailure(
        chatBody({ messages: [{ role: "user", content: [{ type: "video" }] }] })
      ).message
    ).toMatch(/type must be one of/);
  });

  it("rejects an unknown field inside a content block", () => {
    expect(
      expectFailure(
        chatBody({
          messages: [
            { role: "user", content: [{ type: "text", text: "x", cache: true }] },
          ],
        })
      ).message
    ).toContain("cache");
  });

  it("reports the failing position without echoing any content", () => {
    const failure = expectFailure(
      chatBody({
        messages: [
          { role: "user", content: [{ type: "text", text: "safe" }] },
          { role: "assistant", content: [{ type: "text", text: "SECRET-BALANCE-4242" }, { type: "image", format: "png", data_base64: "AAAA" }] },
        ],
      })
    );
    expect(failure.message).toContain("messages[1].content[1]");
    expect(failure.message).not.toContain("SECRET-BALANCE-4242");
    expect(failure.message).not.toContain("AAAA");
  });
});

describe("per-operation content rules", () => {
  it("refuses an image or document block on every text-only operation", () => {
    for (const operation of ["chat", "project_advice", "trends_insight"] as const) {
      for (const block of [
        { type: "image", format: "png", data_base64: "AAAA" },
        { type: "document", format: "pdf", data_base64: "AAAA" },
      ]) {
        const failure = expectFailure(
          chatBody({
            operation,
            messages: [{ role: "user", content: [block] }],
          })
        );
        expect(failure.code).toBe("validation");
        expect(failure.message).toContain(operation);
      }
    }
  });

  it("accepts exactly one text block plus one media block for statement_import", () => {
    const prepared = expectSuccess(
      statementBody({ type: "image", format: "png", data_base64: base64OfBytes(64) })
    );
    expect(prepared.messages[0]!.content.map((block) => block.type)).toEqual([
      "text",
      "image",
    ]);
    const media = prepared.messages[0]!.content[1]!;
    expect(media.type === "image" && media.bytes.byteLength).toBe(64);
  });

  it("accepts a pdf document for statement_import", () => {
    const prepared = expectSuccess(
      statementBody({ type: "document", format: "pdf", data_base64: base64OfBytes(32) })
    );
    const media = prepared.messages[0]!.content[1]!;
    expect(media.type).toBe("document");
    expect(media.type === "document" && media.bytes.byteLength).toBe(32);
  });

  it("rejects zero, two, or more media blocks for statement_import", () => {
    const noMedia = JSON.stringify({
      operation: "statement_import",
      system: "s",
      messages: [{ role: "user", content: [{ type: "text", text: "t" }] }],
      client_request_id: REQUEST_ID,
    });
    expect(expectFailure(noMedia).message).toMatch(/exactly one text block/);

    const twoMedia = JSON.stringify({
      operation: "statement_import",
      system: "s",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "t" },
            { type: "image", format: "png", data_base64: base64OfBytes(8) },
            { type: "image", format: "png", data_base64: base64OfBytes(8) },
          ],
        },
      ],
      client_request_id: REQUEST_ID,
    });
    expect(expectFailure(twoMedia).message).toMatch(/exactly one text block/);
  });

  it("rejects two text blocks or a missing text block for statement_import", () => {
    const twoText = JSON.stringify({
      operation: "statement_import",
      system: "s",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "a" },
            { type: "text", text: "b" },
            { type: "image", format: "png", data_base64: base64OfBytes(8) },
          ],
        },
      ],
      client_request_id: REQUEST_ID,
    });
    expect(expectFailure(twoText).message).toMatch(/exactly one text block/);

    const onlyMedia = JSON.stringify({
      operation: "statement_import",
      system: "s",
      messages: [
        {
          role: "user",
          content: [{ type: "image", format: "png", data_base64: base64OfBytes(8) }],
        },
      ],
      client_request_id: REQUEST_ID,
    });
    expect(expectFailure(onlyMedia).message).toMatch(/exactly one text block/);
  });

  it("rejects more than one message, or a non-user message, for statement_import", () => {
    const twoMessages = JSON.stringify({
      operation: "statement_import",
      system: "s",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "a" },
            { type: "image", format: "png", data_base64: base64OfBytes(8) },
          ],
        },
        { role: "assistant", content: [{ type: "text", text: "b" }] },
      ],
      client_request_id: REQUEST_ID,
    });
    expect(expectFailure(twoMessages).message).toMatch(/exactly one message/);

    const assistantOnly = JSON.stringify({
      operation: "statement_import",
      system: "s",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "a" },
            { type: "image", format: "png", data_base64: base64OfBytes(8) },
          ],
        },
      ],
      client_request_id: REQUEST_ID,
    });
    expect(expectFailure(assistantOnly).message).toMatch(/role 'user'/);
  });

  it("rejects an unsupported media format", () => {
    expect(
      expectFailure(
        statementBody({ type: "image", format: "gif", data_base64: base64OfBytes(8) })
      ).message
    ).toMatch(/format must be one of: png, jpeg/);
    expect(
      expectFailure(
        statementBody({ type: "document", format: "docx", data_base64: base64OfBytes(8) })
      ).message
    ).toMatch(/format must be one of: pdf/);
  });

  it("never accepts a client-supplied document name", () => {
    expect(
      expectFailure(
        statementBody({
          type: "document",
          format: "pdf",
          data_base64: base64OfBytes(8),
          name: "../../etc/passwd",
        })
      ).message
    ).toContain("name");
    expect(FIXED_DOCUMENT_NAME).toBe("statement");
  });
});

describe("base64 and media size ceilings", () => {
  it("computes the decoded length from the encoded length, including padding", () => {
    expect(base64DecodedByteLength("")).toBe(0);
    expect(base64DecodedByteLength(Buffer.alloc(1).toString("base64"))).toBe(1);
    expect(base64DecodedByteLength(Buffer.alloc(2).toString("base64"))).toBe(2);
    expect(base64DecodedByteLength(Buffer.alloc(3).toString("base64"))).toBe(3);
    expect(base64DecodedByteLength(Buffer.alloc(600).toString("base64"))).toBe(600);
  });

  it("rejects malformed base64 as a validation error, never as a size error", () => {
    for (const encoded of ["not!base64", "AAA", "AA=A", "===="]) {
      const failure = expectFailure(
        statementBody({ type: "image", format: "png", data_base64: encoded })
      );
      expect(failure.code).toBe("validation");
    }
  });

  it("rejects an empty or non-string data_base64", () => {
    expect(
      expectFailure(statementBody({ type: "image", format: "png", data_base64: "" }))
        .message
    ).toMatch(/non-empty string/);
    expect(
      expectFailure(statementBody({ type: "image", format: "png", data_base64: 5 }))
        .message
    ).toMatch(/non-empty string/);
  });

  it("accepts media exactly at the 4 MiB decoded ceiling", () => {
    const prepared = expectSuccess(
      statementBody({
        type: "document",
        format: "pdf",
        data_base64: base64OfBytes(MAX_DECODED_MEDIA_BYTES),
      })
    );
    const media = prepared.messages[0]!.content[1]!;
    expect(media.type === "document" && media.bytes.byteLength).toBe(
      MAX_DECODED_MEDIA_BYTES
    );
  });

  it("rejects media one byte over the ceiling with 413 payload_too_large", () => {
    const failure = expectFailure(
      statementBody({
        type: "document",
        format: "pdf",
        data_base64: base64OfBytes(MAX_DECODED_MEDIA_BYTES + 1),
      })
    );
    expect(failure).toMatchObject({ code: "payload_too_large", status: 413 });
  });
});

describe("serialized JSON ceilings exclude media", () => {
  it("pins the architecture's concrete per-operation limits", () => {
    expect(OPERATION_LIMITS).toEqual({
      chat: { serializedJsonBytes: 1048576, outputTokens: 4096 },
      statement_import: { serializedJsonBytes: 262144, outputTokens: 8192 },
      project_advice: { serializedJsonBytes: 262144, outputTokens: 1024 },
      trends_insight: { serializedJsonBytes: 262144, outputTokens: 1024 },
    });
  });

  it("lets a large but legal attachment through without counting toward the JSON ceiling", () => {
    // 4 MiB of media base64-encodes to ~5.3 MiB, far over statement_import's
    // 256 KiB JSON ceiling: excluding media is what makes the ceiling meaningful.
    const prepared = expectSuccess(
      statementBody({
        type: "document",
        format: "pdf",
        data_base64: base64OfBytes(MAX_DECODED_MEDIA_BYTES),
      })
    );
    expect(prepared.operation).toBe("statement_import");
  });

  it("rejects oversized non-media JSON with 413", () => {
    const failure = expectFailure(
      chatBody({
        operation: "project_advice",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "x".repeat(300 * 1024) }],
          },
        ],
      })
    );
    expect(failure).toMatchObject({ code: "payload_too_large", status: 413 });
    expect(failure.message).toContain("project_advice");
  });

  it("allows chat a larger JSON budget than the other operations", () => {
    const body = chatBody({
      messages: [
        { role: "user", content: [{ type: "text", text: "x".repeat(300 * 1024) }] },
      ],
    });
    expect(expectSuccess(body).operation).toBe("chat");
  });
});

/*
 * Input is bounded in BYTES, not tokens: quota is one unit per request, so there is no
 * upstream token count to gate on and no input-token ceiling to enforce. Only the output
 * ceiling stays token-shaped, because only the model can apply it.
 */
describe("no input-token ceiling exists to be enforced", () => {
  it("declares only a byte ceiling and an output-token ceiling per operation", () => {
    for (const [operation, limits] of Object.entries(OPERATION_LIMITS)) {
      expect(Object.keys(limits).sort(), operation).toEqual([
        "outputTokens",
        "serializedJsonBytes",
      ]);
    }
  });

  /* A reintroduced input-token limit would need an upstream count to compare against,
   * which is exactly the call this design removed. */
  it("exports no input-token ceiling check", async () => {
    const module = await import("./validation.ts");
    expect(module).not.toHaveProperty("checkInputTokenCeiling");
    expect(Object.keys(module).filter((name) => /inputToken/i.test(name))).toEqual([]);
  });
});

/*
 * Confirmed against the current contract before encoding: the AWS Bedrock user
 * guide states the Anthropic Messages API "operates on alternating user and
 * assistant conversational turns", and this repo's own `alternating_turns` helper
 * documents that "Bedrock rejects any history that repeats a role or opens with the
 * assistant". Prefilling with a trailing assistant turn is documented as supported,
 * so that case must stay legal.
 */
describe("role alternation is rejected as validation, not as an outage", () => {
  function chatWithRoles(roles: ("user" | "assistant")[]): string {
    return JSON.stringify({
      operation: "chat",
      system: "s",
      messages: roles.map((role) => ({
        role,
        content: [{ type: "text", text: "t" }],
      })),
      client_request_id: REQUEST_ID,
    });
  }

  it("accepts a well-formed alternating history", () => {
    expect(expectSuccess(chatWithRoles(["user"])).operation).toBe("chat");
    expect(
      expectSuccess(chatWithRoles(["user", "assistant", "user"])).messages
    ).toHaveLength(3);
    expect(
      expectSuccess(chatWithRoles(["user", "assistant", "user", "assistant", "user"]))
        .messages
    ).toHaveLength(5);
  });

  /* Prefilling the answer with a final assistant turn is a supported pattern, so
   * rejecting it would break a legitimate caller. */
  it("allows a trailing assistant turn, which is the documented prefill pattern", () => {
    expect(
      expectSuccess(chatWithRoles(["user", "assistant"])).messages
    ).toHaveLength(2);
    expect(
      expectSuccess(chatWithRoles(["user", "assistant", "user", "assistant"]))
        .messages
    ).toHaveLength(4);
  });

  it("rejects a history that opens with the assistant", () => {
    const failure = expectFailure(chatWithRoles(["assistant", "user"]));

    expect(failure).toMatchObject({ code: "validation", status: 400 });
    expect(failure.message).toMatch(/begin with a 'user' turn/);
  });

  it("rejects a repeated role and names the offending position", () => {
    const failure = expectFailure(chatWithRoles(["user", "user"]));

    expect(failure).toMatchObject({ code: "validation", status: 400 });
    expect(failure.message).toContain("messages[1]");
    expect(failure.message).toContain("user");
  });

  it("rejects a repeated assistant role mid-history", () => {
    const failure = expectFailure(
      chatWithRoles(["user", "assistant", "assistant", "user"])
    );

    expect(failure).toMatchObject({ code: "validation", status: 400 });
    expect(failure.message).toContain("messages[2]");
  });

  /* The whole point of catching it here: `validation` forbids fallback, whereas the
   * `hosted_unavailable` it would otherwise become sends the desktop to a BYO
   * provider that rejects the identical history for the identical reason. */
  it("never classifies a malformed history as a hosted outage", () => {
    for (const roles of [
      ["assistant"],
      ["assistant", "user"],
      ["user", "user"],
      ["user", "assistant", "assistant"],
    ] as ("user" | "assistant")[][]) {
      const failure = expectFailure(chatWithRoles(roles));
      expect(failure.code, roles.join(",")).toBe("validation");
      expect(failure.code).not.toBe("hosted_unavailable");
    }
  });

  it("applies the same rule to the other text operations", () => {
    for (const operation of ["project_advice", "trends_insight"] as const) {
      const body = JSON.stringify({
        operation,
        system: "s",
        messages: [
          { role: "user", content: [{ type: "text", text: "a" }] },
          { role: "user", content: [{ type: "text", text: "b" }] },
        ],
        client_request_id: REQUEST_ID,
      });
      expect(expectFailure(body).code, operation).toBe("validation");
    }
  });
});
