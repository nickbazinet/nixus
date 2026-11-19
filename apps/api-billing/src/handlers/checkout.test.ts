import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

import { resetCatalogCacheForTesting } from "../lib/catalog.ts";
import { BillingFailureError } from "../lib/errors.ts";
import {
  resetStripeSecretsForTesting,
  setSsmClientForTesting,
  setStripeClientForTesting,
} from "../lib/stripe.ts";
import { FakeDynamo } from "../lib/testing/fake-dynamo.ts";
import {
  FakeStripe,
  stripePrice,
  stripeProduct,
} from "../lib/testing/fake-stripe.ts";
import {
  SUB_A,
  TEST_ACCOUNT_APP_ORIGIN,
  clearBillingEnvironment,
  fakeSecretsSsmClient,
  installBillingEnvironment,
} from "../lib/testing/fixtures.ts";
import { setDocumentClientForTesting } from "../lib/table.ts";
import {
  CHECKOUT_LOCK_TTL_SECONDS,
  checkoutSessionParams,
  handleCheckout,
} from "./checkout.ts";

/*
 * AD-8, AD-18 and AD-16's checkout-integrity block: two concurrent attempts
 * cannot produce two live subscriptions; a live subscriber is routed to the
 * portal; an invalid promotion code returns `promotion_invalid` and is never
 * echoed; and the parameter set carries NONE of the keys Managed Payments
 * forbids.
 */

