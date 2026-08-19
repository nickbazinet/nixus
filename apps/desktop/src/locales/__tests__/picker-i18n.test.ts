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
 * DatasetPicker.tsx is the only consumer of these keys, and t() on a missing key renders the raw key
 * string rather than failing — so a typo or an en-only addition ships silently.
 */
const REQUIRED_KEYS = [
  "datasets.title",
  "datasets.subtitle",
  "datasets.loginWithCloud",
  "datasets.loadError",
  "datasets.selectFailed",
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

  it("states the screen's question and what a profile means in both locales", () => {
    // The exact strings are the requirement, not a paraphrase: this is the first screen of every
    // launch, and it has to say what the user is choosing between before it lists anything.
    expect(en["datasets.title"]).toBe("Choose a profile");
    expect(fr["datasets.title"]).toBe("Choisissez un profil");
    expect(en["datasets.subtitle"]).toBe(
      "Each profile keeps its own data on this machine. Pick the one you want to work in.",
    );
    expect(fr["datasets.subtitle"]).toBe(
      "Chaque profil conserve ses propres données sur cet appareil. Choisissez celui dans lequel vous voulez travailler.",
    );
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
