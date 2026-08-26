import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import {
  hostedAiIsRetryable,
  hostedAiMessageKey,
  hostedAiNeedsSignIn,
  isHostedAiError,
  parseAppError,
  type HostedAiErrorCode,
} from "../appError";

const ALL_CODES: HostedAiErrorCode[] = [
  "validation",
  "unauthorized",
  "reauthentication_required",
  "premium_required",
  "payload_too_large",
  "quota_exhausted",
  "hosted_unavailable",
  "unsupported_encoding",
];

function hostedAi(code: string, overrides: Record<string, unknown> = {}) {
  return {
    type: "hosted_ai",
    code,
    message: "backend message",
    recoverable: true,
    ...overrides,
  };
}

describe("parseAppError narrows the hosted_ai envelope", () => {
  it("reads the code, message, and recoverable flag", () => {
    const parsed = parseAppError(hostedAi("quota_exhausted", { recoverable: true }));

    expect(isHostedAiError(parsed)).toBe(true);
    if (!isHostedAiError(parsed)) throw new Error("unreachable");

    expect(parsed.code).toBe("quota_exhausted");
    expect(parsed.message).toBe("backend message");
    expect(parsed.recoverable).toBe(true);
  });

  it("preserves an explicitly unrecoverable flag", () => {
    const parsed = parseAppError(hostedAi("validation", { recoverable: false }));

    expect(isHostedAiError(parsed) && parsed.recoverable).toBe(false);
  });

  it("accepts every code in the closed union", () => {
    for (const code of ALL_CODES) {
      const parsed = parseAppError(hostedAi(code));
      expect(isHostedAiError(parsed) && parsed.code, code).toBe(code);
    }
  });

  /* A server that gains a code this build has never heard of is still a hosted
   * failure; dropping it would restore the silent fall-through. */
  it("degrades an unrecognized code to hosted_unavailable rather than dropping it", () => {
    for (const unknown of ["teapot", "", "VALIDATION", "123"]) {
      const parsed = parseAppError(hostedAi(unknown));
      expect(isHostedAiError(parsed)).toBe(true);
      expect(isHostedAiError(parsed) && parsed.code, unknown).toBe(
        "hosted_unavailable"
      );
    }
  });

  it("degrades a missing or non-string code the same way", () => {
    for (const raw of [undefined, null, 42, {}]) {
      const parsed = parseAppError({
        type: "hosted_ai",
        code: raw,
        message: "m",
      });
      expect(isHostedAiError(parsed) && parsed.code).toBe("hosted_unavailable");
    }
  });

  it("leaves the other AppError variants untouched", () => {
    for (const type of [
      "validation",
      "database",
      "ai_service",
      "auth",
      "file",
      "not_configured",
      "invalid_credentials",
      "unavailable",
    ]) {
      const parsed = parseAppError({ type, message: "m" });
      expect(isHostedAiError(parsed)).toBe(false);
      expect(parsed.type).toBe(type);
      expect(parsed.message).toBe("m");
    }
  });

  it("survives a non-object rejection without throwing", () => {
    expect(parseAppError("boom")).toEqual({ type: undefined, message: "boom" });
    expect(parseAppError(null)).toEqual({ type: undefined, message: undefined });
    expect(parseAppError(undefined)).toEqual({
      type: undefined,
      message: undefined,
    });
    expect(parseAppError(7)).toEqual({ type: undefined, message: undefined });
  });
});

describe("hosted-AI message keys exist in both locales", () => {
  it("maps every code to a distinct key", () => {
    const keys = ALL_CODES.map(hostedAiMessageKey);
    expect(new Set(keys).size).toBe(ALL_CODES.length);
  });

  /* A missing key renders the raw key string to the user, which is worse than the
   * generic message it replaced. */
  it("resolves every key in en and fr", () => {
    const enKeys = en as Record<string, string>;
    const frKeys = fr as Record<string, string>;

    for (const code of ALL_CODES) {
      const key = hostedAiMessageKey(code);
      expect(enKeys[key], `${key} missing from en`).toBeTruthy();
      expect(frKeys[key], `${key} missing from fr`).toBeTruthy();
      expect(enKeys[key]).not.toBe(frKeys[key]);
    }
  });
});

describe("retry and sign-in affordances match the closed table", () => {
  /* Offering "try again" for these four invites the user to repeat something that
   * cannot succeed: the request itself, its size, its encoding, or a grant that only
   * a fresh sign-in can reissue. */
  it("never offers a retry for validation, size, encoding, or reauthentication", () => {
    for (const code of [
      "validation",
      "payload_too_large",
      "unsupported_encoding",
      "reauthentication_required",
    ] as HostedAiErrorCode[]) {
      expect(hostedAiIsRetryable(code), code).toBe(false);
    }
  });

  it("offers a retry for the transient and entitlement classes", () => {
    for (const code of [
      "unauthorized",
      "premium_required",
      "quota_exhausted",
      "hosted_unavailable",
    ] as HostedAiErrorCode[]) {
      expect(hostedAiIsRetryable(code), code).toBe(true);
    }
  });

  it("routes only the auth-layer codes to a sign-in affordance", () => {
    const needsSignIn = ALL_CODES.filter(hostedAiNeedsSignIn);
    expect(needsSignIn).toEqual(["unauthorized", "reauthentication_required"]);
  });

  it("classifies every code exhaustively", () => {
    for (const code of ALL_CODES) {
      expect(typeof hostedAiIsRetryable(code)).toBe("boolean");
      expect(typeof hostedAiNeedsSignIn(code)).toBe("boolean");
      expect(hostedAiMessageKey(code)).toMatch(/^hostedAi\./);
    }
  });
});
