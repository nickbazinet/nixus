import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

/*
 * The privacy and limits copy is a factual claim about the code, so it is tested like one. Every
 * sentence below was true of an earlier build and became false without the copy changing: Nixus
 * Cloud sign-in and paid plans exist, four AI surfaces send figures rather than only a statement
 * file, and the app also reaches Yahoo Finance, NHTSA vPIC, GitHub and the Nixus Cloud APIs.
 *
 * These guards are deliberately phrase-level rather than key-level. A future rewrite is free to
 * move the disclosure anywhere it likes; what it may not do is put one of these claims back.
 */

const REQUIRED_KEYS = [
  "settings.aboutLimitLocal",
  "settings.aboutLimitSingleUser",
  "settings.aboutStorageTitle",
  "settings.aboutStorageBody",
  "settings.aboutCloudStorageTitle",
  "settings.aboutCloudStorageBody",
  "settings.aboutNetworkTitle",
  "settings.aboutNetworkBody",
  "settings.readingDescription",
  "settings.readingReassuranceBody",
  "settings.whatGetsSentTitle",
  "settings.whatGetsSentBody",
  "settings.whatGetsSentChatTitle",
  "settings.whatGetsSentChatBody",
  "settings.whatGetsSentInsightsTitle",
  "settings.whatGetsSentInsightsBody",
  "settings.whatGetsSentHostedTitle",
  "settings.whatGetsSentHostedBody",
  "settings.rememberMerchantsBody",
  "onboarding.limitLocal",
  "onboarding.limitLocalBody",
] as const;

/** Claims the code contradicts, each paired with the behaviour that makes it false. */
const RETIRED_CLAIMS_EN: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /only part of Nixus that uses the internet/i,
    "stock quotes, the vehicle catalog, update checks and Nixus Cloud also use the network",
  ],
  [
    /nothing to sign up for/i,
    "Nixus Cloud sign-in and paid plans exist",
  ],
  [
    /never touch the network/i,
    "a syncing Nixus Cloud profile copies those records to the cloud",
  ],
  [
    /(budget|balances|accounts|net worth)[^.]*are never sent/i,
    "Budget Helper sends a budget, account and asset summary with every question",
  ],
  [
    /reads it on this computer/i,
    "the statement file is sent to the AI service to be read",
  ],
  [
    /per install\b/i,
    "an install holds as many profiles as the picker can create",
  ],
  [
    /no account, no API key/i,
    "a user on a plan necessarily has an account",
  ],
  [
    /keep everything local to this machine/i,
    "a BYO key still sends the statement to that provider",
  ],
];

const RETIRED_CLAIMS_FR: ReadonlyArray<readonly [RegExp, string]> = [
  [/seule partie de Nixus qui utilise Internet/i, "same as the English claim"],
  [/ne touchent jamais au réseau/i, "same as the English claim"],
  [/ne sont jamais envoyés/i, "same as the English claim"],
  [/le lit sur cet ordinateur/i, "same as the English claim"],
  [/par installation/i, "same as the English claim"],
  [/ni compte, ni clé/i, "same as the English claim"],
  [/tout garder sur cet ordinateur/i, "same as the English claim"],
  [/rien à créer/i, "same as the English claim"],
];

describe("privacy and limits copy", () => {
  it.each(REQUIRED_KEYS)("defines %s in both locales with a value", (key) => {
    expect(en[key], `${key} missing in en.json`).toBeTruthy();
    expect(fr[key], `${key} missing in fr.json`).toBeTruthy();
  });

  it("has the same key set in English and French", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  it.each(RETIRED_CLAIMS_EN)("makes no en.json string claim %s (%s)", (pattern, _why) => {
    for (const [key, value] of Object.entries(en)) {
      expect(value, `${key} reintroduces a claim the code contradicts`).not.toMatch(pattern);
    }
  });

  it.each(RETIRED_CLAIMS_FR)("makes no fr.json string claim %s (%s)", (pattern, _why) => {
    for (const [key, value] of Object.entries(fr)) {
      expect(value, `${key} reintroduces a claim the code contradicts`).not.toMatch(pattern);
    }
  });

  /* The two facts a user cannot discover by using the app, and the reason this section exists:
   * where a synced copy physically sits, and that Nixus — not only the user — can read it. */
  it("says where a Nixus Cloud copy lives and that it is not end-to-end encrypted", () => {
    expect(en["settings.aboutCloudStorageBody"]).toMatch(/Amazon Web Services/);
    expect(en["settings.aboutCloudStorageBody"]).toMatch(/United States/);
    expect(en["settings.aboutCloudStorageBody"]).toMatch(/not end to end/i);
    expect(fr["settings.aboutCloudStorageBody"]).toMatch(/Amazon Web Services/);
    expect(fr["settings.aboutCloudStorageBody"]).toMatch(/États-Unis/);
    expect(fr["settings.aboutCloudStorageBody"]).toMatch(/pas de bout en bout/i);
  });

  /* `ai/home_surface.rs` is the one AI surface that puts no resolved figure in a prompt, which is
   * only worth disclosing while it stays true — so the claim is pinned here too. */
  it("still distinguishes the Home composer as sending no figures", () => {
    expect(en["settings.whatGetsSentInsightsBody"]).toMatch(/no figures/i);
    expect(fr["settings.whatGetsSentInsightsBody"]).toMatch(/aucun chiffre/i);
  });

  it("keeps the local profile's own promise intact", () => {
    expect(en["settings.aboutLimitLocal"]).toMatch(/local profile/i);
    expect(en["settings.aboutLimitLocal"]).toMatch(/Nixus Cloud/);
    expect(fr["settings.aboutLimitLocal"]).toMatch(/profil local/i);
    expect(fr["settings.aboutLimitLocal"]).toMatch(/Nixus Cloud/);
  });
});
