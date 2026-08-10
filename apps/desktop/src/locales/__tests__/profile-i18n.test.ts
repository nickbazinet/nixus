import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

const PROFILE_PREFIX = "profile.";

const REQUIRED_KEYS = [
  "profile.signIn",
  "profile.accountMenu",
  "profile.loading",
  "profile.signedInAs",
  "profile.signOut",
  "profile.sessionExpired",
  "profile.sessionExpiredAction",
] as const;

/**
 * Two of these are `aria-label` values, which is exactly why they are declared here: a missing
 * accessible name is invisible in review and in the UI, and only a screen-reader user pays for it.
 */
const ARIA_LABEL_KEYS = [
  "profile.signIn",
  "profile.accountMenu",
  "profile.loading",
  "profile.sessionExpiredAction",
] as const;

const PLACEHOLDER_KEYS = [["profile.accountMenu", ["{{email}}"]]] as const;

/**
 * Pending-state copy uses the single-character ellipsis, not three periods. A mixed convention is
 * invisible in review and permanent once shipped.
 */
const ELLIPSIS_KEYS = ["profile.loading"] as const;

function profileKeys(locale: Record<string, string>): string[] {
  return Object.keys(locale).filter((key) => key.startsWith(PROFILE_PREFIX));
}

describe("profile menu i18n", () => {
  it.each(REQUIRED_KEYS)("defines %s in both locales with a value", (key) => {
    expect(en[key], `${key} missing in en.json`).toBeTruthy();
    expect(fr[key], `${key} missing in fr.json`).toBeTruthy();
  });

  it("has no profile key present in one locale but not the other", () => {
    const enKeys = profileKeys(en);
    const frKeys = profileKeys(fr);

    expect(enKeys.length).toBeGreaterThan(0);
    expect(enKeys.filter((k) => !frKeys.includes(k))).toEqual([]);
    expect(frKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
  });

  it("declares every profile key it ships", () => {
    // ProfileMenu is the only consumer, so an orphaned key here is copy the UI can never show —
    // and an undeclared one escapes every assertion above.
    const declared = [...REQUIRED_KEYS].sort();

    expect(profileKeys(en).sort()).toEqual(declared);
    expect(profileKeys(fr).sort()).toEqual(declared);
  });

  it.each(ARIA_LABEL_KEYS)(
    "gives %s a non-empty accessible name in both locales",
    (key) => {
      expect(en[key]?.trim(), `${key} is blank in en.json`).toBeTruthy();
      expect(fr[key]?.trim(), `${key} is blank in fr.json`).toBeTruthy();
    },
  );

  it.each(PLACEHOLDER_KEYS)(
    "keeps every interpolation placeholder of %s in both locales",
    (key, placeholders) => {
      for (const placeholder of placeholders) {
        expect(en[key], `${key} lost ${placeholder} in en.json`).toContain(
          placeholder,
        );
        expect(fr[key], `${key} lost ${placeholder} in fr.json`).toContain(
          placeholder,
        );
      }
    },
  );

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

  it("leaves the neighbouring auth.* block intact", () => {
    // These keys sit immediately after the insertion point. A JSON edit that clobbered one would
    // still parse, still pass every assertion above, and only surface as a raw key in the dialog.
    for (const key of [
      "auth.promptTitle",
      "auth.promptBody",
      "auth.promptFutureFeatures",
      "auth.createAccount",
      "auth.continueOffline",
      "auth.openingBrowser",
      "auth.signInFailed",
    ]) {
      expect(en[key], `${key} missing in en.json`).toBeTruthy();
      expect(fr[key], `${key} missing in fr.json`).toBeTruthy();
    }
  });
});
