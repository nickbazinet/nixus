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
});
