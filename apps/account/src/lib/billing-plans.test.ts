import { describe, expect, it } from "vitest";
import type { PlanCatalogEntry } from "@nixus/shared";

import {
  CHECKOUT_POLL_ATTEMPTS,
  CHECKOUT_POLL_INTERVAL_MS,
  capabilityLabel,
  formatPeriodEnd,
  formatPlanAmount,
  formatPlanPrice,
  listPriceFor,
  resolvePlanDeepLink,
  statusLabel,
  tierDisplayName,
} from "./billing-plans.ts";
import { i18nForLocale } from "./i18n.ts";
import FIXTURES from "../../../../packages/shared/src/types/billing.fixtures.json" with {
  type: "json",
};

/*
 * billing AD-6, AD-8, AD-16.
 *
 * The deep link is the only request-supplied value on this page, so what it can
 * and cannot do is the whole point of the first block: an unknown key renders an
 * ordinary page, is never echoed, and never reaches the billing API.
 */

const PLANS = FIXTURES.plan_catalog.plans as readonly PlanCatalogEntry[];
const EN = i18nForLocale("en");
const FR = i18nForLocale("fr");

describe("resolvePlanDeepLink", () => {
  it("resolves a key the loaded catalog publishes", () => {
    expect(resolvePlanDeepLink(PLANS, "advance_monthly_cad")?.tier).toBe("advance");
    expect(resolvePlanDeepLink(PLANS, "classic_monthly_cad")?.tier).toBe("classic");
  });

  it("ignores a conventionally shaped key the catalog does not publish", () => {
    // Shape alone is not authority: a key may match the pattern and name no
    // Price, which is why membership of the live catalog is the second gate.
    expect(resolvePlanDeepLink(PLANS, "enterprise_monthly_usd")).toBeNull();
  });

  it.each([
    "Advance_Monthly_CAD",
    "advance monthly cad",
    "advance-monthly-cad",
    "advance_monthly_cad ",
    "../../etc/passwd",
    "<script>alert(1)</script>",
    "advance_monthly_cad&plan=classic_monthly_cad",
    "'; DROP TABLE plans; --",
    "a".repeat(65),
    "",
  ])("ignores the malformed key %j", (value) => {
    expect(resolvePlanDeepLink(PLANS, value)).toBeNull();
  });

  it.each([null, undefined, 0, {}, [], true, ["advance_monthly_cad"]])(
    "ignores the non-string value %j",
    (value) => {
      expect(resolvePlanDeepLink(PLANS, value)).toBeNull();
    },
  );

  it("ignores every key when the catalog could not be loaded", () => {
    expect(resolvePlanDeepLink([], "advance_monthly_cad")).toBeNull();
  });

  it("returns the catalog entry itself, so nothing request-supplied is forwarded", () => {
    const resolved = resolvePlanDeepLink(PLANS, "advance_monthly_cad");
    expect(resolved).toBe(PLANS[1]);
  });
});

describe("formatPlanPrice", () => {
  it("shows the catalog's own amount and currency, for display only", () => {
    const price = formatPlanPrice(PLANS[0]!, "en");
    expect(price).toContain("CAD");
    expect(price).toContain("9.99");
  });

  it("formats in the active locale", () => {
    expect(formatPlanPrice(PLANS[1]!, "fr")).toContain("19,99");
    expect(formatPlanPrice(PLANS[1]!, "en")).toContain("19.99");
  });
});

describe("formatPlanAmount", () => {
  it("shows the amount with the local symbol and no code", () => {
    expect(formatPlanAmount(PLANS[0]!, "en")).toBe("$9.99");
    expect(formatPlanAmount(PLANS[0]!, "en")).not.toContain("CAD");
    expect(formatPlanAmount(PLANS[1]!, "fr")).toContain("19,99");
  });
});

