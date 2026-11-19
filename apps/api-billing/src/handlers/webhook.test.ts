import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetCatalogCacheForTesting } from "../lib/catalog.ts";
import { BillingFailureError } from "../lib/errors.ts";
import { setCloudWatchClientForTesting } from "../lib/metrics.ts";
import { setKmsClientForTesting } from "../lib/signing.ts";
import {
  resetStripeSecretsForTesting,
  setSsmClientForTesting,
  setStripeClientForTesting,
} from "../lib/stripe.ts";
import { FakeDynamo } from "../lib/testing/fake-dynamo.ts";
import { FakeKms } from "../lib/testing/fake-kms.ts";
import {
  FakeStripe,
  checkoutSessionEventObject,
  invoiceEventObject,
  stripeEvent,
  stripeProduct,
  stripeSubscription,
} from "../lib/testing/fake-stripe.ts";
import {
  SUB_A,
  SUB_B,
  clearBillingEnvironment,
  fakeSecretsSsmClient,
  installBillingEnvironment,
} from "../lib/testing/fixtures.ts";
import { setDocumentClientForTesting } from "../lib/table.ts";
import {
  RELEVANT_EVENT_TYPES,
  SUBSCRIPTION_SUB_METADATA_KEY,
  eventWatermark,
  handleWebhook,
  subscriptionIdOf,
} from "./webhook.ts";

/*
 * AD-5 and AD-16's webhook-correctness block, in order.
 *
 * Every assertion below is one of AD-16's named gates: a bad or absent signature
 * refused before any read or outbound call; a request outside the tolerance
 * window refused; a `livemode` mismatch refused; a replayed `event_id` as a
 * no-op; a crash between work and acknowledgement losing no event; an older
 * event never downgrading a newer entitlement; a KMS signing failure leaving no
 * entitlement written; cancellation, refund, payment failure and dunning each
 * producing the correct terminal entitlement; and an admin override surviving a
 * converging webhook and expiring correctly.
 */

const NOW = new Date("2026-11-18T12:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const PERIOD_END = NOW_SECONDS + 30 * 86_400;
const REQUEST_ID = "req-webhook";
const CUSTOMER = "cus_test";
const RAW_BODY = Buffer.from('{"id":"evt_1","object":"event"}', "utf8");
const SIGNATURE = "t=1763467200,v1=deadbeef";

const ADVANCE = stripeProduct({
  id: "prod_advance",
  metadata: {
    nixus_tier: "advance",
    nixus_capabilities: "hosted_ai,multi_device_sync,household_net_worth",
    nixus_monthly_request_limit: "1000",
  },
});

const CLASSIC = stripeProduct({
  id: "prod_classic",
  metadata: {
    nixus_tier: "classic",
    nixus_capabilities: "multi_device_sync,household_net_worth",
  },
});

let dynamo: FakeDynamo;
let stripe: FakeStripe;
let kms: FakeKms;
let metricNames: string[];
let captured: string[];

function partitionKey(sub: string): string {
  return `USER#${sub}`;
}

function entitlementOf(sub: string): Record<string, unknown> | undefined {
  return dynamo.stored(partitionKey(sub), "ENTITLEMENT");
}

function subscription(args: {
  readonly id?: string;
  readonly status: string;
  readonly periodEnds?: readonly number[];
  readonly product?: ReturnType<typeof stripeProduct>;
  readonly withSubMetadata?: boolean;
}) {
  return stripeSubscription({
    id: args.id ?? "sub_test",
    customer: CUSTOMER,
    status: args.status,
    periodEnds: args.periodEnds ?? [PERIOD_END],
    product: args.product ?? ADVANCE,
    metadata:
      args.withSubMetadata === false
        ? {}
        : { [SUBSCRIPTION_SUB_METADATA_KEY]: SUB_A },
  });
}

function seedEvent(args: {
  readonly id?: string;
  readonly type?: string;
  readonly created?: number;
  readonly livemode?: boolean;
  readonly status?: string;
  readonly object?: unknown;
  readonly product?: ReturnType<typeof stripeProduct>;
  readonly withSubMetadata?: boolean;
}) {
  const live = subscription({
    status: args.status ?? "active",
    product: args.product,
    withSubMetadata: args.withSubMetadata,
  });
  stripe.seedSubscriptions([live]);
  stripe.seedVerifiedEvent(
    stripeEvent({
      id: args.id ?? "evt_1",
      type: args.type ?? "customer.subscription.updated",
      created: args.created ?? NOW_SECONDS,
      livemode: args.livemode ?? false,
      object: args.object ?? live,
    }),
  );
  return live;
}

function call(overrides: {
  readonly signatureHeader?: string | null;
  readonly now?: Date;
} = {}) {
  return handleWebhook({
    rawBody: RAW_BODY,
    signatureHeader:
      overrides.signatureHeader === undefined
        ? SIGNATURE
        : overrides.signatureHeader,
    now: overrides.now ?? NOW,
    requestId: REQUEST_ID,
  });
}

async function failureOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    expect.unreachable("expected a billing failure");
  } catch (error) {
    if (error instanceof BillingFailureError) return error.failure.code;
    throw error;
  }
}

