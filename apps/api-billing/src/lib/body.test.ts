import { describe, expect, it } from "vitest";

import { BILLING_BODY_MAX_BYTES } from "@nixus/shared";

import {
  decodeJsonBody,
  readExpectedVersion,
  readNullableCount,
  readOptionalString,
  readRequiredInteger,
  readRequiredString,
} from "./body.ts";
import { BillingFailureError } from "./errors.ts";

/*
 * The request-body boundary. Every refusal names a field and a reason and never
 * the submitted value (AD-14), and that is what most of this file asserts.
 */

const ALLOWED = ["plan_lookup_key", "promotion_code"];

function failureOf(run: () => unknown) {
  try {
    run();
    expect.unreachable("expected a refusal");
  } catch (error) {
    expect(error).toBeInstanceOf(BillingFailureError);
    return (error as BillingFailureError).failure;
  }
}

function decode(raw: string | undefined) {
  return decodeJsonBody({
    raw,
    maxBytes: BILLING_BODY_MAX_BYTES,
    allowedMembers: ALLOWED,
  });
}

describe("decodeJsonBody", () => {
  it("returns the parsed object for a well-formed body", () => {
    expect(
      decode('{"plan_lookup_key":"classic_monthly_cad","promotion_code":null}'),
    ).toEqual({
      plan_lookup_key: "classic_monthly_cad",
      promotion_code: null,
    });
  });

  /* The billing error union is closed and carries no payload_too_large member, so
   * an oversized body is a malformed request - which is also what
   * BILLING_GATEWAY_RESPONSES maps API Gateway's own REQUEST_TOO_LARGE to. */
  it("refuses a body above the ceiling as a too-long body", () => {
    const oversized = JSON.stringify({
      plan_lookup_key: "a".repeat(BILLING_BODY_MAX_BYTES),
    });

    expect(failureOf(() => decode(oversized))).toEqual({
      code: "validation",
      field: "body",
      reason: "too_long",
    });
  });

  /* The ceiling is checked on BYTES, not characters: a body of multi-byte
   * characters is larger than its length suggests. */
  it("measures the ceiling in bytes rather than characters", () => {
    const multiByte = `{"promotion_code":"${"é".repeat(
      BILLING_BODY_MAX_BYTES / 2,
    )}"}`;

    expect(multiByte.length).toBeLessThan(BILLING_BODY_MAX_BYTES * 2);
    expect(Buffer.byteLength(multiByte, "utf8")).toBeGreaterThan(
      BILLING_BODY_MAX_BYTES,
    );
    expect(failureOf(() => decode(multiByte))).toMatchObject({
      reason: "too_long",
    });
  });

  it.each([[undefined], [""]])("refuses an absent body (%s)", (raw) => {
    expect(failureOf(() => decode(raw))).toEqual({
      code: "validation",
      field: "body",
      reason: "invalid_format",
    });
  });

  it("refuses unparseable JSON without echoing it", () => {
    expect(failureOf(() => decode('{"plan_lookup_key":'))).toMatchObject({
      field: "body",
      reason: "invalid_format",
    });
  });

  it.each([["[]"], ['"a string"'], ["42"], ["null"]])(
    "refuses %s as the wrong body type",
    (raw) => {
      expect(failureOf(() => decode(raw))).toMatchObject({
        field: "body",
        reason: "invalid_type",
      });
    },
  );

  /* The member NAME is not echoed either: `field: "body"` plus `unknown_field`
   * is the whole of what a client needs, and a name can carry a value. */
  it("refuses an unknown member without naming it", () => {
    const failure = failureOf(() =>
      decode('{"plan_lookup_key":"classic_monthly_cad","stripe_price_id":"price_leak"}'),
    );

    expect(failure).toEqual({
      code: "validation",
      field: "body",
      reason: "unknown_field",
    });
    expect(JSON.stringify(failure)).not.toContain("stripe_price_id");
    expect(JSON.stringify(failure)).not.toContain("price_leak");
  });
});

