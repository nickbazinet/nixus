import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

const DANGER_ZONE_PREFIX = "settings.dangerZone";

const REQUIRED_KEYS = [
  "settings.dangerZone",
  "settings.dangerZoneDescription",
  "settings.dangerZoneDeletedTitle",
  "settings.dangerZoneDeletedList",
  "settings.dangerZoneKeptTitle",
  "settings.dangerZoneKeptList",
  "settings.dangerZoneExportBackup",
  "settings.dangerZoneExporting",
  "settings.dangerZoneDeleteAll",
  "settings.dangerZoneDialogTitle",
  "settings.dangerZoneDialogDescription",
  "settings.dangerZoneConfirmWord",
  "settings.dangerZoneTypeToConfirm",
  "settings.dangerZoneConfirmDelete",
  "settings.dangerZoneDeleting",
  "settings.dangerZoneRestartFailed",
] as const;

function dangerZoneKeys(locale: Record<string, string>): string[] {
  return Object.keys(locale).filter((key) => key.startsWith(DANGER_ZONE_PREFIX));
}

describe("danger zone i18n", () => {
  it.each(REQUIRED_KEYS)("defines %s in both locales with a value", (key) => {
    expect(en[key], `${key} missing in en.json`).toBeTruthy();
    expect(fr[key], `${key} missing in fr.json`).toBeTruthy();
  });

  it("has no danger-zone key present in one locale but not the other", () => {
    const enKeys = dangerZoneKeys(en);
    const frKeys = dangerZoneKeys(fr);

    expect(enKeys.filter((k) => !frKeys.includes(k))).toEqual([]);
    expect(frKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
  });

  it("uses a localized, non-empty confirmation word per locale", () => {
    expect(en["settings.dangerZoneConfirmWord"]).toBe("DELETE");
    expect(fr["settings.dangerZoneConfirmWord"]).toBe("SUPPRIMER");
  });

  it("keeps the {{word}} interpolation placeholder in both locales", () => {
    expect(en["settings.dangerZoneTypeToConfirm"]).toContain("{{word}}");
    expect(fr["settings.dangerZoneTypeToConfirm"]).toContain("{{word}}");
  });

  // Story wipe-epoch reversed the behaviour this copy describes, and the copy has to be exact in
  // BOTH directions: deleting everything on a linked profile does empty the user's other
  // computers and does stop the cloud copy from being loaded again, but it does NOT erase the
  // stored copy (the bucket expires noncurrent versions only, pre-wipe change-log segments are
  // never reclaimed, and erasing the bytes is a manual request). Promising a deletion that does
  // not happen is the failure mode this guards.
  describe("describes the account-wide reach of the deletion truthfully", () => {
    const KEYS = [
      "settings.dangerZoneDeletedList",
      "settings.dangerZoneDialogDescription",
    ] as const;

    it.each(KEYS)("%s states the reach and the limit in English", (key) => {
      expect(en[key]).toMatch(/other computers/i);
      expect(en[key]).toMatch(/never be loaded again|ever being loaded again/i);
      expect(en[key]).toMatch(/not erase|is not erased/i);
      expect(
        en[key],
        "the copy must not claim the stored cloud data is removed"
      ).not.toMatch(/removes the data from your cloud sync/i);
    });

    it.each(KEYS)("%s states the reach and the limit in French", (key) => {
      expect(fr[key]).toMatch(/autres ordinateurs/i);
      expect(fr[key]).toMatch(/charg\u00e9e de nouveau|plus jamais charg\u00e9e/i);
      expect(fr[key]).toMatch(/n'est pas effac\u00e9e/i);
    });

    it.each(KEYS)("%s scopes the warning to a linked profile", (key) => {
      expect(en[key]).toMatch(/once this profile has linked/i);
      expect(fr[key]).toMatch(/d\u00e8s que ce profil est li\u00e9/i);
    });
  });
});
