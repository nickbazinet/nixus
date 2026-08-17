import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

const RETIREMENT_PREFIX = "retirement.";

const REQUIRED_KEYS = [
  "retirement.emptyTitle",
  "retirement.emptyDescription",
  "retirement.headlineAchievedWithAge",
  "retirement.headlineNotAchieved",
  "retirement.monthlySavings",
  "retirement.nestEggNeeded",
  "retirement.matrixLegend",
  "retirement.currentPace",
  "retirement.columnAge",
  "retirement.noExpenseHistory",
  "retirement.ageRequiredTitle",
  "retirement.ageRequiredDescription",
  "retirement.settingsTitle",
  "retirement.pensionLabel",
  "retirement.pensionDisclaimer",
  "retirement.pensionCaDefaultNote",
  "retirement.ageLabel",
  "retirement.ageManualNote",
  "retirement.ageFromProfileNote",
];

function collectRetirementKeys(locale: Record<string, string>): string[] {
  return Object.keys(locale).filter((key) => key.startsWith(RETIREMENT_PREFIX));
}

describe("retirement i18n parity", () => {
  it("includes every retirement EN key in FR", () => {
    const frKeys = new Set(collectRetirementKeys(fr));
    const missingInFr = collectRetirementKeys(en).filter((key) => !frKeys.has(key));

    expect(missingInFr, `Missing FR keys: ${missingInFr.join(", ")}`).toEqual([]);
  });

  it("includes every retirement FR key in EN", () => {
    const enKeys = new Set(collectRetirementKeys(en));
    const missingInEn = collectRetirementKeys(fr).filter((key) => !enKeys.has(key));

    expect(missingInEn, `Missing EN keys: ${missingInEn.join(", ")}`).toEqual([]);
  });

  it("defines every key the retirement page renders in both locales", () => {
    for (const key of REQUIRED_KEYS) {
      expect(en[key], `Missing EN key ${key}`).toBeTruthy();
      expect(fr[key], `Missing FR key ${key}`).toBeTruthy();
    }
  });

  it("defines nav.retirement in both locales", () => {
    expect(en["nav.retirement"]).toBeTruthy();
    expect(fr["nav.retirement"]).toBeTruthy();
  });
});
