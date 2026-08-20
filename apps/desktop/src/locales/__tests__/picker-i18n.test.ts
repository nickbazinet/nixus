import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

// `datasets.*`, not `picker.*`: Epic 33's naming convention puts code identifiers under the
// Dataset/`datasets` spelling and reserves the word "profile" for user-facing copy — which is why
// every value below says "profile" while every key says "datasets".
const DATASETS_PREFIX = "datasets.";

/**
 * DatasetPicker.tsx and ProfileMenu.tsx are the consumers of these keys (plus routes/profile.tsx for
 * the sign-in label that replaced the retired `profile.signIn`), and t() on a missing key renders
 * the raw key string rather than failing — so a typo or an en-only addition ships silently.
 */
const REQUIRED_KEYS = [
  "datasets.title",
  "datasets.subtitle",
  "datasets.loginWithCloud",
  "datasets.newLocalProfile",
  "datasets.switchProfile",
  "datasets.loadError",
  "datasets.selectFailed",
  "datasets.createFailed",
  "datasets.renameProfile",
  "datasets.renameProfileAction",
  "datasets.renameProfileDescription",
  "datasets.profileName",
  "datasets.nameRequired",
  "datasets.nameTooLong",
  "datasets.renameFailed",
  "datasets.migrateToCloud",
  "datasets.signInWithCloud",
  "datasets.signedIn",
  "datasets.signedOut",
  "datasets.cloudFailed",
] as const;

function datasetsKeys(locale: Record<string, string>): string[] {
  return Object.keys(locale).filter((key) => key.startsWith(DATASETS_PREFIX));
}

