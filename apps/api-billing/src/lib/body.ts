import type { BillingValidationField } from "@nixus/shared";

import { failValidation } from "./errors.ts";

/*
 * The request-body boundary shared by every authorized route that takes one.
 * Everything past this module sees a plain object whose members the billing
 * contract defines, and every refusal it produces names a field and a reason
 * WITHOUT the submitted value (AD-14).
 */

export function decodeJsonBody(args: {
  readonly raw: string | undefined;
  readonly maxBytes: number;
  readonly allowedMembers: readonly string[];
}): Record<string, unknown> {
  const { raw, maxBytes, allowedMembers } = args;

  // The ceiling is checked on bytes, not characters: a body of multi-byte
  // characters is larger than its length suggests. The billing error union is
  // closed and carries no payload_too_large member, so an oversized body is a
  // malformed request - which is also what BILLING_GATEWAY_RESPONSES maps API
  // Gateway's own REQUEST_TOO_LARGE to.
  if (raw !== undefined && Buffer.byteLength(raw, "utf8") > maxBytes) {
    failValidation("body", "too_long");
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
 * Mandatory wherever the contract declares it (AD-4): `null` is create-only, a
 * positive integer is "only if the stored version is exactly this". Absent is
 * never "whatever is there now", which is the lost update the mandatory member
 * exists to prevent.
 */
export function readExpectedVersion(
  body: Record<string, unknown>,
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

export function readRequiredString(
  body: Record<string, unknown>,
  field: BillingValidationField,
): string {
  const value = body[field];
  if (typeof value !== "string") {
    failValidation(field, value === undefined ? "required" : "invalid_type");
  }
  if (value.length === 0) {
    failValidation(field, "required");
  }
  return value;
}

/**
 * Absent and `null` are the same thing - the member is unset. A blank or
 * whitespace-only string is also unset rather than a value to refuse, matching
 * the account API's `readNormalizedString`.
 */
export function readOptionalString(
  body: Record<string, unknown>,
  field: BillingValidationField,
): string | null {
  const value = body[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    failValidation(field, "invalid_type");
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** A required integer. Epoch seconds and counters are the only users. */
export function readRequiredInteger(
  body: Record<string, unknown>,
  field: BillingValidationField,
): number {
  const value = body[field];
  if (value === undefined) {
    failValidation(field, "required");
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    failValidation(field, "invalid_type");
  }
  if (!Number.isInteger(value)) {
    failValidation(field, "invalid_format");
  }
  return value;
}

/** `null` or a positive integer, which is how the contract models an absent limit. */
export function readNullableCount(
  body: Record<string, unknown>,
  field: BillingValidationField,
): number | null {
  const value = body[field];
  if (value === undefined) {
    failValidation(field, "required");
  }
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    failValidation(field, "invalid_type");
  }
  if (value <= 0) {
    failValidation(field, "out_of_range");
  }
  return value;
}
