import { describe, expect, it } from "vitest";

import {
  AVATAR_BODY_MAX_BYTES,
  AVATAR_MAX_DECODED_BYTES,
  AVATAR_MAX_EDGE_PX,
} from "@nixus/shared";

import {
  decodeStandardBase64,
  encodeStandardBase64,
  validateAvatarRequest,
} from "./avatar.ts";
import { AccountFailureError, type AccountFailure } from "./errors.ts";
import { readImageDimensions } from "./image-header.ts";
import { base64Of, jpegBytes, pngBytes } from "./testing/fixtures.ts";

/*
 * The avatar contract (AD-5). The server validates exactly what the clients
 * produce and never resizes, re-encodes, or accepts a filename. Dimensions are
 * read from the container header by hand and fail closed.
 */

function avatarBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    mime_type: "image/png",
    data: base64Of(pngBytes(256, 256)),
    expected_version: null,
    ...overrides,
  });
}

function refusal(raw: string | undefined): AccountFailure {
  try {
    validateAvatarRequest(raw);
  } catch (error) {
    if (error instanceof AccountFailureError) return error.failure;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("standard base64 only", () => {
  it("round-trips bytes through the canonical encoding", () => {
    const bytes = pngBytes(8, 8);
    expect(decodeStandardBase64(encodeStandardBase64(bytes))).toEqual(bytes);
  });

  it.each([
    ["base64url", "_-_-"],
    ["unpadded", "iVBORw0KGgo"],
    ["whitespace", "iVBO Rw0KGgo="],
    ["a newline", "iVBORw0K\nGgo="],
    ["a non-alphabet character", "iVBORw0KGg!="],
    ["padding in the middle", "iV=ORw0KGgo="],
    ["an empty string", ""],
  ])("refuses %s", (_label, value) => {
    expect(decodeStandardBase64(value)).toBeUndefined();
  });

  it("reports a non-base64 payload as validation data/invalid_format", () => {
    expect(refusal(avatarBody({ data: "not base64!" }))).toEqual({
      code: "validation",
      field: "data",
      reason: "invalid_format",
    });
  });
});

describe("mime type and magic bytes", () => {
  it("accepts a PNG declared as PNG and a JPEG declared as JPEG", () => {
    expect(validateAvatarRequest(avatarBody()).mimeType).toBe("image/png");
    expect(
      validateAvatarRequest(
        avatarBody({
          mime_type: "image/jpeg",
          data: base64Of(jpegBytes(128, 64)),
        })
      ).mimeType
    ).toBe("image/jpeg");
  });

  it.each([["image/webp"], ["image/gif"], ["image/svg+xml"], ["application/octet-stream"]])(
    "refuses the unsupported mime %s",
    (mime) => {
      expect(refusal(avatarBody({ mime_type: mime }))).toEqual({
        code: "unsupported_media",
      });
    }
  );

  it("refuses a non-string mime type as invalid_type", () => {
    expect(refusal(avatarBody({ mime_type: 1 }))).toEqual({
      code: "validation",
      field: "mime_type",
      reason: "invalid_type",
    });
  });

  /* The declared type must be what the bytes are: a JPEG labelled PNG would be
   * stored under a mime no client can render it with. */
  it("refuses bytes whose magic contradicts the declared mime", () => {
    expect(
      refusal(
        avatarBody({ mime_type: "image/png", data: base64Of(jpegBytes(8, 8)) })
      )
    ).toEqual({ code: "unsupported_media" });

    expect(
      refusal(
        avatarBody({ mime_type: "image/jpeg", data: base64Of(pngBytes(8, 8)) })
      )
    ).toEqual({ code: "unsupported_media" });
  });

  it("refuses bytes that are neither format", () => {
    expect(
      refusal(avatarBody({ data: base64Of(new Uint8Array([1, 2, 3, 4])) }))
    ).toEqual({ code: "unsupported_media" });
  });
});

describe("size ceilings", () => {
  it("refuses a request body over the encoded ceiling", () => {
    expect(refusal("x".repeat(AVATAR_BODY_MAX_BYTES + 1))).toEqual({
      code: "payload_too_large",
    });
  });

  it("accepts a derivative at exactly the decoded ceiling", () => {
    const bytes = new Uint8Array(AVATAR_MAX_DECODED_BYTES);
    bytes.set(pngBytes(256, 256), 0);

    const result = validateAvatarRequest(
      avatarBody({ data: base64Of(bytes) })
    );
    expect(result.bytes.length).toBe(AVATAR_MAX_DECODED_BYTES);
  });

  /* The ceiling is on the DECODED bytes: enforcing it on the base64 text would
   * refuse every derivative above roughly 48 KiB. */
  it("refuses one byte more than the decoded ceiling", () => {
    const bytes = new Uint8Array(AVATAR_MAX_DECODED_BYTES + 1);
    bytes.set(pngBytes(256, 256), 0);

    expect(refusal(avatarBody({ data: base64Of(bytes) }))).toEqual({
      code: "payload_too_large",
    });
  });
});

describe("dimensions are read from the header and fail closed", () => {
  it("reads PNG dimensions from IHDR", () => {
    expect(readImageDimensions(pngBytes(256, 128))).toEqual({
      width: 256,
      height: 128,
    });
  });

  it("reads JPEG dimensions from the frame header", () => {
    expect(readImageDimensions(jpegBytes(64, 200))).toEqual({
      width: 64,
      height: 200,
    });
  });

  it("accepts an image at exactly the longest-edge ceiling", () => {
    expect(
      validateAvatarRequest(
        avatarBody({ data: base64Of(pngBytes(AVATAR_MAX_EDGE_PX, 10)) })
      ).bytes.length
    ).toBeGreaterThan(0);
  });

  it.each([
    [AVATAR_MAX_EDGE_PX + 1, 10],
    [10, AVATAR_MAX_EDGE_PX + 1],
    [4096, 4096],
  ])("refuses %sx%s as dimensions_exceeded", (width, height) => {
    expect(
      refusal(avatarBody({ data: base64Of(pngBytes(width, height)) }))
    ).toEqual({
      code: "validation",
      field: "data",
      reason: "dimensions_exceeded",
    });
  });

  it.each([
    ["a truncated PNG header", pngBytes(32, 32).slice(0, 20)],
    [
      "a PNG whose first chunk is not IHDR",
      (() => {
        const bytes = pngBytes(32, 32);
        bytes.set([0x49, 0x44, 0x41, 0x54], 12);
        return bytes;
      })(),
    ],
    ["a PNG claiming a zero dimension", pngBytes(0, 32)],
    ["a JPEG with no frame header", new Uint8Array([0xff, 0xd8, 0xff, 0xd9])],
    [
      "a JPEG whose frame segment is truncated",
      jpegBytes(32, 32).slice(0, 8),
    ],
    [
      "a JPEG whose segment length is impossible",
      (() => {
        const bytes = jpegBytes(32, 32);
        bytes[4] = 0x00;
        bytes[5] = 0x01;
        return bytes;
      })(),
    ],
  ])("returns no dimensions for %s", (_label, bytes) => {
    expect(readImageDimensions(bytes)).toBeUndefined();
  });

  it("refuses an image whose dimensions cannot be determined", () => {
    const truncated = pngBytes(32, 32).slice(0, 20);

    expect(refusal(avatarBody({ data: base64Of(truncated) }))).toEqual({
      code: "validation",
      field: "data",
      reason: "invalid_format",
    });
  });

  /* A multi-segment JPEG is the normal case: the frame header sits behind the
   * application and quantisation segments a real encoder emits. */
  it("walks past preceding segments to find the frame header", () => {
    const frame = jpegBytes(120, 90);
    const withApp1 = new Uint8Array(frame.length + 10);
    withApp1.set([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 1, 2, 3, 4, 5, 6], 0);
    withApp1.set(frame.subarray(2), 12);

    expect(readImageDimensions(withApp1)).toEqual({ width: 120, height: 90 });
  });
});

describe("the avatar body carries nothing else", () => {
  it("refuses a filename member outright", () => {
    expect(refusal(avatarBody({ filename: "selfie.png" }))).toEqual({
      code: "validation",
      field: "body",
      reason: "unknown_field",
    });
  });

  it("requires expected_version like every other PUT", () => {
    const raw = JSON.parse(avatarBody()) as Record<string, unknown>;
    delete raw.expected_version;

    expect(refusal(JSON.stringify(raw))).toEqual({
      code: "validation",
      field: "expected_version",
      reason: "required",
    });
  });
});
