import {
  ADMIN_OVERRIDE_MAX_DURATION_SECONDS,
  ADMIN_OVERRIDE_REASON_MAX_LENGTH,
  BILLING_BODY_MAX_BYTES,
  isBillingCapability,
  isPlanLookupKeyShaped,
  isPromotionCodeShaped,
  toBillingCapabilities,
  type BillingCapability,
} from "@nixus/shared";

import {
  decodeJsonBody,
  readExpectedVersion,
  readNullableCount,
  readOptionalString,
  readRequiredInteger,
  readRequiredString,
} from "./body.ts";
import { failValidation } from "./errors.ts";
import { isUuidShaped } from "./table.ts";

/*
 * The server is the final validation authority. Nothing here is echoed back: a
 * refusal names a field and a reason and never the value, which is what keeps a
 * promotion code out of an error body (AD-8, AD-14).
 *
 * Shape is all this module can decide. Whether a `plan_lookup_key` names a Price
 * the catalog currently publishes is Stripe's answer, checked against the live
 * catalog before Stripe is called (AD-8) - a later work package's job.
 */

export interface ValidatedCheckoutRequest {
  readonly planLookupKey: string;
  readonly promotionCode: string | null;
}

const CHECKOUT_BODY_MEMBERS: readonly string[] = [
  "plan_lookup_key",
  "promotion_code",
];

export function validateCheckoutRequest(
  raw: string | undefined,
): ValidatedCheckoutRequest {
  const body = decodeJsonBody({
    raw,
    maxBytes: BILLING_BODY_MAX_BYTES,
    allowedMembers: CHECKOUT_BODY_MEMBERS,
  });

  const planLookupKey = readRequiredString(body, "plan_lookup_key");
  if (!isPlanLookupKeyShaped(planLookupKey)) {
    failValidation("plan_lookup_key", "invalid_format");
  }

  const promotionCode = readOptionalString(body, "promotion_code");
  if (promotionCode !== null && !isPromotionCodeShaped(promotionCode)) {
    // The code is never named in the refusal, here or anywhere downstream.
    failValidation("promotion_code", "invalid_format");
  }

  return { planLookupKey, promotionCode };
}

export interface ValidatedAdminOverrideRequest {
  readonly sub: string;
  readonly tier: string;
  readonly capabilities: readonly BillingCapability[];
  readonly monthlyRequestLimit: number | null;
  readonly adminExpiresAt: number;
  readonly reason: string;
  readonly expectedVersion: number | null;
}

const ADMIN_OVERRIDE_BODY_MEMBERS: readonly string[] = [
  "sub",
  "tier",
  "capabilities",
  "monthly_request_limit",
  "admin_expires_at",
  "reason",
  "expected_version",
];

/**
 * By convention a tier is a lowercase snake_case code from Stripe Product
 * `metadata.nixus_tier`. The shape is checked so a key is never composed from an
 * arbitrary string; the VALUE is never compared, by anything, anywhere (AD-1).
 */
const TIER_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const TIER_MAX_LENGTH = 32;

export function validateAdminOverrideRequest(
  raw: string | undefined,
  now: Date,
): ValidatedAdminOverrideRequest {
  const body = decodeJsonBody({
    raw,
    maxBytes: BILLING_BODY_MAX_BYTES,
    allowedMembers: ADMIN_OVERRIDE_BODY_MEMBERS,
  });

  // The ONE route on which a `sub` is a request parameter (AD-2). It is still
  // shape-checked before any key is composed from it (AD-3).
  const sub = readRequiredString(body, "sub");
  if (!isUuidShaped(sub)) {
    failValidation("sub", "invalid_format");
  }

  const tier = readRequiredString(body, "tier");
  if (tier.length > TIER_MAX_LENGTH) {
    failValidation("tier", "too_long");
  }
  if (!TIER_PATTERN.test(tier)) {
    failValidation("tier", "invalid_format");
  }

  const capabilities = validateCapabilities(body.capabilities);
  const monthlyRequestLimit = readNullableCount(body, "monthly_request_limit");
  const adminExpiresAt = validateAdminExpiresAt(
    readRequiredInteger(body, "admin_expires_at"),
    now,
  );

  const reason = readRequiredString(body, "reason");
  if (reason.length > ADMIN_OVERRIDE_REASON_MAX_LENGTH) {
    failValidation("reason", "too_long");
  }

  return {
    sub,
    tier,
    capabilities,
    monthlyRequestLimit,
    adminExpiresAt,
    reason,
    expectedVersion: readExpectedVersion(body),
  };
}

/**
 * An administrative grant is explicit, so an unrecognised capability name is
 * REFUSED here rather than silently dropped - unlike a name arriving from Stripe
 * Product metadata, which AD-6 drops with a warning because an operator's typo
 * must not fail a paying customer's webhook. The accepted list still goes through
 * `toBillingCapabilities`, so the stored array is sorted and deduplicated and two
 * representations of one grant are byte-identical (AD-1).
 */
function validateCapabilities(value: unknown): readonly BillingCapability[] {
  if (value === undefined) {
    failValidation("capabilities", "required");
  }
  if (!Array.isArray(value)) {
    failValidation("capabilities", "invalid_type");
  }
  for (const entry of value) {
    if (typeof entry !== "string") {
      failValidation("capabilities", "invalid_type");
    }
    if (!isBillingCapability(entry)) {
      failValidation("capabilities", "not_allowed");
    }
  }
  return toBillingCapabilities(value);
}

/** Mandatory, in the future, and never longer than the maximum: an override can
 * never become permanent (AD-2). */
function validateAdminExpiresAt(value: number, now: Date): number {
  const nowSeconds = Math.floor(now.getTime() / 1000);

  if (value <= nowSeconds) {
    failValidation("admin_expires_at", "in_past");
  }
  if (value - nowSeconds > ADMIN_OVERRIDE_MAX_DURATION_SECONDS) {
    failValidation("admin_expires_at", "out_of_range");
  }
  return value;
}
