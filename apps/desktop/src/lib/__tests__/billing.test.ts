import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BILLING_CAPABILITIES,
  BILLING_ERROR_CODES,
  isPlanLookupKeyShaped,
} from "@nixus/shared";
import {
  ADVANCE_PLAN_LOOKUP_KEY,
  HOSTED_AI_CAPABILITY,
  billingMessageKey,
  billingNeedsSignIn,
  entitlementOrUnestablished,
  holdsCapability,
  holdsPaidPlan,
  lacksCapability,
  type BillingEntitlement,
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

/* The capability answer's gate helpers. Pure functions, so every row of the matrix the two UI
 * gates are built on is asserted here rather than inferred from a rendered component. */
describe("the capability gates", () => {
  const verified = (capabilities: string[]): BillingEntitlement => ({
    established: true,
    tier: "whatever",
    capabilities: capabilities as BillingEntitlement["capabilities"],
  });
  const unestablished: BillingEntitlement = {
    established: false,
    tier: null,
    capabilities: [],
  };

  /* A name typed against the shared union, so a misspelling is a compile error rather than a gate
   * that silently never opens. Pinned to the union at runtime too, because a rename on the shared
   * side would otherwise only surface as a feature quietly becoming unreachable. */
  it("names hosted AI from the shared union and nowhere else", () => {
    expect(BILLING_CAPABILITIES).toContain(HOSTED_AI_CAPABILITY);
    expect(HOSTED_AI_CAPABILITY).toBe("hosted_ai");
  });

  /* "Has a paid plan" is "holds at least one capability", never a tier and never `hosted_ai`:
   * Classic grants `multi_device_sync` and `household_net_worth` and no hosted AI. */
  it("treats any single capability as a paid plan", () => {
    expect(holdsPaidPlan(verified(["multi_device_sync"]))).toBe(true);
    expect(holdsPaidPlan(verified(["household_net_worth", "multi_device_sync"]))).toBe(true);
    expect(holdsPaidPlan(verified(["hosted_ai"]))).toBe(true);
  });

  it("treats a verified empty grant as no plan", () => {
    expect(holdsPaidPlan(verified([]))).toBe(false);
  });

  /* The whole point. An answer that was never established is not "no plan" and not "no
   * capability" — it is "we do not know", and NO gate may act on it in either direction (AD-9). */
  it("lets an unestablished answer open no gate in either direction", () => {
    expect(holdsPaidPlan(unestablished)).toBe(false);
    expect(holdsCapability(unestablished, HOSTED_AI_CAPABILITY)).toBe(false);
    expect(lacksCapability(unestablished, HOSTED_AI_CAPABILITY)).toBe(false);
  });

  /* `lacksCapability` is deliberately not `!holdsCapability`, and this is the assertion that
   * pins the difference: the naive negation is TRUE for an unestablished answer, which is how an
   * upsell reaches a user whose connection failed and who may already own the capability. */
  it("is not the naive negation of holdsCapability", () => {
    expect(!holdsCapability(unestablished, HOSTED_AI_CAPABILITY)).toBe(true);
    expect(lacksCapability(unestablished, HOSTED_AI_CAPABILITY)).toBe(false);
  });

  it("answers a named capability only from an established grant", () => {
    expect(holdsCapability(verified(["hosted_ai"]), HOSTED_AI_CAPABILITY)).toBe(true);
    expect(holdsCapability(verified(["multi_device_sync"]), HOSTED_AI_CAPABILITY)).toBe(false);
    expect(lacksCapability(verified(["multi_device_sync"]), HOSTED_AI_CAPABILITY)).toBe(true);
    expect(lacksCapability(verified(["hosted_ai"]), HOSTED_AI_CAPABILITY)).toBe(false);
  });

  /* An in-flight or rejected query is the same non-answer as an unreachable server, so the
   * absence resolves to the shape that claims nothing rather than to `undefined` every caller
   * would have to remember to handle. */
  it("resolves an absent answer to the unestablished one", () => {
    expect(entitlementOrUnestablished(undefined)).toEqual(unestablished);
    expect(holdsPaidPlan(entitlementOrUnestablished(undefined))).toBe(false);
    expect(lacksCapability(entitlementOrUnestablished(undefined), HOSTED_AI_CAPABILITY)).toBe(
      false
    );
  });
});

/* The D11 guard, in code rather than in a merge checklist.
 *
 * `ProfileMenu` is mounted on every screen and now reads `get_billing_entitlement` on load, and
 * the E2E suite has no shared mock module: each spec stubs `window.__TAURI_INTERNALS__.invoke`
 * itself and falls through to `Promise.reject("Unknown command")`. A spec that omits the case
 * therefore renders the whole shell in its error state and fails for a reason that looks nothing
 * like the cause. That is a 40-spec breakage discoverable only by running the suite, so it is
 * asserted by the unit suite — which runs in seconds — instead.
 *
 * Scoped to the commands an always-mounted surface reads, because that is the whole hazard: a
 * command reached from a route only that route's spec has to mock. */
describe("the always-mounted command surface", () => {
  // Resolved from the Vitest root (`apps/desktop`, per `vitest.config.ts`) rather than from
  // `import.meta.url`, which is not a file URL under the jsdom transform.
  const TESTS_DIR = resolve(process.cwd(), "tests");

  /** Every command `ProfileMenu`'s own hooks reach on load, with no user interaction. */
  const ALWAYS_MOUNTED_COMMANDS = ["get_billing_entitlement"];

  const specs = readdirSync(TESTS_DIR)
    .filter((name) => name.endsWith(".spec.ts"))
    .map((name) => ({ name, source: readFileSync(`${TESTS_DIR}/${name}`, "utf8") }))
    .filter(({ source }) => source.includes("__TAURI_INTERNALS__"));

  it("finds the E2E specs it claims to be guarding", () => {
    expect(specs.length).toBeGreaterThan(30);
  });

  it.each(ALWAYS_MOUNTED_COMMANDS)(
    "is handled by every spec that stubs the Tauri IPC layer: %s",
    (command) => {
      const missing = specs
        .filter(({ source }) => !source.includes(command))
        .map(({ name }) => name);

      expect(
        missing,
        `these specs stub invoke() without handling ${command}, so their mock falls through to ` +
          `the Unknown-command rejection and the app shell renders in its error state (D11)`
      ).toEqual([]);
    }
  );

  /* Per stub, not per file: several specs install more than one mock, and a second stub that
   * omits the case is exactly as broken as a whole file that does — and far easier to miss. */
  it.each(ALWAYS_MOUNTED_COMMANDS)(
    "is handled by every individual invoke stub, not merely once per file: %s",
    (command) => {
      const offenders: string[] = [];

      for (const { name, source } of specs) {
        for (const match of source.matchAll(/invoke: \(cmd[^\n]*=>\s*\{/g)) {
          const open = source.indexOf("{", match.index + match[0].length - 1);
          let depth = 0;
          let close = source.length;
          for (let i = open; i < source.length; i += 1) {
            if (source[i] === "{") depth += 1;
            else if (source[i] === "}") {
              depth -= 1;
              if (depth === 0) {
                close = i;
                break;
              }
            }
          }
          const body = source.slice(open, close + 1);
          if (!body.includes(command)) {
            offenders.push(`${name}:${source.slice(0, match.index).split("\n").length}`);
          }
        }
      }

      expect(offenders, `these invoke stubs do not handle ${command} (D11)`).toEqual([]);
    }
  );
});