describe("readExpectedVersion is mandatory, never implicit", () => {
  /* Absent is never "whatever is there now", which is the lost update the
   * mandatory member exists to prevent (AD-4). */
  it("refuses an absent member rather than defaulting it", () => {
    expect(failureOf(() => readExpectedVersion({}))).toEqual({
      code: "validation",
      field: "expected_version",
      reason: "required",
    });
  });

  it("accepts null as create-only and a positive integer as a guard", () => {
    expect(readExpectedVersion({ expected_version: null })).toBeNull();
    expect(readExpectedVersion({ expected_version: 7 })).toBe(7);
  });

  it.each([[0], [-1], [1.5], ["3"], [true], [{}]])(
    "refuses %s as a version",
    (value) => {
      expect(
        failureOf(() => readExpectedVersion({ expected_version: value })),
      ).toMatchObject({ field: "expected_version", reason: "invalid_type" });
    },
  );
});

describe("string readers", () => {
  it("requires a non-empty string and distinguishes absent from wrong-typed", () => {
    expect(readRequiredString({ tier: "classic" }, "tier")).toBe("classic");

    expect(failureOf(() => readRequiredString({}, "tier"))).toMatchObject({
      field: "tier",
      reason: "required",
    });
    expect(failureOf(() => readRequiredString({ tier: "" }, "tier"))).toMatchObject(
      { reason: "required" },
    );
    expect(failureOf(() => readRequiredString({ tier: 4 }, "tier"))).toMatchObject(
      { reason: "invalid_type" },
    );
  });

  /* Absent and `null` are the same thing - the member is unset - and a blank or
   * whitespace-only string is also unset rather than a value to refuse. */
  it("treats absent, null and blank alike on an optional string", () => {
    for (const body of [
      {},
      { promotion_code: null },
      { promotion_code: "" },
      { promotion_code: "   " },
    ]) {
      expect(readOptionalString(body, "promotion_code")).toBeNull();
    }

    expect(readOptionalString({ promotion_code: "  SAVE20 " }, "promotion_code")).toBe(
      "SAVE20",
    );
    expect(
      failureOf(() => readOptionalString({ promotion_code: 20 }, "promotion_code")),
    ).toMatchObject({ reason: "invalid_type" });
  });
});

describe("number readers", () => {
  it("requires an integer and distinguishes the three refusals", () => {
    expect(readRequiredInteger({ admin_expires_at: 1 }, "admin_expires_at")).toBe(
      1,
    );

    expect(
      failureOf(() => readRequiredInteger({}, "admin_expires_at")),
    ).toMatchObject({ reason: "required" });
    expect(
      failureOf(() =>
        readRequiredInteger({ admin_expires_at: "1" }, "admin_expires_at"),
      ),
    ).toMatchObject({ reason: "invalid_type" });
    expect(
      failureOf(() =>
        readRequiredInteger({ admin_expires_at: Number.NaN }, "admin_expires_at"),
      ),
    ).toMatchObject({ reason: "invalid_type" });
    expect(
      failureOf(() =>
        readRequiredInteger({ admin_expires_at: 1.5 }, "admin_expires_at"),
      ),
    ).toMatchObject({ reason: "invalid_format" });
  });

  /* `null` is how the contract models an absent limit, so it is accepted, while
   * a non-positive one is out of range rather than wrong-typed. */
  it("accepts null or a positive integer as a count", () => {
    expect(
      readNullableCount({ monthly_request_limit: null }, "monthly_request_limit"),
    ).toBeNull();
    expect(
      readNullableCount({ monthly_request_limit: 500 }, "monthly_request_limit"),
    ).toBe(500);

    expect(
      failureOf(() => readNullableCount({}, "monthly_request_limit")),
    ).toMatchObject({ reason: "required" });
    expect(
      failureOf(() =>
        readNullableCount({ monthly_request_limit: 0 }, "monthly_request_limit"),
      ),
    ).toMatchObject({ reason: "out_of_range" });
    expect(
      failureOf(() =>
        readNullableCount({ monthly_request_limit: -5 }, "monthly_request_limit"),
      ),
    ).toMatchObject({ reason: "out_of_range" });
    expect(
      failureOf(() =>
        readNullableCount({ monthly_request_limit: 1.5 }, "monthly_request_limit"),
      ),
    ).toMatchObject({ reason: "invalid_type" });
  });
});
