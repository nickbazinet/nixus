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
  readonly outputTokens: number;
}
/*
 * Input is bounded in bytes, not tokens: quota is one unit per request, so the ceilings
 * below plus MAX_DECODED_MEDIA_BYTES are computed from the request itself, before any
 * reservation and without an upstream call. Output stays token-bounded because only the
 * model can enforce it, through inferenceConfig.maxTokens.
 */
export const OPERATION_LIMITS: Readonly<
  Record<CloudAiOperation, OperationLimits>
> = {
  chat: { serializedJsonBytes: 1 * MIB, outputTokens: 4096 },
  statement_import: {
    serializedJsonBytes: 256 * KIB,
    outputTokens: 8192,
  },
  project_advice: {
    serializedJsonBytes: 256 * KIB,
    outputTokens: 1024,
  },
  trends_insight: {
    serializedJsonBytes: 256 * KIB,
    outputTokens: 1024,
  },
};

export const MAX_DECODED_MEDIA_BYTES = 4 * MIB;

/**
 * The fixed Bedrock document name per operation. Never a client-supplied file name: that
 * is both a prompt-injection vector and a path leak.
 *
 * Operation-specific because the label is part of what the model reads. `statement_import`
 * keeps `statement`, unchanged from before chat attachments existed, so the extraction
 * prompt it has always seen is untouched.
 */
export const DOCUMENT_NAMES: Readonly<Record<CloudAiOperation, string>> = {
  chat: "attachment",
  statement_import: "statement",
  project_advice: "attachment",
  trends_insight: "attachment",
};

const IMAGE_FORMATS: readonly CloudAiImageFormat[] = ["png", "jpeg"];

/**
 * Document formats per operation, not one global list.
 *
 * `statement_import` is deliberately PDF-only: it is a fixed pipeline whose prompt and
 * parser were built and tuned for statement PDFs and screenshots, so widening it for
 * chat's benefit would change a surface this feature must leave alone. An empty list
 * means the operation takes no document at all.
 */
const DOCUMENT_FORMATS: Readonly<
  Record<CloudAiOperation, readonly CloudAiDocumentFormat[]>
> = {
  chat: ["pdf", "csv", "txt", "xls", "xlsx"],
  statement_import: ["pdf"],
  project_advice: [],
  trends_insight: [],
};

const ROLES: readonly CloudAiRole[] = ["user", "assistant"];

const TEXT_ONLY_OPERATIONS: readonly CloudAiOperation[] = [
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
      /** Resolved from the operation here, so the Bedrock adapter never has to know it. */
      readonly name: string;
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

    // Unreachable for an empty list: TEXT_ONLY_OPERATIONS above already returned for both
    // operations whose format list is empty, and IMAGE_FORMATS is never empty.
    const allowedFormats: readonly string[] =
      type === "image" ? IMAGE_FORMATS : DOCUMENT_FORMATS[operation];
    if (typeof raw.format !== "string" || !allowedFormats.includes(raw.format)) {
      return {
        code: "validation",
        status: 400,
        // Names the operation because the same format is legal on another one: a `csv`
        // rejected here is rejected for `statement_import` specifically, not universally.
        message: `${where} format for operation '${operation}' must be one of: ${allowedFormats.join(", ")}.`,
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
      : {
          type: "document",
          format: raw.format as CloudAiDocumentFormat,
          name: DOCUMENT_NAMES[operation],
          bytes,
        };
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

function isMedia(block: PreparedContent): boolean {
  return block.type === "image" || block.type === "document";
}

function newestUserMessageIndex(messages: readonly PreparedMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.role === "user") return index;
  }
  return -1;
}

/**
 * Chat carries conversation history, so unlike `statement_import` it cannot be pinned to
 * a single message. The attachment is ephemeral read-only context for the turn the user
 * just sent: allowing it on an older turn would let a caller replay media the desktop
 * never persisted, and allowing several would multiply the media ceiling per request.
 */
function validateChatShape(
  messages: readonly PreparedMessage[]
): PreOutputFailure | undefined {
  const mediaCount = messages.reduce(
    (total, message) => total + message.content.filter(isMedia).length,
    0
  );
  if (mediaCount === 0) return undefined;
  if (mediaCount > 1) {
    return {
      code: "validation",
      status: 400,
      message: "chat accepts at most one image-or-document block per request.",
    };
  }

  const newest = newestUserMessageIndex(messages);
  const carrier = messages.findIndex((message) => message.content.some(isMedia));
  if (carrier !== newest) {
    const block = messages[carrier]!.content.findIndex(isMedia);
    return {
      code: "validation",
      status: 400,
      // Carries the offending position, like every block-level failure above: without it a
      // misplaced attachment is the one rejection a caller cannot locate in its own payload.
      message: `messages[${carrier}].content[${block}] is an image-or-document block, which must be on the newest 'user' message.`,
    };
  }

  if (!messages[carrier]!.content.some((block) => block.type === "text")) {
    return {
      code: "validation",
      status: 400,
      message:
        "chat's attachment-carrying message must also contain a text block.",
    };
  }

  return undefined;
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
  const mediaBlocks = message.content.filter(isMedia);
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
 * before any quota unit is reserved. Left to `ConverseStream` it would surface as
 * a generic exception and be classified `503 hosted_unavailable` - which the closed
 * table treats as an outage, so the desktop would fall back to BYO and be rejected
 * there for the identical reason, having spent a quota unit on the way.
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

  if (typedOperation === "chat") {
    const failure = validateChatShape(messages);
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
