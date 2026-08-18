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
  "retirement.headlineExploringWithAge",
  "retirement.headlineExploringNotAchieved",
  "retirement.monthlySavings",
  "retirement.nestEggNeeded",
  "retirement.matrixLegend",
  "retirement.todaysDollarsInfoAria",
  "retirement.todaysDollarsInfoPlain",
  "retirement.nestEggFutureDetail",
  "retirement.nestEggFutureDetailAria",
  "retirement.currentPace",
  "retirement.exploringPace",
  "retirement.anchorLabel",
  "retirement.anchorReset",
  "retirement.horizonLabel",
  "retirement.horizonNext6",
  "retirement.horizonNext12",
  "retirement.horizonNext30",
  "retirement.columnAge",
  "retirement.noExpenseHistory",
  "retirement.ageRequiredTitle",
  "retirement.ageRequiredDescription",
  "retirement.settingsTitle",
  "retirement.governmentPensionLabel",
  "retirement.governmentPensionDisclaimer",
  "retirement.governmentPensionAgeGateNote",
  "retirement.governmentPensionCaDefaultNote",
  "retirement.employerPensionLabel",
  "retirement.employerPensionDisclaimer",
  "retirement.employerPensionStartAgeLabel",
  "retirement.employerPensionStartAgeNote",
  "retirement.pensionTaxRateLabel",
  "retirement.pensionTaxRateNote",
  "retirement.pensionTaxRateAutoBadge",
  "retirement.pensionTaxRateZeroBadge",
  "retirement.pensionTaxRateZeroNote",
  "retirement.pensionTaxRateAutoNote",
  "retirement.pensionTaxRateUseEstimate",
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

  // A headline missing a placeholder renders a sentence with a hole in it rather than failing, so
  // interpolation parity has to be asserted separately from key parity. `{{horizon}}` in particular
  // is what stops the "not on track" copy from claiming 30 years over a 6-year grid.
  it("interpolates every placeholder the matrix supplies, in both locales", () => {
    const headlinePlaceholders = {
      "retirement.headlineAchievedWithAge": ["expense", "amount", "age", "years"],
      "retirement.headlineNotAchieved": ["expense", "amount", "horizon"],
      "retirement.headlineExploringWithAge": ["expense", "amount", "age", "years"],
      "retirement.headlineExploringNotAchieved": ["expense", "amount", "horizon"],
    } as const;

    for (const [key, placeholders] of Object.entries(headlinePlaceholders)) {
      for (const [localeName, locale] of [
        ["EN", en],
        ["FR", fr],
      ] as const) {
        for (const placeholder of placeholders) {
          expect(
            locale[key],
            `${localeName} ${key} must interpolate {{${placeholder}}}`,
          ).toContain(`{{${placeholder}}}`);
        }
      }
    }
  });

  // The two places outside the matrix that interpolate a value. Without the placeholder the button
  // reads "Use our estimate (%)" and the caption "Using %…" — a claim with its number missing, which
  // a key-presence check still passes. Both must name the rate: the whole point of the affordance is
  // that the user can verify the number before accepting it.
  it("interpolates the estimated rate into the estimate button and caption, in both locales", () => {
    for (const key of [
      "retirement.pensionTaxRateUseEstimate",
      "retirement.pensionTaxRateAutoNote",
    ]) {
      expect(en[key], `EN ${key} must interpolate {{rate}}`).toContain("{{rate}}");
      expect(fr[key], `FR ${key} must interpolate {{rate}}`).toContain("{{rate}}");
    }
  });

  // Non-CA users have no tax table, so clearing an override lands on a flat 0% — a default, not an
  // estimate. These four are every string that can render in that state, so an estimate word in any
  // of them is the exact lie this spec removed, walked back in by a copy edit.
  it("keeps estimate language out of every string shown when no estimate exists", () => {
    const estimateWords = /estimat|automatic|automatique/i;

    for (const key of [
      "retirement.pensionTaxRateLabel",
      "retirement.pensionTaxRateNote",
      "retirement.pensionTaxRateZeroBadge",
      "retirement.pensionTaxRateZeroNote",
    ]) {
      expect(en[key], `EN ${key} must not promise an estimate`).not.toMatch(
        estimateWords,
      );
      expect(fr[key], `FR ${key} must not promise an estimate`).not.toMatch(
        estimateWords,
      );
    }
  });

  // Parity only compares what both files contain, so a key orphaned in both passes it silently and
  // keeps serving old copy to any leftover call site instead of failing loudly as a missing
  // translation. These two are the readout and action the badge and rate-naming button replaced.
  it("leaves no orphaned pension-tax-rate keys in either locale", () => {
    for (const key of [
      "retirement.pensionTaxRateAutoEstimate",
      "retirement.pensionTaxRateUseAutomatic",
    ]) {
      expect(en[key], `EN ${key} should be deleted`).toBeUndefined();
      expect(fr[key], `FR ${key} should be deleted`).toBeUndefined();
    }
  });

  // The receipt tooltip exists to name the future figure a header amount was deflated from. A missing
  // placeholder leaves the sentence grammatical and the disclosure gone, so the user reads an
  // explanation that explains nothing — a state key-presence parity accepts.
  it("interpolates every figure the deflation receipt discloses, in both locales", () => {
    const detailPlaceholders = {
      "retirement.todaysDollarsInfoPlain": ["rate"],
      "retirement.nestEggFutureDetail": [
        "age",
        "years",
        "futureAmount",
        "todaysAmount",
        "rate",
      ],
      "retirement.nestEggFutureDetailAria": [
        "todaysAmount",
        "futureAmount",
        "age",
      ],
    } as const;

    for (const [key, placeholders] of Object.entries(detailPlaceholders)) {
      for (const [localeName, locale] of [
        ["EN", en],
        ["FR", fr],
      ] as const) {
        for (const placeholder of placeholders) {
          expect(
            locale[key],
            `${localeName} ${key} must interpolate {{${placeholder}}}`,
          ).toContain(`{{${placeholder}}}`);
        }
      }
    }
  });

  // The row label and the legend are the only two places that tell the user these figures are not in
  // future dollars. Without that phrase the legend's "retiring earlier needs a bigger cushion" reads
  // as a claim about numbers the user cannot verify, and key-presence parity still passes.
  it("says the amounts are in today's dollars, in both the row label and the legend", () => {
    const todaysDollars = { EN: /today's/i, FR: /aujourd'hui/i } as const;

    for (const [localeName, locale] of [
      ["EN", en],
      ["FR", fr],
    ] as const) {
      for (const key of [
        "retirement.nestEggNeeded",
        "retirement.matrixLegend",
      ]) {
        expect(
          locale[key],
          `${localeName} ${key} must state the amounts are in today's dollars`,
        ).toMatch(todaysDollars[localeName]);
      }
    }
  });
});
