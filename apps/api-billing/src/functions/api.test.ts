import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { APIGatewayProxyEvent } from "aws-lambda";

import { BILLING_CLIENT_VERSION_HEADER } from "@nixus/shared";

import {
  ADMINISTRATIVE_GROUP,
  UNAUTHENTICATED_ROUTE_KEYS,
  dispatch,
  isAdministrativeClaim,
  rawBodyOf,
} from "./api.ts";
import { resetCatalogCacheForTesting } from "../lib/catalog.ts";
import { resetFreeStatementLimitForTesting } from "../handlers/entitlement.ts";
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
  stripePrice,
  stripeProduct,
} from "../lib/testing/fake-stripe.ts";
import {
  SUB_A,
  TEST_CATALOG_TTL_SECONDS,
  administrativeApiEvent,
  apiEvent,
  clearBillingEnvironment,
  fakeSecretsSsmClient,
  installBillingEnvironment,
  unauthenticatedApiEvent,
} from "../lib/testing/fixtures.ts";
import { setDocumentClientForTesting } from "../lib/table.ts";

/*
 * Route-level contract for the six routes (AD-3/AD-13). What is asserted here is
 * the DISPATCHER - which routes require an identity, which require an
 * administrative claim, where validation runs, and what reaches a log line - and
 * each handler's own rules are asserted in its own co-located spec.
 */

const NOW = new Date("2026-11-18T12:00:00.000Z");
const CATALOG_TTL = TEST_CATALOG_TTL_SECONDS;

const CLASSIC = stripeProduct({
  id: "prod_classic",
  metadata: {
    nixus_tier: "classic",
    nixus_capabilities: "multi_device_sync,household_net_worth",
  },
});

let captured: string[];
let dynamo: FakeDynamo;
let stripe: FakeStripe;

async function call(args: {
  readonly route: string;
  readonly method: string;
  readonly sub?: string;
  readonly groups?: readonly string[];
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}) {
  const response = await dispatch(apiEvent(args), () => NOW);
  return {
    status: response.statusCode,
    headers: response.headers ?? {},
    payload: JSON.parse(response.body as string) as Record<string, unknown>,
    raw: response.body as string,
  };
}

function lastLine(): Record<string, unknown> {
  return JSON.parse(captured.at(-1)!) as Record<string, unknown>;
}

