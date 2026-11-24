import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CATALOG_CAPABILITIES_METADATA_KEY,
  CATALOG_DISPLAY_ORDER_METADATA_KEY,
  CATALOG_MONTHLY_REQUEST_LIMIT_METADATA_KEY,
  CATALOG_TIER_METADATA_KEY,
  CATALOG_TRIAL_DAYS_METADATA_KEY,
  catalogCacheTtlSeconds,
  catalogLookupKeys,
  deriveProductGrant,
  expandedProductOf,
  getCatalog,
  planForLookupKey,
  resetCatalogCacheForTesting,
} from "./catalog.ts";
import { setCloudWatchClientForTesting } from "./metrics.ts";
import { setStripeClientForTesting } from "./stripe.ts";
import {
  FakeStripe,
  stripePrice,
  stripeProduct,
} from "./testing/fake-stripe.ts";
import {
  TEST_CATALOG_TTL_SECONDS,
  clearBillingEnvironment,
  installBillingEnvironment,
} from "./testing/fixtures.ts";

/*
 * AD-6: Stripe is the catalog, the metadata contract is the whole interface an
 * operator has, and the malformed case is DEFINED rather than discovered.
 */

const NOW = new Date("2026-11-18T12:00:00.000Z");
const REQUEST_ID = "req-catalog";

let stripe: FakeStripe;
let metrics: { readonly names: string[] };
let captured: string[];

function fakeCloudWatch(): { readonly names: string[] } {
  const names: string[] = [];
  setCloudWatchClientForTesting({
    async send(command: {
      input: { MetricData?: { MetricName?: string }[] };
    }): Promise<unknown> {
      for (const datum of command.input.MetricData ?? []) {
        if (datum.MetricName) names.push(datum.MetricName);
      }
      return {};
    },
  } as never);
  return { names };
}

function classicProduct(
  metadata: Readonly<Record<string, string>>,
): ReturnType<typeof stripeProduct> {
  return stripeProduct({ id: "prod_classic", metadata });
}

beforeEach(() => {
  installBillingEnvironment();
  resetCatalogCacheForTesting();
  metrics = fakeCloudWatch();
  stripe = new FakeStripe();
  setStripeClientForTesting(stripe.asStripe());

  captured = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    captured.push(args.map((arg) => String(arg)).join(" "));
  });
});

afterEach(() => {
  setStripeClientForTesting(undefined);
  setCloudWatchClientForTesting(undefined);
  resetCatalogCacheForTesting();
  vi.restoreAllMocks();
  clearBillingEnvironment();
});

describe("the published key set is configuration, not a list in a handler", () => {
  it("reads and trims the configured keys in order", () => {
    installBillingEnvironment({
      CATALOG_LOOKUP_KEYS: " classic_monthly_cad , advance_monthly_cad ",
    });
    expect(catalogLookupKeys()).toEqual([
      "classic_monthly_cad",
      "advance_monthly_cad",
    ]);
  });

  it.each([[""], ["   "], [","], ["Classic_Monthly"], ["classic monthly"]])(
    "refuses %s as a configured set",
    (value) => {
      installBillingEnvironment({ CATALOG_LOOKUP_KEYS: value });
      expect(() => catalogLookupKeys()).toThrow();
    },
  );

  /* `prices.list` accepts ten lookup keys per call and the catalog is read in
   * ONE call, so an eleventh key would silently drop a plan. */
  it("refuses more than ten keys", () => {
    installBillingEnvironment({
      CATALOG_LOOKUP_KEYS: Array.from(
        { length: 11 },
        (_, index) => `tier${index}_monthly_cad`,
      ).join(","),
    });
    expect(() => catalogLookupKeys()).toThrow();
  });

  it("never names the malformed value in the failure it throws", () => {
    installBillingEnvironment({ CATALOG_LOOKUP_KEYS: "NOT-A-KEY" });
    try {
      catalogLookupKeys();
      expect.unreachable("expected a configuration failure");
    } catch (error) {
      expect((error as Error).message).not.toContain("NOT-A-KEY");
    }
  });

  it("requires a positive integer cache bound", () => {
    expect(catalogCacheTtlSeconds()).toBe(TEST_CATALOG_TTL_SECONDS);
    for (const value of ["0", "-1", "abc", "1.5", ""]) {
      installBillingEnvironment({ CATALOG_CACHE_TTL_SECONDS: value });
      expect(() => catalogCacheTtlSeconds(), value).toThrow();
    }
  });
});

