import type {
  CloudAiDocumentFormat,
  CloudAiErrorCode,
  CloudAiImageFormat,
  CloudAiOperation,
  CloudAiRole,
} from "@nixus/shared";

/*
 * Closed request boundary (AD-8). Nothing past this module ever sees an unvalidated
 * field, and no error message it produces contains prompt, response, or attachment
 * content - only shapes and positions (AD-11).
 */

export const OPERATIONS: readonly CloudAiOperation[] = [
  "chat",
  "statement_import",
  "project_advice",
  "trends_insight",
];

const KIB = 1024;
const MIB = 1024 * 1024;

export interface OperationLimits {
  /** Serialized request JSON, excluding base64 media payloads. */
  readonly serializedJsonBytes: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export const OPERATION_LIMITS: Readonly<
  Record<CloudAiOperation, OperationLimits>
> = {
  chat: { serializedJsonBytes: 1 * MIB, inputTokens: 32_768, outputTokens: 4096 },
  statement_import: {
    serializedJsonBytes: 256 * KIB,
    inputTokens: 64_000,
    outputTokens: 8192,
  },
  project_advice: {
    serializedJsonBytes: 256 * KIB,
    inputTokens: 8192,
    outputTokens: 1024,
  },
  trends_insight: {
    serializedJsonBytes: 256 * KIB,
    inputTokens: 8192,
    outputTokens: 1024,
  },
};

export const MAX_DECODED_MEDIA_BYTES = 4 * MIB;

/** Fixed, neutral Bedrock document name. A client-supplied file name is a prompt-injection vector and is never accepted or forwarded. */
export const FIXED_DOCUMENT_NAME = "statement";

const IMAGE_FORMATS: readonly CloudAiImageFormat[] = ["png", "jpeg"];
const DOCUMENT_FORMATS: readonly CloudAiDocumentFormat[] = ["pdf"];
const ROLES: readonly CloudAiRole[] = ["user", "assistant"];

const TEXT_ONLY_OPERATIONS: readonly CloudAiOperation[] = [
  "chat",
  "project_advice",
  "trends_insight",
];

const REQUEST_FIELDS = [
  "operation",
  "system",
  "messages",
  "client_request_id",
] as const;

export interface PreOutputFailure {
  readonly code: CloudAiErrorCode;
  readonly status: number;
  readonly message: string;
}

export type PreparedContent =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image";
      readonly format: CloudAiImageFormat;
      readonly bytes: Uint8Array;
    }
  | {
      readonly type: "document";
      readonly format: CloudAiDocumentFormat;
      readonly bytes: Uint8Array;
    };

export interface PreparedMessage {
  readonly role: CloudAiRole;
  readonly content: readonly PreparedContent[];
}

export interface PreparedInvokeRequest {
  readonly operation: CloudAiOperation;
  readonly system: string;
  readonly clientRequestId: string;
  readonly messages: readonly PreparedMessage[];
  readonly limits: OperationLimits;
}

export type ValidationResult =
  | { readonly ok: true; readonly value: PreparedInvokeRequest }
  | { readonly ok: false; readonly failure: PreOutputFailure };

function invalid(message: string): ValidationResult {
  return { ok: false, failure: { code: "validation", status: 400, message } };
}

function tooLarge(message: string): ValidationResult {
  return {
    ok: false,
    failure: { code: "payload_too_large", status: 413, message },
  };
}

/**
 * AD-8 step 0. A compressed body would make every downstream byte ceiling
 * meaningless, so anything other than an absent or `identity` encoding is refused
 * before the body is even parsed.
 */
export function checkContentEncoding(
  headers: Readonly<Record<string, string | undefined>> | undefined
): PreOutputFailure | undefined {
  const header = Object.entries(headers ?? {}).find(
    ([name]) => name.toLowerCase() === "content-encoding"
  );
  const value = header?.[1]?.trim().toLowerCase();
  if (value === undefined || value === "" || value === "identity") {
    return undefined;
  }
  return {
    code: "unsupported_encoding",
    status: 415,
    message: "Content-Encoding must be absent or identity.",
  };
}

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/*
 * RFC 4122 shape without pinning the version nibble: `client_request_id` is
 * tracing-only, so rejecting a future UUID version would break tracing without
 * protecting anything.
 */
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Decoded length from the encoded length, so an oversized attachment is refused before it is materialized in memory. */
export function base64DecodedByteLength(encoded: string): number {
  if (encoded.length === 0) return 0;
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return (encoded.length / 4) * 3 - padding;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

function unknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[]
): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

interface RawMedia {
  readonly encoded: string;
}

