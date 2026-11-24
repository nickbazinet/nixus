import { sendJson, startFake, type RunningFake } from "./fake";

/**
 * Stub billing API, standing in for `https://api.nixusapp.com/v1/billing`.
 *
 * It enforces the things the BFF's behaviour depends on, and nothing more:
 *
 *  - A bearer token must be present on every authorized route, so a request that
 *    lost its token fails here rather than silently succeeding.
 *  - **The account is resolved from the TOKEN and from nothing else** (billing
 *    AD-3). There is no customer or subject parameter, so the only way this stub
 *    can be made to answer for another account is by presenting that account's
 *    token — which is exactly what the cross-account spec proves is impossible.
 *  - `GET /plans` is public and needs no token.
 *
 * It also serves two stand-in hosted pages, so the browser can really follow the
 * url the BFF hands it. They are the only thing here that is not the contract:
 * a real Checkout and a real Portal are Stripe-hosted (AD-8), and what the spec
 * needs to prove is that this app redirects OUT to whatever url it was given.
 */

export interface StubAccount {
  /** Opaque tier code, as Stripe Product metadata would carry it. */
  tier: string;
  status: string;
  current_period_end: number | null;
  capabilities: string[];
  monthly_request_limit: number | null;
  source: string;
  version: number | null;
  /** What Stripe is billing. `null` when no Stripe state ever converged. */
  stripe_state: {
    tier: string;
    status: string;
    current_period_end: number | null;
  } | null;
}

export type BillingRefusal =
  | { readonly code: "checkout_in_progress" }
  | { readonly code: "promotion_invalid" }
  | { readonly code: "unavailable" }
  | { readonly code: "rate_limited" }
  | { readonly code: "unauthorized"; readonly status: 401 | 403 }
  | {
      readonly code: "validation";
      readonly field: string;
      readonly reason: string;
    };

export interface RecordedCall {
  readonly method: string;
  readonly path: string;
  readonly token: string;
  readonly clientVersion: string | undefined;
  readonly body: string;
}

export interface RunningBillingApi extends RunningFake {
  /** Every authorized call, in order, for the assertions no DOM can make. */
  readonly calls: RecordedCall[];
  /** Entitlement per access token. An unmapped token is a free account. */
  readonly accounts: Map<string, StubAccount>;
  /** Forces the next `POST /checkout` to answer with this refusal. */
  refuseCheckoutNext: BillingRefusal | null;
  /** Forces the next `POST /portal` to answer with this refusal. */
  refusePortalNext: BillingRefusal | null;
  /** Forces every `GET /entitlement` to answer with this refusal. */
  refuseEntitlement: BillingRefusal | null;
  /** Forces `GET /plans` to answer `unavailable`. */
  plansUnavailable: boolean;
  /** Also publishes a yearly price for each tier. */
  yearlyPlans: boolean;
  /** Also publishes the Advance trial Price, as production does. */
  trialPlans: boolean;
  /** Promotes a token's account on the Nth `GET /entitlement`, modelling AD-5's lag. */
  convergeEntitlementAfter: number | null;
}

export const FREE_ACCOUNT: StubAccount = {
  tier: "free",
  status: "none",
  current_period_end: null,
  capabilities: [],
  monthly_request_limit: null,
  source: "stripe",
  version: null,
  stripe_state: null,
};

export const ADVANCE_ACCOUNT: StubAccount = {
  tier: "advance",
  status: "active",
  current_period_end: 1796083200,
  capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
  monthly_request_limit: 1000,
  source: "stripe",
  version: 7,
  stripe_state: {
    tier: "advance",
    status: "active",
    current_period_end: 1796083200,
  },
};

export const CLASSIC_ACCOUNT: StubAccount = {
  tier: "classic",
  status: "active",
  current_period_end: 1796083200,
  capabilities: ["household_net_worth", "multi_device_sync"],
  monthly_request_limit: null,
  source: "stripe",
  version: 3,
  stripe_state: {
    tier: "classic",
    status: "active",
    current_period_end: 1796083200,
  },
};

/** A finished subscription: no trial on offer, because one was already had. */
export const CANCELED_ACCOUNT: StubAccount = {
  tier: "advance",
  status: "canceled",
  current_period_end: 1796083200,
  capabilities: [],
  monthly_request_limit: null,
  source: "stripe",
  version: 9,
  stripe_state: {
    tier: "advance",
    status: "canceled",
    current_period_end: 1796083200,
  },
};

/** Already on the trial. The offer must not be made a second time. */
export const TRIALING_ACCOUNT: StubAccount = {
  tier: "advance",
  status: "trialing",
  current_period_end: 1796083200,
  capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
  monthly_request_limit: 1000,
  source: "stripe",
  version: 2,
  stripe_state: {
    tier: "advance",
    status: "trialing",
    current_period_end: 1796083200,
  },
};

