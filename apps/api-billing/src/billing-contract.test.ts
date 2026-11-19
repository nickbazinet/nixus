import { describe, expect, it } from "vitest";

import {
  BILLING_CAPABILITIES,
  BILLING_ERROR_CODES,
  BILLING_ERROR_HTTP_STATUS,
  BILLING_GATEWAY_RESPONSES,
  type BillingErrorCode,
} from "@nixus/shared";

import { errorBodyFor, SIMPLE_MESSAGES, statusFor } from "./lib/errors.ts";
import { loadTemplate } from "./lib/testing/cfn.ts";

/*
 * The template side and the handler side both agree with `@nixus/shared`'s
 * billing contract (AD-13). Each half is independently plausible and wrong in a
 * different way: a template whose GatewayResponses drifted answers a rejection
 * with a code no client recognises, and a Lambda whose statuses drifted answers
 * the same code with two different numbers depending on who refused.
 */

const TEMPLATE = loadTemplate("apps/api-billing/template.yaml");

/* eslint-disable @typescript-eslint/no-explicit-any */
const API = TEMPLATE.resources.BillingApi.Properties as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const REQUEST_ID = "req-contract";

describe("the gateway and the Lambda speak one error vocabulary", () => {
  it("emits every code in the closed union from one of the two sides", () => {
    const fromGateway = new Set<string>(
      Object.values(BILLING_GATEWAY_RESPONSES).map((entry) => entry.code),
    );

    for (const code of BILLING_ERROR_CODES) {
      const fromLambda =
        code === "validation" ||
        code === "version_conflict" ||
        code === "premium_required" ||
        code === "client_too_old" ||
        Object.hasOwn(SIMPLE_MESSAGES, code);

      expect(
        fromLambda || fromGateway.has(code),
        `${code} is emitted by neither the Lambda nor the gateway`,
      ).toBe(true);
    }
  });

  /* The Lambda's own refusals take their status from the contract, never from a
   * literal - so no handler can answer one code with two numbers. */
  it("takes every status from BILLING_ERROR_HTTP_STATUS", () => {
    for (const code of Object.keys(SIMPLE_MESSAGES) as BillingErrorCode[]) {
      expect(statusFor({ code } as never), code).toBe(
        BILLING_ERROR_HTTP_STATUS[code],
      );
    }

    expect(
      statusFor({ code: "validation", field: "body", reason: "invalid_type" }),
    ).toBe(400);
    expect(
      statusFor({
        code: "version_conflict",
        resource: "entitlement",
        current_version: 1,
      }),
    ).toBe(409);
    expect(
      statusFor({ code: "premium_required", capability: "hosted_ai" }),
    ).toBe(403);
    expect(
      statusFor({ code: "client_too_old", minimum_client_version: "1.2.3" }),
    ).toBe(403);
  });

  /* AD-12: pinned to 403 and NEVER 401, so no client mistakes a plan limitation
   * for an expired session and sends the user to re-authenticate. */
  it("pins premium_required and client_too_old to 403", () => {
    expect(BILLING_ERROR_HTTP_STATUS.premium_required).toBe(403);
    expect(BILLING_ERROR_HTTP_STATUS.client_too_old).toBe(403);
    expect(
      statusFor({ code: "premium_required", capability: "multi_device_sync" }),
    ).not.toBe(401);
  });

  it("names the capability on a premium refusal, never a tier", () => {
    for (const capability of BILLING_CAPABILITIES) {
      const body = errorBodyFor(
        { code: "premium_required", capability },
        REQUEST_ID,
      );

      expect(body.error).toMatchObject({
        code: "premium_required",
        capability,
        request_id: REQUEST_ID,
      });
      // AD-1: the refusal routes a user to an upgrade by naming what they lack,
      // and a tier string never appears.
      expect(JSON.stringify(body)).not.toMatch(/\btier\b/);
      expect(JSON.stringify(body)).not.toContain("premium user");
    }
  });

  it("carries a fixed sentence that never echoes a submitted value", () => {
    const body = errorBodyFor(
      { code: "validation", field: "promotion_code", reason: "invalid_format" },
      REQUEST_ID,
    );

    expect(body.error).toMatchObject({
      code: "validation",
      field: "promotion_code",
      reason: "invalid_format",
    });
    // AD-8/AD-14: a promotion code is never echoed back, so the message has to
    // be value-free by construction.
    expect(body.error.message).toBe("A billing field was refused.");
    for (const message of Object.values(SIMPLE_MESSAGES)) {
      expect(message, message).toMatch(/^[A-Z].*\.$/);
    }
  });
});

