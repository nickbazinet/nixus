import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENTITLEMENT_STATUSES, type EntitlementStatus } from "@nixus/shared";

import { resetCatalogCacheForTesting } from "./catalog.ts";
import {
  deriveEntitlement,
  entitlementStatusFromStripe,
  FREE_ENTITLEMENT,
  GRANTING_ENTITLEMENT_STATUSES,
  grantsCapabilities,
  isAdminOverrideLive,
  subscriptionPeriodEnd,
  toEntitlementRecord,
  toEntitlementResponse,
} from "./entitlement.ts";
import { setCloudWatchClientForTesting } from "./metrics.ts";
import { stripeProduct, stripeSubscription } from "./testing/fake-stripe.ts";
import {
  clearBillingEnvironment,
  installBillingEnvironment,
} from "./testing/fixtures.ts";

/*
 * The derivation, in isolation: every rule below is a property of a Stripe
 * subscription plus its Product metadata, with no storage and no network.
 */

const REQUEST_ID = "req-derive";
const PERIOD_END = 1_796_083_200;

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

let metricNames: string[];
let captured: string[];

beforeEach(() => {
  installBillingEnvironment();
  resetCatalogCacheForTesting();

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
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    captured.push(args.map((arg) => String(arg)).join(" "));
  });
});

afterEach(() => {
  setCloudWatchClientForTesting(undefined);
  vi.restoreAllMocks();
  clearBillingEnvironment();
});

describe("ONE predicate decides which statuses grant (AD-11)", () => {
  it("grants on active, trialing and past_due, and on nothing else", () => {
    expect([...GRANTING_ENTITLEMENT_STATUSES].sort()).toEqual([
      "active",
      "past_due",
      "trialing",
    ]);

    for (const status of ENTITLEMENT_STATUSES) {
      expect(grantsCapabilities(status), status).toBe(
        (["active", "trialing", "past_due"] as readonly string[]).includes(
          status,
        ),
      );
    }
  });

  /* Dunning grace is STRIPE's, configured in the Dashboard, so Nixus keeps
   * granting for as long as Stripe reports the subscription live and hard-codes
   * no retry window of its own. */
  it("keeps granting through dunning", () => {
    expect(grantsCapabilities("past_due")).toBe(true);
  });

  it("grants nothing on every terminal or incomplete status", () => {
    for (const status of [
      "canceled",
      "unpaid",
      "incomplete",
      "incomplete_expired",
      "paused",
      "none",
    ] as EntitlementStatus[]) {
      expect(grantsCapabilities(status), status).toBe(false);
    }
  });

  /* The granting set must stay a strict subset of the contract's union: a member
   * invented here would be a grant decision the contract never declared. */
  it("names only statuses the contract declares", () => {
    for (const status of GRANTING_ENTITLEMENT_STATUSES) {
      expect(ENTITLEMENT_STATUSES as readonly string[]).toContain(status);
    }
  });
});

describe("a status the union does not contain maps to none and is logged", () => {
  it("passes through a status the contract declares", () => {
    expect(
      entitlementStatusFromStripe({ status: "active", requestId: REQUEST_ID }),
    ).toBe("active");
    expect(captured).toEqual([]);
  });

  it.each([["ended"], ["will_pause"], [""], ["ACTIVE"]])(
    "maps %s to none and logs it rather than inventing a union member",
    (status) => {
      expect(
        entitlementStatusFromStripe({ status, requestId: REQUEST_ID }),
      ).toBe("none");
      expect(captured.join("\n")).toContain("unknown_subscription_status");
    },
  );
});

describe("current_period_end comes from the ITEMS, never the subscription", () => {
  it("takes the minimum across items", () => {
    expect(
      subscriptionPeriodEnd(
        stripeSubscription({
          status: "active",
          periodEnds: [PERIOD_END + 86_400, PERIOD_END, PERIOD_END + 3600],
          product: ADVANCE,
        }),
      ),
    ).toBe(PERIOD_END);
  });

  it("is that one value for a single-item subscription", () => {
    expect(
      subscriptionPeriodEnd(
        stripeSubscription({
          status: "active",
          periodEnds: [PERIOD_END],
          product: ADVANCE,
        }),
      ),
    ).toBe(PERIOD_END);
  });

  /* A subscription with no items is malformed rather than eternal. */
  it("is null when there are no items at all", () => {
    expect(
      subscriptionPeriodEnd(
        stripeSubscription({
          status: "active",
          periodEnds: [],
          product: ADVANCE,
        }),
      ),
    ).toBeNull();
  });
});