beforeEach(() => {
  installBillingEnvironment();
  dynamo = new FakeDynamo();
  setDocumentClientForTesting(dynamo.asDocumentClient());
  setSsmClientForTesting(fakeSecretsSsmClient());

  kms = new FakeKms();
  setKmsClientForTesting(kms.asKmsClient());

  stripe = new FakeStripe();
  setStripeClientForTesting(stripe.asStripe());

  metricNames = [];
  setCloudWatchClientForTesting({
    async send(command: {
      input: { MetricData?: { MetricName?: string }[] };
    }): Promise<unknown> {
      for (const datum of command.input.MetricData ?? []) {
        if (datum.MetricName) metricNames.push(datum.MetricName);
      }
      return {};
    },
  } as never);

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
  setKmsClientForTesting(undefined);
  setCloudWatchClientForTesting(undefined);
  resetStripeSecretsForTesting();
  resetCatalogCacheForTesting();
  vi.restoreAllMocks();
  clearBillingEnvironment();
});

describe("AD-16: an unverified request is refused before any read or call", () => {
  it("refuses an absent signature header with no read and no outbound call", async () => {
    seedEvent({});

    expect(await failureOf(call({ signatureHeader: null }))).toBe("validation");
    expect(dynamo.sent).toHaveLength(0);
    expect(stripe.calls).toHaveLength(0);
    expect(kms.signCount).toBe(0);
  });

  it("refuses a forged signature with no read and no outbound call", async () => {
    seedEvent({});
    stripe.seedVerifiedEvent(
      new Error("No signatures found matching the expected signature"),
    );

    expect(await failureOf(call())).toBe("validation");
    expect(dynamo.sent).toHaveLength(0);
    expect(stripe.countOf("subscriptions.retrieve")).toBe(0);
    expect(kms.signCount).toBe(0);
  });

  /* The tolerance window is the SDK's, enforced by the same call: a captured
   * request replayed outside it is refused exactly as a forged one is, so it
   * cannot be replayed indefinitely. */
  it("refuses a request outside the timestamp tolerance window", async () => {
    seedEvent({});
    stripe.seedVerifiedEvent(
      new Error("Timestamp outside the tolerance zone"),
    );

    expect(await failureOf(call())).toBe("validation");
    expect(dynamo.sent).toHaveLength(0);
    expect(stripe.countOf("subscriptions.retrieve")).toBe(0);
  });

  it("verifies before parsing, over the raw bytes and the configured tolerance", async () => {
    seedEvent({});
    await call();

    const params = stripe.paramsOf("webhooks.constructEvent") as {
      payload: Buffer;
      header: string;
      tolerance: number;
    };
    expect(params.payload.equals(RAW_BODY)).toBe(true);
    expect(params.header).toBe(SIGNATURE);
    expect(params.tolerance).toBe(300);
  });

  it("never logs the signature header or the raw body", async () => {
    seedEvent({});
    stripe.seedVerifiedEvent(new Error("bad signature"));
    await failureOf(call({ signatureHeader: "t=1,v1=ZZQQXXSIGNATURE" }));

    const haystack = captured.join("\n");
    expect(haystack).not.toContain("ZZQQXXSIGNATURE");
    expect(haystack).not.toContain(RAW_BODY.toString("utf8"));
  });
});

