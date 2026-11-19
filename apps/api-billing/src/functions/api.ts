import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { BILLING_CLIENT_VERSION_HEADER } from "@nixus/shared";

import { handleAdminOverride } from "../handlers/admin.ts";
import { handleCheckout } from "../handlers/checkout.ts";
import { handleEntitlement } from "../handlers/entitlement.ts";
import { handlePlans } from "../handlers/plans.ts";
import { handlePortal } from "../handlers/portal.ts";
import { handleWebhook } from "../handlers/webhook.ts";
import {
  BillingFailureError,
  errorBodyFor,
  fail,
  failureFromUnknown,
  statusFor,
  type BillingFailure,
} from "../lib/errors.ts";
import { logRequest, logUnhandled } from "../lib/logging.ts";
import { isUuidShaped } from "../lib/table.ts";
import {
  validateAdminOverrideRequest,
  validateCheckoutRequest,
} from "../lib/validation.ts";

/*
 * The sole Lambda entry point (AD-3). All six routes are served from here; there
 * is never a Lambda per route. The custom domain's API mapping strips the
 * `v1/billing` base path, so the REST resources are `/checkout`, `/portal`,
 * `/entitlement`, `/admin/override`, `/webhook` and `/plans`.
 */

const JSON_CONTENT_TYPE = "application/json";

export const CHECKOUT_ROUTE = "/checkout";
export const PORTAL_ROUTE = "/portal";
export const ENTITLEMENT_ROUTE = "/entitlement";
export const ADMIN_OVERRIDE_ROUTE = "/admin/override";
export const WEBHOOK_ROUTE = "/webhook";
export const PLANS_ROUTE = "/plans";

/** The Cognito group an `/admin/override` caller must hold (AD-2). */
export const ADMINISTRATIVE_GROUP = "nixus-billing-admin";

/**
 * AD-3's CLOSED set of unauthenticated routes, and the ONE list in this service
 * that decides whether an identity is required. `POST /webhook` is authenticated
 * by the Stripe signature inside its own handler; `GET /plans` carries no user
 * data at all.
 *
 * Adding an entry here is an amendment to AD-3, not a code change: it is a
 * visible, deliberate edit to one place, mirrored by `Auth: {Authorizer: NONE}`
 * on exactly the same two events in template.yaml, and
 * src/template-scaffold.test.ts asserts the two lists agree.
 */
export const UNAUTHENTICATED_ROUTE_KEYS: readonly string[] = [
  `POST ${WEBHOOK_ROUTE}`,
  `GET ${PLANS_ROUTE}`,
];

interface RouteOutcome {
  readonly status: number;
  readonly body: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly code?: BillingFailure["code"];
}

function claimsOf(
  event: APIGatewayProxyEvent,
): Record<string, unknown> | undefined {
  // The authorizer's verified claims are the only source of identity (AD-3).
  return event.requestContext.authorizer?.claims as
    | Record<string, unknown>
    | undefined;
}

function subFromAuthorizer(event: APIGatewayProxyEvent): string | undefined {
  const sub = claimsOf(event)?.sub;
  return typeof sub === "string" ? sub : undefined;
}

/**
 * The administrative gate on `POST /admin/override`, hard-coded rather than read
 * from configuration: a group name supplied by an environment variable would make
 * "who may grant an entitlement" a deploy-time parameter, and a mis-set one would
 * silently widen the gate instead of failing. A token lacking the group is
 * `unauthorized`.
 *
 * The REST authorizer flattens a token's `cognito:groups` array into a string of
 * the form `[a b]`, so both shapes are accepted and neither is assumed.
 */
export function isAdministrativeClaim(
  claims: Record<string, unknown> | undefined,
): boolean {
  const raw = claims?.["cognito:groups"];

  if (Array.isArray(raw)) {
    return raw.some((group) => group === ADMINISTRATIVE_GROUP);
  }
  if (typeof raw !== "string") return false;

  return raw
    .replace(/^\[|\]$/g, "")
    .split(/[\s,]+/)
    .includes(ADMINISTRATIVE_GROUP);
}

function decodeBody(event: APIGatewayProxyEvent): string | undefined {
  if (event.body === null || event.body === undefined) return undefined;
  return event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
}

/**
 * The exact bytes Stripe signed (AD-5). Correct whether or not
 * `BinaryMediaTypes` is set on the API, which is what lets that template switch
 * be flipped with no change here: API Gateway's proxy integration either hands
 * over the body verbatim or base64-encodes it, and both are decoded to the same
 * buffer.
 */
export function rawBodyOf(event: APIGatewayProxyEvent): Buffer {
  if (event.body === null || event.body === undefined) return Buffer.alloc(0);
  return Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8");
}

function headerOf(
  event: APIGatewayProxyEvent,
  name: string,
): string | undefined {
  const headers = event.headers ?? {};
  const match = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === name,
  );
  return typeof match?.[1] === "string" ? match[1] : undefined;
}

function ok(
  payload: unknown,
  headers?: Readonly<Record<string, string>>,
): RouteOutcome {
  // `undefined` would serialize to an empty body; every success body is JSON.
  return { status: 200, body: JSON.stringify(payload ?? null), headers };
}