beforeEach(() => {
  installBillingEnvironment();
  dynamo = new FakeDynamo();
  setDocumentClientForTesting(dynamo.asDocumentClient());
  setSsmClientForTesting(fakeSecretsSsmClient());
  setKmsClientForTesting(new FakeKms().asKmsClient());

  stripe = new FakeStripe().seedPrices([
    stripePrice({
      id: "price_classic",
      lookupKey: "classic_monthly_cad",
      product: CLASSIC,
    }),
  ]);
  setStripeClientForTesting(stripe.asStripe());

  resetStripeSecretsForTesting();
  resetCatalogCacheForTesting();
  resetFreeStatementLimitForTesting();

  captured = [];
  const capture = (...args: unknown[]) => {
    captured.push(args.map((arg) => String(arg)).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});

afterEach(() => {
  setDocumentClientForTesting(undefined);
  setSsmClientForTesting(undefined);
  setStripeClientForTesting(undefined);
  setKmsClientForTesting(undefined);
  resetStripeSecretsForTesting();
  resetCatalogCacheForTesting();
  resetFreeStatementLimitForTesting();
  vi.restoreAllMocks();
  clearBillingEnvironment();
});

describe("AD-3 the unauthenticated route set is closed and exactly two", () => {
  it("names exactly POST /webhook and GET /plans", () => {
    expect([...UNAUTHENTICATED_ROUTE_KEYS].sort()).toEqual([
      "GET /plans",
      "POST /webhook",
    ]);
  });

  /* The whole reason the dispatcher is structured around one closed list: a
   * webhook from Stripe carries no Cognito token and never will, so requiring an
   * identity on it would answer Stripe with a 401 forever. */
  it("serves GET /plans with no authorizer and no claims at all", async () => {
    const response = await dispatch(
      unauthenticatedApiEvent({ route: "/plans", method: "GET" }),
      () => NOW,
    );

    expect(response.statusCode).toBe(200);
    // SUPERSEDED STUB-ERA ASSERTION: this previously expected `plans: []`,
    // which was the only possible answer while the catalog read did not exist.
    // The property it was protecting - a public answer with no identity and no
    // user data - is what is asserted now, over a catalog that has content.
    expect(JSON.parse(response.body as string)).toEqual({
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
      ],
      cache_ttl_seconds: CATALOG_TTL,
    });
  });

  /* An empty catalog stays a correct, NON-failing answer: a pricing page
   * hydrating over it keeps its baked fallback copy (AD-6). */
  it("answers 200 with no plans for a stack whose Products do not exist yet", async () => {
    stripe.seedPrices([]);
    resetCatalogCacheForTesting();

    const response = await dispatch(
      unauthenticatedApiEvent({ route: "/plans", method: "GET" }),
      () => NOW,
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body as string)).toEqual({
      plans: [],
      cache_ttl_seconds: CATALOG_TTL,
    });
  });

  it("reaches the webhook handler with no claims, rather than refusing it", async () => {
    const response = await dispatch(
      unauthenticatedApiEvent({
        route: "/webhook",
        method: "POST",
        rawBody: '{"id":"evt_1","object":"event"}',
        headers: { "Stripe-Signature": "t=1,v1=abc" },
      }),
      () => NOW,
    );

    // SUPERSEDED STUB-ERA ASSERTION: this previously expected the stub's 503.
    // The forged signature is now refused by the handler itself with a 400, and
    // the property the original assertion existed for is unchanged and still
    // asserted - it is NOT the 401 an identity check would have produced, so a
    // webhook from Stripe reached the handler rather than being refused for
    // carrying no Cognito token.
    expect(response.statusCode).toBe(400);
    expect(
      (JSON.parse(response.body as string) as { error: { code: string } }).error
        .code,
    ).toBe("validation");

    // AD-5: refused before any read and before any outbound Stripe call.
    expect(dynamo.sent).toHaveLength(0);
    expect(stripe.countOf("subscriptions.retrieve")).toBe(0);
  });

  it.each([
    ["/checkout", "POST"],
    ["/portal", "POST"],
    ["/entitlement", "GET"],
    ["/admin/override", "POST"],
  ])("refuses %s %s with no claims", async (route, method) => {
    const response = await dispatch(
      unauthenticatedApiEvent({ route, method }),
      () => NOW,
    );

    expect(response.statusCode).toBe(401);
    expect(
      (JSON.parse(response.body as string) as { error: { code: string } }).error
        .code,
    ).toBe("unauthorized");
  });
});

describe("identity comes from the authorizer and must look like a sub", () => {
  it.each([
    ["not-a-uuid"],
    [""],
    ["11111111-2222-4333-8444-55555555555"],
  ])("refuses the claim %s before composing a key", async (sub) => {
    const response = await call({ route: "/entitlement", method: "GET", sub });

    expect(response.status).toBe(401);
    expect(response.payload.error).toMatchObject({ code: "unauthorized" });
    // The value is never echoed, in the body or the log line (AD-14).
    expect(`${response.raw}\n${captured.join("\n")}`).not.toContain(sub || "\u0000");
  });

  it("logs no subject at all for a rejected identity", async () => {
    await call({ route: "/entitlement", method: "GET", sub: "not-a-uuid" });

    expect(lastLine().sub).toBeNull();
    expect(lastLine().status).toBe(401);
  });

  it("never reads a sub from a body or a path", async () => {
    const response = await call({
      route: "/entitlement",
      method: "GET",
      body: { sub: SUB_A },
    });

    expect(response.status).toBe(401);
  });
});