describe("the Product must be expanded, never cast away", () => {
  it("throws when the Price carries a bare product id", () => {
    expect(() =>
      expandedProductOf(
        stripePrice({ lookupKey: "classic_monthly_cad", product: "prod_x" }),
      ),
    ).toThrow("without its Product expanded");
  });

  it("returns the expanded Product", () => {
    const product = classicProduct({ nixus_tier: "classic" });
    expect(
      expandedProductOf(
        stripePrice({ lookupKey: "classic_monthly_cad", product }),
      ).id,
    ).toBe("prod_classic");
  });
});

describe("the metadata contract (AD-6)", () => {
  it("names the four keys a setup script must create", () => {
    expect(CATALOG_TIER_METADATA_KEY).toBe("nixus_tier");
    expect(CATALOG_CAPABILITIES_METADATA_KEY).toBe("nixus_capabilities");
    expect(CATALOG_MONTHLY_REQUEST_LIMIT_METADATA_KEY).toBe(
      "nixus_monthly_request_limit",
    );
    expect(CATALOG_DISPLAY_ORDER_METADATA_KEY).toBe("nixus_display_order");
  });

  /* The one key that lives on the PRICE: two Prices of one tier differ in it,
   * so it cannot be a Product key. */
  it("names the price-level trial key", () => {
    expect(CATALOG_TRIAL_DAYS_METADATA_KEY).toBe("nixus_trial_days");
  });

  it("derives the tier, the capability list and the limit from metadata", () => {
    expect(
      deriveProductGrant({
        requestId: REQUEST_ID,
        product: classicProduct({
          nixus_tier: "advance",
          nixus_capabilities: "hosted_ai, multi_device_sync",
          nixus_monthly_request_limit: "1000",
          nixus_display_order: "2",
        }),
      }),
    ).toEqual({
      tier: "advance",
      capabilities: ["hosted_ai", "multi_device_sync"],
      monthlyRequestLimit: 1000,
      displayOrder: 2,
      malformed: false,
    });
    expect(metrics.names).toEqual([]);
  });

  /* An operator's typo must not fail a paying customer's webhook, so an
   * unrecognised name is DROPPED with a warning and never reaches an
   * entitlement. */
  it("drops an unknown capability name and logs it", () => {
    const grant = deriveProductGrant({
      requestId: REQUEST_ID,
      product: classicProduct({
        nixus_tier: "classic",
        nixus_capabilities: "multi_device_sync,househould_net_worth",
      }),
    });

    expect(grant.capabilities).toEqual(["multi_device_sync"]);
    expect(grant.malformed).toBe(false);
    expect(captured.join("\n")).toContain("househould_net_worth");
    expect(captured.join("\n")).toContain("billing_capability_dropped");
    expect(metrics.names).toEqual([]);
  });

  /* THE malformed case. A metadata typo never grants a capability, and never
   * silently revokes one from a paying customer without raising an alert. */
  it.each([
    ["an absent tier", { nixus_capabilities: "hosted_ai" }],
    ["an empty tier", { nixus_tier: "  ", nixus_capabilities: "hosted_ai" }],
    [
      "an unparseable tier",
      { nixus_tier: "Classic Tier!", nixus_capabilities: "hosted_ai" },
    ],
    ["absent capabilities", { nixus_tier: "classic" }],
    ["empty capabilities", { nixus_tier: "classic", nixus_capabilities: " " }],
    [
      "capabilities none of which parse",
      { nixus_tier: "classic", nixus_capabilities: "nope,also_nope" },
    ],
    [
      "an unparseable limit",
      {
        nixus_tier: "advance",
        nixus_capabilities: "hosted_ai",
        nixus_monthly_request_limit: "lots",
      },
    ],
    [
      "an unparseable display order",
      {
        nixus_tier: "advance",
        nixus_capabilities: "hosted_ai",
        nixus_display_order: "second",
      },
    ],
  ])("grants nothing and alarms on %s", (_label, metadata) => {
    const grant = deriveProductGrant({
      requestId: REQUEST_ID,
      product: classicProduct(metadata),
    });

    expect(grant.malformed).toBe(true);
    expect(grant.capabilities).toEqual([]);
    expect(grant.monthlyRequestLimit).toBeNull();
    expect(metrics.names).toEqual(["CatalogMetadataMalformed"]);
  });

  /* An absent limit is NOT malformed: a tier legitimately has no AI quota, which
   * is exactly what Classic is. */
  it("treats an absent limit as no limit rather than as malformed", () => {
    const grant = deriveProductGrant({
      requestId: REQUEST_ID,
      product: classicProduct({
        nixus_tier: "classic",
        nixus_capabilities: "multi_device_sync",
      }),
    });

    expect(grant.malformed).toBe(false);
    expect(grant.monthlyRequestLimit).toBeNull();
    expect(metrics.names).toEqual([]);
  });
});