function failureOutcome(
  failure: BillingFailure,
  requestId: string,
): RouteOutcome {
  return {
    status: statusFor(failure),
    body: JSON.stringify(errorBodyFor(failure, requestId)),
    code: failure.code,
  };
}

/**
 * The two routes that need no identity. Reached BEFORE any claim is examined, so
 * a webhook from Stripe - which carries no Cognito token and never will - is
 * never refused for not having one.
 */
async function runUnauthenticatedRoute(args: {
  readonly routeKey: string;
  readonly event: APIGatewayProxyEvent;
  readonly now: Date;
  readonly requestId: string;
}): Promise<RouteOutcome> {
  const { routeKey, event, now, requestId } = args;

  if (routeKey === `GET ${PLANS_ROUTE}`) {
    const catalog = await handlePlans({ now, requestId });
    return ok(catalog, {
      // Derived from THE single cache bound, never a second one (AD-6).
      "Cache-Control": `public, max-age=${catalog.cache_ttl_seconds}`,
    });
  }
  if (routeKey === `POST ${WEBHOOK_ROUTE}`) {
    return ok(
      await handleWebhook({
        rawBody: rawBodyOf(event),
        signatureHeader: headerOf(event, "stripe-signature") ?? null,
        now,
        requestId,
      }),
    );
  }

  // Unreachable: `routeKey` was matched against UNAUTHENTICATED_ROUTE_KEYS
  // before this was called, so reaching it means the two lists disagree.
  fail("unavailable");
}

async function runAuthorizedRoute(args: {
  readonly routeKey: string;
  readonly event: APIGatewayProxyEvent;
  readonly sub: string;
  readonly body: string | undefined;
  readonly now: Date;
  readonly requestId: string;
}): Promise<RouteOutcome> {
  const { routeKey, event, sub, body, now, requestId } = args;

  if (routeKey === `POST ${CHECKOUT_ROUTE}`) {
    return ok(
      await handleCheckout({
        sub,
        request: validateCheckoutRequest(body),
        now,
        requestId,
      }),
    );
  }
  if (routeKey === `POST ${PORTAL_ROUTE}`) {
    return ok(await handlePortal({ sub, now }));
  }
  if (routeKey === `GET ${ENTITLEMENT_ROUTE}`) {
    return ok(
      await handleEntitlement({
        sub,
        clientVersion: headerOf(event, BILLING_CLIENT_VERSION_HEADER) ?? null,
        now,
        requestId,
      }),
    );
  }
  if (routeKey === `POST ${ADMIN_OVERRIDE_ROUTE}`) {
    // Identity and scope are not enough here: the grant is administrative, so
    // the claim is required on top of them (AD-2).
    if (!isAdministrativeClaim(claimsOf(event))) {
      fail("unauthorized");
    }
    return ok(
      await handleAdminOverride({
        request: validateAdminOverrideRequest(body, now),
        // The CALLER's own verified `sub`, recorded as the actor of the grant
        // (AD-2, AD-14). It is never read from the body.
        actorSub: sub,
        now,
        requestId,
      }),
    );
  }

  // Unreachable through the deployed API: API Gateway answers an undeclared
  // route itself. Reaching it means the template and this router disagree, which
  // is a server defect rather than anything the caller can fix.
  fail("unavailable");
}

export async function dispatch(
  event: APIGatewayProxyEvent,
  now: () => Date = () => new Date(),
): Promise<APIGatewayProxyResult> {
  const startedAt = Date.now();
  const requestId = event.requestContext.requestId;
  const method = event.httpMethod.toUpperCase();
  const route = event.resource || event.path;
  const routeKey = `${method} ${route}`;

  const sub = subFromAuthorizer(event);
  let outcome: RouteOutcome;

  try {
    if (UNAUTHENTICATED_ROUTE_KEYS.includes(routeKey)) {
      outcome = await runUnauthenticatedRoute({
        routeKey,
        event,
        now: now(),
        requestId,
      });
    } else if (sub !== undefined && isUuidShaped(sub)) {
      // The claim must look like a `sub` BEFORE any key is composed from it
      // (AD-3).
      outcome = await runAuthorizedRoute({
        routeKey,
        event,
        sub,
        body: decodeBody(event),
        now: now(),
        requestId,
      });
    } else {
      outcome = failureOutcome({ code: "unauthorized" }, requestId);
    }
  } catch (error) {
    const failure = failureFromUnknown(error);
    // Only a throw the service did NOT classify itself gets the second line. A
    // deliberate `fail("unavailable")` is a decision, not a surprise, and
    // recording it as an unhandled error would bury the real ones in noise.
    if (!(error instanceof BillingFailureError)) logUnhandled(requestId, error);
    outcome = failureOutcome(failure, requestId);
  }

  logRequest({
    request_id: requestId,
    sub: outcome.code === "unauthorized" ? undefined : sub,
    route,
    method,
    status: outcome.status,
    latency_ms: Date.now() - startedAt,
    error_code: outcome.code,
  });

  return {
    statusCode: outcome.status,
    headers: { "Content-Type": JSON_CONTENT_TYPE, ...outcome.headers },
    body: outcome.body,
  };
}

export async function handler(
  event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  return dispatch(event);
}
