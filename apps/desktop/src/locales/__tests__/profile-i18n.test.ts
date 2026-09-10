import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

const PROFILE_PREFIX = "profile.";

const REQUIRED_KEYS = [
  "profile.accountMenu",
  "profile.accountMenuPremium",
  "profile.loading",
  "profile.signedInAs",
  "profile.premiumBadge",
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
  "profile.avatar.label",
  "profile.avatar.alt",
  "profile.avatar.addAction",
  "profile.avatar.replaceAction",
  "profile.avatar.uploading",
  "profile.avatar.hint",
  "profile.avatar.filterName",
  "profile.avatar.saveFailed",
  "profile.avatar.unsupportedType",
  "profile.avatar.empty",
  "profile.avatar.tooLarge",
  "profile.avatar.unreadable",
  "profile.avatar.contentMismatch",
  "profile.avatar.dimensions",
  "profile.avatar.unprocessable",
] as const;

/**
 * Every `field` a profile-picture refusal can carry, as `userAvatarMessageKey` maps them. The
 * enforcement side is `avatar_store::derive_from_file`, which reuses `projects/image.rs` — so this
 * list is what proves the shared validator's seven causes each reach profile-owned copy rather
 * than collapsing into the generic fallback.
 */
const AVATAR_REFUSAL_KEYS = [
  "profile.avatar.unsupportedType",
  "profile.avatar.empty",
  "profile.avatar.tooLarge",
  "profile.avatar.unreadable",
  "profile.avatar.contentMismatch",
  "profile.avatar.dimensions",
  "profile.avatar.unprocessable",
] as const;

const PREMIUM_COPY_KEYS = ["profile.premiumBadge"] as const;

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
  "profile.accountMenu",
  "profile.accountMenuPremium",
  "profile.loading",
  "profile.sessionExpiredAction",
  "profile.avatar.alt",
] as const;

const PLACEHOLDER_KEYS = [
  ["profile.accountMenu", ["{{email}}"]],
  ["profile.tfsaAccumulatedLimitCaption", ["{{year}}"]],
] as const;

/**
 * Pending-state copy uses the single-character ellipsis, not three periods. A mixed convention is
 * invisible in review and permanent once shipped.
 */
const ELLIPSIS_KEYS = [
  "profile.loading",
  "profile.saving",
  "profile.avatar.uploading",
] as const;

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

  it("retires profile.signIn from both locales (Story 35.5)", () => {
    // The account menu's cloud entry point moved to the `datasets.*` namespace once Story 35.3 made
    // it unconditionally "Migrate to Nixus Cloud" in a local profile. A survivor here is copy no
    // component reads, and the declared-keys assertion above is what would drift with it.
    expect(en["profile.signIn"]).toBeUndefined();
    expect(fr["profile.signIn"]).toBeUndefined();
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

  it.each(PREMIUM_COPY_KEYS)("defines %s in both locales with a value", (key) => {
    expect(en[key], `${key} missing in en.json`).toBeTruthy();
    expect(fr[key], `${key} missing in fr.json`).toBeTruthy();
  });

  it("keeps the Premium badge inside its copy ceiling", () => {
    expect(en["profile.premiumBadge"].length).toBeLessThanOrEqual(20);
    expect(fr["profile.premiumBadge"].length).toBeLessThanOrEqual(20);
  });

  it.each(PREMIUM_COPY_KEYS)("makes no usage or quota claim in %s", (key) => {
    // Request counts and limits are deliberately absent from the IPC boundary, so copy that implied
    // one could never be made true. Asserted rather than reviewed because a well-meaning "3 of 200
    // requests left" edit here reads as an improvement.
    for (const [locale, name] of [
      [en, "en.json"],
      [fr, "fr.json"],
    ] as const) {
      expect(locale[key], `${key} carries a figure in ${name}`).not.toMatch(/\d/);
      for (const word of [
        "request",
        "quota",
        "limit",
        "remaining",
        "requête",
        "restant",
        "limite",
      ]) {
        expect(
          locale[key].toLowerCase(),
          `${key} says "${word}" in ${name}`,
        ).not.toContain(word);
      }
    }
  });

  it("keeps Premium account-owned rather than branding the sidebar", () => {
    expect(en["sidebar.premium"]).toBeUndefined();
    expect(fr["sidebar.premium"]).toBeUndefined();
  });

  it("ships only the approved Premium label copy", () => {
    for (const [locale, name] of [
      [en, "en.json"],
      [fr, "fr.json"],
    ] as const) {
      const premiumKeys = profileKeys(locale).filter((key) =>
        key.startsWith("profile.premium"),
      );
      expect(premiumKeys.sort(), `unexpected premium copy in ${name}`).toEqual([
        "profile.premiumBadge",
      ]);
    }
  });

  it.each(AVATAR_REFUSAL_KEYS)(
    "gives %s its own non-empty wording in both locales",
    (key) => {
      expect(en[key]?.trim(), `${key} is blank in en.json`).toBeTruthy();
      expect(fr[key]?.trim(), `${key} is blank in fr.json`).toBeTruthy();
    },
  );

  it("keeps every avatar refusal distinguishable within each locale", () => {
    // Two causes sharing one sentence is the failure this guards: the shared validator reports six
    // distinct fields plus the derivation failure, and the user's next action differs across them
    // ("pick a smaller file" versus "pick a different file").
    for (const [locale, name] of [
      [en, "en.json"],
      [fr, "fr.json"],
    ] as const) {
      const messages = AVATAR_REFUSAL_KEYS.map((key) => locale[key]);
      expect(new Set(messages).size, `duplicate refusal copy in ${name}`).toBe(
        AVATAR_REFUSAL_KEYS.length,
      );
    }
  });

  it("never names a filesystem path or the account identifier in avatar copy (AD-11)", () => {
    // The picked path and the Cognito subject are the two values this feature must never surface.
    // Rust withholds both; copy that asked the user to check "C:\..." would reintroduce the idea.
    for (const [locale, name] of [
      [en, "en.json"],
      [fr, "fr.json"],
    ] as const) {
      for (const key of profileKeys(locale).filter((k) =>
        k.startsWith("profile.avatar."),
      )) {
        expect(locale[key], `${key} looks path-like in ${name}`).not.toMatch(
          /[/\\]{1,}[A-Za-z]|[A-Za-z]:\\/,
        );
        expect(
          locale[key].toLowerCase(),
          `${key} mentions the subject in ${name}`,
        ).not.toContain("cognito");
      }
    }
  });

  it("ships exactly the declared avatar keys", () => {
    const declared = [
      ...REQUIRED_KEYS.filter((key) => key.startsWith("profile.avatar.")),
    ].sort();

    for (const [locale, name] of [
      [en, "en.json"],
      [fr, "fr.json"],
    ] as const) {
      const shipped = profileKeys(locale)
        .filter((key) => key.startsWith("profile.avatar."))
        .sort();
      expect(shipped, `unexpected avatar copy in ${name}`).toEqual(declared);
    }
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