describe("AD-16: a livemode mismatch is refused", () => {
  it("refuses a live-mode event in a test-mode stack", async () => {
    seedEvent({ livemode: true });

    expect(await failureOf(call())).toBe("validation");
    expect(entitlementOf(SUB_A)).toBeUndefined();
    expect(stripe.countOf("subscriptions.retrieve")).toBe(0);
    expect(captured.join("\n")).toContain("livemode_mismatch");
  });

  it("refuses a test-mode event in a live-mode stack", async () => {
    installBillingEnvironment({ STRIPE_MODE: "live" });
    resetStripeSecretsForTesting();
    // A live-mode stack holds a live key; the mode assertion is what pairs them.
    setSsmClientForTesting({
      async send(command: { input: { Name: string } }) {
        return {
          Parameter: {
            Value: command.input.Name.endsWith("secret-key")
              ? "sk_live_FAKEFAKEFAKEFAKE"
              : "whsec_FAKEFAKEFAKEFAKE",
          },
        };
      },
    } as never);
    seedEvent({ livemode: false });

    expect(await failureOf(call())).toBe("validation");
    expect(entitlementOf(SUB_A)).toBeUndefined();
  });

  it("accepts a test-mode event in a test-mode stack", async () => {
    seedEvent({ livemode: false });
    expect(await call()).toEqual({ received: true });
  });
});

describe("the relevant event set is closed", () => {
  it("names the six current types and not the legacy invoice event", () => {
    expect([...RELEVANT_EVENT_TYPES].sort()).toEqual([
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.deleted",
      "customer.subscription.updated",
      "invoice.paid",
      "invoice.payment_failed",
    ]);
    expect(RELEVANT_EVENT_TYPES).not.toContain("invoice.payment_succeeded");
  });

  it.each([
    ["charge.dispute.created"],
    ["customer.subscription.trial_will_end"],
    ["invoice.payment_succeeded"],
    ["something.stripe.adds.later"],
  ])("acknowledges %s with a 2xx and logs it, never an error", async (type) => {
    seedEvent({ type });

    expect(await call()).toEqual({ received: true });
    expect(captured.join("\n")).toContain("unrecognised_event_type");
    expect(entitlementOf(SUB_A)).toBeUndefined();
    expect(stripe.countOf("subscriptions.retrieve")).toBe(0);
  });

  it("finds the subscription on each relevant object shape", () => {
    const live = subscription({ status: "active" });

    expect(
      subscriptionIdOf(
        stripeEvent({
          type: "customer.subscription.updated",
          created: 1,
          object: live,
        }),
      ),
    ).toBe("sub_test");
    // `invoice.subscription` no longer exists: it is under `parent`.
    expect(
      subscriptionIdOf(
        stripeEvent({
          type: "invoice.paid",
          created: 1,
          object: invoiceEventObject("sub_from_invoice"),
        }),
      ),
    ).toBe("sub_from_invoice");
    expect(
      subscriptionIdOf(
        stripeEvent({
          type: "checkout.session.completed",
          created: 1,
          object: checkoutSessionEventObject({ subscription: "sub_from_session" }),
        }),
      ),
    ).toBe("sub_from_session");
  });

  it("acknowledges an event with no subscription to converge", async () => {
    stripe.seedVerifiedEvent(
      stripeEvent({
        type: "invoice.paid",
        created: NOW_SECONDS,
        object: invoiceEventObject(null),
      }),
    );

    expect(await call()).toEqual({ received: true });
    expect(dynamo.sent).toHaveLength(0);
  });
});

