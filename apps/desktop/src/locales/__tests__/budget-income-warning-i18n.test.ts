import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

const TITLE_KEY = "budget.incomeWarningTitle";
const DESCRIPTION_KEY = "budget.incomeWarningDescription";

const AMOUNT_PLACEHOLDERS = ["{{target}}", "{{average}}"] as const;

describe("budget income warning i18n", () => {
  it.each([TITLE_KEY, DESCRIPTION_KEY])(
    "defines %s in both locales with a value",
    (key) => {
      expect(en[key], `${key} missing in en.json`).toBeTruthy();
      expect(fr[key], `${key} missing in fr.json`).toBeTruthy();
    },
  );

  it.each(AMOUNT_PLACEHOLDERS)(
    "keeps %s in the description in both locales",
    (placeholder) => {
      expect(
        en[DESCRIPTION_KEY],
        `${DESCRIPTION_KEY} lost ${placeholder} in en.json`,
      ).toContain(placeholder);
      expect(
        fr[DESCRIPTION_KEY],
        `${DESCRIPTION_KEY} lost ${placeholder} in fr.json`,
      ).toContain(placeholder);
    },
  );

  it("interpolates both amounts and nothing else", () => {
    // An extra placeholder in one locale renders as literal braces for that language only —
    // the failure mode a per-placeholder check cannot see.
    for (const [locale, name] of [
      [en, "en.json"],
      [fr, "fr.json"],
    ] as const) {
      const found = locale[DESCRIPTION_KEY]?.match(/\{\{[^}]+\}\}/g) ?? [];
      expect(found.sort(), `unexpected placeholders in ${name}`).toEqual(
        [...AMOUNT_PLACEHOLDERS].sort(),
      );
    }
  });

  it("keeps the title free of interpolation", () => {
    expect(en[TITLE_KEY]).not.toContain("{{");
    expect(fr[TITLE_KEY]).not.toContain("{{");
  });

});