describe("AD-2 the admin route needs an administrative claim", () => {
  it("requires cognito:groups to carry the group", () => {
    expect(ADMINISTRATIVE_GROUP).toBe("nixus-billing-admin");

    // The REST authorizer flattens a token's array claim into `[a b]`, so both
    // shapes are accepted and neither is assumed.
    expect(
      isAdministrativeClaim({ "cognito:groups": "[nixus-billing-admin]" }),
    ).toBe(true);
    expect(
      isAdministrativeClaim({
        "cognito:groups": "[beta-testers nixus-billing-admin]",
      }),
    ).toBe(true);
    expect(
      isAdministrativeClaim({ "cognito:groups": ["nixus-billing-admin"] }),
    ).toBe(true);
    expect(
      isAdministrativeClaim({ "cognito:groups": "beta,nixus-billing-admin" }),
    ).toBe(true);
  });

  it.each([
    [undefined],
    [{}],
    [{ "cognito:groups": "[]" }],
    [{ "cognito:groups": "[beta-testers]" }],
    [{ "cognito:groups": [] }],
    [{ "cognito:groups": ["nixus-billing-admins"] }],
    [{ "cognito:groups": "[nixus-billing-admin-readonly]" }],
    [{ "cognito:groups": 42 }],
    [{ "cognito:groups": null }],
  ])("refuses the claim set %s", (claims) => {
    expect(
      isAdministrativeClaim(claims as Record<string, unknown> | undefined),
    ).toBe(false);
  });

  /* A token with a valid `sub` and the billing scope is still not enough: the
   * grant is administrative, so the claim is required on top of them. */
  it("answers unauthorized for a valid token without the group", async () => {
    const response = await call({
      route: "/admin/override",
      method: "POST",
      sub: SUB_A,
      body: { sub: SUB_A },
    });

    expect(response.status).toBe(401);
    expect(response.payload.error).toMatchObject({ code: "unauthorized" });
  });

  /* The claim check runs BEFORE validation, so a caller without the group learns
   * nothing about the body's shape. */
  it("checks the claim before validating the body", async () => {
    const response = await call({
      route: "/admin/override",
      method: "POST",
      sub: SUB_A,
      body: { nonsense: true },
    });

    expect(response.status).toBe(401);
    expect(response.payload.error).not.toHaveProperty("field");
  });

  it("reaches validation once the group is present", async () => {
    const response = await dispatch(
      administrativeApiEvent({
        route: "/admin/override",
        method: "POST",
        body: { nonsense: true },
      }),
      () => NOW,
    );

    expect(response.statusCode).toBe(400);
    expect(
      (JSON.parse(response.body as string) as { error: Record<string, unknown> })
        .error,
    ).toMatchObject({
      code: "validation",
      field: "body",
      reason: "unknown_field",
    });
  });
});

describe("validation runs in the dispatcher, before the handler", () => {
  /* `POST /checkout` is a stub that answers `unavailable`, so a 400 proves the
   * body was refused before the handler was reached. */
  it("refuses a malformed checkout body with 400, not 503", async () => {
    const response = await call({
      route: "/checkout",
      method: "POST",
      sub: SUB_A,
      body: { plan_lookup_key: "Classic_Monthly" },
    });

    expect(response.status).toBe(400);
    expect(response.payload.error).toMatchObject({
      code: "validation",
      field: "plan_lookup_key",
    });
  });

  /* SUPERSEDED STUB-ERA ASSERTION: this previously expected the stub's 503 to
   * prove the body had passed validation. A real session URL proves the same
   * thing and more. */
  it("reaches the handler and opens a session once the body is well-formed", async () => {
    const response = await call({
      route: "/checkout",
      method: "POST",
      sub: SUB_A,
      body: { plan_lookup_key: "classic_monthly_cad", promotion_code: null },
    });

    expect(response.status).toBe(200);
    expect(response.payload).toMatchObject({ destination: "checkout" });
  });

  /* A caller who has never checked out has no portal to open, and that is NOT a
   * passing outage: every hand-granted account is permanently in this state, so
   * the status must not be the 503 a client treats as retryable. */
  it("refuses /portal cleanly for a caller with no Stripe customer", async () => {
    const response = await call({ route: "/portal", method: "POST", sub: SUB_A });

    expect(response.status).toBe(409);
    expect(response.payload.error).toMatchObject({ code: "no_subscription" });
  });

  it("answers /entitlement with a signed free statement and no record", async () => {
    const response = await call({
      route: "/entitlement",
      method: "GET",
      sub: SUB_A,
    });

    expect(response.status).toBe(200);
    expect(response.payload).toMatchObject({
      tier: "free",
      capabilities: [],
      status: "none",
      version: null,
    });
    expect(String(response.payload.statement)).toMatch(/^NXS1\./);
    // No entitlement write: the free answer creates no record (AD-9).
    expect(dynamo.puts).toHaveLength(0);
    expect(dynamo.transactions).toHaveLength(0);
  });
});