describe("convergence re-fetches from Stripe and never trusts the payload", () => {
  /* B7's whole point: the event payload is a TRIGGER. A stale or forged-looking
   * payload cannot grant anything the live subscription does not. */
  it("derives from the re-fetched subscription, not from the event body", async () => {
    const stale = subscription({ status: "active", product: ADVANCE });
    const current = subscription({ status: "canceled", product: ADVANCE });
    stripe.seedSubscriptions([current]);
    stripe.seedVerifiedEvent(
      stripeEvent({
        type: "customer.subscription.updated",
        created: NOW_SECONDS,
        object: stale,
      }),
    );

    await call();

    expect(stripe.paramsOf("subscriptions.retrieve")).toEqual({
      id: "sub_test",
      params: { expand: ["items.data.price.product"] },
    });
    expect(entitlementOf(SUB_A)).toMatchObject({
      status: "canceled",
      capabilities: [],
    });
  });

  it("resolves the sub from subscription metadata", async () => {
    seedEvent({});
    await call();
    expect(entitlementOf(SUB_A)).toBeDefined();
  });

  /* A Checkout Session's own `client_reference_id`, for the first event of a new
   * subscription whose metadata has not yet propagated. */
  it("resolves the sub from client_reference_id when metadata is absent", async () => {
    const live = subscription({ status: "active", withSubMetadata: false });
    stripe.seedSubscriptions([live]);
    stripe.seedVerifiedEvent(
      stripeEvent({
        type: "checkout.session.completed",
        created: NOW_SECONDS,
        object: checkoutSessionEventObject({
          subscription: "sub_test",
          clientReferenceId: SUB_B,
        }),
      }),
    );

    await call();
    expect(entitlementOf(SUB_B)).toBeDefined();
  });

  /* A webhook arrives keyed by Stripe CUSTOMER and never by `sub`, so the GSI is
   * the only route home for a subscription created outside this service. */
  it("resolves the sub through the customer GSI as a last resort", async () => {
    seedEvent({ withSubMetadata: false });
    dynamo.seedQueryResult([{ pk: partitionKey(SUB_B), sk: "BILLING_CUSTOMER" }]);

    await call();

    expect(dynamo.queries).toHaveLength(1);
    expect(dynamo.queries[0]!.input).toMatchObject({
      IndexName: "stripe-customer-index",
      ExpressionAttributeValues: { ":customer": CUSTOMER },
    });
    expect(entitlementOf(SUB_B)).toBeDefined();
  });

  it("acknowledges an event for a customer it cannot resolve", async () => {
    seedEvent({ withSubMetadata: false });
    dynamo.seedQueryResult([]);

    expect(await call()).toEqual({ received: true });
    expect(dynamo.transactions).toHaveLength(0);
    expect(kms.signCount).toBe(0);
  });
});