describe("the template's gateway responses mirror the contract", () => {
  const responses = API.GatewayResponses as Record<
    string,
    { StatusCode?: number; ResponseTemplates: Record<string, string> }
  >;

  it("declares one entry per BILLING_GATEWAY_RESPONSES key", () => {
    expect(Object.keys(responses).sort()).toEqual(
      Object.keys(BILLING_GATEWAY_RESPONSES).sort(),
    );
  });

  it("emits a code the closed union contains, with the mapped status", () => {
    for (const [type, expected] of Object.entries(BILLING_GATEWAY_RESPONSES)) {
      const response = responses[type]!;
      const body = JSON.parse(response.ResponseTemplates["application/json"]!);

      expect(
        (BILLING_ERROR_CODES as readonly string[]).includes(body.error.code),
        `${type} emits ${body.error.code}, which the union does not contain`,
      ).toBe(true);
      expect(body.error.code, type).toBe(expected.code);

      if (expected.status === null) {
        expect(response, type).not.toHaveProperty("StatusCode");
      } else {
        expect(response.StatusCode, type).toBe(expected.status);
      }
    }
  });

  /* The gateway's status for a code it shares with the Lambda has to be the
   * contract's - otherwise the same `rate_limited` means 429 from one side and
   * something else from the other. Two keys are documented exceptions, and both
   * are exceptions because the GATEWAY knows something the Lambda could not: it
   * refused the request before any handler ran. */
  it("agrees with the Lambda on the status of every shared code", () => {
    const DOCUMENTED_EXCEPTIONS: Readonly<Record<string, string>> = {
      // Insufficient scope. It stays `unauthorized` on the wire so a client can
      // reclassify it as reauthentication_required - a token refresh cannot add
      // a scope - and 403 is what distinguishes it from a missing token.
      ACCESS_DENIED: "insufficient scope keeps 403 under the unauthorized code",
      // API Gateway's own 413, mapped to `validation` because the union is
      // closed and an oversized body is a malformed request. The Lambda-side
      // status for `validation` is 400, which is the right answer once a handler
      // has seen the body - and 413 is the more precise one before it has.
      REQUEST_TOO_LARGE: "the gateway's 413 is more precise than validation's 400",
    };

    for (const [type, expected] of Object.entries(BILLING_GATEWAY_RESPONSES)) {
      if (expected.status === null) continue;
      if (Object.hasOwn(DOCUMENTED_EXCEPTIONS, type)) continue;

      expect(
        expected.status,
        `${type} disagrees with the contract's status for ${expected.code}`,
      ).toBe(BILLING_ERROR_HTTP_STATUS[expected.code]);
    }

    // The exceptions are asserted explicitly, so neither can drift unnoticed
    // behind the skip above.
    expect(BILLING_GATEWAY_RESPONSES.ACCESS_DENIED).toEqual({
      status: 403,
      code: "unauthorized",
    });
    expect(BILLING_GATEWAY_RESPONSES.REQUEST_TOO_LARGE).toEqual({
      status: 413,
      code: "validation",
    });
    expect(Object.keys(DOCUMENTED_EXCEPTIONS).sort()).toEqual([
      "ACCESS_DENIED",
      "REQUEST_TOO_LARGE",
    ]);
  });
});

describe("AD-6 the catalog TTL is the only cache bound surfaced", () => {
  /* One cache owner, one bound. The TTL is declared once, in the stack, and
   * reaches clients through `PlanCatalogResponse.cache_ttl_seconds`; CloudFront
   * and every client cache derive from it rather than adding their own, so the
   * advertised-versus-charged drift window is exactly that value. */
  it("declares the bound once, as a template parameter", () => {
    expect(TEMPLATE.parameters.CatalogCacheTtlSeconds).toBeDefined();
    expect(TEMPLATE.resources.BillingFunction.Properties.Environment.Variables
      .CATALOG_CACHE_TTL_SECONDS).toEqual({
      __cfn: "Ref",
      value: "CatalogCacheTtlSeconds",
    });
  });

  /* No second bound anywhere in the stack: no CloudFront distribution, no cache
   * policy, and no Cache-Control literal in a gateway response or a method
   * setting. */
  it("introduces no second cache bound in the template", () => {
    const declared = JSON.stringify(TEMPLATE.resources);

    expect(declared).not.toContain("AWS::CloudFront");
    expect(declared).not.toContain("CachePolicy");
    expect(declared).not.toContain("CachingEnabled");
    expect(declared).not.toContain("max-age");
    expect(declared).not.toContain("Cache-Control");
    expect(API).not.toHaveProperty("CacheClusterEnabled");
  });

  it("surfaces it on the catalog response and in one output", () => {
    expect(TEMPLATE.outputs.CatalogCacheTtlSecondsEcho.Value).toEqual({
      __cfn: "Ref",
      value: "CatalogCacheTtlSeconds",
    });
  });
});