describe("listPriceFor", () => {
  it("finds the one catalog entry carrying a tier", () => {
    expect(listPriceFor(PLANS, "classic")?.lookup_key).toBe("classic_monthly_cad");
  });

  it("shows nothing for a tier the catalog does not list", () => {
    expect(listPriceFor(PLANS, "a_tier_shipped_from_the_dashboard")).toBeNull();
    expect(listPriceFor([], "classic")).toBeNull();
  });

  it("shows nothing when the tier has more than one price, since the paid one is unknown", () => {
    const classic = PLANS.find((plan) => plan.tier === "classic")!;
    const yearly = { ...classic, lookup_key: "classic_yearly_cad", interval: "year" as const };
    expect(listPriceFor([...PLANS, yearly], "classic")).toBeNull();
  });
});

describe("formatPeriodEnd", () => {
  it("renders the renewal date in the active locale", () => {
    expect(formatPeriodEnd(1796083200, "en")).toBe("December 1, 2026");
    expect(formatPeriodEnd(1796083200, "fr")).toBe("1 décembre 2026");
  });

  it("renders nothing for a free entitlement, which has no period", () => {
    expect(formatPeriodEnd(null, "en")).toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("renders nothing for %j", (value) => {
    expect(formatPeriodEnd(value, "en")).toBeNull();
  });
});

describe("tierDisplayName", () => {
  it.each(["classic", "advance", "free"])("names the known tier %s", (tier) => {
    expect(tierDisplayName(EN.t, tier)).not.toContain("billing.tier");
    expect(tierDisplayName(FR.t, tier)).not.toContain("billing.tier");
  });

  it("names the two tiers differently in both locales", () => {
    expect(tierDisplayName(EN.t, "classic")).not.toBe(tierDisplayName(EN.t, "advance"));
    expect(tierDisplayName(FR.t, "classic")).not.toBe(tierDisplayName(FR.t, "advance"));
  });

  /* Adding a tier is a Stripe Dashboard change with no deploy (AD-6), so a code
   * these files have never seen will arrive. The page must not break on it. */
  it.each(["a_tier_from_the_dashboard", "", "tier_with_underscores_only"])(
    "falls back to a neutral sentence for the unknown tier %j",
    (tier) => {
      expect(tierDisplayName(EN.t, tier)).toBe(EN.t("billing.tier.unknown"));
      expect(tierDisplayName(FR.t, tier)).toBe(FR.t("billing.tier.unknown"));
    },
  );

  it("never renders the raw Stripe metadata code as copy", () => {
    expect(tierDisplayName(EN.t, "a_tier_from_the_dashboard")).not.toContain(
      "a_tier_from_the_dashboard",
    );
  });
});

describe("capabilityLabel and statusLabel", () => {
  it.each(["hosted_ai", "household_net_worth", "multi_device_sync"] as const)(
    "labels the capability %s in both locales",
    (capability) => {
      expect(capabilityLabel(EN.t, capability)).not.toContain("billing.capability");
      expect(capabilityLabel(FR.t, capability)).not.toContain("billing.capability");
    },
  );

  it.each([
    "none",
    "active",
    "trialing",
    "past_due",
    "unpaid",
    "canceled",
    "incomplete",
    "incomplete_expired",
    "paused",
  ] as const)("labels the status %s in both locales", (status) => {
    expect(statusLabel(EN.t, status)).not.toContain("billing.status");
    expect(statusLabel(FR.t, status)).not.toContain("billing.status");
  });
});

describe("the /checkout/complete polling bounds", () => {
  /* Stripe returns the visitor before the webhook has converged (AD-5), so the
   * wait has to be bounded in code rather than left to a spinner. */
  it("waits at most twelve seconds in total", () => {
    expect(CHECKOUT_POLL_ATTEMPTS).toBe(6);
    expect(CHECKOUT_POLL_INTERVAL_MS).toBe(2_000);
    expect(CHECKOUT_POLL_ATTEMPTS * CHECKOUT_POLL_INTERVAL_MS).toBe(12_000);
  });
});
