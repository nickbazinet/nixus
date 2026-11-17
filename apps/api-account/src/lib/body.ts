import { failValidation, fail } from "./errors.ts";
import type { ValidationField } from "@nixus/shared";

/*
 * The request-body boundary shared by `PUT /` and `PUT /avatar`. Everything past
 * this module sees a plain object whose members this contract defines, and every
 * refusal it produces names a field and a reason without the submitted value
 * (AD-12).
 */

export function decodeJsonBody(args: {
  readonly raw: string | undefined;
  readonly maxBytes: number;
  readonly allowedMembers: readonly string[];
}): Record<string, unknown> {
  const { raw, maxBytes, allowedMembers } = args;

  // The ceiling is checked on bytes, not characters: a body of multi-byte
  // characters is larger than its length suggests.
  if (raw !== undefined && Buffer.byteLength(raw, "utf8") > maxBytes) {
    fail("payload_too_large");
  }

  if (raw === undefined || raw.length === 0) {
    failValidation("body", "invalid_format");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    failValidation("body", "invalid_format");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    failValidation("body", "invalid_type");
  }

  const body = parsed as Record<string, unknown>;
  for (const member of Object.keys(body)) {
    if (!allowedMembers.includes(member)) {
      // The member NAME is not echoed either: `field: "body"` plus
      // `unknown_field` is the whole of what a client needs.
      failValidation("body", "unknown_field");
    }
  }

  return body;
}

/**
 * Mandatory on every `PUT` (AD-4): `null` is create-only, a positive integer is
 * "only if the stored version is exactly this". Absent is never "whatever is
 * there now", which is the lost update the mandatory member exists to prevent.
 */
export function readExpectedVersion(
  body: Record<string, unknown>
): number | null {
  if (!Object.hasOwn(body, "expected_version")) {
    failValidation("expected_version", "required");
  }

  const value = body.expected_version;
  if (value === null) return null;
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  failValidation("expected_version", "invalid_type");
}

/**
 * Absent and `null` are the same thing - the field is unset - and a blank or
 * whitespace-only string clears it rather than being refused as an unknown code,
 * matching `profile_store.rs`'s `normalize`.
 */
export function readNormalizedString(
  body: Record<string, unknown>,
  field: ValidationField
): string | null {
  const value = body[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    failValidation(field, "invalid_type");
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function readRequiredString(
  body: Record<string, unknown>,
  field: ValidationField
): string {
  const value = body[field];
  if (typeof value !== "string") {
    failValidation(field, "invalid_type");
  }
  return value;
}
