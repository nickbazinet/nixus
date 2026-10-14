import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";
import { syncMessageKey } from "@/lib/appError";
import type { SyncErrorCode } from "@/lib/appError";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

const PREFIX = "recentlyDeleted.";

/* The three refusals `sync::restore` can return. Spelled out rather than derived, so a code the
 * backend gains and nobody translated fails here. */
const RESTORE_ERROR_CODES: readonly SyncErrorCode[] = [
  "restore_not_found",
  "restore_parent_missing",
  "restore_conflict",
];

const REQUIRED_KEYS = [
  "recentlyDeleted.sectionHeading",
  "recentlyDeleted.title",
  "recentlyDeleted.body",
  "recentlyDeleted.showAction",
  "recentlyDeleted.hideAction",
  "recentlyDeleted.loading",
  "recentlyDeleted.retryAction",
  "recentlyDeleted.errorList",
  "recentlyDeleted.errorTitle",
  "recentlyDeleted.errorGeneric",
  "recentlyDeleted.emptyTitle",
  "recentlyDeleted.emptyBody",
  "recentlyDeleted.localOnlyTitle",
  "recentlyDeleted.localOnlyBody",
  "recentlyDeleted.item",
  "recentlyDeleted.itemWithChildren",
  "recentlyDeleted.restoreAction",
  "recentlyDeleted.restoring",
  "recentlyDeleted.unnamed",
  "recentlyDeleted.typeAccount",
  "recentlyDeleted.typeAsset",
  "recentlyDeleted.typeBudgetCategory",
  "recentlyDeleted.typeBudgetGroup",
  "recentlyDeleted.typeContribution",
  "recentlyDeleted.typeConversation",
  "recentlyDeleted.typeExpense",
  "recentlyDeleted.typeIncomeEntry",
  "recentlyDeleted.typeIncomeSource",
  "recentlyDeleted.typeProject",
  "recentlyDeleted.typeRecurringExpense",
  "recentlyDeleted.typeRecurringIncome",
  "recentlyDeleted.typeServiceLog",
  "recentlyDeleted.typeVehicle",
  "recentlyDeleted.typeOther",
] as const;

function keysOf(locale: Record<string, string>): string[] {
  return Object.keys(locale).filter((key) => key.startsWith(PREFIX));
}

describe("recently deleted i18n", () => {
  it.each(REQUIRED_KEYS)("defines %s in both locales with a value", (key) => {
    expect(en[key], `${key} missing in en.json`).toBeTruthy();
    expect(fr[key], `${key} missing in fr.json`).toBeTruthy();
  });

  it("has no recently-deleted key present in one locale but not the other", () => {
    const enKeys = keysOf(en);
    const frKeys = keysOf(fr);

    expect(enKeys.filter((key) => !frKeys.includes(key))).toEqual([]);
    expect(frKeys.filter((key) => !enKeys.includes(key))).toEqual([]);
  });

  it.each(RESTORE_ERROR_CODES)("has localized copy for %s", (code) => {
    const key = syncMessageKey(code);

    expect(key.startsWith(PREFIX), `${code} maps outside ${PREFIX}`).toBe(true);
    expect(en[key], `${key} missing in en.json`).toBeTruthy();
    expect(fr[key], `${key} missing in fr.json`).toBeTruthy();
  });

  it("keeps every interpolation placeholder in both locales", () => {
    const placeholders: Record<string, readonly string[]> = {
      "recentlyDeleted.item": ["{{deletedAt}}", "{{days}}"],
      "recentlyDeleted.itemWithChildren": [
        "{{deletedAt}}",
        "{{days}}",
        "{{count}}",
      ],
    };

    for (const [key, expected] of Object.entries(placeholders)) {
      for (const token of expected) {
        expect(en[key], `${key} en.json`).toContain(token);
        expect(fr[key], `${key} fr.json`).toContain(token);
      }
    }
  });

  /* AD-14, the same rule the sync strings carry: the retention window is a product behaviour and
   * the copy must never make it a tier benefit. */
  it("names no subscription tier", () => {
    const forbidden = /\b(premium|tier|forfait|gratuit)\b/i;
    for (const locale of [en, fr]) {
      for (const key of keysOf(locale)) {
        expect(locale[key], `${key} names a tier`).not.toMatch(forbidden);
      }
    }
  });
});
