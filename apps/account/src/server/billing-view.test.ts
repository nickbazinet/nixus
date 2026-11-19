import { describe, expect, it } from "vitest";
import type { BillingError, EntitlementResponse } from "@nixus/shared";

import type { BillingApi, BillingResult } from "./billing-client.ts";
import {
  hasPortal,
  loadBillingSnapshot,
  toEntitlementView,
} from "./billing-view.ts";
import FIXTURES from "../../../../packages/shared/src/types/billing.fixtures.json" with {
  type: "json",
};

/*
 * billing AD-1, AD-13, AD-14: the page may display a tier and may never compare
 * one, the signed statement must not cross to the browser, and a value a newer
 * server introduced must narrow rather than break the page.
 */

const PAID = FIXTURES.entitlement_paid as EntitlementResponse;
const FREE = FIXTURES.entitlement_free as EntitlementResponse;

interface Scripted {
  entitlement?: () => Promise<BillingResult<EntitlementResponse>>;
  plans?: () => Promise<BillingResult<typeof FIXTURES.plan_catalog>>;
}

function api(scripted: Scripted): BillingApi {
  const unused = () => {
    throw new Error("not part of this behaviour");
  };
  return {
    getEntitlement: scripted.entitlement ?? unused,
    getPlans: scripted.plans ?? unused,
    startCheckout: unused,
    createPortalSession: unused,
  } as unknown as BillingApi;
}

function ok<T>(value: T): () => Promise<BillingResult<T>> {
  return async () => ({ ok: true, value });
}

function refused(code: string) {
  return async (): Promise<BillingResult<never>> => ({
    ok: false,
    error: { code, message: "fixed sentence", request_id: "req-1" } as BillingError,
  });
}

describe("toEntitlementView", () => {
  it("carries the tier through as the opaque display string it is", () => {
    expect(toEntitlementView(PAID)).toEqual({
      tier: "advance",
      status: "active",
      currentPeriodEnd: 1796083200,
      capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
      monthlyRequestLimit: 1000,
      source: "stripe",
    });
  });

  it("never carries the signed statement or its expiry", () => {
    const view = toEntitlementView(PAID);
    expect(view).not.toHaveProperty("statement");
    expect(view).not.toHaveProperty("statement_exp");
    expect(JSON.stringify(view)).not.toContain("NXS1");
  });

  it("reads a free entitlement as an ordinary account, not an error", () => {
    expect(toEntitlementView(FREE)).toEqual({
      tier: "free",
      status: "none",
      currentPeriodEnd: null,
      capabilities: [],
      monthlyRequestLimit: null,
      source: "stripe",
    });
  });

  it("drops a capability name it does not recognise and sorts what is left", () => {
    const view = toEntitlementView({
      ...PAID,
      capabilities: ["multi_device_sync", "a_capability_from_the_future", "hosted_ai"],
    } as unknown as EntitlementResponse);

    expect(view.capabilities).toEqual(["hosted_ai", "multi_device_sync"]);
  });

  it("narrows an unrecognised status to none, which grants nothing either way", () => {
    const view = toEntitlementView({
      ...PAID,
      status: "a_status_from_the_future",
    } as unknown as EntitlementResponse);

    expect(view.status).toBe("none");
  });

  it("narrows an unrecognised source without losing the rest of the record", () => {
    const view = toEntitlementView({
      ...PAID,
      source: "a_source_from_the_future",
    } as unknown as EntitlementResponse);

    expect(view.source).toBe("stripe");
    expect(view.tier).toBe("advance");
  });

  it("keeps a tier code these locale files have never seen", () => {
    const view = toEntitlementView({ ...PAID, tier: "a_tier_shipped_from_the_dashboard" });
    expect(view.tier).toBe("a_tier_shipped_from_the_dashboard");
  });

  it("reads an absent tier as free rather than as an empty string", () => {
    expect(toEntitlementView({ ...PAID, tier: "" }).tier).toBe("free");
  });

  it.each([null, "not a number", undefined])(
    "reads a non-numeric period end as absent (%j)",
    (value) => {
      const view = toEntitlementView({
        ...PAID,
        current_period_end: value,
      } as unknown as EntitlementResponse);
      expect(view.currentPeriodEnd).toBeNull();
    },
  );
});

describe("hasPortal", () => {
  it("offers no portal to an account that has never subscribed", () => {
    expect(hasPortal("none")).toBe(false);
  });

  it.each([
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "canceled",
    "incomplete",
    "incomplete_expired",
    "paused",
  ] as const)("offers the portal on %s, where a customer exists", (status) => {
    expect(hasPortal(status)).toBe(true);
  });
});

describe("loadBillingSnapshot", () => {
  it("returns the entitlement, the catalog in display order, and no error", async () => {
    const view = await loadBillingSnapshot(
      api({ entitlement: ok(PAID), plans: ok(FIXTURES.plan_catalog) }),
    );

    expect(view.signedIn).toBe(true);
    expect(view.error).toBeNull();
    expect(view.entitlement?.tier).toBe("advance");
    expect(view.portalAvailable).toBe(true);
    expect(view.plans.map((plan) => plan.lookup_key)).toEqual([
      "classic_monthly_cad",
      "advance_monthly_cad",
    ]);
  });

  it("sorts the catalog by the operator-controlled display order", async () => {
    const reversed = {
      ...FIXTURES.plan_catalog,
      plans: [...FIXTURES.plan_catalog.plans].reverse(),
    };
    const view = await loadBillingSnapshot(
      api({ entitlement: ok(FREE), plans: ok(reversed) }),
    );

    expect(view.plans.map((plan) => plan.display_order)).toEqual([1, 2]);
  });

  it("still shows the plans when the entitlement read is refused", async () => {
    const view = await loadBillingSnapshot(
      api({ entitlement: refused("unavailable"), plans: ok(FIXTURES.plan_catalog) }),
    );

    expect(view.entitlement).toBeNull();
    expect(view.portalAvailable).toBe(false);
    expect(view.error).toBe("unavailable");
    expect(view.plans).toHaveLength(2);
  });

  it("still shows the entitlement and the portal when the catalog read is refused", async () => {
    const view = await loadBillingSnapshot(
      api({ entitlement: ok(PAID), plans: refused("unavailable") }),
    );

    expect(view.plans).toEqual([]);
    expect(view.entitlement?.tier).toBe("advance");
    expect(view.portalAvailable).toBe(true);
    expect(view.error).toBeNull();
  });

  it("reports unavailable when the entitlement call could not be made at all", async () => {
    const view = await loadBillingSnapshot(
      api({
        entitlement: () => Promise.reject(new TypeError("fetch failed")),
        plans: ok(FIXTURES.plan_catalog),
      }),
    );

    expect(view.error).toBe("unavailable");
    expect(view.entitlement).toBeNull();
  });

  it("survives a catalog call that could not be made at all", async () => {
    const view = await loadBillingSnapshot(
      api({
        entitlement: ok(FREE),
        plans: () => Promise.reject(new TypeError("fetch failed")),
      }),
    );

    expect(view.plans).toEqual([]);
    expect(view.error).toBeNull();
  });

  it("carries a reauthentication refusal through as its own code", async () => {
    const view = await loadBillingSnapshot(
      api({
        entitlement: refused("reauthentication_required"),
        plans: ok(FIXTURES.plan_catalog),
      }),
    );

    expect(view.error).toBe("reauthentication_required");
  });
});
