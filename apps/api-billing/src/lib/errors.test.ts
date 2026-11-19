import { describe, expect, it } from "vitest";

import {
  BILLING_CAPABILITIES,
  BILLING_ERROR_CODES,
  BILLING_ERROR_HTTP_STATUS,
} from "@nixus/shared";

import {
  BillingFailureError,
  SIMPLE_MESSAGES,
  errorBodyFor,
  fail,
  failClientTooOld,
  failConflict,
  failPremiumRequired,
  failValidation,
  failureFromUnknown,
  messageFor,
  statusFor,
  type SimpleErrorCode,
} from "./errors.ts";

/*
 * The one error vocabulary (AD-13). Every refusal is one of these, the status
 * always comes from the shared contract, and the message is a fixed English
 * sentence that never carries a submitted value (AD-14).
 */

const REQUEST_ID = "req-errors";

const SIMPLE_CODES = Object.keys(SIMPLE_MESSAGES) as SimpleErrorCode[];

describe("the union covers the contract's closed set", () => {
  /* The per-code members are exactly the four codes that carry one; everything
   * else is a simple failure. A code added to the contract and not here fails to
   * compile in `messageFor`'s exhaustive switch. */
  it("accounts for every BILLING_ERROR_CODES member exactly once", () => {
    const perCode = [
      "validation",
      "version_conflict",
      "premium_required",
      "client_too_old",
    ];

    expect([...SIMPLE_CODES, ...perCode].sort()).toEqual(
      [...BILLING_ERROR_CODES].sort(),
    );
  });

  it("takes every status from the shared contract and never a literal", () => {
    for (const code of SIMPLE_CODES) {
      expect(statusFor({ code }), code).toBe(BILLING_ERROR_HTTP_STATUS[code]);
    }
  });
});

describe("messages are fixed sentences that carry no value", () => {
  it("gives every code a sentence", () => {
    for (const code of SIMPLE_CODES) {
      expect(messageFor({ code }), code).toBe(SIMPLE_MESSAGES[code]);
      expect(SIMPLE_MESSAGES[code], code).toMatch(/^[A-Z].*\.$/);
    }

    expect(
      messageFor({ code: "validation", field: "tier", reason: "too_long" }),
    ).toBe("A billing field was refused.");
    expect(
      messageFor({
        code: "version_conflict",
        resource: "entitlement",
        current_version: null,
      }),
    ).toBe("The entitlement changed since it was loaded.");
  });

  /* AD-12: the sentence narrows to "your plan does not include this capability"
   * and must never tell a paying Classic subscriber they need premium. */
  it("never says a subscriber needs premium", () => {
    const message = messageFor({
      code: "premium_required",
      capability: "hosted_ai",
    });

    expect(message).toBe("Your plan does not include this capability.");
    for (const sentence of [...Object.values(SIMPLE_MESSAGES), message]) {
      expect(sentence.toLowerCase(), sentence).not.toContain("premium");
    }
  });
});