describe("AD-16: the terminal entitlement of each lifecycle event", () => {
  it.each([
    ["customer.subscription.created", "active", ["hosted_ai", "household_net_worth", "multi_device_sync"]],
    ["invoice.paid", "active", ["hosted_ai", "household_net_worth", "multi_device_sync"]],
    ["invoice.payment_failed", "past_due", ["hosted_ai", "household_net_worth", "multi_device_sync"]],
    ["customer.subscription.updated", "unpaid", []],
    ["customer.subscription.deleted", "canceled", []],
  ])("%s with Stripe reporting %s", async (type, status, capabilities) => {
    seedEvent({ type, status });
    expect(await call()).toEqual({ received: true });

    expect(entitlementOf(SUB_A)).toMatchObject({
      status,
      capabilities,
      source: "stripe",
      tier: "advance",
    });
  });

  /* Dunning: Stripe reports past_due while it retries, so Nixus keeps granting -
   * the grace period is Stripe's Dashboard setting and is hard-coded nowhere. */
  it("keeps granting through dunning and revokes only when Stripe gives up", async () => {
    seedEvent({ type: "invoice.payment_failed", status: "past_due" });
    await call();
    expect(entitlementOf(SUB_A)).toMatchObject({
      capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
    });

    seedEvent({
      id: "evt_2",
      created: NOW_SECONDS + 10,
      type: "customer.subscription.updated",
      status: "unpaid",
    });
    await call();
    expect(entitlementOf(SUB_A)).toMatchObject({
      status: "unpaid",
      capabilities: [],
    });
  });

  /* A Stripe-INITIATED refund or cancellation is an ordinary inbound event:
   * Stripe can refund within 60 days without seller approval, so the authority
   * records whatever status results and raises nothing. */
  it("records a Stripe-initiated cancellation as an ordinary event", async () => {
    seedEvent({ type: "customer.subscription.deleted", status: "canceled" });

    expect(await call()).toEqual({ received: true });
    expect(entitlementOf(SUB_A)).toMatchObject({
      status: "canceled",
      capabilities: [],
    });
    expect(metricNames).not.toContain("WebhookFailure");
  });

  /* AD-11: a billing event never deletes anything. The record remains, with its
   * tier label and its history, and only the grant stops. */
  it("deletes nothing on tier loss", async () => {
    seedEvent({ type: "customer.subscription.created", status: "active" });
    await call();
    const before = dynamo.itemCount;

    seedEvent({
      id: "evt_2",
      created: NOW_SECONDS + 10,
      type: "customer.subscription.deleted",
      status: "canceled",
    });
    await call();

    expect(dynamo.itemCount).toBeGreaterThanOrEqual(before);
    expect(entitlementOf(SUB_A)).toMatchObject({ tier: "advance" });
  });

  it("records the paid-but-capability-less entitlement and alarms", async () => {
    seedEvent({
      status: "active",
      product: stripeProduct({ metadata: { nixus_capabilities: "hosted_ai" } }),
    });

    expect(await call()).toEqual({ received: true });
    expect(entitlementOf(SUB_A)).toMatchObject({
      status: "active",
      capabilities: [],
    });
    expect(metricNames).toContain("CatalogMetadataMalformed");
  });
});

describe("AD-16: the dedupe marker and the transaction", () => {
  it("writes the entitlement and the marker in ONE transaction", async () => {
    seedEvent({});
    await call();

    expect(dynamo.transactions).toHaveLength(1);
    const items = (
      dynamo.transactions[0]!.input as {
        TransactItems: { Put: { Item: Record<string, unknown> } }[];
      }
    ).TransactItems;

    expect(items).toHaveLength(2);
    expect(items[0]!.Put.Item.sk).toBe("ENTITLEMENT");
    expect(items[1]!.Put.Item.sk).toBe("EVENT#evt_1");
    // The marker is NEVER durable before the work it guards.
    expect(dynamo.puts).toHaveLength(0);
  });

  it("acknowledges a replayed event id as a no-op", async () => {
    seedEvent({});
    await call();
    const first = entitlementOf(SUB_A);

    expect(await call()).toEqual({ received: true });
    expect(entitlementOf(SUB_A)).toEqual(first);
    // One transaction for the first delivery; the replay is refused at the
    // dedupe read and costs NO outbound Stripe call at all.
    expect(dynamo.transactions).toHaveLength(1);
    expect(stripe.countOf("subscriptions.retrieve")).toBe(1);
  });

  /* A crash between the work and the acknowledgement loses no event: the marker
   * and the entitlement are one atomic write, so either both exist - and the
   * redelivery is a no-op - or neither does, and the redelivery converges. */
  it("loses no event when the transaction never commits", async () => {
    seedEvent({});
    dynamo.queueError(new Error("ServiceUnavailable"));

    await expect(call()).rejects.toThrow();
    expect(entitlementOf(SUB_A)).toBeUndefined();
    expect(dynamo.stored(partitionKey(SUB_A), "EVENT#evt_1")).toBeUndefined();
    expect(metricNames).toContain("WebhookFailure");

    // Stripe's redelivery converges, because nothing durable said otherwise.
    seedEvent({});
    expect(await call()).toEqual({ received: true });
    expect(entitlementOf(SUB_A)).toBeDefined();
  });

  it("carries a marker TTL beyond Stripe's own retry horizon", async () => {
    seedEvent({});
    await call();

    const marker = dynamo.stored(partitionKey(SUB_A), "EVENT#evt_1")!;
    expect(Number(marker.expires_at)).toBeGreaterThan(
      NOW_SECONDS + 3 * 86_400,
    );
  });
});

