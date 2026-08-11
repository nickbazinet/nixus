import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

const AUTH_PREFIX = "auth.";

/**
 * AccountPromptDialog.tsx is the only consumer of these keys, and t() on a missing key renders the
 * raw key string rather than failing — so a typo or an en-only addition ships silently.
 */
const REQUIRED_KEYS = [
  "auth.promptTitle",
  "auth.promptBody",
  "auth.promptFutureFeatures",
  "auth.createAccount",
  "auth.continueOffline",
  "auth.openingBrowser",
  "auth.signInFailed",
] as const;

/**
 * Pending-state copy uses the single-character ellipsis, not three periods. A mixed
 * convention is invisible in review and permanent once shipped.
 */
const ELLIPSIS_KEYS = ["auth.openingBrowser"] as const;

function authKeys(locale: Record<string, string>): string[] {
  return Object.keys(locale).filter((key) => key.startsWith(AUTH_PREFIX));
}

describe("auth i18n", () => {
  it.each(REQUIRED_KEYS)("defines %s in both locales with a value", (key) => {
    expect(en[key], `${key} missing in en.json`).toBeTruthy();
    expect(fr[key], `${key} missing in fr.json`).toBeTruthy();
  });

  it("has no auth key present in one locale but not the other", () => {
    const enKeys = authKeys(en);
    const frKeys = authKeys(fr);

    expect(enKeys.length).toBeGreaterThan(0);
    expect(enKeys.filter((k) => !frKeys.includes(k))).toEqual([]);
    expect(frKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
  });

  it("declares every auth key it ships", () => {
    // An orphaned key here is copy the dialog can never show, and an undeclared one escapes
    // the required-key assertions above.
    expect(authKeys(en).sort()).toEqual([...REQUIRED_KEYS].sort());
    expect(authKeys(fr).sort()).toEqual([...REQUIRED_KEYS].sort());
  });

  it.each(ELLIPSIS_KEYS)("spells %s with a single-character ellipsis", (key) => {
    for (const [locale, name] of [
      [en, "en.json"],
      [fr, "fr.json"],
    ] as const) {
      expect(locale[key], `${key} missing in ${name}`).toBeTruthy();
      expect(locale[key], `${key} uses "..." in ${name}`).not.toContain("...");
      expect(locale[key], `${key} lost its ellipsis in ${name}`).toContain(
        "\u2026",
      );
    }
  });

  it("keeps user-identity copy out of the accounts.* namespace", () => {
    // accounts.* means a bank or investment account everywhere else in this app, so a
    // user-identity string under that prefix would be a permanent semantic collision.
    expect(en["accounts.createAccount"]).toBeUndefined();
    expect(en["accounts.continueOffline"]).toBeUndefined();
    expect(fr["accounts.createAccount"]).toBeUndefined();
    expect(fr["accounts.continueOffline"]).toBeUndefined();
  });

  it("labels account creation with the Nixus Cloud brand term in both locales (D14)", () => {
    // D14 relabels this key so the dialog's primary action names the same brand term as the
    // header affordance. The exact string is the requirement, not a paraphrase.
    expect(en["auth.createAccount"]).toBe("Create Nixus Cloud Account");
    expect(fr["auth.createAccount"]).toBe("Créer un compte Nixus Cloud");
  });

  it("does not translate the Nixus Cloud brand term in fr.json (NFR8)", () => {
    expect(fr["auth.createAccount"]).toContain("Nixus Cloud");
  });

  it("states in both locales that no feature requires an account today", () => {
    // AC 4: the prompt must not read as a gate. Copy that drops this reassurance turns an
    // invitation into a paywall, which NFR1 forbids.
    expect(en["auth.promptBody"]).toContain("Nothing in Nixus requires an account");
    expect(fr["auth.promptBody"]).toContain("n'exige de compte");
  });

  it.each([
    ["en.json", en, ["mobile notifications", "photo sync", "community"]],
    ["fr.json", fr, ["notifications mobiles", "photos", "communautaires"]],
  ] as const)(
    "names the possible future features in %s",
    (_name, locale, fragments) => {
      for (const fragment of fragments) {
        expect(
          locale["auth.promptFutureFeatures"],
          `auth.promptFutureFeatures lost "${fragment}"`,
        ).toContain(fragment);
      }
    },
  );
});
