import { describe, expect, it } from "vitest";

import {
  ACCOUNT_ERROR_CODES,
  ACCOUNT_ERROR_HTTP_STATUS,
  VALIDATION_FIELDS,
  VALIDATION_REASONS,
  VERSIONED_RESOURCES,
} from "@nixus/shared";

import {
  AccountFailureError,
  errorBodyFor,
  failureFromUnknown,
  messageFor,
  statusFor,
  type AccountFailure,
} from "./errors.ts";

/*
 * The error envelope is the contract (AD-13): one shape, a status that always
 * comes from `ACCOUNT_ERROR_HTTP_STATUS`, a fixed English message, and per-code
 * members that appear on no other code.
 */

function sampleFor(code: (typeof ACCOUNT_ERROR_CODES)[number]): AccountFailure {
  if (code === "validation") {
    return { code, field: "birth_date", reason: "too_young" };
  }
  if (code === "version_conflict") {
    return { code, resource: "profile", current_version: 4 };
  }
  return { code };
}

describe("status and message for every code", () => {
  it("takes the HTTP status from the shared contract, never a local literal", () => {
    for (const code of ACCOUNT_ERROR_CODES) {
      expect(statusFor(sampleFor(code))).toBe(ACCOUNT_ERROR_HTTP_STATUS[code]);
    }
  });

  it("gives every code a fixed English sentence that carries no value", () => {
    for (const code of ACCOUNT_ERROR_CODES) {
      const message = messageFor(sampleFor(code));
      expect(message.length).toBeGreaterThan(0);
      expect(message).toMatch(/^[A-Z].*\.$/);
      expect(message).not.toMatch(/[{}$%]/);
    }
  });

  it("distinguishes the two conflicting resources in the message", () => {
    const profile = messageFor({
      code: "version_conflict",
      resource: "profile",
      current_version: 1,
    });
    const avatar = messageFor({
      code: "version_conflict",
      resource: "avatar",
      current_version: 1,
    });
    expect(profile).not.toBe(avatar);
  });
});

describe("envelope shape", () => {
  it("wraps every code as { error: { code, message, request_id } }", () => {
    for (const code of ACCOUNT_ERROR_CODES) {
      const body = errorBodyFor(sampleFor(code), "req-1");
      expect(body.error.code).toBe(code);
      expect(body.error.request_id).toBe("req-1");
      expect(typeof body.error.message).toBe("string");
    }
  });

  it("adds field and reason to a validation error and nothing else", () => {
    const body = errorBodyFor(
      { code: "validation", field: "data", reason: "dimensions_exceeded" },
      "req-2"
    );

    expect(Object.keys(body.error).sort()).toEqual([
      "code",
      "field",
      "message",
      "reason",
      "request_id",
    ]);
    expect(VALIDATION_FIELDS).toContain("data");
    expect(VALIDATION_REASONS).toContain("dimensions_exceeded");
  });

  it("adds the resource and current version to a conflict, including a null one", () => {
    const body = errorBodyFor(
      { code: "version_conflict", resource: "avatar", current_version: null },
      "req-3"
    );

    expect(Object.keys(body.error).sort()).toEqual([
      "code",
      "current_version",
      "message",
      "request_id",
      "resource",
    ]);
    expect(VERSIONED_RESOURCES).toContain("avatar");
  });

  it("gives a simple code no per-code members at all", () => {
    for (const code of ["unauthorized", "rate_limited", "unavailable"] as const) {
      const body = errorBodyFor({ code }, "req-4");
      expect(Object.keys(body.error).sort()).toEqual([
        "code",
        "message",
        "request_id",
      ]);
    }
  });
});

describe("unclassified failures", () => {
  it("passes a failure the service raised itself straight through", () => {
    const failure: AccountFailure = {
      code: "validation",
      field: "body",
      reason: "unknown_field",
    };
    expect(failureFromUnknown(new AccountFailureError(failure))).toEqual(
      failure
    );
  });

  it.each([
    "ProvisionedThroughputExceededException",
    "RequestLimitExceeded",
    "ThrottlingException",
    "TooManyRequestsException",
  ])("maps the DynamoDB throttle %s to rate_limited", (name) => {
    const error = new Error("slow down");
    error.name = name;
    expect(failureFromUnknown(error)).toEqual({ code: "rate_limited" });
  });

  it.each([
    ["a resource error", "ResourceNotFoundException"],
    ["a validation error from AWS", "ValidationException"],
    ["an ordinary error", "Error"],
  ])("maps %s to unavailable", (_label, name) => {
    const error = new Error("boom");
    error.name = name;
    expect(failureFromUnknown(error)).toEqual({ code: "unavailable" });
  });

  it("maps a thrown non-error to unavailable rather than leaking it", () => {
    expect(failureFromUnknown("USER#11111111")).toEqual({
      code: "unavailable",
    });
  });
});