describe("AD-16: an older event never downgrades a newer entitlement", () => {
  it("keeps the newer state and acknowledges the older event", async () => {
    // The newer event converges first, cancelling the subscription.
    seedEvent({
      id: "evt_new",
      created: NOW_SECONDS + 100,
      type: "customer.subscription.deleted",
      status: "canceled",
    });
    await call();
    expect(entitlementOf(SUB_A)).toMatchObject({ status: "canceled" });

    // The older event arrives late, and Stripe has since reported it active
    // again - which is exactly the state the watermark must refuse to apply.
    seedEvent({
      id: "evt_old",
      created: NOW_SECONDS,
      type: "customer.subscription.updated",
      status: "active",
    });

    expect(await call()).toEqual({ received: true });
    expect(entitlementOf(SUB_A)).toMatchObject({
      status: "canceled",
      capabilities: [],
      event_watermark: NOW_SECONDS + 100,
    });
    expect(captured.join("\n")).toContain("converged_by_newer_event");
    // Acknowledged rather than failed: Stripe must not retry work that is moot.
    expect(metricNames).not.toContain("WebhookFailure");
  });

  /* `event.created` is the watermark, with no synthetic tiebreak - the ordering
   * the guard respects is the one STRIPE generated, and nothing derived from this
   * service's clock would be monotonic in it. */
  it("derives the watermark from event.created alone", () => {
    expect(
      eventWatermark(
        stripeEvent({ type: "invoice.paid", created: 1_795_003_200, object: {} }),
      ),
    ).toBe(1_795_003_200);
  });

  /* Two events CAN share a second. Acknowledging is sound because the handler
   * converges: the state that won is at least as fresh as the one that lost. */
  it("acknowledges a second event that shares a second with the first", async () => {
    seedEvent({ id: "evt_a", created: NOW_SECONDS, status: "active" });
    await call();

    seedEvent({ id: "evt_b", created: NOW_SECONDS, status: "active" });
    expect(await call()).toEqual({ received: true });
    expect(metricNames).not.toContain("WebhookFailure");
  });

  it("advances the watermark on every accepted event", async () => {
    seedEvent({ id: "evt_1", created: NOW_SECONDS, status: "active" });
    await call();
    expect(entitlementOf(SUB_A)).toMatchObject({
      event_watermark: NOW_SECONDS,
      version: 1,
    });

    seedEvent({ id: "evt_2", created: NOW_SECONDS + 5, status: "past_due" });
    await call();
    expect(entitlementOf(SUB_A)).toMatchObject({
      event_watermark: NOW_SECONDS + 5,
      version: 2,
    });
  });
});

describe("AD-16: a KMS signing failure leaves NO entitlement written", () => {
  it("writes nothing and fails the event so Stripe retries", async () => {
    seedEvent({});
    kms.failWith(new Error("KMSInternalException"));

    await expect(call()).rejects.toThrow("KMSInternalException");

    expect(entitlementOf(SUB_A)).toBeUndefined();
    expect(dynamo.stored(partitionKey(SUB_A), "EVENT#evt_1")).toBeUndefined();
    expect(dynamo.transactions).toHaveLength(0);
    expect(metricNames).toContain("WebhookFailure");
  });

  it("signs before it writes, so a statement-less entitlement is unreachable", async () => {
    seedEvent({});
    await call();

    expect(kms.signCount).toBe(1);
    expect(String(entitlementOf(SUB_A)!.statement)).toMatch(/^NXS1\./);
    expect(Number(entitlementOf(SUB_A)!.statement_exp)).toBeGreaterThan(
      NOW_SECONDS,
    );
  });

  /* The statement's `exp` is clamped to the period end, so a cancellation cannot
   * be outlived by more than one window. */
  it("clamps the statement to the subscription's period end", async () => {
    const soon = NOW_SECONDS + 3600;
    const live = subscription({ status: "active", periodEnds: [soon] });
    stripe.seedSubscriptions([live]);
    stripe.seedVerifiedEvent(
      stripeEvent({
        type: "customer.subscription.updated",
        created: NOW_SECONDS,
        object: live,
      }),
    );

    await call();
    expect(entitlementOf(SUB_A)!.statement_exp).toBe(soon);
  });
});