describe("the envelope carries per-code members only on their own code", () => {
  it("adds field and reason to a validation error alone", () => {
    const body = errorBodyFor(
      { code: "validation", field: "plan_lookup_key", reason: "not_allowed" },
      REQUEST_ID,
    );

    expect(Object.keys(body.error).sort()).toEqual([
      "code",
      "field",
      "message",
      "reason",
      "request_id",
    ]);
  });

  it("adds the current version to a conflict, including a null one", () => {
    const absent = errorBodyFor(
      {
        code: "version_conflict",
        resource: "entitlement",
        current_version: null,
      },
      REQUEST_ID,
    );

    // `null` is a numbered write against an absent record, which is itself a
    // conflict and never a create (AD-4).
    expect(absent.error).toMatchObject({
      resource: "entitlement",
      current_version: null,
    });
  });

  it("names the capability on a premium refusal", () => {
    for (const capability of BILLING_CAPABILITIES) {
      expect(
        errorBodyFor({ code: "premium_required", capability }, REQUEST_ID).error,
      ).toMatchObject({ code: "premium_required", capability });
    }
  });

  it("carries the floor on a client_too_old refusal (AD-9)", () => {
    expect(
      errorBodyFor(
        { code: "client_too_old", minimum_client_version: "2.4.0" },
        REQUEST_ID,
      ).error,
    ).toMatchObject({
      code: "client_too_old",
      minimum_client_version: "2.4.0",
    });
  });

  it("carries only the three base members on a simple failure", () => {
    for (const code of SIMPLE_CODES) {
      expect(
        Object.keys(errorBodyFor({ code }, REQUEST_ID).error).sort(),
        code,
      ).toEqual(["code", "message", "request_id"]);
    }
  });

  it("echoes the request id on every code", () => {
    for (const code of SIMPLE_CODES) {
      expect(errorBodyFor({ code }, REQUEST_ID).error.request_id, code).toBe(
        REQUEST_ID,
      );
    }
  });
});

describe("the throw helpers carry the typed failure out", () => {
  it("throws a BillingFailureError whose failure the router reads", () => {
    for (const code of SIMPLE_CODES) {
      try {
        fail(code);
        expect.unreachable(`fail(${code}) should have thrown`);
      } catch (error) {
        expect(error).toBeInstanceOf(BillingFailureError);
        expect((error as BillingFailureError).failure).toEqual({ code });
        expect((error as Error).name).toBe("BillingFailureError");
      }
    }
  });

  it("carries the per-code members through the matching helper", () => {
    const thrown = (run: () => never) => {
      try {
        run();
        expect.unreachable("expected a throw");
      } catch (error) {
        return (error as BillingFailureError).failure;
      }
    };

    expect(thrown(() => failValidation("reason", "too_long"))).toEqual({
      code: "validation",
      field: "reason",
      reason: "too_long",
    });
    expect(thrown(() => failConflict("entitlement", 5))).toEqual({
      code: "version_conflict",
      resource: "entitlement",
      current_version: 5,
    });
    expect(thrown(() => failPremiumRequired("multi_device_sync"))).toEqual({
      code: "premium_required",
      capability: "multi_device_sync",
    });
    expect(thrown(() => failClientTooOld("1.0.0"))).toEqual({
      code: "client_too_old",
      minimum_client_version: "1.0.0",
    });
  });
});

describe("failureFromUnknown classifies what the service did not", () => {
  it("returns a carried failure unchanged", () => {
    const failure = {
      code: "checkout_in_progress",
    } as const;

    expect(failureFromUnknown(new BillingFailureError(failure))).toEqual(
      failure,
    );
  });

  /* DynamoDB throttling is the one failure a client should retry, so it keeps its
   * own code; everything else is `unavailable`, with no detail from the
   * underlying error on the wire (AD-14). */
  it.each([
    ["ProvisionedThroughputExceededException"],
    ["RequestLimitExceeded"],
    ["ThrottlingException"],
    ["TooManyRequestsException"],
  ])("maps %s to rate_limited", (name) => {
    const error = new Error("ignored");
    error.name = name;

    expect(failureFromUnknown(error)).toEqual({ code: "rate_limited" });
  });

  it.each([
    [new Error("cus_leaky customer went missing")],
    [new TypeError("undefined is not a function")],
    ["a thrown string carrying sk_live_leak"],
    [undefined],
    [null],
    [{ message: "whsec_leak" }],
  ])("maps anything else to unavailable with no detail", (thrown) => {
    const failure = failureFromUnknown(thrown);

    expect(failure).toEqual({ code: "unavailable" });
    expect(JSON.stringify(failure)).not.toContain("cus_");
    expect(JSON.stringify(failure)).not.toContain("sk_live_");
    expect(JSON.stringify(failure)).not.toContain("whsec_");
  });
});
