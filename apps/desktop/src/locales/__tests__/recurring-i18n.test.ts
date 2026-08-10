import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

const RECURRING_PREFIX = "recurring.";

// Keys the recurring page and its forms read directly. Listed explicitly so a rename in the
// components cannot quietly leave the page rendering raw key names.
const REQUIRED_KEYS = [
  "recurring.title",
  "recurring.subtitle",
  "recurring.autoApplyTitle",
  "recurring.autoApplyDescription",
  "recurring.tableCaption",
  "recurring.typeColumn",
  "recurring.nameColumn",
  "recurring.categoryColumn",
  "recurring.dayColumn",
  "recurring.activeColumn",
  "recurring.typeExpense",
  "recurring.typeIncome",
  "recurring.committedLabel",
  "recurring.expectedLabel",
  "recurring.activeTemplateCount",
  "recurring.activeIncomeTemplateCount",
  "recurring.activeCount",
  "recurring.activeIncomeCount",
  "recurring.emptyTitle",
  "recurring.emptyDescription",
  "recurring.addBill",
  "recurring.addTemplate",
  "recurring.addTemplateDescription",
  "recurring.addIncome",
  "recurring.addIncomeDescription",
  "recurring.editTemplate",
  "recurring.editTemplateDescription",
  "recurring.editIncome",
  "recurring.editIncomeDescription",
  "recurring.saveTemplate",
  "recurring.templateSaved",
  "recurring.templateSaveFailed",
  "recurring.incomeSaved",
  "recurring.incomeSaveFailed",
  "recurring.incomeNeedsSource",
  "recurring.incomeAccountHelp",
  "recurring.incomeActiveLabel",
  "recurring.incomeActiveHint",
  "recurring.activeLabel",
  "recurring.activeHint",
  "recurring.activate",
  "recurring.deactivate",
  "recurring.openTemplate",
  "recurring.deleteTemplate",
  "recurring.deleteTemplateExplain",
  "recurring.deleteIncomeExplain",
  "recurring.dayOfMonth",
  "recurring.dayLabel",
  "recurring.dayHint",
  "recurring.dayRequired",
  "recurring.dayRange",
] as const;

// Keys outside the `recurring.` namespace that the recurring income forms and rows render.
// The prefix-based parity checks below cannot see these, so they are asserted by name.
const REQUIRED_FOREIGN_KEYS = [
  "common.source",
  "common.amount",
  "common.category",
  "common.cancel",
  "common.delete",
  "common.none",
  "income.sourceRequired",
  "income.selectSource",
  "income.accountOptional",
  "income.typeEmployment",
  "income.typeFreelance",
  "income.typeInvestment",
  "income.typeOther",
  "validation.amountPositive",
] as const;

function collectRecurringKeys(locale: Record<string, string>): string[] {
  return Object.keys(locale).filter((key) => key.startsWith(RECURRING_PREFIX));
}

describe("recurring i18n parity", () => {
  it("includes every recurring EN key in FR", () => {
    const frKeys = new Set(collectRecurringKeys(fr));
    const missingInFr = collectRecurringKeys(en).filter((key) => !frKeys.has(key));

    expect(missingInFr, `Missing FR keys: ${missingInFr.join(", ")}`).toEqual([]);
  });

  it("includes every recurring FR key in EN", () => {
    const enKeys = new Set(collectRecurringKeys(en));
    const missingInEn = collectRecurringKeys(fr).filter((key) => !enKeys.has(key));

    expect(missingInEn, `Missing EN keys: ${missingInEn.join(", ")}`).toEqual([]);
  });

  it("defines every key the recurring page renders in both locales", () => {
    for (const key of REQUIRED_KEYS) {
      expect(en[key], `Missing EN key ${key}`).toBeTruthy();
      expect(fr[key], `Missing FR key ${key}`).toBeTruthy();
    }
  });

  it("defines the shared keys the recurring income forms borrow, in both locales", () => {
    for (const key of REQUIRED_FOREIGN_KEYS) {
      expect(en[key], `Missing EN key ${key}`).toBeTruthy();
      expect(fr[key], `Missing FR key ${key}`).toBeTruthy();
    }
  });

  it("keeps the plural and singular forms of the income counters together", () => {
    for (const key of ["recurring.activeIncomeCount", "recurring.activeIncomeTemplateCount"]) {
      expect(en[`${key}_one`], `Missing EN key ${key}_one`).toBeTruthy();
      expect(fr[`${key}_one`], `Missing FR key ${key}_one`).toBeTruthy();
    }
  });
});