describe("AD-2: an admin override out-ranks a converging webhook", () => {
  function seedOverride(expiresAt: number): void {
    dynamo.seed({
      pk: partitionKey(SUB_A),
      sk: "ENTITLEMENT",
      tier: "advance",
      capabilities: ["hosted_ai", "multi_device_sync", "household_net_worth"],
      status: "none",
      current_period_end: null,
      monthly_request_limit: 1000,
      source: "admin",
      statement: "NXS1.admin.signature",
      statement_iat: NOW_SECONDS - 10,
      statement_exp: NOW_SECONDS + 86_400,
      version: 4,
      created_at: "2026-11-01T00:00:00.000Z",
      updated_at: "2026-11-01T00:00:00.000Z",
      admin_expires_at: expiresAt,
      admin_reason: "support_grant_ticket_4821",
      admin_actor: SUB_B,
    });
  }

  it("survives a converging webhook, which records Stripe state separately", async () => {
    seedOverride(NOW_SECONDS + 86_400);
    seedEvent({ status: "canceled", product: CLASSIC });

    expect(await call()).toEqual({ received: true });

    const stored = entitlementOf(SUB_A)!;
    // The override's grant is UNTOUCHED.
    expect(stored).toMatchObject({
      source: "admin",
      tier: "advance",
      capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
      status: "none",
      admin_reason: "support_grant_ticket_4821",
      admin_actor: SUB_B,
    });
    // And the Stripe-derived state is recorded alongside it, which is what makes
    // the restoration after expiry possible at all.
    expect(stored).toMatchObject({
      stripe_tier: "classic",
      stripe_status: "canceled",
      stripe_capabilities: [],
    });
    expect(captured.join("\n")).toContain("admin_override_precedence");
  });

  /* Always visible, always time-boxed, and never indistinguishable from a paid
   * entitlement: the source and the expiry are both on the record. */
  it("keeps the override distinguishable and time-boxed", async () => {
    seedOverride(NOW_SECONDS + 86_400);
    seedEvent({ status: "active" });
    await call();

    const stored = entitlementOf(SUB_A)!;
    expect(stored.source).toBe("admin");
    expect(Number(stored.admin_expires_at)).toBeGreaterThan(NOW_SECONDS);
  });

  it("restores the Stripe-derived state once the override has expired", async () => {
    seedOverride(NOW_SECONDS - 1);
    seedEvent({ status: "active", product: CLASSIC });

    await call();

    expect(entitlementOf(SUB_A)).toMatchObject({
      source: "stripe",
      tier: "classic",
      status: "active",
      capabilities: ["household_net_worth", "multi_device_sync"],
      admin_expires_at: null,
      admin_reason: null,
      admin_actor: null,
    });
  });

  it("re-signs the statement for whichever grant is in force", async () => {
    seedOverride(NOW_SECONDS + 86_400);
    seedEvent({ status: "canceled", product: CLASSIC });
    await call();

    // The statement carries the OVERRIDE's grant, not Stripe's.
    const payload = kms.lastSigningInput().split(".")[1]!;
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { tier: string; capabilities: string[] };

    expect(claims.tier).toBe("advance");
    expect(claims.capabilities).toContain("hosted_ai");
  });
});

describe("the failure metric and the error vocabulary", () => {
  it("emits WebhookFailure on a Stripe read failure", async () => {
    seedEvent({});
    stripe.failOn("subscriptions.retrieve", new Error("StripeAPIError"));

    await expect(call()).rejects.toThrow("StripeAPIError");
    expect(metricNames).toContain("WebhookFailure");
  });

  /* A refusal the service classified itself is a decision, not a failure to
   * alarm on: a forged signature is an expected event on a public route. */
  it("does not emit WebhookFailure for a refused signature", async () => {
    seedEvent({});
    stripe.seedVerifiedEvent(new Error("bad signature"));

    await failureOf(call());
    expect(metricNames).not.toContain("WebhookFailure");
  });
});
