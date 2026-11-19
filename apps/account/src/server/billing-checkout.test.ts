import { describe, expect, it } from "vitest";
import type { BillingError, CheckoutResponse, PortalResponse } from "@nixus/shared";

import type { BillingApi, BillingResult, StartCheckoutInput } from "./billing-client.ts";
import {
  narrowCheckoutInput,
  openPortalSession,
  startCheckoutSession,
} from "./billing-checkout.ts";

/*
 * billing AD-8, AD-14, AD-18.
 *
 * Three behaviours that are easy to get wrong and invisible in a diff: an
 * already-open checkout is its own answer and not a failure, an invalid
 * promotion code never travels back out, and a request whose response was never
 * observed is not reported as a refusal.
 */

const CHECKOUT_URL = "https://checkout.invalid/c/pay/cs_test_a1b2c3";
const PORTAL_URL = "https://billing.invalid/p/session/test_manage";

interface Scripted {
  checkout?: (input: StartCheckoutInput) => Promise<BillingResult<CheckoutResponse>>;
  portal?: () => Promise<BillingResult<PortalResponse>>;
}

function api(scripted: Scripted): BillingApi {
  const unused = () => {
    throw new Error("not part of this behaviour");
  };
  return {
    startCheckout: scripted.checkout ?? unused,
    createPortalSession: scripted.portal ?? unused,
    getEntitlement: unused,
    getPlans: unused,
  } as unknown as BillingApi;
}

function refusal(code: string, extra: Record<string, unknown> = {}) {
  return async (): Promise<BillingResult<never>> => ({
    ok: false,
    error: { code, message: "fixed sentence", request_id: "req-1", ...extra } as BillingError,
  });
}

describe("narrowCheckoutInput", () => {
  it("accepts a conventionally shaped lookup key", () => {
    expect(
      narrowCheckoutInput({ planLookupKey: "classic_monthly_cad", promotionCode: null }),
    ).toEqual({
      planLookupKey: "classic_monthly_cad",
      promotionCode: null,
      promotionCodeSubmitted: false,
    });
  });

  it.each([
    "Classic_Monthly_CAD",
    "classic monthly cad",
    "classic-monthly-cad",
    "classic",
    "_classic_monthly",
    "1classic_monthly",
    "classic_monthly_cad; DROP TABLE",
    "../../etc/passwd",
    "",
    "a".repeat(65),
  ])("refuses the malformed lookup key %j", (value) => {
    expect(narrowCheckoutInput({ planLookupKey: value, promotionCode: null }).planLookupKey)
      .toBeNull();
  });

  it.each([null, undefined, 0, {}, [], true])(
    "refuses the non-string lookup key %j",
    (value) => {
      expect(narrowCheckoutInput({ planLookupKey: value, promotionCode: null }).planLookupKey)
        .toBeNull();
    },
  );

  it("accepts a conventionally shaped promotion code", () => {
    const narrowed = narrowCheckoutInput({
      planLookupKey: "classic_monthly_cad",
      promotionCode: "LAUNCH-2026_A",
    });
    expect(narrowed.promotionCode).toBe("LAUNCH-2026_A");
    expect(narrowed.promotionCodeSubmitted).toBe(true);
  });

  it.each(["LAUNCH 2026", "LAUNCH!", "a".repeat(65), "<script>"])(
    "tells a malformed submitted code %j apart from no code at all",
    (value) => {
      const narrowed = narrowCheckoutInput({
        planLookupKey: "classic_monthly_cad",
        promotionCode: value,
      });
      expect(narrowed.promotionCode).toBeNull();
      expect(narrowed.promotionCodeSubmitted).toBe(true);
    },
  );

  it.each([null, undefined, "", "   "])("reads %j as no code submitted", (value) => {
    const narrowed = narrowCheckoutInput({
      planLookupKey: "classic_monthly_cad",
      promotionCode: value,
    });
    expect(narrowed.promotionCode).toBeNull();
    expect(narrowed.promotionCodeSubmitted).toBe(false);
  });
});

