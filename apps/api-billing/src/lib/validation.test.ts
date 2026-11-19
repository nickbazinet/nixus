import { describe, expect, it } from "vitest";

import {
  ADMIN_OVERRIDE_MAX_DURATION_SECONDS,
  ADMIN_OVERRIDE_REASON_MAX_LENGTH,
  BILLING_CAPABILITIES,
} from "@nixus/shared";

import { BillingFailureError } from "./errors.ts";
import { SUB_A } from "./testing/fixtures.ts";
import {
  validateAdminOverrideRequest,
  validateCheckoutRequest,
} from "./validation.ts";

/*
 * Shape is all this layer can decide, and nothing it refuses is echoed back
 * (AD-8, AD-14). Whether a `plan_lookup_key` names a Price the catalog publishes
 * and whether a promotion code is redeemable are Stripe's answers, checked
 * against the live catalog before Stripe is called - a later work package.
 */

const NOW = new Date("2026-11-18T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);

function failureOf(run: () => unknown) {
  try {
    run();
    expect.unreachable("expected a refusal");
  } catch (error) {
    expect(error).toBeInstanceOf(BillingFailureError);
    return (error as BillingFailureError).failure;
  }
}

function checkout(body: unknown) {
  return validateCheckoutRequest(JSON.stringify(body));
}

function override(overrides: Record<string, unknown> = {}) {
  return validateAdminOverrideRequest(
    JSON.stringify({
      sub: SUB_A,
      tier: "advance",
      capabilities: ["hosted_ai", "multi_device_sync"],
      monthly_request_limit: 500,
      admin_expires_at: NOW_SECONDS + 3600,
      reason: "support escalation 1234",
      expected_version: null,
      ...overrides,
    }),
    NOW,
  );
}

describe("validateCheckoutRequest", () => {
  it("accepts a shaped lookup key with no promotion code", () => {
    expect(checkout({ plan_lookup_key: "classic_monthly_cad", promotion_code: null }))
      .toEqual({ planLookupKey: "classic_monthly_cad", promotionCode: null });
  });

  it("accepts a shaped promotion code and trims it", () => {
    expect(
      checkout({
        plan_lookup_key: "advance_monthly_cad",
        promotion_code: "  SAVE-20_NOW ",
      }),
    ).toEqual({
      planLookupKey: "advance_monthly_cad",
      promotionCode: "SAVE-20_NOW",
    });
  });

  it("treats an absent promotion code as unset", () => {
    expect(checkout({ plan_lookup_key: "classic_monthly_cad" }).promotionCode).toBeNull();
  });

  it.each([
    ["Classic_Monthly_CAD"],
    ["classic"],
    ["_classic_monthly"],
    ["classic monthly cad"],
    ["classic-monthly-cad"],
    ["1classic_monthly"],
    ["a".repeat(70)],
  ])("refuses the malformed lookup key %s without echoing it", (key) => {
    const failure = failureOf(() => checkout({ plan_lookup_key: key }));

    expect(failure).toMatchObject({
      code: "validation",
      field: "plan_lookup_key",
    });
    expect(JSON.stringify(failure)).not.toContain(key);
  });

  /* AD-8/AD-14: a code is never forwarded to Stripe unvalidated and never echoed
   * back in an error - the whole point of the shape check. */
  it("refuses a malformed promotion code without echoing it", () => {
    const failure = failureOf(() =>
      checkout({
        plan_lookup_key: "classic_monthly_cad",
        promotion_code: "DROP TABLE promos; --",
      }),
    );

    expect(failure).toEqual({
      code: "validation",
      field: "promotion_code",
      reason: "invalid_format",
    });
    expect(JSON.stringify(failure)).not.toContain("DROP TABLE");
  });

  it("refuses a body carrying a member the contract does not define", () => {
    expect(
      failureOf(() =>
        checkout({
          plan_lookup_key: "classic_monthly_cad",
          price_id: "price_1234",
        }),
      ),
    ).toEqual({ code: "validation", field: "body", reason: "unknown_field" });
  });

  it("refuses an absent lookup key", () => {
    expect(failureOf(() => checkout({ promotion_code: null }))).toMatchObject({
      field: "plan_lookup_key",
      reason: "required",
    });
  });
});

describe("validateAdminOverrideRequest", () => {
  it("accepts a complete, well-formed override", () => {
    expect(override()).toEqual({
      sub: SUB_A,
      tier: "advance",
      capabilities: ["hosted_ai", "multi_device_sync"],
      monthlyRequestLimit: 500,
      adminExpiresAt: NOW_SECONDS + 3600,
      reason: "support escalation 1234",
      expectedVersion: null,
    });
  });

  /* The ONE route on which a `sub` is a request parameter (AD-2). It is still
   * shape-checked before any key is composed from it (AD-3). */
  it("shape-checks the subject being granted", () => {
    const failure = failureOf(() => override({ sub: "not-a-uuid" }));

    expect(failure).toEqual({
      code: "validation",
      field: "sub",
      reason: "invalid_format",
    });
    expect(JSON.stringify(failure)).not.toContain("not-a-uuid");
  });

  it.each([["Advance"], ["advance!"], ["_advance"], ["a".repeat(40)]])(
    "refuses the malformed tier %s",
    (tier) => {
      expect(failureOf(() => override({ tier }))).toMatchObject({
        field: "tier",
      });
    },
  );

  /* An administrative grant is explicit, so an unrecognised capability name is
   * REFUSED here - unlike a name arriving from Stripe Product metadata, which
   * AD-6 drops with a warning so an operator's typo does not fail a paying
   * customer's webhook. */
  it("refuses an unknown capability name rather than dropping it", () => {
    const failure = failureOf(() =>
      override({ capabilities: ["hosted_ai", "household_net_wroth"] }),
    );

    expect(failure).toEqual({
      code: "validation",
      field: "capabilities",
      reason: "not_allowed",
    });
    expect(JSON.stringify(failure)).not.toContain("household_net_wroth");
  });

  it.each([[{}], ["hosted_ai"], [null], [42]])(
    "refuses %s as a capability list",
    (capabilities) => {
      expect(failureOf(() => override({ capabilities }))).toMatchObject({
        field: "capabilities",
        reason: "invalid_type",
      });
    },
  );

  /* Normalised through toBillingCapabilities, so the stored array is sorted and
   * deduplicated and two representations of one grant are byte-identical
   * (AD-1). */
  it("sorts and deduplicates an accepted capability list", () => {
    expect(
      override({
        capabilities: [
          "multi_device_sync",
          "hosted_ai",
          "multi_device_sync",
          "household_net_worth",
        ],
      }).capabilities,
    ).toEqual([...BILLING_CAPABILITIES]);
  });

  it("accepts an empty capability list, which grants nothing", () => {
    expect(override({ capabilities: [] }).capabilities).toEqual([]);
  });

  it("accepts a null monthly limit and refuses a non-positive one", () => {
    expect(override({ monthly_request_limit: null }).monthlyRequestLimit).toBeNull();
    expect(
      failureOf(() => override({ monthly_request_limit: 0 })),
    ).toMatchObject({ field: "monthly_request_limit", reason: "out_of_range" });
  });

  /* Mandatory, in the future, and never longer than the maximum: an override can
   * never become permanent (AD-2). */
  it("refuses an expiry that has already passed", () => {
    expect(
      failureOf(() => override({ admin_expires_at: NOW_SECONDS - 1 })),
    ).toEqual({
      code: "validation",
      field: "admin_expires_at",
      reason: "in_past",
    });
    expect(failureOf(() => override({ admin_expires_at: NOW_SECONDS }))).toMatchObject(
      { reason: "in_past" },
    );
  });

  it("refuses an expiry beyond the maximum duration", () => {
    expect(
      override({
        admin_expires_at: NOW_SECONDS + ADMIN_OVERRIDE_MAX_DURATION_SECONDS,
      }).adminExpiresAt,
    ).toBe(NOW_SECONDS + ADMIN_OVERRIDE_MAX_DURATION_SECONDS);

    expect(
      failureOf(() =>
        override({
          admin_expires_at:
            NOW_SECONDS + ADMIN_OVERRIDE_MAX_DURATION_SECONDS + 1,
        }),
      ),
    ).toEqual({
      code: "validation",
      field: "admin_expires_at",
      reason: "out_of_range",
    });
  });

  it("requires a reason within the maximum length", () => {
    expect(
      override({ reason: "x".repeat(ADMIN_OVERRIDE_REASON_MAX_LENGTH) }).reason,
    ).toHaveLength(ADMIN_OVERRIDE_REASON_MAX_LENGTH);

    expect(
      failureOf(() =>
        override({ reason: "x".repeat(ADMIN_OVERRIDE_REASON_MAX_LENGTH + 1) }),
      ),
    ).toEqual({
      code: "validation",
      field: "reason",
      reason: "too_long",
    });
    expect(failureOf(() => override({ reason: "" }))).toMatchObject({
      field: "reason",
      reason: "required",
    });
  });

  it("requires expected_version explicitly, including as null", () => {
    expect(override({ expected_version: 4 }).expectedVersion).toBe(4);

    const body = {
      sub: SUB_A,
      tier: "advance",
      capabilities: [],
      monthly_request_limit: null,
      admin_expires_at: NOW_SECONDS + 60,
      reason: "r",
    };
    expect(
      failureOf(() => validateAdminOverrideRequest(JSON.stringify(body), NOW)),
    ).toMatchObject({ field: "expected_version", reason: "required" });
  });

  it("refuses a member the contract does not define", () => {
    expect(failureOf(() => override({ source: "admin" }))).toEqual({
      code: "validation",
      field: "body",
      reason: "unknown_field",
    });
  });
});