/** Hand-granted by an operator, with no Stripe customer behind it (AD-17 backfill). */
export const GRANT_ONLY_ACCOUNT: StubAccount = {
  tier: "advance",
  status: "none",
  current_period_end: null,
  capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
  monthly_request_limit: 2000,
  source: "admin",
  version: 1,
  stripe_state: null,
};

/** The state that caused this: a grant out-ranking a subscription Stripe is billing. */
export const OVERRIDE_OVER_PAID_ACCOUNT: StubAccount = {
  ...GRANT_ONLY_ACCOUNT,
  version: 3,
  stripe_state: {
    tier: "classic",
    status: "active",
    current_period_end: 1797680175,
  },
};

const PLANS = {
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
      trial_period_days: null,
    },
    {
      tier: "advance",
      lookup_key: "advance_monthly_cad",
      unit_amount_cents: 1999,
      currency: "CAD",
      interval: "month",
      display_order: 2,
      capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
      monthly_request_limit: 1000,
      trial_period_days: null,
    },
  ],
  cache_ttl_seconds: 300,
};

const YEARLY_PLANS = {
  ...PLANS,
  plans: [
    ...PLANS.plans,
    {
      tier: "classic",
      lookup_key: "classic_yearly_cad",
      unit_amount_cents: 9999,
      currency: "CAD",
      interval: "year",
      display_order: 1,
      capabilities: ["household_net_worth", "multi_device_sync"],
      monthly_request_limit: null,
      trial_period_days: null,
    },
    {
      tier: "advance",
      lookup_key: "advance_yearly_cad",
      unit_amount_cents: 12999,
      currency: "CAD",
      interval: "year",
      display_order: 2,
      capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
      monthly_request_limit: 1000,
      trial_period_days: null,
    },
  ],
};

/**
 * The published trial Price: the same tier, interval and amount as the plan it
 * leads into, distinguished only by `trial_period_days` — which is exactly how
 * the live `advance_trial` Price is configured (billing AD-6).
 */
const TRIAL_PLAN = {
  tier: "advance",
  lookup_key: "advance_trial",
  unit_amount_cents: 1999,
  currency: "CAD",
  interval: "month",
  display_order: 2,
  capabilities: ["hosted_ai", "household_net_worth", "multi_device_sync"],
  monthly_request_limit: 1000,
  trial_period_days: 7,
};

const STATUS_FOR: Record<string, number> = {
  unauthorized: 401,
  reauthentication_required: 403,
  validation: 400,
  premium_required: 403,
  version_conflict: 409,
  rate_limited: 429,
  unavailable: 503,
  promotion_invalid: 400,
  checkout_in_progress: 409,
  client_too_old: 403,
};

function envelope(refusal: BillingRefusal) {
  const { code, ...extra } = refusal as BillingRefusal & Record<string, unknown>;
  delete extra.status;
  return {
    error: { code, message: "fixed sentence", request_id: "req-stub", ...extra },
  };
}

/** A statement shaped like the contract's, so the BFF has one to drop on the floor. */
function statementFor(account: StubAccount): string {
  const payload = Buffer.from(
    JSON.stringify({ tier: account.tier, capabilities: account.capabilities }),
  ).toString("base64url");
  return `NXS1.${payload}.MEUCIQCstubsignaturebytes`;
}