function validateContentBlock(
  raw: unknown,
  operation: CloudAiOperation,
  where: string,
  media: RawMedia[]
): PreparedContent | PreOutputFailure {
  if (!isPlainObject(raw)) {
    return { code: "validation", status: 400, message: `${where} is not an object.` };
  }

  const type = raw.type;
  if (type === "text") {
    const extra = unknownFields(raw, ["type", "text"]);
    if (extra.length > 0) {
      return {
        code: "validation",
        status: 400,
        message: `${where} has unknown field(s): ${extra.join(", ")}.`,
      };
    }
    if (typeof raw.text !== "string") {
      return { code: "validation", status: 400, message: `${where} text must be a string.` };
    }
    return { type: "text", text: raw.text };
  }

  if (type === "image" || type === "document") {
    if (TEXT_ONLY_OPERATIONS.includes(operation)) {
      return {
        code: "validation",
        status: 400,
        message: `${where} type '${type}' is not permitted for operation '${operation}'.`,
      };
    }
    const extra = unknownFields(raw, ["type", "format", "data_base64"]);
    if (extra.length > 0) {
      return {
        code: "validation",
        status: 400,
        message: `${where} has unknown field(s): ${extra.join(", ")}.`,
      };
    }

    const allowedFormats: readonly string[] =
      type === "image" ? IMAGE_FORMATS : DOCUMENT_FORMATS;
    if (typeof raw.format !== "string" || !allowedFormats.includes(raw.format)) {
      return {
        code: "validation",
        status: 400,
        message: `${where} format must be one of: ${allowedFormats.join(", ")}.`,
      };
    }

    const encoded = raw.data_base64;
    if (typeof encoded !== "string" || encoded.length === 0) {
      return {
        code: "validation",
        status: 400,
        message: `${where} data_base64 must be a non-empty string.`,
      };
    }
    if (encoded.length % 4 !== 0 || !BASE64_PATTERN.test(encoded)) {
      return {
        code: "validation",
        status: 400,
        message: `${where} data_base64 is not valid base64.`,
      };
    }
    if (base64DecodedByteLength(encoded) > MAX_DECODED_MEDIA_BYTES) {
      return {
        code: "payload_too_large",
        status: 413,
        message: `${where} exceeds the ${MAX_DECODED_MEDIA_BYTES}-byte decoded media ceiling.`,
      };
    }

    media.push({ encoded });
    const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
    // A lenient decoder can silently drop characters; a length mismatch means the
    // payload was not the base64 it claimed to be.
    if (bytes.byteLength !== base64DecodedByteLength(encoded)) {
      return {
        code: "validation",
        status: 400,
        message: `${where} data_base64 is not valid base64.`,
      };
    }

    return type === "image"
      ? { type: "image", format: raw.format as CloudAiImageFormat, bytes }
      : { type: "document", format: raw.format as CloudAiDocumentFormat, bytes };
  }

  return {
    code: "validation",
    status: 400,
    message: `${where} type must be one of: text, image, document.`,
  };
}

function isFailure(
  value: PreparedContent | PreOutputFailure
): value is PreOutputFailure {
  return "code" in value;
}

function validateStatementImportShape(
  messages: readonly PreparedMessage[]
): PreOutputFailure | undefined {
  if (messages.length !== 1) {
    return {
      code: "validation",
      status: 400,
      message: "statement_import accepts exactly one message.",
    };
  }
  const message = messages[0]!;
  if (message.role !== "user") {
    return {
      code: "validation",
      status: 400,
      message: "statement_import's single message must have role 'user'.",
    };
  }
  const textBlocks = message.content.filter((block) => block.type === "text");
  const mediaBlocks = message.content.filter(
    (block) => block.type === "image" || block.type === "document"
  );
  if (
    textBlocks.length !== 1 ||
    mediaBlocks.length !== 1 ||
    message.content.length !== 2
  ) {
    return {
      code: "validation",
      status: 400,
      message:
        "statement_import accepts exactly one text block and exactly one image-or-document block.",
    };
  }
  return undefined;
}

/**
 * Anthropic's Messages API - which the selected direct model
 * `anthropic.claude-sonnet-4-6` implements - operates on alternating
 * user/assistant turns beginning with `user`. Bedrock rejects a history that opens
 * with the assistant or repeats a role.
 *
 * Caught here, at step 1, so a malformed history is a canonical `400 validation`
 * before `CountTokens` is ever billed. Left to `ConverseStream` it would surface as
 * a generic exception and be classified `503 hosted_unavailable` - which the closed
 * table treats as an outage, so the desktop would fall back to BYO and be rejected
 * there for the identical reason, having paid for a CountTokens call on the way.
 *
 * A TRAILING assistant turn is deliberately allowed: prefilling the response with a
 * final assistant message is a documented, supported pattern.
 */