describe("deriveEntitlement", () => {
  it("derives the free entitlement from no subscription at all", () => {
    expect(deriveEntitlement({ subscriptions: [], requestId: REQUEST_ID })).toEqual(
      FREE_ENTITLEMENT,
    );
    expect(FREE_ENTITLEMENT).toEqual({
      tier: "free",
      capabilities: [],
      status: "none",
      current_period_end: null,
      monthly_request_limit: null,
      malformed: false,
    });
  });

  it("derives tier, capabilities, limit and period end from a live subscription", () => {
    expect(
      deriveEntitlement({
        requestId: REQUEST_ID,
        subscriptions: [
          stripeSubscription({
            status: "active",
            periodEnds: [PERIOD_END],
            product: ADVANCE,
          }),
        ],
      }),
    ).toEqual({
      tier: "advance",
      capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
      status: "active",
      current_period_end: PERIOD_END,
      monthly_request_limit: 1000,
      malformed: false,
    });
  });

  /* Each of AD-16's terminal states. The tier LABEL survives for display and
   * operations; the capability grant does not. */
  it.each([
    ["canceled", "a cancellation"],
    ["unpaid", "dunning exhausted"],
    ["incomplete", "a never-completed first payment"],
    ["incomplete_expired", "an expired first payment"],
    ["paused", "a paused subscription"],
  ])("grants nothing on %s (%s)", (status) => {
    const derived = deriveEntitlement({
      requestId: REQUEST_ID,
      subscriptions: [
        stripeSubscription({
          status,
          periodEnds: [PERIOD_END],
          product: ADVANCE,
        }),
      ],
    });

    expect(derived.capabilities).toEqual([]);
    expect(derived.monthly_request_limit).toBeNull();
    expect(derived.status).toBe(status);
    // Still labelled, because support has to see who was on what.
    expect(derived.tier).toBe("advance");
  });

  it("keeps granting while Stripe reports past_due", () => {
    const derived = deriveEntitlement({
      requestId: REQUEST_ID,
      subscriptions: [
        stripeSubscription({
          status: "past_due",
          periodEnds: [PERIOD_END],
          product: ADVANCE,
        }),
      ],
    });

    expect(derived.capabilities).toEqual([
      "hosted_ai",
      "household_net_worth",
      "multi_device_sync",
    ]);
  });

  it("grants through a trial", () => {
    expect(
      deriveEntitlement({
        requestId: REQUEST_ID,
        subscriptions: [
          stripeSubscription({
            status: "trialing",
            periodEnds: [PERIOD_END],
            product: CLASSIC,
          }),
        ],
      }).capabilities,
    ).toEqual(["household_net_worth", "multi_device_sync"]);
  });

  /* AD-6's paid-but-capability-less entitlement: the subscription IS recorded
   * and no capability is granted. */
  it("records a malformed Product's subscription with no capability", () => {
    const derived = deriveEntitlement({
      requestId: REQUEST_ID,
      subscriptions: [
        stripeSubscription({
          status: "active",
          periodEnds: [PERIOD_END],
          product: stripeProduct({ metadata: { nixus_capabilities: "hosted_ai" } }),
        }),
      ],
    });

    expect(derived.malformed).toBe(true);
    expect(derived.capabilities).toEqual([]);
    expect(derived.status).toBe("active");
    expect(derived.current_period_end).toBe(PERIOD_END);
    expect(metricNames).toContain("CatalogMetadataMalformed");
  });

  /* AD-18: two live subscriptions for one account is a DEFECT, not a state to
   * model. The union is granted so nobody loses access, the alarm fires, and the
   * architecture never silently picks one. */
  it("grants the UNION of two live subscriptions, alarms and logs", () => {
    const derived = deriveEntitlement({
      requestId: REQUEST_ID,
      subscriptions: [
        stripeSubscription({
          id: "sub_b",
          status: "active",
          periodEnds: [PERIOD_END + 86_400],
          product: ADVANCE,
        }),
        stripeSubscription({
          id: "sub_a",
          status: "active",
          periodEnds: [PERIOD_END],
          product: CLASSIC,
        }),
      ],
    });

    expect(derived.capabilities).toEqual([
      "hosted_ai",
      "household_net_worth",
      "multi_device_sync",
    ]);
    // The EARLIEST lapse, so the statement cannot outlive the shorter period.
    expect(derived.current_period_end).toBe(PERIOD_END);
    // The most generous limit, so neither paid-for quota is silently lost.
    expect(derived.monthly_request_limit).toBe(1000);
    expect(metricNames).toContain("DuplicateSubscription");
    expect(captured.join("\n")).toContain("duplicate_live_subscription");
  });

  it("does not alarm when only one of two subscriptions is live", () => {
    const derived = deriveEntitlement({
      requestId: REQUEST_ID,
      subscriptions: [
        stripeSubscription({
          id: "sub_a",
          status: "canceled",
          periodEnds: [PERIOD_END - 86_400],
          product: ADVANCE,
        }),
        stripeSubscription({
          id: "sub_b",
          status: "active",
          periodEnds: [PERIOD_END],
          product: CLASSIC,
        }),
      ],
    });

    expect(derived.tier).toBe("classic");
    expect(derived.capabilities).toEqual([
      "household_net_worth",
      "multi_device_sync",
    ]);
    expect(derived.current_period_end).toBe(PERIOD_END);
    expect(metricNames).not.toContain("DuplicateSubscription");
  });

  /* Deterministic: the same set must derive the same tier label whichever order
   * Stripe happened to list it in. */
  it("derives the same answer whatever order the subscriptions arrive in", () => {
    const first = stripeSubscription({
      id: "sub_a",
      status: "active",
      periodEnds: [PERIOD_END],
      product: CLASSIC,
    });
    const second = stripeSubscription({
      id: "sub_b",
      status: "active",
      periodEnds: [PERIOD_END],
      product: ADVANCE,
    });

    expect(
      deriveEntitlement({ subscriptions: [first, second], requestId: REQUEST_ID }),
    ).toEqual(
      deriveEntitlement({ subscriptions: [second, first], requestId: REQUEST_ID }),
    );
  });

  it("handles a subscription with no items as having no period end", () => {
    expect(
      deriveEntitlement({
        requestId: REQUEST_ID,
        subscriptions: [
          stripeSubscription({
            status: "active",
            periodEnds: [],
            product: ADVANCE,
          }),
        ],
      }),
    ).toMatchObject({ current_period_end: null, malformed: true });
  });
});

