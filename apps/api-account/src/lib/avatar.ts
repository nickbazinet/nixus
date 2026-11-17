import {
  AVATAR_BODY_MAX_BYTES,
  AVATAR_MAX_DECODED_BYTES,
  AVATAR_MAX_EDGE_PX,
  AVATAR_MIME_TYPES,
  type AvatarMimeType,
} from "@nixus/shared";

import {
  decodeJsonBody,
  readExpectedVersion,
  readRequiredString,
} from "./body.ts";
import { fail, failValidation } from "./errors.ts";
import { mimeMatchesMagic, readImageDimensions } from "./image-header.ts";

/*
 * The avatar half of AD-5. The server validates the exact contract the clients
 * produce - it never resizes, re-encodes or renames - and no route anywhere
 * accepts or emits a filename.
 */

export interface ValidatedAvatarRequest {
  readonly mimeType: AvatarMimeType;
  readonly bytes: Uint8Array;
  readonly expectedVersion: number | null;
}

const AVATAR_BODY_MEMBERS: readonly string[] = [
  "mime_type",
  "data",
  "expected_version",
];

/**
 * Standard base64 only: padded, no whitespace, and none of base64url's `-_`.
 * `Buffer.from(..., "base64")` is permissive enough to silently accept all three
 * and return a short buffer, which is how a client's encoding bug becomes a
 * stored image nobody can decode.
 */
const STANDARD_BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function decodeStandardBase64(value: string): Uint8Array | undefined {
  if (value.length === 0 || value.length % 4 !== 0) return undefined;
  if (!STANDARD_BASE64.test(value)) return undefined;
  return new Uint8Array(Buffer.from(value, "base64"));
}

export function encodeStandardBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function readMimeType(body: Record<string, unknown>): AvatarMimeType {
  const value = readRequiredString(body, "mime_type");
  if (!(AVATAR_MIME_TYPES as readonly string[]).includes(value)) {
    fail("unsupported_media");
  }
  return value as AvatarMimeType;
}

export function validateAvatarRequest(
  raw: string | undefined
): ValidatedAvatarRequest {
  const body = decodeJsonBody({
    raw,
    maxBytes: AVATAR_BODY_MAX_BYTES,
    allowedMembers: AVATAR_BODY_MEMBERS,
  });

  const expectedVersion = readExpectedVersion(body);
  const mimeType = readMimeType(body);

  const data = readRequiredString(body, "data");
  const bytes = decodeStandardBase64(data);
  if (!bytes) {
    failValidation("data", "invalid_format");
  }

  // Measured on the DECODED bytes: the body ceiling above covers the encoded form.
  if (bytes.length > AVATAR_MAX_DECODED_BYTES) {
    fail("payload_too_large");
  }

  if (!mimeMatchesMagic(mimeType, bytes)) {
    fail("unsupported_media");
  }

  const dimensions = readImageDimensions(bytes);
  if (!dimensions) {
    // Fail closed: an undeterminable size cannot be compared to the ceiling.
    failValidation("data", "invalid_format");
  }

  if (Math.max(dimensions.width, dimensions.height) > AVATAR_MAX_EDGE_PX) {
    failValidation("data", "dimensions_exceeded");
  }

  return { mimeType, bytes, expectedVersion };
}
