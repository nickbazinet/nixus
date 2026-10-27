import { describe, expect, it } from "vitest";
import enLocale from "../en.json";
import frLocale from "../fr.json";

const en = enLocale as Record<string, string>;
const fr = frLocale as Record<string, string>;

const ASSET_PREFIX = "assets.";

/**
 * The strings the stock surfaces render. Pinned by NAME and not by a count, so a key that is
 * renamed in EN without being renamed in FR fails here instead of rendering as a raw key.
 */
const STOCK_KEYS = [
  "assets.typeStock",
  "assets.stockSymbol",
  "assets.stockSymbolPlaceholder",
  "assets.stockSymbolNote",
  "assets.stockSymbolRequired",
  "assets.stockSearchPlaceholder",
  "assets.stockSearchHint",
  "assets.stockSearching",
  "assets.stockSearchFailed",
  "assets.stockSearchEmpty",
  "assets.stockQuantity",
  "assets.stockQuantityPlaceholder",
  "assets.stockQuantityRequired",
  "assets.stockQuantityNote",
  "assets.stockQuantityTooLarge",
  "assets.stockNamePlaceholder",
  "assets.stockValueNote",
  "assets.stockTypeLocked",
  "assets.stockEditQuantityNote",
  "assets.stockShares_one",
  "assets.stockShares_other",
  "assets.stockAsOf",
  "assets.stockPriceUnavailable",
  "assets.stockRefresh",
  "assets.stockRefreshing",
  "assets.stockRefreshDone",
  "assets.stockRefreshPartial",
  "assets.stockRefreshFailed",
  "assets.stockRefreshSkipped",
] as const;

/** An interpolation present in one language and missing in the other renders a blank. */
const INTERPOLATED: Record<string, string[]> = {
  "assets.stockEditQuantityNote": ["symbol"],
  "assets.stockShares_one": ["quantity"],
  "assets.stockShares_other": ["quantity"],
  "assets.stockAsOf": ["age"],
  "assets.stockRefreshPartial": ["symbols"],
};

function assetKeys(locale: Record<string, string>): string[] {
  return Object.keys(locale).filter((key) => key.startsWith(ASSET_PREFIX));
}

/** i18next picks the suffix from `count`; a missing half renders the raw key. */
const PLURALIZED = ["assets.stockShares"] as const;

describe("assets i18n parity", () => {
  it("gives every pluralized string both an _one and an _other form", () => {
    for (const base of PLURALIZED) {
      for (const locale of [en, fr]) {
        expect(locale[`${base}_one`], `${base}_one`).toBeTruthy();
        expect(locale[`${base}_other`], `${base}_other`).toBeTruthy();
        expect(
          locale[base],
          `${base} must not also exist unsuffixed, which shadows the plural forms`
        ).toBeUndefined();
      }
    }
  });

  it("does not label the symbol field with the same text as the stock type", () => {
    // Two different things called "Stock" is the ambiguity this guards: one names the asset KIND in
    // the type select, the other names the ticker field beneath it.
    expect(en["assets.stockSymbol"]).not.toBe(en["assets.typeStock"]);
    expect(fr["assets.stockSymbol"]).not.toBe(fr["assets.typeStock"]);
  });

  it("describes the stock case in both slide-over descriptions", () => {
    for (const locale of [en, fr]) {
      expect(locale["assets.addAssetDescription"]).toMatch(/stock|action/i);
      expect(locale["assets.editAssetDescription"]).toMatch(/share|action/i);
    }
  });

  it("does not claim a quantity edit refreshes the price", () => {
    // It recomputes from the CACHED price and makes no network call, so promising a refresh here
    // would be a lie the offline path exposes immediately.
    expect(en["assets.stockEditQuantityNote"]).not.toMatch(/refresh/i);
    expect(fr["assets.stockEditQuantityNote"]).not.toMatch(/actualis/i);
  });

  it("includes every EN assets key in FR", () => {
    const frKeys = new Set(assetKeys(fr));
    const missingInFr = assetKeys(en).filter((key) => !frKeys.has(key));

    expect(missingInFr, `Missing FR keys: ${missingInFr.join(", ")}`).toEqual([]);
  });

  it("includes every FR assets key in EN", () => {
    const enKeys = new Set(assetKeys(en));
    const missingInEn = assetKeys(fr).filter((key) => !enKeys.has(key));

    expect(missingInEn, `Missing EN keys: ${missingInEn.join(", ")}`).toEqual([]);
  });

  it("includes EN and FR text for every stock string", () => {
    for (const key of STOCK_KEYS) {
      expect(en[key], `Missing EN key ${key}`).toBeTruthy();
      expect(fr[key], `Missing FR key ${key}`).toBeTruthy();
    }
  });

  it("keeps every interpolation placeholder in both languages", () => {
    for (const [key, placeholders] of Object.entries(INTERPOLATED)) {
      for (const placeholder of placeholders) {
        const token = `{{${placeholder}}}`;
        expect(en[key], `EN ${key} lost ${token}`).toContain(token);
        expect(fr[key], `FR ${key} lost ${token}`).toContain(token);
      }
    }
  });

  it("does not leave an FR string identical to its EN original", () => {
    const untranslated = STOCK_KEYS.filter(
      (key) => en[key] === fr[key] && (en[key] ?? "").trim().length > 0
    );

    expect(
      untranslated,
      `FR is still the EN text for: ${untranslated.join(", ")}`
    ).toEqual([]);
  });
});