describe("datasets i18n", () => {
  it.each(REQUIRED_KEYS)("defines %s in both locales with a value", (key) => {
    expect(en[key], `${key} missing in en.json`).toBeTruthy();
    expect(fr[key], `${key} missing in fr.json`).toBeTruthy();
  });

  it("has no datasets key present in one locale but not the other", () => {
    const enKeys = datasetsKeys(en);
    const frKeys = datasetsKeys(fr);

    expect(enKeys.length).toBeGreaterThan(0);
    expect(enKeys.filter((k) => !frKeys.includes(k))).toEqual([]);
    expect(frKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
  });

  it("declares every datasets key it ships", () => {
    // An orphaned key here is copy the screen can never show, and an undeclared one escapes the
    // required-key assertions above.
    expect(datasetsKeys(en).sort()).toEqual([...REQUIRED_KEYS].sort());
    expect(datasetsKeys(fr).sort()).toEqual([...REQUIRED_KEYS].sort());
  });

  it("retires the picker.* namespace entirely", () => {
    // These keys shipped under `picker.*` first. A leftover there is copy no component reads, and it
    // would drift out of sync with the `datasets.*` value the screen actually renders.
    expect(Object.keys(en).filter((k) => k.startsWith("picker."))).toEqual([]);
    expect(Object.keys(fr).filter((k) => k.startsWith("picker."))).toEqual([]);
  });

  it("greets the user and says what a profile means in both locales", () => {
    // The exact strings are the requirement, not a paraphrase: this is the first screen of every
    // launch, so it greets first and then says what the user is choosing between.
    expect(en["datasets.title"]).toBe("Welcome to Nixus");
    expect(fr["datasets.title"]).toBe("Bienvenue dans Nixus");
    expect(en["datasets.subtitle"]).toBe(
      "Choose a profile to open. Each one keeps its own data on this machine, separate from the rest.",
    );
    expect(fr["datasets.subtitle"]).toBe(
      "Choisissez un profil à ouvrir. Chacun conserve ses propres données sur cet appareil, séparément des autres.",
    );
  });

  it("still asks the screen's question now that the title is a greeting", () => {
    // The instruction moved from the title into the subtitle; a greeting alone would leave the list
    // below it unexplained.
    expect(en["datasets.subtitle"]).toContain("Choose a profile");
    expect(fr["datasets.subtitle"]).toContain("Choisissez un profil");
  });

  it("labels the header's way back to the picker in both locales", () => {
    // The account trigger's only action while a local profile is open: it must never read as a
    // cloud action, because a cloud sign-in would switch the profile out from under the user.
    expect(en["datasets.switchProfile"]).toBe("Switch profile");
    expect(fr["datasets.switchProfile"]).toBe("Changer de profil");
    expect(en["datasets.switchProfile"]).not.toContain("Nixus Cloud");
    expect(fr["datasets.switchProfile"]).not.toContain("Nixus Cloud");
  });

  it("names the local-first guarantee in both locales", () => {
    // A picker that does not say the data stays put reads as a cloud account switcher, which is
    // the opposite of what this product is.
    expect(en["datasets.subtitle"]).toContain("on this machine");
    expect(fr["datasets.subtitle"]).toContain("sur cet appareil");
  });

  it("labels the cloud action with the Nixus Cloud brand term in both locales", () => {
    expect(en["datasets.loginWithCloud"]).toBe("Log in with Nixus Cloud");
    expect(fr["datasets.loginWithCloud"]).toBe("Se connecter avec Nixus Cloud");
  });

  it("does not translate the Nixus Cloud brand term in fr.json (NFR8)", () => {
    expect(fr["datasets.loginWithCloud"]).toContain("Nixus Cloud");
  });

  it("says a failed read failed, rather than reading as an empty list", () => {
    // The whole point of this key is being distinguishable from "you have zero profiles", so copy
    // that omits the failure would put the state right back where it started.
    expect(en["datasets.loadError"]).toBe("Your profiles could not be read.");
    expect(fr["datasets.loadError"]).toBe("Vos profils n'ont pas pu être lus.");
    expect(en["datasets.loadError"]).not.toBe(en["datasets.subtitle"]);
  });

  it("distinguishes a failed selection from a failed read", () => {
    // Two different failures on the same screen: the list could not be read at all, versus one
    // chosen profile could not be opened. Identical copy would make them indistinguishable.
    expect(en["datasets.selectFailed"]).toBeTruthy();
    expect(fr["datasets.selectFailed"]).toBeTruthy();
    expect(en["datasets.selectFailed"]).not.toBe(en["datasets.loadError"]);
    expect(fr["datasets.selectFailed"]).not.toBe(fr["datasets.loadError"]);
  });

  it("speaks of profiles, never datasets, in user-facing copy", () => {
    // Epic 33's naming rule runs both ways: identifiers say dataset, copy says profile. A value
    // leaking the internal noun is the failure this guards.
    for (const key of REQUIRED_KEYS) {
      expect(en[key], `${key} leaks "dataset" into en copy`).not.toMatch(/dataset/i);
      expect(fr[key], `${key} leaks "dataset" into fr copy`).not.toMatch(/dataset/i);
    }
  });

  it("labels the account menu's cloud entry points with the brand term in both locales", () => {
    // Story 35.3 makes the migrate label unconditional in a local profile, and Story 35.4 adds the
    // signed-in/out badge. All four are brand-bearing copy, and the brand is never translated.
    expect(en["datasets.migrateToCloud"]).toBe("Migrate to Nixus Cloud");
    expect(fr["datasets.migrateToCloud"]).toBe("Migrer vers Nixus Cloud");
    for (const key of [
      "datasets.migrateToCloud",
      "datasets.signInWithCloud",
      "datasets.signedIn",
      "datasets.signedOut",
    ]) {
      expect(en[key], `${key} lost the brand term in en.json`).toContain("Nixus Cloud");
      expect(fr[key], `${key} lost the brand term in fr.json`).toContain("Nixus Cloud");
    }
  });

  it("distinguishes migrating from signing in, and signed in from signed out", () => {
    // The two menu actions run the same OAuth flow but produce different profiles, and the two badge
    // states are the whole point of Story 35.4 — identical copy would make either pair unreadable.
    expect(en["datasets.migrateToCloud"]).not.toBe(en["datasets.signInWithCloud"]);
    expect(fr["datasets.migrateToCloud"]).not.toBe(fr["datasets.signInWithCloud"]);
    expect(en["datasets.signedIn"]).not.toBe(en["datasets.signedOut"]);
    expect(fr["datasets.signedIn"]).not.toBe(fr["datasets.signedOut"]);
  });

  it("retires profile.signIn now that the datasets namespace owns the cloud entry points", () => {
    // Story 35.5's other half: the old label had exactly one caller left, and both it and this key
    // go in the same change rather than leaving an orphan behind.
    expect(en["profile.signIn"]).toBeUndefined();
    expect(fr["profile.signIn"]).toBeUndefined();
  });

  it("names the rename action and keeps its three failures distinguishable in both locales", () => {
    expect(en["datasets.renameProfile"]).toBe("Rename profile");
    expect(fr["datasets.renameProfile"]).toBe("Renommer le profil");

    for (const locale of [en, fr]) {
      // The per-row action names the profile it acts on, so a screen reader hears which of several
      // identical Rename buttons it has landed on — an interpolation-free label cannot.
      expect(locale["datasets.renameProfileAction"]).toContain("{{name}}");
      // The limit is stated by the validator that enforces it, never spelled out twice.
      expect(locale["datasets.nameTooLong"]).toContain("{{max}}");

      // Blank, too long, and refused by the backend are three different outcomes on one screen;
      // identical copy would make them indistinguishable, and reusing select/create copy would
      // report the wrong action entirely.
      expect(locale["datasets.nameRequired"]).not.toBe(locale["datasets.nameTooLong"]);
      expect(locale["datasets.renameFailed"]).not.toBe(locale["datasets.selectFailed"]);
      expect(locale["datasets.renameFailed"]).not.toBe(locale["datasets.createFailed"]);
    }
  });

  it("promises the rename moves no data, in both locales", () => {
    // The one reassurance this dialog owes the user: a rename is a label edit, not a migration.
    expect(en["datasets.renameProfileDescription"]).toContain("Only the name changes");
    expect(fr["datasets.renameProfileDescription"]).toContain("Seul le nom change");
  });

  it("keeps the picker's copy out of the auth.* namespace", () => {
    // auth.* was the account-prompt dialog's namespace and Story 33.5 deleted it outright. A picker
    // string parked there would have been deleted with it.
    expect(en["auth.loginWithCloud"]).toBeUndefined();
    expect(fr["auth.loginWithCloud"]).toBeUndefined();
  });

  it("retires the auth.* namespace entirely", () => {
    // Story 33.5 deleted the account-prompt dialog and every key it read. A survivor here is copy
    // no component can ever render, and the dedicated auth i18n test that would have caught it is
    // gone with the dialog.
    expect(Object.keys(en).filter((k) => k.startsWith("auth."))).toEqual([]);
    expect(Object.keys(fr).filter((k) => k.startsWith("auth."))).toEqual([]);
  });
});