function validateTurnOrder(
  messages: readonly PreparedMessage[]
): PreOutputFailure | undefined {
  if (messages[0]!.role !== "user") {
    return {
      code: "validation",
      status: 400,
      message: "messages must begin with a 'user' turn.",
    };
  }

  for (let index = 1; index < messages.length; index += 1) {
    if (messages[index]!.role === messages[index - 1]!.role) {
      return {
        code: "validation",
        status: 400,
        message: `messages must alternate roles; messages[${index}] repeats '${messages[index]!.role}'.`,
      };
    }
  }

  return undefined;
}

export function validateInvokeRequest(rawBody: string | undefined): ValidationResult {
  if (rawBody === undefined || rawBody.length === 0) {
    return invalid("Request body is required.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return invalid("Request body is not valid JSON.");
  }

  if (!isPlainObject(parsed)) {
    return invalid("Request body must be a JSON object.");
  }

  const extra = unknownFields(parsed, REQUEST_FIELDS);
  if (extra.length > 0) {
    // Catches a client-supplied model id or token-limit override too: neither
    // exists in the contract, so presence is a validation error (AD-8).
    return invalid(`Request has unknown field(s): ${extra.join(", ")}.`);
  }

  const operation = parsed.operation;
  if (
    typeof operation !== "string" ||
    !OPERATIONS.includes(operation as CloudAiOperation)
  ) {
    return invalid(`operation must be one of: ${OPERATIONS.join(", ")}.`);
  }
  const typedOperation = operation as CloudAiOperation;

  if (typeof parsed.system !== "string") {
    return invalid("system must be a string.");
  }

  const clientRequestId = parsed.client_request_id;
  if (typeof clientRequestId !== "string" || !UUID_PATTERN.test(clientRequestId)) {
    return invalid("client_request_id must be a UUID string.");
  }

  const rawMessages = parsed.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return invalid("messages must be a non-empty array.");
  }

  const media: RawMedia[] = [];
  const messages: PreparedMessage[] = [];

  for (const [messageIndex, rawMessage] of rawMessages.entries()) {
    const where = `messages[${messageIndex}]`;
    if (!isPlainObject(rawMessage)) {
      return invalid(`${where} is not an object.`);
    }
    const messageExtra = unknownFields(rawMessage, ["role", "content"]);
    if (messageExtra.length > 0) {
      return invalid(`${where} has unknown field(s): ${messageExtra.join(", ")}.`);
    }
    const role = rawMessage.role;
    if (typeof role !== "string" || !ROLES.includes(role as CloudAiRole)) {
      return invalid(`${where} role must be one of: ${ROLES.join(", ")}.`);
    }
    const rawContent = rawMessage.content;
    if (!Array.isArray(rawContent) || rawContent.length === 0) {
      return invalid(`${where} content must be a non-empty array.`);
    }

    const content: PreparedContent[] = [];
    for (const [blockIndex, rawBlock] of rawContent.entries()) {
      const result = validateContentBlock(
        rawBlock,
        typedOperation,
        `${where}.content[${blockIndex}]`,
        media
      );
      if (isFailure(result)) return { ok: false, failure: result };
      content.push(result);
    }

    messages.push({ role: role as CloudAiRole, content });
  }

  if (typedOperation === "statement_import") {
    const failure = validateStatementImportShape(messages);
    if (failure) return { ok: false, failure };
  }

  const turnOrder = validateTurnOrder(messages);
  if (turnOrder) return { ok: false, failure: turnOrder };

  const limits = OPERATION_LIMITS[typedOperation];
  const mediaBytes = media.reduce(
    (total, entry) => total + Buffer.byteLength(entry.encoded, "utf8"),
    0
  );
  const serializedBytes = Buffer.byteLength(rawBody, "utf8") - mediaBytes;
  if (serializedBytes > limits.serializedJsonBytes) {
    return tooLarge(
      `Request JSON excluding media is ${serializedBytes} bytes, over the ${limits.serializedJsonBytes}-byte ceiling for '${typedOperation}'.`
    );
  }

  return {
    ok: true,
    value: {
      operation: typedOperation,
      system: parsed.system,
      clientRequestId,
      messages,
      limits,
    },
  };
}

/**
 * AD-8 step 3's ceiling check. Runs on the CountTokens result, after reservation
 * eligibility has been established and before any quota is reserved, so an
 * oversized prompt costs the caller nothing.
 */
export function checkInputTokenCeiling(
  operation: CloudAiOperation,
  inputTokens: number
): PreOutputFailure | undefined {
  const limit = OPERATION_LIMITS[operation].inputTokens;
  if (inputTokens <= limit) return undefined;
  return {
    code: "validation",
    status: 400,
    message: `Input is ${inputTokens} tokens, over the ${limit}-token ceiling for '${operation}'.`,
  };
}