describe("startCheckoutSession", () => {
  it("returns the url and the destination the server chose", async () => {
    const outcome = await startCheckoutSession(
      api({ checkout: async () => ({ ok: true, value: { url: CHECKOUT_URL, destination: "checkout" } }) }),
      { planLookupKey: "classic_monthly_cad", promotionCode: null },
    );

    expect(outcome).toEqual({
      kind: "redirect",
      url: CHECKOUT_URL,
      destination: "checkout",
    });
  });

  it("opens the portal when the SERVER routes an existing subscriber there", async () => {
    const outcome = await startCheckoutSession(
      api({ checkout: async () => ({ ok: true, value: { url: PORTAL_URL, destination: "portal" } }) }),
      { planLookupKey: "advance_monthly_cad", promotionCode: null },
    );

    // AD-18: the UI never decides this, it reports what it was handed.
    expect(outcome).toEqual({ kind: "redirect", url: PORTAL_URL, destination: "portal" });
  });

  it("forwards the shaped promotion code and nothing else", async () => {
    const seen: StartCheckoutInput[] = [];
    await startCheckoutSession(
      api({
        checkout: async (input) => {
          seen.push(input);
          return { ok: true, value: { url: CHECKOUT_URL, destination: "checkout" } };
        },
      }),
      { planLookupKey: "advance_monthly_cad", promotionCode: "LAUNCH2026" },
    );

    expect(seen).toEqual([
      { planLookupKey: "advance_monthly_cad", promotionCode: "LAUNCH2026" },
    ]);
  });

  it("refuses a malformed lookup key without calling the billing api", async () => {
    const outcome = await startCheckoutSession(api({}), {
      planLookupKey: "Not A Lookup Key",
      promotionCode: null,
    });

    expect(outcome).toEqual({
      kind: "rejected",
      code: "validation",
      field: "plan_lookup_key",
      reason: "invalid_format",
    });
  });

  it("refuses a malformed promotion code without calling the billing api", async () => {
    const outcome = await startCheckoutSession(api({}), {
      planLookupKey: "classic_monthly_cad",
      promotionCode: "NOT A CODE",
    });

    expect(outcome).toEqual({
      kind: "rejected",
      code: "validation",
      field: "promotion_code",
      reason: "invalid_format",
    });
    expect(JSON.stringify(outcome)).not.toContain("NOT A CODE");
  });

  it("reports an already-open checkout as its own outcome, not as an error", async () => {
    const outcome = await startCheckoutSession(
      api({ checkout: refusal("checkout_in_progress") }),
      { planLookupKey: "classic_monthly_cad", promotionCode: null },
    );

    expect(outcome).toEqual({ kind: "checkout_in_progress" });
  });

  it("reports an invalid promotion code at the field, never echoing it", async () => {
    const outcome = await startCheckoutSession(
      api({ checkout: refusal("promotion_invalid") }),
      { planLookupKey: "classic_monthly_cad", promotionCode: "NOTREAL2026" },
    );

    expect(outcome).toEqual({ kind: "promotion_invalid" });
    expect(JSON.stringify(outcome)).not.toContain("NOTREAL2026");
  });

  it("routes a server-side validation refusal to the field it blamed", async () => {
    const outcome = await startCheckoutSession(
      api({
        checkout: refusal("validation", { field: "plan_lookup_key", reason: "not_allowed" }),
      }),
      { planLookupKey: "a_plan_the_catalog_dropped", promotionCode: null },
    );

    expect(outcome).toEqual({
      kind: "rejected",
      code: "validation",
      field: "plan_lookup_key",
      reason: "not_allowed",
    });
  });

  it.each(["unavailable", "rate_limited", "reauthentication_required", "unauthorized"])(
    "passes %s through as a refusal with no field",
    async (code) => {
      const outcome = await startCheckoutSession(api({ checkout: refusal(code) }), {
        planLookupKey: "classic_monthly_cad",
        promotionCode: null,
      });

      expect(outcome).toEqual({ kind: "rejected", code, field: null, reason: null });
    },
  );

  it("reports indeterminate when the response was never observed", async () => {
    const outcome = await startCheckoutSession(
      api({
        checkout: () => Promise.reject(new TypeError("fetch failed")),
      }),
      { planLookupKey: "classic_monthly_cad", promotionCode: null },
    );

    // A Checkout Session may exist and the AD-18 lock may be held, so "it
    // failed" would be a lie that invites a retry.
    expect(outcome).toEqual({ kind: "indeterminate" });
  });

  it("never carries a submitted code into any outcome shape", async () => {
    const secret = "SECRETLAUNCHCODE";
    for (const scripted of [
      api({ checkout: refusal("promotion_invalid") }),
      api({ checkout: refusal("validation", { field: "promotion_code", reason: "not_allowed" }) }),
      api({ checkout: refusal("unavailable") }),
      api({ checkout: () => Promise.reject(new TypeError("fetch failed")) }),
    ]) {
      const outcome = await startCheckoutSession(scripted, {
        planLookupKey: "classic_monthly_cad",
        promotionCode: secret,
      });
      expect(JSON.stringify(outcome)).not.toContain(secret);
    }
  });
});

describe("openPortalSession", () => {
  it("returns the portal url the server minted for the caller's own customer", async () => {
    const outcome = await openPortalSession(
      api({ portal: async () => ({ ok: true, value: { url: PORTAL_URL } }) }),
    );

    expect(outcome).toEqual({ kind: "redirect", url: PORTAL_URL });
  });

  it.each(["unavailable", "rate_limited", "reauthentication_required"])(
    "reports %s as a refusal",
    async (code) => {
      const outcome = await openPortalSession(api({ portal: refusal(code) }));
      expect(outcome).toEqual({ kind: "rejected", code });
    },
  );

  it("reports indeterminate when the request could not be made", async () => {
    const outcome = await openPortalSession(
      api({ portal: () => Promise.reject(new TypeError("fetch failed")) }),
    );

    expect(outcome).toEqual({ kind: "indeterminate" });
  });
});
