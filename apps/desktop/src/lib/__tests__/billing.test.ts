import { describe, expect, it } from "vitest";
import { BILLING_ERROR_CODES, isPlanLookupKeyShaped } from "@nixus/shared";
import {
  ADVANCE_PLAN_LOOKUP_KEY,
  billingMessageKey,
  billingNeedsSignIn,
} from "@/lib/billing";
import { parseAppError, isBillingError } from "@/lib/appError";
import enLocale from "@/locales/en.json";
import frLocale from "@/locales/fr.json";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

describe("the plan lookup key", () => {
  /* The server validates this against the live Stripe catalog, so a key that does not even
   * satisfy the shared shape could only ever produce a refused Checkout. */
  it("is the hosted-AI upsell key and satisfies the shared contract's shape", () => {
    expect(ADVANCE_PLAN_LOOKUP_KEY).toBe("advance_monthly_cad");
    expect(isPlanLookupKeyShaped(ADVANCE_PLAN_LOOKUP_KEY)).toBe(true);
  });

  /* One place, so adding a plan is one edit. A key spelled in a component is the copy that
   * drifts, and its failure mode is a refused Checkout at click time. */
  it("names no tier anywhere a user can read", () => {
    expect(en["home.locked.upgradeAction"]).not.toContain(ADVANCE_PLAN_LOOKUP_KEY);
    expect(fr["home.locked.upgradeAction"]).not.toContain(ADVANCE_PLAN_LOOKUP_KEY);
    expect(en["settings.readingUpgradeAction"]).not.toContain(ADVANCE_PLAN_LOOKUP_KEY);
  });
});

describe("billingMessageKey", () => {
  it("resolves every code in the closed shared union to a key present in both locales", () => {
    for (const code of BILLING_ERROR_CODES) {
      const key = billingMessageKey(code);

      expect(en[key], `${code} -> ${key}`).toBeTruthy();
      expect(fr[key], `${code} -> ${key}`).toBeTruthy();
      expect(en[key].trim(), key).not.toBe("");
      expect(fr[key].trim(), key).not.toBe("");
    }
  });

  /* Each of these three names a different next action — install an update, sign in, wait — and
   * collapsing any two of them gives the user an instruction that cannot work. */
  it("keeps the update, sign-in and outage refusals distinct", () => {
    const update = billingMessageKey("client_too_old");
    const signIn = billingMessageKey("reauthentication_required");
    const outage = billingMessageKey("unavailable");

    expect(new Set([update, signIn, outage]).size).toBe(3);
    expect(en[update].toLowerCase()).toContain("version");
    expect(en[update].toLowerCase()).not.toContain("sign in to");
    expect(fr[update].toLowerCase()).toContain("version");
  });

  it("gives a rate limit and an outage the one answer that fits both", () => {
    expect(billingMessageKey("rate_limited")).toBe(billingMessageKey("unavailable"));
  });
});

describe("billingNeedsSignIn", () => {
  /* `client_too_old` is the one refusal that looks like an auth problem and is not one: the
   * server will not serve this build, and signing the user out over it is the "a client
   * limitation read as an auth failure" confusion AD-12 forbids. */
  it("claims only the two codes a sign-in actually repairs", () => {
    const needing = BILLING_ERROR_CODES.filter(billingNeedsSignIn);

    expect([...needing].sort()).toEqual([
      "reauthentication_required",
      "unauthorized",
    ]);
    expect(billingNeedsSignIn("client_too_old")).toBe(false);
    expect(billingNeedsSignIn("premium_required")).toBe(false);
  });
});

describe("parseAppError on a billing refusal", () => {
  it("narrows the Rust envelope and keeps the code and the recoverable flag", () => {
    const parsed = parseAppError({
      type: "billing",
      code: "checkout_in_progress",
      message: "A plan change is already open in your browser. Finish it there.",
      recoverable: true,
    });

    expect(isBillingError(parsed)).toBe(true);
    if (!isBillingError(parsed)) return;
    expect(parsed.code).toBe("checkout_in_progress");
    expect(parsed.recoverable).toBe(true);
  });

  /* A newer server's code is still a billing refusal. Dropping it would restore the silent
   * generic fall-through, and guessing anything about the plan would be worse. */
  it("degrades a code this build has never heard of to an outage", () => {
    const parsed = parseAppError({
      type: "billing",
      code: "a_code_from_a_newer_build",
      message: "",
    });

    expect(isBillingError(parsed)).toBe(true);
    if (!isBillingError(parsed)) return;
    expect(parsed.code).toBe("unavailable");
    expect(parsed.recoverable).toBe(true);
  });

  /* A billing refusal must never arrive as a hosted-AI one: the user clicked an upgrade, no
   * model was involved, and "Nixus Cloud AI is unavailable" would be a confident wrong
   * diagnosis. */
  it("is not readable as a hosted-AI failure", () => {
    const parsed = parseAppError({
      type: "billing",
      code: "premium_required",
      message: "",
      recoverable: true,
    });

    expect(parsed.type).toBe("billing");
    expect(parsed.type).not.toBe("hosted_ai");
  });

  it("carries no URL, because the Rust command never has one to carry", () => {
    for (const code of BILLING_ERROR_CODES) {
      expect(en[billingMessageKey(code)]).not.toContain("http");
      expect(fr[billingMessageKey(code)]).not.toContain("http");
    }
  });
});