describe("AD-5 the raw body is the exact bytes Stripe signed", () => {
  /* Correct whether or not BinaryMediaTypes is set on the API, which is what lets
   * that template switch be flipped with no change here: the proxy integration
   * either hands over the body verbatim or base64-encodes it, and both decode to
   * the same buffer. */
  it("decodes an identical buffer from either transport encoding", () => {
    const signed = '{"id":"evt_1","object":"event","livemode":false}';
    const utf8 = rawBodyOf(
      unauthenticatedApiEvent({
        route: "/webhook",
        method: "POST",
        rawBody: signed,
      }),
    );
    const base64 = rawBodyOf(
      unauthenticatedApiEvent({
        route: "/webhook",
        method: "POST",
        rawBody: Buffer.from(signed, "utf8").toString("base64"),
        isBase64Encoded: true,
      }),
    );

    expect(utf8.toString("utf8")).toBe(signed);
    expect(base64.equals(utf8)).toBe(true);
  });

  /* A multi-byte body is where a length-based or re-serialising path breaks: the
   * signature is over BYTES. */
  it("preserves multi-byte bytes exactly", () => {
    const signed = '{"description":"Café — Montréal"}';
    const bytes = rawBodyOf(
      unauthenticatedApiEvent({
        route: "/webhook",
        method: "POST",
        rawBody: Buffer.from(signed, "utf8").toString("base64"),
        isBase64Encoded: true,
      }),
    );

    expect(bytes).toEqual(Buffer.from(signed, "utf8"));
    expect(bytes.length).toBeGreaterThan(signed.length);
  });

  it("yields an empty buffer rather than throwing on an absent body", () => {
    expect(
      rawBodyOf(unauthenticatedApiEvent({ route: "/webhook", method: "POST" })),
    ).toEqual(Buffer.alloc(0));
  });
});

describe("headers the contract defines are read case-insensitively", () => {
  /* API Gateway does not normalise header case, and the entitlement route's
   * revocation floor depends on reading this one (AD-9). */
  it("finds the client-version header whatever case it arrives in", async () => {
    for (const name of [
      BILLING_CLIENT_VERSION_HEADER,
      "X-Nixus-Client-Version",
      "X-NIXUS-CLIENT-VERSION",
    ]) {
      const response = await call({
        route: "/entitlement",
        method: "GET",
        sub: SUB_A,
        headers: { [name]: "1.2.3" },
      });

      // SUPERSEDED STUB-ERA ASSERTION: the stub's 503 proved the request reached
      // the handler; a served statement proves it reached the handler AND that
      // the floor read the header it was given.
      expect(response.status, name).toBe(200);
    }
  });
});

describe("an undeclared route is a server defect, never a client error", () => {
  /* Unreachable through the deployed API - API Gateway answers an undeclared
   * route itself - so reaching it means the template and this router disagree. */
  it("answers unavailable for a route the template does not declare", async () => {
    const response = await call({
      route: "/refund",
      method: "POST",
      sub: SUB_A,
    });

    expect(response.status).toBe(503);
    expect(response.payload.error).toMatchObject({ code: "unavailable" });
  });

  it("answers unavailable for a declared route with the wrong method", async () => {
    const response = await call({
      route: "/entitlement",
      method: "DELETE",
      sub: SUB_A,
    });

    expect(response.status).toBe(503);
  });
});

