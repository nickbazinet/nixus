import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BILLING_CLIENT_VERSION_HEADER,
  BILLING_ERROR_CODES,
  BILLING_ERROR_HTTP_STATUS,
  type BillingErrorCode,
} from "@nixus/shared";

import { createBillingApi } from "./billing-client.ts";
import { ACCOUNT_CLIENT_VERSION } from "./client-version.ts";
import FIXTURES from "../../../../packages/shared/src/types/billing.fixtures.json" with {
  type: "json",
};

/*
 * The BFF's whole relationship with commerce (billing AD-3, AD-7, AD-12).
 *
 * What is proved here is what no type can prove: the headers that actually leave
 * the process, that an insufficient-scope 403 becomes `reauthentication_required`
 * rather than a retry loop, that a `premium_required` 403 stays its own code so a
 * plan limitation never reads as an expired session, and that a submitted
 * promotion code never comes back out in anything.
 */

const BASE = "https://api.invalid/v1/billing";
const TOKEN = "an-access-token-that-must-not-be-echoed";

interface Capture {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

const captured: Capture[] = [];

function stubFetch(responses: readonly Response[]): void {
  let index = 0;
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    captured.push({
      url,
      method: init?.method ?? "GET",
      headers: { ...(init?.headers as Record<string, string> | undefined) },
      body: typeof init?.body === "string" ? init.body : null,
    });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (response === undefined) throw new Error("no scripted response");
    return Promise.resolve(response.clone());
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function envelope(code: BillingErrorCode, extra: Record<string, unknown> = {}): unknown {
  return { error: { code, message: "fixed sentence", request_id: "req-1", ...extra } };
}

function api() {
  return createBillingApi(BASE, TOKEN);
}

afterEach(() => {
  captured.length = 0;
  vi.unstubAllGlobals();
});

describe("the requests it makes", () => {
  it("reads the entitlement with the session's own bearer token", async () => {
    stubFetch([json(200, FIXTURES.entitlement_paid)]);
    const result = await api().getEntitlement();

    expect(result).toEqual({ ok: true, value: FIXTURES.entitlement_paid });
    expect(captured[0]?.url).toBe(`${BASE}/entitlement`);
    expect(captured[0]?.method).toBe("GET");
    expect(captured[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(captured[0]?.headers.accept).toBe("application/json");
  });

  it("states its own version on every call, so AD-9's floor applies here too", async () => {
    stubFetch([json(200, FIXTURES.plan_catalog)]);
    const client = api();
    await client.getEntitlement();
    await client.getPlans();
    await client.createPortalSession();
    await client.startCheckout({ planLookupKey: "classic_monthly_cad", promotionCode: null });

    expect(captured).toHaveLength(4);
    for (const request of captured) {
      expect(request.headers[BILLING_CLIENT_VERSION_HEADER]).toBe(ACCOUNT_CLIENT_VERSION);
    }
  });

  it("sends content-type only when there is a body to describe", async () => {
    stubFetch([json(200, FIXTURES.portal_response)]);
    const client = api();
    await client.createPortalSession();
    await client.getEntitlement();
    await client.startCheckout({ planLookupKey: "classic_monthly_cad", promotionCode: null });

    // `POST /portal` carries no body: the customer is the caller's own, so there
    // is nothing to send (billing AD-3).
    expect(captured[0]?.method).toBe("POST");
    expect(captured[0]?.body).toBeNull();
    expect(captured[0]?.headers["content-type"]).toBeUndefined();
    expect(captured[1]?.headers["content-type"]).toBeUndefined();
    expect(captured[2]?.headers["content-type"]).toBe("application/json");
  });

  it("sends the checkout request in the contract's snake_case shape", async () => {
    stubFetch([json(200, FIXTURES.checkout_response_checkout)]);
    const result = await api().startCheckout({
      planLookupKey: "advance_monthly_cad",
      promotionCode: "LAUNCH2026",
    });

    expect(result).toEqual({ ok: true, value: FIXTURES.checkout_response_checkout });
    expect(captured[0]?.url).toBe(`${BASE}/checkout`);
    expect(JSON.parse(captured[0]?.body ?? "null")).toEqual(
      FIXTURES.checkout_request_with_promotion,
    );
  });

  it("sends a null promotion code rather than an empty string", async () => {
    stubFetch([json(200, FIXTURES.checkout_response_checkout)]);
    await api().startCheckout({ planLookupKey: "classic_monthly_cad", promotionCode: null });

    expect(JSON.parse(captured[0]?.body ?? "null")).toEqual(
      FIXTURES.checkout_request_without_promotion,
    );
  });

  it("names no subject and no customer on any route, so none can be selected", async () => {
    stubFetch([json(200, FIXTURES.portal_response)]);
    const client = api();
    await client.createPortalSession();
    await client.startCheckout({ planLookupKey: "classic_monthly_cad", promotionCode: null });
    await client.getEntitlement();

    for (const request of captured) {
      const wire = `${request.url} ${request.body ?? ""}`;
      for (const forbidden of ["sub=", '"sub"', "customer", "cus_", "price_id"]) {
        expect(wire, `${request.url} names ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("reads the plan catalog, which the marketing site's deep link depends on", async () => {
    stubFetch([json(200, FIXTURES.plan_catalog)]);
    const result = await api().getPlans();

    expect(result).toEqual({ ok: true, value: FIXTURES.plan_catalog });
    expect(captured[0]?.url).toBe(`${BASE}/plans`);
    expect(captured[0]?.method).toBe("GET");
  });

  it("routes an already-subscribed caller wherever the SERVER says", async () => {
    stubFetch([json(200, FIXTURES.checkout_response_portal)]);
    const result = await api().startCheckout({
      planLookupKey: "advance_monthly_cad",
      promotionCode: null,
    });

    // The client never decides this: `destination: "portal"` is the server's
    // answer under AD-18, and the caller just opens the url it was handed.
    expect(result).toEqual({ ok: true, value: FIXTURES.checkout_response_portal });
  });
});

describe("the error codes it narrows", () => {
  it.each([...BILLING_ERROR_CODES])("carries %s through at its pinned status", async (code) => {
    const status = BILLING_ERROR_HTTP_STATUS[code];
    stubFetch([json(status, envelope(code))]);
    const result = await api().getEntitlement();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The one reclassification is `unauthorized` at 403; every other code,
    // including `premium_required` which shares that status, is its own answer.
    expect(result.error.code).toBe(
      code === "unauthorized" && status === 403 ? "reauthentication_required" : code,
    );
  });

  it("reclassifies the gateway's insufficient-scope 403 as reauthentication", async () => {
    stubFetch([json(403, envelope("unauthorized"))]);
    const result = await api().getEntitlement();

    expect(result).toEqual({
      ok: false,
      error: {
        code: "reauthentication_required",
        message: "fixed sentence",
        request_id: "req-1",
      },
    });
  });

  it("leaves a 401 unauthorized alone, which a refresh CAN fix", async () => {
    stubFetch([json(401, envelope("unauthorized"))]);
    const result = await api().getEntitlement();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unauthorized");
  });

  it("keeps premium_required its own code at the same 403", async () => {
    stubFetch([json(403, envelope("premium_required", { capability: "hosted_ai" }))]);
    const result = await api().getEntitlement();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("premium_required");
    // The capability survives, because the refusal has to name it (AD-12).
    expect(result.error).toMatchObject({ capability: "hosted_ai" });
  });

  it("maps a code a newer server invented onto unavailable", async () => {
    stubFetch([json(409, { error: { code: "a_code_from_the_future", message: "x", request_id: "r" } })]);
    const result = await api().getEntitlement();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unavailable");
  });

  it.each([...FIXTURES.errors])(
    "preserves the members of the canonical envelope %#",
    async (fixture) => {
      const code = fixture.error.code as BillingErrorCode;
      stubFetch([json(BILLING_ERROR_HTTP_STATUS[code], fixture)]);
      const result = await api().startCheckout({
        planLookupKey: "classic_monthly_cad",
        promotionCode: null,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      // Every canonical fixture arrives at its own pinned status, and only
      // `unauthorized` AT 403 is reclassified — which the gateway emits and no
      // fixture does, so each one survives verbatim.
      expect(result.error).toEqual(fixture.error);
    },
  );

  it("answers unavailable when the body is not the envelope at all", async () => {
    stubFetch([new Response("<html>gateway</html>", { status: 502 })]);
    const result = await api().createPortalSession();

    expect(result).toEqual({
      ok: false,
      error: {
        code: "unavailable",
        message: "The billing service is unavailable.",
        request_id: "",
      },
    });
  });

  it("answers unavailable when a 2xx body is not JSON", async () => {
    stubFetch([new Response("not json", { status: 200 })]);
    const result = await api().getPlans();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unavailable");
  });

  it("answers unavailable on a well-formed body with no error member", async () => {
    stubFetch([json(500, { message: "boom" })]);
    const result = await api().getEntitlement();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unavailable");
  });
});

describe("nothing it was handed comes back out", () => {
  it("never echoes the submitted promotion code into a refusal", async () => {
    stubFetch([json(400, envelope("promotion_invalid"))]);
    const result = await api().startCheckout({
      planLookupKey: "advance_monthly_cad",
      promotionCode: "A-SECRET-LAUNCH-CODE",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(JSON.stringify(result.error)).not.toContain("A-SECRET-LAUNCH-CODE");
      expect(result.error.code).toBe("promotion_invalid");
    }
  });

  it("never echoes the access token into a result of either shape", async () => {
    stubFetch([json(403, envelope("unauthorized")), json(200, FIXTURES.entitlement_paid)]);
    const client = api();
    const refusal = await client.getEntitlement();
    const ok = await client.getEntitlement();

    expect(JSON.stringify(refusal)).not.toContain(TOKEN);
    expect(JSON.stringify(ok)).not.toContain(TOKEN);
  });

  it("does not throw on a transport failure; the caller decides", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    await expect(api().getEntitlement()).rejects.toThrow(TypeError);
  });
});