describe("the public catalog", () => {
  const CLASSIC = classicProduct({
    nixus_tier: "classic",
    nixus_capabilities: "multi_device_sync,household_net_worth",
  });
  const ADVANCE = stripeProduct({
    id: "prod_advance",
    metadata: {
      nixus_tier: "advance",
      nixus_capabilities: "hosted_ai,multi_device_sync,household_net_worth",
      nixus_monthly_request_limit: "1000",
    },
  });

  function seedBoth(): void {
    stripe.seedPrices([
      stripePrice({
        id: "price_advance",
        lookupKey: "advance_monthly_cad",
        unitAmount: 1999,
        product: ADVANCE,
      }),
      stripePrice({
        id: "price_classic",
        lookupKey: "classic_monthly_cad",
        unitAmount: 999,
        product: CLASSIC,
      }),
    ]);
  }

  it("reads by plural lookup_keys with the product expanded", async () => {
    seedBoth();
    await getCatalog({ now: NOW, requestId: REQUEST_ID });

    expect(stripe.paramsOf("prices.list")).toEqual({
      lookup_keys: ["classic_monthly_cad", "advance_monthly_cad"],
      expand: ["data.product"],
      active: true,
    });
  });

  it("publishes no price_id and an uppercase currency", async () => {
    seedBoth();
    const catalog = await getCatalog({ now: NOW, requestId: REQUEST_ID });

    expect(catalog.plans).toHaveLength(2);
    for (const plan of catalog.plans) {
      expect(plan.entry).not.toHaveProperty("price_id");
      expect(plan.entry.currency).toBe("CAD");
      expect(JSON.stringify(plan.entry)).not.toContain("price_");
    }
    // The id is held internally, because checkout needs it to open a session.
    expect(catalog.plans.map((plan) => plan.priceId).sort()).toEqual([
      "price_advance",
      "price_classic",
    ]);
  });

  /* `display_order` falls back to the POSITION in the configured key list, so
   * the configured order is the default and the Dashboard is the override. */
  it("orders by the configured key list when no metadata order is set", async () => {
    seedBoth();
    const catalog = await getCatalog({ now: NOW, requestId: REQUEST_ID });

    expect(
      catalog.plans.map((plan) => [
        plan.entry.lookup_key,
        plan.entry.display_order,
      ]),
    ).toEqual([
      ["classic_monthly_cad", 1],
      ["advance_monthly_cad", 2],
    ]);
  });

  it("lets Product metadata override the configured order", async () => {
    stripe.seedPrices([
      stripePrice({
        lookupKey: "classic_monthly_cad",
        product: classicProduct({
          nixus_tier: "classic",
          nixus_capabilities: "multi_device_sync",
          nixus_display_order: "9",
        }),
      }),
      stripePrice({
        id: "price_advance",
        lookupKey: "advance_monthly_cad",
        product: ADVANCE,
      }),
    ]);

    const catalog = await getCatalog({ now: NOW, requestId: REQUEST_ID });
    expect(catalog.plans.map((plan) => plan.entry.display_order)).toEqual([
      2, 9,
    ]);
  });

  /* A Product with no usable tier identity cannot be displayed or purchased, so
   * it is not published - and the alarm has already fired. */
  it("omits a malformed Product from the catalog and alarms", async () => {
    stripe.seedPrices([
      stripePrice({
        lookupKey: "classic_monthly_cad",
        product: classicProduct({ nixus_capabilities: "multi_device_sync" }),
      }),
    ]);

    const catalog = await getCatalog({ now: NOW, requestId: REQUEST_ID });
    expect(catalog.plans).toEqual([]);
    expect(metrics.names).toEqual(["CatalogMetadataMalformed"]);
  });

  it.each([
    ["no lookup key", { lookupKey: null }],
    ["no unit amount", { unitAmount: null }],
    ["a non-recurring price", { interval: null }],
    ["an interval the contract does not declare", { interval: "week" }],
    ["an inactive price", { active: false }],
  ])("omits a price with %s", async (_label, overrides) => {
    stripe.seedPrices([
      stripePrice({
        lookupKey: "classic_monthly_cad",
        product: CLASSIC,
        ...overrides,
      }),
    ]);

    expect(
      (await getCatalog({ now: NOW, requestId: REQUEST_ID })).plans,
    ).toEqual([]);
  });

  it("resolves a published key and refuses one it does not publish", async () => {
    seedBoth();
    const catalog = await getCatalog({ now: NOW, requestId: REQUEST_ID });

    expect(planForLookupKey(catalog, "classic_monthly_cad")?.priceId).toBe(
      "price_classic",
    );
    expect(planForLookupKey(catalog, "privilege_monthly_cad")).toBeNull();
  });
});