describe("every response and every log line", () => {
  it("answers JSON with the contract's envelope", async () => {
    const response = await call({ route: "/portal", method: "POST", sub: SUB_A });

    expect(response.headers["Content-Type"]).toBe("application/json");
    expect(Object.keys(response.payload)).toEqual(["error"]);
  });

  /* Derived from THE single cache bound, never a second one (AD-6). */
  it("derives the catalog's Cache-Control from the configured TTL", async () => {
    const response = await dispatch(
      unauthenticatedApiEvent({ route: "/plans", method: "GET" }),
      () => NOW,
    );

    expect(response.headers?.["Cache-Control"]).toBe(
      `public, max-age=${CATALOG_TTL}`,
    );
  });

  /* AD-6's advertised-price path crosses an origin boundary: the marketing site is
     nixusapp.com and this API is api.nixusapp.com, so without the header the browser
     refuses the read and the pricing page is pinned to its baked fallback forever -
     which is exactly what happened against the deployed stack. The same test pins the
     other half: no AUTHORIZED route may carry it, because none is browser-reachable
     and a wildcard there would be a real hole. */
  it("lets a browser read the public catalog and no authorized route", async () => {
    const plans = await dispatch(
      unauthenticatedApiEvent({ route: "/plans", method: "GET" }),
      () => NOW,
    );

    expect(plans.headers?.["Access-Control-Allow-Origin"]).toBe("*");

    for (const [route, method] of [
      ["/entitlement", "GET"],
      ["/checkout", "POST"],
      ["/portal", "POST"],
      ["/admin/override", "POST"],
    ] as const) {
      const response = await call({ route, method, sub: SUB_A });
      expect(
        response.headers?.["Access-Control-Allow-Origin"],
        `${method} ${route} must not be browser-readable`,
      ).toBeUndefined();
    }
  });

  it("logs the allow-listed fields and nothing else", async () => {
    await call({ route: "/portal", method: "POST", sub: SUB_A });

    expect(Object.keys(lastLine()).sort()).toEqual([
      "capabilities",
      "error_code",
      "event",
      "latency_ms",
      "method",
      "request_id",
      "route",
      "status",
      "stripe_event_id",
      "stripe_event_type",
      "sub",
      "tier",
    ]);
    expect(lastLine().sub).toBe(SUB_A);
    expect(lastLine().route).toBe("/portal");
    expect(lastLine().error_code).toBe("no_subscription");
    expect(typeof lastLine().latency_ms).toBe("number");
  });

  it("never logs a request body, a promotion code, or a signature header", async () => {
    await call({
      route: "/checkout",
      method: "POST",
      sub: SUB_A,
      body: {
        plan_lookup_key: "classic_monthly_cad",
        promotion_code: "ZZQQXXPROMO",
      },
      headers: { "Stripe-Signature": "t=1,v1=ZZQQXXSIGNATURE" },
    });

    const haystack = captured.join("\n");
    expect(haystack).not.toContain("ZZQQXXPROMO");
    expect(haystack).not.toContain("ZZQQXXSIGNATURE");
    expect(haystack).not.toContain("plan_lookup_key");
  });

  it("logs exactly one line per request", async () => {
    await call({ route: "/portal", method: "POST", sub: SUB_A });

    // The stub's `unavailable` is a classified failure, not an unhandled throw,
    // so no second `billing_unhandled_error` line is written.
    expect(captured).toHaveLength(1);
    expect(lastLine().event).toBe("billing_request");
  });

  /* A throw the router did not classify is `unavailable` plus a second line
   * carrying only the error's class name - a message can carry a Stripe key or a
   * raw webhook body (AD-14). */
  it("records an unclassified throw as a class name", async () => {
    delete process.env.CATALOG_CACHE_TTL_SECONDS;

    const response = await dispatch(
      unauthenticatedApiEvent({ route: "/plans", method: "GET" }),
      () => NOW,
    );

    expect(response.statusCode).toBe(503);
    const haystack = captured.join("\n");
    expect(haystack).toContain("billing_unhandled_error");
    expect(haystack).toContain('"error_name":"Error"');
    expect(haystack).not.toContain("CATALOG_CACHE_TTL_SECONDS is not configured");
  });

  it("falls back to the path when the event carries no resource", async () => {
    const event = apiEvent({
      route: "/portal",
      method: "POST",
      sub: SUB_A,
    }) as APIGatewayProxyEvent & { resource: string };
    event.resource = "";

    expect((await dispatch(event, () => NOW)).statusCode).toBe(409);
    expect(lastLine().route).toBe("/portal");
  });
});
