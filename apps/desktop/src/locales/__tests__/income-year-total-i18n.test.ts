import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

const KEYS = [
  "income.yearTotal",
  "income.yearTotalsUnavailable",
  "income.yearTotalsUnavailableDescription",
  "income.retryYearTotals",
] as const;

const YEAR_KEYS = [
  "income.yearTotal",
  "income.yearTotalsUnavailableDescription",
] as const;

describe("income year total i18n", () => {
  it.each(KEYS)("defines %s in both locales", (key) => {
    expect(en[key], `${key} missing in en.json`).toBeTruthy();
    expect(fr[key], `${key} missing in fr.json`).toBeTruthy();
  });

  it.each(YEAR_KEYS)("keeps only the year placeholder in %s", (key) => {
    for (const [locale, name] of [
      [en, "en.json"],
      [fr, "fr.json"],
    ] as const) {
      expect(
        locale[key]?.match(/\{\{[^}]+\}\}/g) ?? [],
        `unexpected placeholders in ${name}`,
      ).toEqual(["{{year}}"]);
    }
  });
});