function hostedPage(testId: string, heading: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${heading}</title></head><body><h1 data-testid="${testId}">${heading}</h1></body></html>`;
}

export async function startBillingApi(): Promise<RunningBillingApi> {
  const calls: RecordedCall[] = [];
  const accounts = new Map<string, StubAccount>();
  const entitlementReads = new Map<string, number>();
  const state = {
    refuseCheckoutNext: null as BillingRefusal | null,
    refusePortalNext: null as BillingRefusal | null,
    refuseEntitlement: null as BillingRefusal | null,
    plansUnavailable: false,
    yearlyPlans: false,
    trialPlans: false,
    convergeEntitlementAfter: null as number | null,
  };

  /** What `GET /plans` currently publishes, and what `POST /checkout` accepts. */
  function publishedCatalog(): { plans: Record<string, unknown>[]; cache_ttl_seconds: number } {
    const base = state.yearlyPlans ? YEARLY_PLANS : PLANS;
    return state.trialPlans ? { ...base, plans: [...base.plans, TRIAL_PLAN] } : base;
  }

  const fake = await startFake("billing-api", (request, response) => {
    const path = request.url.pathname.replace(/^\/v1\/billing/, "");

    if (path === "/hosted-checkout") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(hostedPage("stub-hosted-checkout", "Stub hosted checkout"));
      return true;
    }
    if (path === "/hosted-portal") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(hostedPage("stub-hosted-portal", "Stub customer portal"));
      return true;
    }

    // Public and unauthenticated, exactly as the contract says (AD-3).
    if (path === "/plans" && request.method === "GET") {
      return state.plansUnavailable
        ? sendJson(response, 503, envelope({ code: "unavailable" }))
        : sendJson(response, 200, publishedCatalog());
    }

    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) {
      return sendJson(response, 401, envelope({ code: "unauthorized", status: 401 }));
    }
    const token = authorization.slice(7);
    const clientVersion = request.headers["x-nixus-client-version"];

    calls.push({
      method: request.method,
      path,
      token,
      clientVersion: Array.isArray(clientVersion) ? clientVersion[0] : clientVersion,
      body: request.body,
    });

    if (path === "/entitlement" && request.method === "GET") {
      const entitlementRefusal = state.refuseEntitlement;
      if (entitlementRefusal !== null) {
        const status =
          "status" in entitlementRefusal
            ? entitlementRefusal.status
            : STATUS_FOR[entitlementRefusal.code];
        return sendJson(response, status ?? 503, envelope(entitlementRefusal));
      }

      const reads = (entitlementReads.get(token) ?? 0) + 1;
      entitlementReads.set(token, reads);

      if (
        state.convergeEntitlementAfter !== null &&
        reads >= state.convergeEntitlementAfter
      ) {
        accounts.set(token, ADVANCE_ACCOUNT);
      }

      const account = accounts.get(token) ?? FREE_ACCOUNT;
      return sendJson(response, 200, {
        ...account,
        statement: statementFor(account),
        statement_exp: 1795089600,
      });
    }

    if (path === "/checkout" && request.method === "POST") {
      const refusal = state.refuseCheckoutNext;
      if (refusal !== null) {
        state.refuseCheckoutNext = null;
        const status = "status" in refusal ? refusal.status : STATUS_FOR[refusal.code];
        return sendJson(response, status ?? 503, envelope(refusal));
      }

      const body = JSON.parse(request.body) as {
        plan_lookup_key?: unknown;
        promotion_code?: unknown;
      };
      const published = publishedCatalog().plans.some(
        (plan) => plan.lookup_key === body.plan_lookup_key,
      );
      if (!published) {
        return sendJson(
          response,
          400,
          envelope({ code: "validation", field: "plan_lookup_key", reason: "not_allowed" }),
        );
      }

      // AD-18: an account with a live subscription is routed to the portal BY
      // THE SERVER, never to a second Checkout Session.
      const live = (accounts.get(token) ?? FREE_ACCOUNT).status !== "none";
      return sendJson(response, 200, {
        url: live
          ? `${fake.origin}/v1/billing/hosted-portal?for=${encodeURIComponent(token)}`
          : `${fake.origin}/v1/billing/hosted-checkout?for=${encodeURIComponent(token)}`,
        destination: live ? "portal" : "checkout",
      });
    }

    if (path === "/portal" && request.method === "POST") {
      const refusal = state.refusePortalNext;
      if (refusal !== null) {
        state.refusePortalNext = null;
        const status = "status" in refusal ? refusal.status : STATUS_FOR[refusal.code];
        return sendJson(response, status ?? 503, envelope(refusal));
      }
      if ((accounts.get(token) ?? FREE_ACCOUNT).status === "none") {
        return sendJson(response, 503, envelope({ code: "unavailable" }));
      }
      return sendJson(response, 200, {
        url: `${fake.origin}/v1/billing/hosted-portal?for=${encodeURIComponent(token)}`,
      });
    }

    return false;
  });

  return {
    origin: fake.origin,
    close: fake.close,
    calls,
    accounts,
    get refuseCheckoutNext() {
      return state.refuseCheckoutNext;
    },
    set refuseCheckoutNext(value: BillingRefusal | null) {
      state.refuseCheckoutNext = value;
    },
    get refusePortalNext() {
      return state.refusePortalNext;
    },
    set refusePortalNext(value: BillingRefusal | null) {
      state.refusePortalNext = value;
    },
    get refuseEntitlement() {
      return state.refuseEntitlement;
    },
    set refuseEntitlement(value: BillingRefusal | null) {
      state.refuseEntitlement = value;
    },
    get plansUnavailable() {
      return state.plansUnavailable;
    },
    set plansUnavailable(value: boolean) {
      state.plansUnavailable = value;
    },
    get yearlyPlans() {
      return state.yearlyPlans;
    },
    set yearlyPlans(value: boolean) {
      state.yearlyPlans = value;
    },
    get trialPlans() {
      return state.trialPlans;
    },
    set trialPlans(value: boolean) {
      state.trialPlans = value;
    },
    get convergeEntitlementAfter() {
      return state.convergeEntitlementAfter;
    },
    set convergeEntitlementAfter(value: number | null) {
      state.convergeEntitlementAfter = value;
    },
  };
}
