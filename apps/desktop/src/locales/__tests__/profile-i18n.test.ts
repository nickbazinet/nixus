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
  "profile.menuItem",
  "profile.title",
  "profile.email",
  "profile.signInRequiredTitle",
  "profile.signInRequiredBody",
  "profile.firstName",
  "profile.lastName",
  "profile.birthDate",
  "profile.birthDatePlaceholder",
  "profile.birthDateClear",
  "profile.country",
  "profile.countryPlaceholder",
  "profile.countryUnset",
  "profile.subdivision",
  "profile.subdivisionPlaceholder",
  "profile.subdivisionUnset",
  "profile.incomeBracket",
  "profile.incomeBracketPlaceholder",
  "profile.incomeBracketUnset",
  "profile.incomeBracketCurrency",
  "profile.incomeBracketCurrencyPlaceholder",
  "profile.incomeBracketCurrencyUnset",
  "profile.incomeBracketCurrencyRequired",
  "profile.bracketUnder50k",
  "profile.bracket50k99k",
  "profile.bracket100k149k",
  "profile.bracket150k249k",
  "profile.bracket250kPlus",
  "profile.saving",
  "profile.tfsaAccumulatedLimit",
  "profile.tfsaAccumulatedLimitCaption",
  "profile.tfsaAccumulatedLimitNote",
] as const;

/**
 * The bracket is a range label, not a monetary amount, and the currency is a separate field — a
 * symbol baked into a label would contradict whatever the user picked in the currency select.
 */
const BRACKET_LABEL_KEYS = [
  "profile.bracketUnder50k",
  "profile.bracket50k99k",
  "profile.bracket100k149k",
  "profile.bracket150k249k",
  "profile.bracket250kPlus",
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

const PLACEHOLDER_KEYS = [
  ["profile.accountMenu", ["{{email}}"]],
  ["profile.tfsaAccumulatedLimitCaption", ["{{year}}"]],
] as const;

/**
 * Pending-state copy uses the single-character ellipsis, not three periods. A mixed convention is
 * invisible in review and permanent once shipped.
 */
const ELLIPSIS_KEYS = ["profile.loading", "profile.saving"] as const;

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
    // ProfileMenu, routes/profile.tsx, components/profile/SignInRequired.tsx, and
    // components/profile/ProfileForm.tsx are the consumers — plus
    // components/financial-health/TfsaRoomPanel.tsx, which reuses the three
    // profile.tfsa* keys verbatim now that the figure lives on the guidance surfaces,
    // so an orphaned key here is copy the UI can never show — and an undeclared one escapes every
    // assertion above.
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

  it("labels sign-in with the Nixus Cloud brand term in both locales (D14)", () => {
    // D14 relabels this key so an account reads as the gateway to Nixus Cloud, before any
    // networked feature exists. The exact string is the requirement, not a paraphrase.
    expect(en["profile.signIn"]).toBe("Sign In with Nixus Cloud");
    expect(fr["profile.signIn"]).toBe("Se connecter avec Nixus Cloud");
  });

  it("does not translate the Nixus Cloud brand term in fr.json (NFR8)", () => {
    expect(fr["profile.signIn"]).toContain("Nixus Cloud");
  });

  it.each(BRACKET_LABEL_KEYS)("gives %s a currency-free label in both locales", (key) => {
    for (const [locale, name] of [
      [en, "en.json"],
      [fr, "fr.json"],
    ] as const) {
      expect(locale[key], `${key} missing in ${name}`).toBeTruthy();
      for (const symbol of ["$", "€", "£", "¥", "CAD", "USD"]) {
        expect(locale[key], `${key} embeds ${symbol} in ${name}`).not.toContain(
          symbol,
        );
      }
    }
  });

  it("ships exactly the five allow-listed bracket labels", () => {
    const bracketKeys = profileKeys(en).filter((key) =>
      key.startsWith("profile.bracket"),
    );
    expect(bracketKeys.sort()).toEqual([...BRACKET_LABEL_KEYS].sort());
  });

  it("labels the TFSA figure as accumulated room, never as available or remaining (AC #2)", () => {
    // Nixus tracks balances, not contributions, so remaining room is not
    // computable. The label is the one place a user could misread the figure as
    // spendable headroom, so the forbidden words are asserted, not reviewed.
    expect(en["profile.tfsaAccumulatedLimit"]).toContain("accumulated");
    expect(fr["profile.tfsaAccumulatedLimit"]).toContain("accumulés");

    for (const [locale, name] of [
      [en, "en.json"],
      [fr, "fr.json"],
    ] as const) {
      const label = locale["profile.tfsaAccumulatedLimit"].toLowerCase();
      for (const word of [
        "available",
        "remaining",
        "restants",
        "disponibles",
      ]) {
        expect(label, `label says "${word}" in ${name}`).not.toContain(word);
      }
    }
  });

  it("negates remaining room in the caption and disclaims tracking in the note (AC #2)", () => {
    expect(en["profile.tfsaAccumulatedLimitCaption"]).toContain(
      "not your remaining room",
    );
    expect(fr["profile.tfsaAccumulatedLimitCaption"]).toContain(
      "droits restants",
    );
    expect(en["profile.tfsaAccumulatedLimitNote"]).toContain(
      "does not track your contributions or withdrawals",
    );
    expect(fr["profile.tfsaAccumulatedLimitNote"]).toContain(
      "ne suit pas vos cotisations ni vos retraits",
    );
  });

  it("leaves the neighbouring update.* block intact", () => {
    // These keys sit immediately after the insertion point. A JSON edit that clobbered one would
    // still parse, still pass every assertion above, and only surface as a raw key in the UI.
    // Was the auth.* block until Story 33.5 deleted it outright; update.* is what neighbours the
    // insertion point now.
    for (const key of [
      "update.available",
      "update.downloading",
      "update.restarting",
      "update.notNow",
      "update.updateRestart",
      "update.failed",
    ]) {
      expect(en[key], `${key} missing in en.json`).toBeTruthy();
      expect(fr[key], `${key} missing in fr.json`).toBeTruthy();
    }
  });
});
