import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetCatalogCacheForTesting } from "../lib/catalog.ts";
import { setStripeClientForTesting } from "../lib/stripe.ts";
import {
  FakeStripe,
  stripePrice,
  stripeProduct,
} from "../lib/testing/fake-stripe.ts";
import {
  TEST_CATALOG_TTL_SECONDS,
  clearBillingEnvironment,
  installBillingEnvironment,
} from "../lib/testing/fixtures.ts";
import { handlePlans } from "./plans.ts";

/*
 * `GET /plans` is public and carries NO user data: that is the property this
 * spec exists for, alongside AD-6's single cache bound reaching the response.
 */

const NOW = new Date("2026-11-18T12:00:00.000Z");
const REQUEST_ID = "req-plans";

let stripe: FakeStripe;

beforeEach(() => {
  installBillingEnvironment();
  resetCatalogCacheForTesting();
  stripe = new FakeStripe().seedPrices([
    stripePrice({
      id: "price_classic",
      lookupKey: "classic_monthly_cad",
      unitAmount: 999,
      product: stripeProduct({
        id: "prod_classic",
        metadata: {
          nixus_tier: "classic",
          nixus_capabilities: "multi_device_sync,household_net_worth",
        },
      }),
    }),
    stripePrice({
      id: "price_advance",
      lookupKey: "advance_monthly_cad",
      unitAmount: 1999,
      product: stripeProduct({
        id: "prod_advance",
        metadata: {
          nixus_tier: "advance",
          nixus_capabilities: "hosted_ai,multi_device_sync,household_net_worth",
          nixus_monthly_request_limit: "1000",
        },
      }),
    }),
  ]);
  setStripeClientForTesting(stripe.asStripe());
});

afterEach(() => {
  setStripeClientForTesting(undefined);
  resetCatalogCacheForTesting();
  clearBillingEnvironment();
});

describe("the public catalog response", () => {
  it("matches the contract's shape exactly, with the single cache bound", async () => {
    expect(await handlePlans({ now: NOW, requestId: REQUEST_ID })).toEqual({
      plans: [
        {
          tier: "classic",
          lookup_key: "classic_monthly_cad",
          unit_amount_cents: 999,
          currency: "CAD",
          interval: "month",
          display_order: 1,
          capabilities: ["household_net_worth", "multi_device_sync"],
          monthly_request_limit: null,
        },
        {
          tier: "advance",
          lookup_key: "advance_monthly_cad",
          unit_amount_cents: 1999,
          currency: "CAD",
          interval: "month",
          display_order: 2,
          capabilities: [
            "hosted_ai",
            "household_net_worth",
            "multi_device_sync",
          ],
          monthly_request_limit: 1000,
        },
      ],
      cache_ttl_seconds: TEST_CATALOG_TTL_SECONDS,
    });
  });

  it("carries no user data and no price id", async () => {
    const serialized = JSON.stringify(
      await handlePlans({ now: NOW, requestId: REQUEST_ID }),
    );

    expect(serialized).not.toContain("price_");
    expect(serialized).not.toContain("cus_");
    expect(serialized).not.toContain("sub_");
    expect(serialized).not.toContain("USER#");
  });

  /* An empty catalog is a correct, NON-failing answer: a pricing page hydrating
   * over it keeps its baked fallback copy (AD-6). */
  it("answers with no plans rather than failing when Stripe has none", async () => {
    stripe.seedPrices([]);
    resetCatalogCacheForTesting();

    expect(await handlePlans({ now: NOW, requestId: REQUEST_ID })).toEqual({
      plans: [],
      cache_ttl_seconds: TEST_CATALOG_TTL_SECONDS,
    });
  });

  /* The response's own TTL IS the cache bound the Cache-Control header derives
   * from: there is no second number anywhere. */
  it("reports the configured bound, whatever it is configured to", async () => {
    installBillingEnvironment({ CATALOG_CACHE_TTL_SECONDS: "1800" });
    resetCatalogCacheForTesting();

    expect(
      (await handlePlans({ now: NOW, requestId: REQUEST_ID })).cache_ttl_seconds,
    ).toBe(1800);
  });
});