const NOW = new Date("2026-11-18T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const REQUEST_ID = "req-checkout";
const SESSION_URL = "https://checkout.stripe.com/c/pay/cs_test_a1b2c3";

const CLASSIC = stripeProduct({
  id: "prod_classic",
  metadata: {
    nixus_tier: "classic",
    nixus_capabilities: "multi_device_sync,household_net_worth",
  },
});

let dynamo: FakeDynamo;
let stripe: FakeStripe;
let captured: string[];

function partitionKey(sub: string): string {
  return `USER#${sub}`;
}

function customerRecord(sub: string): Record<string, unknown> | undefined {
  return dynamo.stored(partitionKey(sub), "BILLING_CUSTOMER");
}

function call(args: {
  readonly planLookupKey?: string;
  readonly promotionCode?: string | null;
} = {}) {
  return handleCheckout({
    sub: SUB_A,
    request: {
      planLookupKey: args.planLookupKey ?? "classic_monthly_cad",
      promotionCode: args.promotionCode ?? null,
    },
    now: NOW,
    requestId: REQUEST_ID,
  });
}

async function failureOf(promise: Promise<unknown>): Promise<BillingFailureError> {
  try {
    await promise;
    expect.unreachable("expected a billing failure");
  } catch (error) {
    if (error instanceof BillingFailureError) return error;
    throw error;
  }
}

beforeEach(() => {
  installBillingEnvironment();
  dynamo = new FakeDynamo();
  setDocumentClientForTesting(dynamo.asDocumentClient());
  setSsmClientForTesting(fakeSecretsSsmClient());

  stripe = new FakeStripe()
    .seedPrices([
      stripePrice({
        id: "price_classic",
        lookupKey: "classic_monthly_cad",
        product: CLASSIC,
      }),
    ])
    .seedSessionUrl(SESSION_URL)
    .seedCreatedCustomerId("cus_created");
  setStripeClientForTesting(stripe.asStripe());

  captured = [];
  const capture = (...args: unknown[]) => {
    captured.push(args.map((arg) => String(arg)).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);

  resetStripeSecretsForTesting();
  resetCatalogCacheForTesting();
});

afterEach(() => {
  setDocumentClientForTesting(undefined);
  setSsmClientForTesting(undefined);
  setStripeClientForTesting(undefined);
  resetStripeSecretsForTesting();
  resetCatalogCacheForTesting();
  vi.restoreAllMocks();
  clearBillingEnvironment();
});

describe("the catalog is the authority on what may be bought (AD-8)", () => {
  it("opens a session for a key the catalog publishes", async () => {
    expect(await call()).toEqual({ url: SESSION_URL, destination: "checkout" });
    expect(stripe.countOf("checkout.sessions.create")).toBe(1);
  });

  /* Validated against the CURRENT catalog BEFORE Stripe is called: a key the
   * catalog does not publish never reaches a session. */
  it("refuses a key the catalog does not publish, without echoing it", async () => {
    const failure = await failureOf(call({ planLookupKey: "privilege_yearly_usd" }));

    expect(failure.failure).toEqual({
      code: "validation",
      field: "plan_lookup_key",
      reason: "not_allowed",
    });
    expect(failure.message).not.toContain("privilege_yearly_usd");
    expect(captured.join("\n")).not.toContain("privilege_yearly_usd");
    expect(stripe.countOf("checkout.sessions.create")).toBe(0);
  });

  it("refuses a key whose Product metadata is malformed", async () => {
    stripe.seedPrices([
      stripePrice({
        lookupKey: "classic_monthly_cad",
        product: stripeProduct({ metadata: { nixus_capabilities: "hosted_ai" } }),
      }),
    ]);
    resetCatalogCacheForTesting();

    expect((await failureOf(call())).failure).toMatchObject({
      field: "plan_lookup_key",
      reason: "not_allowed",
    });
  });
});

describe("AD-18: the Stripe customer is created at most once per sub", () => {
  it("creates it under an idempotency key derived from the sub", async () => {
    await call();

    expect(stripe.optionsOf("customers.create")).toEqual({
      idempotencyKey: `nixus-billing-customer-${SUB_A}`,
    });
    expect(stripe.paramsOf("customers.create")).toEqual({
      metadata: { nixus_sub: SUB_A },
    });
  });

  /* `customers.search` is NOT read-after-write consistent, so it can report "no
   * customer" for one that exists. Our own record is the index. */
  it("never uses customer search to decide whether a customer exists", async () => {
    await call();
    expect(
      stripe.calls.map((entry) => entry.method).filter((m) => m.includes("search")),
    ).toEqual([]);
  });

  it("reuses a recorded customer rather than creating a second one", async () => {
    dynamo.seed({
      ...{ pk: partitionKey(SUB_A), sk: "BILLING_CUSTOMER" },
      stripe_customer_id: "cus_existing",
    });

    await call();

    expect(stripe.countOf("customers.create")).toBe(0);
    expect(
      (stripe.paramsOf("checkout.sessions.create") as { customer: string })
        .customer,
    ).toBe("cus_existing");
  });

  /* Recorded BEFORE the session URL is returned, so a webhook can always resolve
   * back to the account. */
  it("records the customer before the session URL is returned", async () => {
    await call();

    expect(customerRecord(SUB_A)).toMatchObject({
      stripe_customer_id: "cus_created",
      price_lookup_key: "classic_monthly_cad",
    });

    const recordWrite = dynamo.sent.findIndex((entry) => entry.kind === "Put");
    const sessionCall = stripe.calls.findIndex(
      (entry) => entry.method === "checkout.sessions.create",
    );
    expect(recordWrite).toBeGreaterThanOrEqual(0);
    expect(sessionCall).toBeGreaterThanOrEqual(0);
  });
});

describe("AD-16: two concurrent attempts cannot produce two subscriptions", () => {
  it("answers the second concurrent attempt with checkout_in_progress", async () => {
    const [first, second] = await Promise.allSettled([call(), call()]);

    const outcomes = [first, second];
    const fulfilled = outcomes.filter((entry) => entry.status === "fulfilled");
    const rejected = outcomes.filter((entry) => entry.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(
      (
        (rejected[0] as PromiseRejectedResult).reason as BillingFailureError
      ).failure.code,
    ).toBe("checkout_in_progress");

    // ONE session, and ONE customer: the idempotency key guarantees the second.
    expect(stripe.countOf("checkout.sessions.create")).toBe(1);
    expect(
      new Set(
        stripe.calls
          .filter((entry) => entry.method === "customers.create")
          .map((entry) => JSON.stringify(entry.options)),
      ).size,
    ).toBeLessThanOrEqual(1);
  });

  it("refuses a second attempt while the lock is live", async () => {
    await call();
    expect((await failureOf(call())).failure.code).toBe("checkout_in_progress");
  });

  /* A LAPSING timestamp rather than a flag, so a crashed request cannot hold an
   * account forever. */
  it("lets a new attempt through once the lock has lapsed", async () => {
    await call();

    const later = new Date(NOW.getTime() + (CHECKOUT_LOCK_TTL_SECONDS + 1) * 1000);
    const response = await handleCheckout({
      sub: SUB_A,
      request: { planLookupKey: "classic_monthly_cad", promotionCode: null },
      now: later,
      requestId: REQUEST_ID,
    });

    expect(response.destination).toBe("checkout");
    expect(CHECKOUT_LOCK_TTL_SECONDS).toBe(300);
  });

  it("stores the lock as the second at which it lapses", async () => {
    await call();
    expect(customerRecord(SUB_A)!.checkout_lock).toBe(
      NOW_SECONDS + CHECKOUT_LOCK_TTL_SECONDS,
    );
  });
});

describe("AD-18: a live subscriber is routed to the portal", () => {
  function seedLiveEntitlement(status: string): void {
    dynamo
      .seed({
        pk: partitionKey(SUB_A),
        sk: "ENTITLEMENT",
        tier: "classic",
        capabilities: ["multi_device_sync"],
        status,
        source: "stripe",
        statement: "NXS1.a.b",
        version: 3,
      })
      .seed({
        pk: partitionKey(SUB_A),
        sk: "BILLING_CUSTOMER",
        stripe_customer_id: "cus_existing",
      });
  }

  it.each([["active"], ["trialing"], ["past_due"]])(
    "routes a %s subscriber to the portal, never to a second session",
    async (status) => {
      seedLiveEntitlement(status);
      const response = await call();

      expect(response).toEqual({
        url: "https://billing.stripe.com/p/session/test",
        destination: "portal",
      });
      expect(stripe.countOf("checkout.sessions.create")).toBe(0);
      // No lock either: nothing is being created.
      expect(dynamo.puts).toHaveLength(0);
    },
  );

  it.each([["canceled"], ["unpaid"], ["incomplete"], ["none"], ["paused"]])(
    "lets a %s account open a new checkout",
    async (status) => {
      seedLiveEntitlement(status);
      expect((await call()).destination).toBe("checkout");
    },
  );

  // A live admin override pins the EFFECTIVE status to `none` (AD-2), so a gate
  // reading it handed an account that had already paid a second checkout session
  // per attempt, with no ceiling. Observed live, not reasoned about.
  it("routes an admin-overridden account whose Stripe state is live to the portal", async () => {
    dynamo
      .seed({
        pk: partitionKey(SUB_A),
        sk: "ENTITLEMENT",
        tier: "advance",
        capabilities: [
          "hosted_ai",
          "household_net_worth",
          "multi_device_sync",
        ],
        status: "none",
        source: "admin",
        admin_expires_at: NOW_SECONDS + 86_400,
        stripe_tier: "classic",
        stripe_capabilities: ["household_net_worth", "multi_device_sync"],
        stripe_status: "active",
        statement: "NXS1.a.b",
        version: 3,
      })
      .seed({
        pk: partitionKey(SUB_A),
        sk: "BILLING_CUSTOMER",
        stripe_customer_id: "cus_existing",
      });

    expect((await call()).destination).toBe("portal");
    expect(stripe.countOf("checkout.sessions.create")).toBe(0);
  });

  it("still lets an admin-overridden account with no Stripe state buy its first plan", async () => {
    dynamo.seed({
      pk: partitionKey(SUB_A),
      sk: "ENTITLEMENT",
      tier: "advance",
      capabilities: ["hosted_ai"],
      status: "none",
      source: "admin",
      admin_expires_at: NOW_SECONDS + 86_400,
      statement: "NXS1.a.b",
      version: 1,
    });

    expect((await call()).destination).toBe("checkout");
  });

  it("refuses cleanly when a live entitlement has no recorded customer", async () => {
    dynamo.seed({
      pk: partitionKey(SUB_A),
      sk: "ENTITLEMENT",
      status: "active",
      tier: "classic",
      capabilities: ["multi_device_sync"],
      source: "stripe",
      version: 1,
    });

    expect((await failureOf(call())).failure.code).toBe("unavailable");
  });
});

describe("AD-16: an invalid promotion code is refused and never echoed", () => {
  it("resolves a valid code to the PromotionCode object id", async () => {
    stripe.seedPromotionCode("LAUNCH2026", "promo_abc123");
    await call({ promotionCode: "LAUNCH2026" });

    expect(stripe.paramsOf("promotionCodes.list")).toEqual({
      code: "LAUNCH2026",
      active: true,
    });
    // The `discounts` form takes the object id, not the user-facing string.
    expect(stripe.paramsOf("checkout.sessions.create")).toMatchObject({
      discounts: [{ promotion_code: "promo_abc123" }],
    });
  });

  it("returns promotion_invalid and never names the submitted code", async () => {
    const failure = await failureOf(call({ promotionCode: "ZZQQXXPROMO" }));

    expect(failure.failure.code).toBe("promotion_invalid");
    expect(failure.message).not.toContain("ZZQQXXPROMO");
    expect(captured.join("\n")).not.toContain("ZZQQXXPROMO");
    expect(stripe.countOf("checkout.sessions.create")).toBe(0);
    // Refused before the lock, so a mistyped code does not block a retry.
    expect(dynamo.puts).toHaveLength(0);
  });

  it("matches a code case-insensitively, as Stripe does", async () => {
    stripe.seedPromotionCode("LAUNCH2026", "promo_abc123");
    await call({ promotionCode: "launch2026" });

    expect(stripe.paramsOf("checkout.sessions.create")).toMatchObject({
      discounts: [{ promotion_code: "promo_abc123" }],
    });
  });
});

describe("the Checkout Session parameter set", () => {
  const PARAMS = () =>
    checkoutSessionParams({
      sub: SUB_A,
      customerId: "cus_existing",
      priceId: "price_classic",
      promotionCodeId: null,
    });

  it("is a Managed Payments subscription carrying the sub on both halves", () => {
    installBillingEnvironment();
    const params = PARAMS();

    expect(params.mode).toBe("subscription");
    expect(params.managed_payments).toEqual({ enabled: true });
    expect(params.client_reference_id).toBe(SUB_A);
    expect(params.subscription_data?.metadata).toEqual({ nixus_sub: SUB_A });
    expect(params.line_items).toEqual([
      { price: "price_classic", quantity: 1 },
    ]);
  });

  /* Sending ANY of these under Managed Payments is an error, so each must be
   * ABSENT rather than present-and-falsy. */
  it("carries NONE of the parameters Managed Payments forbids", () => {
    installBillingEnvironment();
    const forbidden = [
      "adaptive_pricing",
      "automatic_tax",
      "tax_id_collection",
      "payment_method_configuration",
      "payment_method_types",
      "shipping_address_collection",
      "shipping_options",
      "invoice_creation",
      "customer_update",
    ] as const;

    for (const promotionCodeId of [null, "promo_abc123"]) {
      const params = checkoutSessionParams({
        sub: SUB_A,
        customerId: "cus_existing",
        priceId: "price_classic",
        promotionCodeId,
      }) as Record<string, unknown>;

      for (const key of forbidden) {
        expect(Object.hasOwn(params, key), `${key} must be absent`).toBe(false);
      }

      const subscriptionData = (params.subscription_data ??
        {}) as Record<string, unknown>;
      for (const key of [
        "default_tax_rates",
        "application_fee_percent",
        "on_behalf_of",
        "transfer_data",
        "invoice_settings",
      ]) {
        expect(
          Object.hasOwn(subscriptionData, key),
          `subscription_data.${key} must be absent`,
        ).toBe(false);
      }
    }
  });

  /* `allow_promotion_codes` and `discounts` are MUTUALLY EXCLUSIVE and cannot
   * both be sent - not even with one set to false or null, because null
   * serialises to an empty string and still conflicts. Exactly one KEY exists. */
  it("sends allow_promotion_codes alone when no code was supplied", () => {
    installBillingEnvironment();
    const params = PARAMS() as Record<string, unknown>;

    expect(params.allow_promotion_codes).toBe(true);
    expect(Object.hasOwn(params, "discounts")).toBe(false);
  });

  it("sends discounts alone when a code was supplied", () => {
    installBillingEnvironment();
    const params = checkoutSessionParams({
      sub: SUB_A,
      customerId: "cus_existing",
      priceId: "price_classic",
      promotionCodeId: "promo_abc123",
    }) as Record<string, unknown>;

    expect(params.discounts).toEqual([{ promotion_code: "promo_abc123" }]);
    expect(Object.hasOwn(params, "allow_promotion_codes")).toBe(false);
  });

  /* A server-side allow-list of PATH constants: no request-supplied URL is ever
   * accepted or echoed. */
  it("composes both URLs from the configured origin and fixed paths", () => {
    installBillingEnvironment();
    const params = PARAMS();

    expect(params.success_url).toBe(`${TEST_ACCOUNT_APP_ORIGIN}/checkout/complete`);
    expect(params.cancel_url).toBe(`${TEST_ACCOUNT_APP_ORIGIN}/pricing`);
  });

  it("refuses a configured origin that is not a bare https origin", () => {
    for (const origin of [
      "http://account.nixusapp.com",
      "https://account.nixusapp.com/evil",
      "https://account.nixusapp.com?next=x",
      "not-a-url",
      "",
    ]) {
      installBillingEnvironment({ ACCOUNT_APP_ORIGIN: origin });
      expect(() => PARAMS(), origin).toThrow();
    }
  });

  /* Nixus stores no money and no price id in code: the only price reference is
   * the lookup key, resolved from the live catalog. */
  it("names no amount and no literal price id", () => {
    installBillingEnvironment();
    const serialized = JSON.stringify(PARAMS() satisfies Stripe.Checkout.SessionCreateParams);

    expect(serialized).not.toContain("999");
    expect(serialized).not.toContain("unit_amount");
    expect(serialized).not.toContain("cad");
  });
});

describe("a session Stripe could not give a URL for", () => {
  it("is a clean refusal rather than an undefined url", async () => {
    stripe.seedSessionUrl(null);
    expect((await failureOf(call())).failure.code).toBe("unavailable");
  });
});