describe("the stored record and the wire projection", () => {
  it("reads a stored item back, dropping a capability name it does not know", () => {
    const record = toEntitlementRecord({
      tier: "advance",
      capabilities: ["hosted_ai", "nope", "multi_device_sync"],
      status: "active",
      current_period_end: PERIOD_END,
      monthly_request_limit: 1000,
      source: "stripe",
      statement: "NXS1.a.b",
      statement_iat: 1,
      statement_exp: 2,
      version: 7,
      event_watermark: 99,
    });

    expect(record.capabilities).toEqual(["hosted_ai", "multi_device_sync"]);
    expect(record.version).toBe(7);
    expect(record.event_watermark).toBe(99);
    expect(record.stripe_state).toBeNull();
  });

  it("defaults an unrecognised source to stripe, never to admin", () => {
    for (const source of [undefined, "", "root", 42, null]) {
      expect(toEntitlementRecord({ source }).source, String(source)).toBe(
        "stripe",
      );
    }
    expect(toEntitlementRecord({ source: "admin" }).source).toBe("admin");
  });

  it("reads the recorded Stripe state back when one was written", () => {
    const record = toEntitlementRecord({
      source: "admin",
      stripe_tier: "classic",
      stripe_capabilities: ["multi_device_sync"],
      stripe_status: "active",
      stripe_current_period_end: PERIOD_END,
      stripe_monthly_request_limit: null,
    });

    expect(record.stripe_state).toEqual({
      tier: "classic",
      capabilities: ["multi_device_sync"],
      status: "active",
      current_period_end: PERIOD_END,
      monthly_request_limit: null,
      malformed: false,
    });
  });

  it("projects the wire response, with a null version only for a free answer", () => {
    expect(
      toEntitlementResponse({
        state: FREE_ENTITLEMENT,
        source: "stripe",
        statement: "NXS1.a.b",
        statementExp: 2,
        version: null,
      }),
    ).toEqual({
      tier: "free",
      capabilities: [],
      status: "none",
      current_period_end: null,
      monthly_request_limit: null,
      source: "stripe",
      statement: "NXS1.a.b",
      statement_exp: 2,
      version: null,
    });
  });
});

describe("an override out-ranks a webhook only while it is live (AD-2)", () => {
  const NOW_SECONDS = 1_795_003_200;

  it("is live only for an admin source with a future expiry", () => {
    expect(
      isAdminOverrideLive({
        source: "admin",
        adminExpiresAt: NOW_SECONDS + 1,
        nowSeconds: NOW_SECONDS,
      }),
    ).toBe(true);
  });

  it.each([
    ["an expiry in the past", "admin", NOW_SECONDS - 1],
    ["an expiry exactly now", "admin", NOW_SECONDS],
    ["no expiry at all", "admin", null],
    ["a stripe-sourced record", "stripe", NOW_SECONDS + 1],
  ])("is not live for %s", (_label, source, adminExpiresAt) => {
    expect(
      isAdminOverrideLive({
        source: source as "admin" | "stripe",
        adminExpiresAt,
        nowSeconds: NOW_SECONDS,
      }),
    ).toBe(false);
  });
});
