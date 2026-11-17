import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

import { handleGetAvatar, handlePutAvatar } from "../handlers/avatar.ts";
import { handleGetProfile, handlePutProfile } from "../handlers/profile.ts";
import {
  errorBodyFor,
  fail,
  failureFromUnknown,
  statusFor,
  type AccountFailure,
} from "../lib/errors.ts";
import { locationsResponse } from "../lib/locations.ts";
import { logRequest, logUnhandled } from "../lib/logging.ts";
import { isUuidShaped } from "../lib/table.ts";

export { bundledCountryCount } from "../lib/locations.ts";

/*
 * The sole Lambda entry point (AD-3). All five routes are served from here;
 * there is never a Lambda per route. The custom domain's API mapping strips the
 * `v1/profile` base path, so the REST resources are `/`, `/avatar` and
 * `/locations`.
 */

const JSON_CONTENT_TYPE = "application/json";

/** The ISO catalog changes only when the bundle does, so a client may hold it for a day. */
const LOCATIONS_CACHE_CONTROL = "public, max-age=86400, immutable";

export const PROFILE_ROUTE = "/";
export const AVATAR_ROUTE = "/avatar";
export const LOCATIONS_ROUTE = "/locations";

interface RouteOutcome {
  readonly status: number;
  readonly body: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly code?: AccountFailure["code"];
}

function subFromAuthorizer(event: APIGatewayProxyEvent): string | undefined {
  // The authorizer's verified claims are the only source of identity (AD-3).
  const claims = event.requestContext.authorizer?.claims as
    | Record<string, unknown>
    | undefined;
  const sub = claims?.sub;
  return typeof sub === "string" ? sub : undefined;
}

function decodeBody(event: APIGatewayProxyEvent): string | undefined {
  if (event.body === null || event.body === undefined) return undefined;
  return event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
}

async function runRoute(args: {
  readonly route: string;
  readonly method: string;
  readonly sub: string;
  readonly body: string | undefined;
  readonly now: Date;
}): Promise<RouteOutcome> {
  const { route, method, sub, body, now } = args;

  if (route === PROFILE_ROUTE && method === "GET") {
    return ok(await handleGetProfile(sub));
  }
  if (route === PROFILE_ROUTE && method === "PUT") {
    return ok(await handlePutProfile({ sub, body, now }));
  }
  if (route === AVATAR_ROUTE && method === "GET") {
    return ok(await handleGetAvatar(sub));
  }
  if (route === AVATAR_ROUTE && method === "PUT") {
    return ok(await handlePutAvatar({ sub, body, now }));
  }
  if (route === LOCATIONS_ROUTE && method === "GET") {
    return ok(locationsResponse(), {
      "Cache-Control": LOCATIONS_CACHE_CONTROL,
    });
  }

  // Unreachable through the deployed API: API Gateway answers an undeclared
  // route itself. Reaching it means the template and this router disagree, which
  // is a server defect rather than anything the caller can fix.
  fail("unavailable");
}

function ok(
  payload: unknown,
  headers?: Readonly<Record<string, string>>
): RouteOutcome {
  // `undefined` would serialize to an empty body; every success body is JSON,
  // including the literal `null` an absent profile or avatar answers with.
  return { status: 200, body: JSON.stringify(payload ?? null), headers };
}

function failureOutcome(
  failure: AccountFailure,
  requestId: string
): RouteOutcome {
  return {
    status: statusFor(failure),
    body: JSON.stringify(errorBodyFor(failure, requestId)),
    code: failure.code,
  };
}

export async function dispatch(
  event: APIGatewayProxyEvent,
  now: () => Date = () => new Date()
): Promise<APIGatewayProxyResult> {
  const startedAt = Date.now();
  const requestId = event.requestContext.requestId;
  const method = event.httpMethod.toUpperCase();
  const route = event.resource || event.path;
  const body = decodeBody(event);
  const requestBytes = body === undefined ? 0 : Buffer.byteLength(body, "utf8");

  const sub = subFromAuthorizer(event);
  let outcome: RouteOutcome;

  try {
    // The claim must look like a `sub` BEFORE any key is composed from it (AD-3).
    outcome =
      sub !== undefined && isUuidShaped(sub)
        ? await runRoute({ route, method, sub, body, now: now() })
        : failureOutcome({ code: "unauthorized" }, requestId);
  } catch (error) {
    const failure = failureFromUnknown(error);
    if (failure.code === "unavailable") logUnhandled(requestId, error);
    outcome = failureOutcome(failure, requestId);
  }

  logRequest({
    request_id: requestId,
    sub: outcome.code === "unauthorized" ? undefined : sub,
    route,
    method,
    status: outcome.status,
    latency_ms: Date.now() - startedAt,
    request_bytes: requestBytes,
    response_bytes: Buffer.byteLength(outcome.body, "utf8"),
    code: outcome.code,
  });

  return {
    statusCode: outcome.status,
    headers: { "Content-Type": JSON_CONTENT_TYPE, ...outcome.headers },
    body: outcome.body,
  };
}

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  return dispatch(event);
}
