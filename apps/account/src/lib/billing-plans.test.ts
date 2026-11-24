import { describe, expect, it } from "vitest";
import type { PlanCatalogEntry } from "@nixus/shared";

import {
  CHECKOUT_POLL_ATTEMPTS,
  CHECKOUT_POLL_INTERVAL_MS,
  capabilityLabel,
  formatPeriodEnd,
  formatPlanAmount,
  formatPlanPrice,
  groupPlansByTier,
  listPriceFor,
  resolvePlanDeepLink,
  statusLabel,
  tierDisplayName,
  trialOffer,
  trialPlanForTier,
  yearlySavings,
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

  /* The marketing site's trial CTA links to `?plan=advance_trial`, so the deep
   * link has to resolve a trial Price exactly like any other published one. */
  it("resolves the trial Price the pricing page links to", () => {
    const trial = resolvePlanDeepLink(PLANS, "advance_trial");
    expect(trial?.tier).toBe("advance");
    expect(trial?.trial_period_days).toBe(7);
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

  /* A trial Price names the amount it converts to, so it is not a second list
   * price: counting it would turn a knowable amount into "more than one". */
  it("ignores a tier's trial Price when deciding the list price", () => {
    expect(listPriceFor(PLANS, "advance")?.lookup_key).toBe("advance_monthly_cad");
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

describe("groupPlansByTier and yearlySavings", () => {
  const entry = (
    tier: string,
    interval: "month" | "year",
    cents: number,
    order: number,
    currency = "CAD",
  ): PlanCatalogEntry => ({
    ...PLANS[0]!,
    tier,
    lookup_key: `${tier}_${interval}ly_${currency.toLowerCase()}`,
    interval,
    unit_amount_cents: cents,
    display_order: order,
    currency,
  });

  const CATALOG = [
    entry("advance", "year", 12999, 2),
    entry("classic", "month", 999, 1),
    entry("advance", "month", 1999, 2),
    entry("classic", "year", 9999, 1),
  ];

  it("pairs each tier's monthly and yearly price, in display order", () => {
    const tiers = groupPlansByTier(CATALOG);
    expect(tiers.map((tier) => tier.tier)).toEqual(["classic", "advance"]);
    expect(tiers[0]?.monthly?.unit_amount_cents).toBe(999);
    expect(tiers[0]?.yearly?.unit_amount_cents).toBe(9999);
  });

  it("leaves the missing interval null for a tier priced one way only", () => {
    const [only] = groupPlansByTier([entry("classic", "month", 999, 1)]);
    expect(only?.yearly).toBeNull();
    expect(yearlySavings(only!)).toBeNull();
  });

  it("measures the yearly saving against twelve monthly payments", () => {
    const [classic, advance] = groupPlansByTier(CATALOG);
    expect(yearlySavings(classic!)).toEqual({
      yearOfMonthlyCents: 11988,
      savedCents: 1989,
      percent: 17,
    });
    expect(yearlySavings(advance!)?.savedCents).toBe(10989);
    expect(yearlySavings(advance!)?.percent).toBe(46);
  });

  it("claims no saving when yearly is not cheaper or the currencies differ", () => {
    const dearer = groupPlansByTier([entry("t", "month", 100, 1), entry("t", "year", 1200, 1)]);
    expect(yearlySavings(dearer[0]!)).toBeNull();
    const mixed = groupPlansByTier([
      entry("t", "month", 1000, 1),
      entry("t", "year", 5000, 1, "USD"),
    ]);
    expect(yearlySavings(mixed[0]!)).toBeNull();
  });
});

/*
 * The trial Price. It names the same tier, the same interval and the same
 * amount as the plan it leads into, so leaving it in the tier grouping would
 * show one plan twice at one price — the confusing duplicate, not an offer.
 */
describe("trial prices in the plan list", () => {
  it("keeps the trial Price out of the monthly/yearly grouping", () => {
    const tiers = groupPlansByTier(PLANS);
    expect(tiers.map((tier) => tier.tier)).toEqual(["classic", "advance"]);
    // The ordinary monthly Price, not the trial, is what the Advance row shows.
    expect(tiers[1]?.monthly?.lookup_key).toBe("advance_monthly_cad");
    expect(tiers[1]?.yearly).toBeNull();
  });

  it("offers the tier's trial Price separately", () => {
    expect(trialPlanForTier(PLANS, "advance")?.lookup_key).toBe("advance_trial");
    expect(trialPlanForTier(PLANS, "advance")?.trial_period_days).toBe(7);
  });

  it("offers nothing for a tier with no trial Price, and nothing on an empty catalog", () => {
    expect(trialPlanForTier(PLANS, "classic")).toBeNull();
    expect(trialPlanForTier([], "advance")).toBeNull();
  });

  /* `trial_period_days: 0` is not a trial. The contract says absent is `null`,
   * but a zero arriving from a newer server must not render "0 days free". */
  it("treats a zero-day trial as no trial", () => {
    const zeroed = PLANS.map((plan) =>
      plan.lookup_key === "advance_trial" ? { ...plan, trial_period_days: 0 } : plan,
    );
    expect(trialPlanForTier(zeroed, "advance")).toBeNull();
    expect(groupPlansByTier(zeroed)).toHaveLength(2);
  });
});

/*
 * The headline free-trial card, for an account with no subscription.
 *
 * Before this, the trial was reachable only from the Advance MONTHLY row of the
 * plan list, and the interval toggle defaulted to Yearly — so an account that
 * had never paid never saw the one offer the page most wanted to make. The
 * visibility rules live in `trialOffer` so they can be proved here, without a
 * DOM, in the four shapes that actually occur.
 */
describe("trialOffer", () => {
  const ELIGIBLE = {
    plans: PLANS,
    trialEligible: true,
    subscriptionLive: false,
    status: "none" as const,
  };

  it("offers the catalog's trial Price to an account that has never subscribed", () => {
    const offer = trialOffer(ELIGIBLE);
    expect(offer?.lookup_key).toBe("advance_trial");
    // The length and the amount are read off this entry, never written into the
    // page: a trial retuned in the Stripe Dashboard needs no deploy.
    expect(offer?.trial_period_days).toBe(7);
    expect(offer?.unit_amount_cents).toBe(1999);
    expect(offer?.tier).toBe("advance");
  });

  it("offers nothing to an account that has, or has had, a subscription", () => {
    expect(trialOffer({ ...ELIGIBLE, trialEligible: false })).toBeNull();
  });

  it("offers nothing while a subscription is live", () => {
    expect(trialOffer({ ...ELIGIBLE, subscriptionLive: true })).toBeNull();
  });

  /* Belt and braces: `trialEligible` is already false for an account Stripe has
   * converged, so this can only fire if eligibility is ever widened. Offering a
   * trial to someone already on one would be the worst version of that bug. */
  it("offers nothing to an account already on a trial", () => {
    expect(trialOffer({ ...ELIGIBLE, status: "trialing" })).toBeNull();
  });

  it.each(["active", "past_due", "canceled", "unpaid", "paused"] as const)(
    "offers nothing on the status %s once eligibility is gone",
    (status) => {
      expect(trialOffer({ ...ELIGIBLE, trialEligible: false, status })).toBeNull();
    },
  );

  it("offers nothing when the catalog publishes no trial Price", () => {
    const noTrial = PLANS.filter((plan) => plan.lookup_key !== "advance_trial");
    expect(trialOffer({ ...ELIGIBLE, plans: noTrial })).toBeNull();
    expect(trialOffer({ ...ELIGIBLE, plans: [] })).toBeNull();
  });

  /* `trial_period_days: 0` is not a trial, so it must not render a card
   * offering "0 days free" either. */
  it("offers nothing for a zero-day trial", () => {
    const zeroed = PLANS.map((plan) =>
      plan.lookup_key === "advance_trial" ? { ...plan, trial_period_days: 0 } : plan,
    );
    expect(trialOffer({ ...ELIGIBLE, plans: zeroed })).toBeNull();
  });

  /* The tier is read off the entry, never assumed (AD-1): a trial published on
   * a tier these locale files have never seen must still be offered. */
  it("offers a trial on a tier it cannot name", () => {
    const dashboard = PLANS.map((plan) =>
      plan.lookup_key === "advance_trial"
        ? { ...plan, tier: "a_tier_shipped_from_the_dashboard" }
        : plan,
    );
    const offer = trialOffer({ ...ELIGIBLE, plans: dashboard });
    expect(offer?.tier).toBe("a_tier_shipped_from_the_dashboard");
    expect(tierDisplayName(EN.t, offer!.tier)).toBe(EN.t("billing.tier.unknown"));
  });

  /* The offered Price is monthly, which is what the interval toggle now
   * defaults to when a trial is on offer — otherwise the Yearly default hides
   * the trial row behind a tab the visitor has no reason to open. */
  it("offers a monthly Price, which is the interval the toggle must open on", () => {
    expect(trialOffer(ELIGIBLE)?.interval).toBe("month");
  });
});

/*
 * The trial disclosure. A trial that converts to a charge has to state the
 * price after it, that it renews on its own, that a card is taken now, and how
 * to stop it — in both locales, with the length interpolated from the catalog
 * rather than written into the sentence.
 */
describe("trial copy", () => {
  const ARGS = { count: 7, amount: "$19.99", interval: "/ month" };

  it.each([
    ["en", EN],
    ["fr", FR],
  ])("interpolates the catalog's trial length in %s", (_locale, i18n) => {
    for (const key of ["billing.startTrial", "billing.trialBadge", "billing.trialTerms"]) {
      const text = i18n.t(key, ARGS);
      expect(text, key).not.toContain(key);
      expect(text, key).not.toContain("{{");
      expect(text, key).toContain("7");
    }
  });

  /* The headline card's own copy. The tier name is interpolated rather than
   * written in, because the trial is published on whichever tier the Dashboard
   * put it on — including one these files cannot name. */
  it.each([
    ["en", EN],
    ["fr", FR],
  ])("names the plan and the trial length in the offer title in %s", (_locale, i18n) => {
    const title = i18n.t("billing.trialOfferTitle", { count: 7, plan: "Advance" });
    expect(title).not.toContain("{{");
    expect(title).not.toContain("billing.trialOfferTitle");
    expect(title).toContain("7");
    expect(title).toContain("Advance");
    expect(title).toContain("Nixus Cloud");

    const includes = i18n.t("billing.trialOfferIncludes");
    expect(includes).not.toContain("billing.trialOfferIncludes");
    expect(includes).not.toContain("{{");
  });

  it("asks for the trial in French with the established wording", () => {
    expect(FR.t("billing.trialOfferTitle", { count: 7, plan: "Advance" })).toContain(
      "essai gratuit de 7 jours",
    );
    expect(FR.t("billing.startTrial", ARGS)).toContain("essai gratuit de 7 jours");
  });

  it("states the price after the trial, the card and the way out", () => {
    const en = EN.t("billing.trialTerms", ARGS);
    expect(en).toContain("$19.99");
    expect(en).toMatch(/card is required/i);
    expect(en).toMatch(/cancel/i);
    expect(en).toMatch(/will not be charged/i);

    const fr = FR.t("billing.trialTerms", ARGS);
    expect(fr).toContain("$19.99");
    expect(fr).toMatch(/carte est exigée/i);
    expect(fr).toMatch(/[Aa]nnulez/);
  });

  it("says a trial continues automatically rather than just ending", () => {
    for (const i18n of [EN, FR]) {
      const dated = i18n.t("billing.trialNoticeDated", { date: "1 December 2026" });
      expect(dated).toContain("1 December 2026");
      expect(dated).not.toContain("{{");
      expect(i18n.t("billing.trialNotice")).not.toContain("{{");
    }
    expect(EN.t("billing.trialNotice")).toMatch(/continues automatically/i);
    expect(FR.t("billing.trialNotice")).toMatch(/automatiquement/i);
  });
});
