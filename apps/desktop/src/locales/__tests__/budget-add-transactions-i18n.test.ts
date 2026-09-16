import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

const TRIGGER_KEYS = [
  "budget.addTransactions",
  "budget.addExpenseManually",
  "budget.applyRecurringExpenses",
] as const;

// The menu reuses this rather than restating it, so the consolidation depends on it staying
// bilingual even though this change did not author it.
const REUSED_ITEM_KEYS = ["dashboard.importStatement"] as const;

describe("budget add-transactions menu i18n", () => {
  it.each([...TRIGGER_KEYS, ...REUSED_ITEM_KEYS])(
    "defines %s in both locales",
    (key) => {
      expect(en[key], `${key} missing in en.json`).toBeTruthy();
      expect(fr[key], `${key} missing in fr.json`).toBeTruthy();
    },
  );

  it.each([...TRIGGER_KEYS, ...REUSED_ITEM_KEYS])(
    "keeps %s free of placeholders",
    (key) => {
      for (const [locale, name] of [
        [en, "en.json"],
        [fr, "fr.json"],
      ] as const) {
        expect(
          locale[key]?.match(/\{\{[^}]+\}\}/g) ?? [],
          `unexpected placeholders in ${name}`,
        ).toEqual([]);
      }
    },
  );

  it.each([...TRIGGER_KEYS, ...REUSED_ITEM_KEYS])(
    "gives %s its own French wording",
    (key) => {
      expect(fr[key], `${key} left untranslated in fr.json`).not.toBe(en[key]);
    },
  );
});