/*
 * The trial Price. Checkout honours a trial only when the SESSION asks for one,
 * so the length has to be published for the session to be able to carry it -
 * and for a surface to tell a trial Price apart from a second full-price Price
 * on the same tier.
 */
describe("a Price sold with a free trial", () => {
  const ADVANCE = stripeProduct({
    id: "prod_advance",
    metadata: {
      nixus_tier: "advance",
      nixus_capabilities: "hosted_ai,multi_device_sync,household_net_worth",
      nixus_monthly_request_limit: "1000",
    },
  });

  function seedTrial(trialDays: string | undefined): void {
    installBillingEnvironment({
      CATALOG_LOOKUP_KEYS: "advance_monthly_cad,advance_trial",
    });
    resetCatalogCacheForTesting();
    stripe.seedPrices([
      stripePrice({
        id: "price_advance",
        lookupKey: "advance_monthly_cad",
        unitAmount: 1999,
        product: ADVANCE,
      }),
      stripePrice({
        id: "price_advance_trial",
        lookupKey: "advance_trial",
        unitAmount: 1999,
        product: ADVANCE,
        metadata: trialDays === undefined ? {} : { nixus_trial_days: trialDays },
      }),
    ]);
  }

  it("publishes the trial length from the Price's own metadata", async () => {
    seedTrial("7");
    const catalog = await getCatalog({ now: NOW, requestId: REQUEST_ID });

    expect(
      catalog.plans.map((plan) => [
        plan.entry.lookup_key,
        plan.entry.trial_period_days,
      ]),
    ).toEqual([
      ["advance_monthly_cad", null],
      ["advance_trial", 7],
    ]);
    // The trial Price is an ordinary entry otherwise: same tier, same grant and
    // the same amount it converts to.
    const trial = planForLookupKey(catalog, "advance_trial")!;
    expect(trial.entry.tier).toBe("advance");
    expect(trial.entry.capabilities).toEqual([
      "hosted_ai",
      "household_net_worth",
      "multi_device_sync",
    ]);
    expect(metrics.names).toEqual([]);
  });

  it("publishes null for a Price with no trial metadata", async () => {
    seedTrial(undefined);
    const catalog = await getCatalog({ now: NOW, requestId: REQUEST_ID });

    expect(planForLookupKey(catalog, "advance_trial")?.entry.trial_period_days)
      .toBeNull();
    expect(metrics.names).toEqual([]);
  });

  /* A Price advertised as a trial that Checkout would open at FULL PRICE is the
   * one outcome a customer would call fraud, so an unparseable length refuses
   * the Price outright and alarms rather than degrading to a sale. */
  it.each([["0"], ["-7"], ["7.5"], ["a week"], ["731"]])(
    "refuses the Price and alarms on the trial length %j",
    async (value) => {
      seedTrial(value);
      const catalog = await getCatalog({ now: NOW, requestId: REQUEST_ID });

      expect(catalog.plans.map((plan) => plan.entry.lookup_key)).toEqual([
        "advance_monthly_cad",
      ]);
      expect(planForLookupKey(catalog, "advance_trial")).toBeNull();
      expect(metrics.names).toEqual(["CatalogMetadataMalformed"]);
    },
  );
});

describe("ONE cache, bounded by ONE TTL (AD-6)", () => {
  it("serves a second read from the cache inside the TTL", async () => {
    stripe.seedPrices([]);

    await getCatalog({ now: NOW, requestId: REQUEST_ID });
    await getCatalog({
      now: new Date(NOW.getTime() + (TEST_CATALOG_TTL_SECONDS - 1) * 1000),
      requestId: REQUEST_ID,
    });

    expect(stripe.countOf("prices.list")).toBe(1);
  });

  /* The TTL is the ONLY bound: nothing else shortens or extends it, so the
   * advertised-versus-charged drift window is exactly this value. */
  it("re-reads once the TTL has elapsed", async () => {
    stripe.seedPrices([]);

    await getCatalog({ now: NOW, requestId: REQUEST_ID });
    await getCatalog({
      now: new Date(NOW.getTime() + TEST_CATALOG_TTL_SECONDS * 1000 + 1),
      requestId: REQUEST_ID,
    });

    expect(stripe.countOf("prices.list")).toBe(2);
  });

  it("honours a reconfigured bound rather than a baked one", async () => {
    installBillingEnvironment({ CATALOG_CACHE_TTL_SECONDS: "30" });
    stripe.seedPrices([]);

    const catalog = await getCatalog({ now: NOW, requestId: REQUEST_ID });
    expect(catalog.cacheTtlSeconds).toBe(30);

    await getCatalog({
      now: new Date(NOW.getTime() + 31_000),
      requestId: REQUEST_ID,
    });
    expect(stripe.countOf("prices.list")).toBe(2);
  });
});
