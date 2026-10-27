import { describe, expect, it, vi, afterEach } from "vitest";
import {
  ASSET_TYPE_ORDER,
  ASSET_TYPE_VALUES,
  MAX_QUANTITY_MICROS,
  STOCK_STALE_AFTER_HOURS,
  formatQuantity,
  formatQuotePrice,
  microsToQuantity,
  parseQuantityToMicros,
  parseStockStamp,
  priceAgeHours,
  quantityProblem,
  quantityToMicros,
  relativeQuoteAge,
} from "@/lib/assetUtils";

afterEach(() => {
  vi.useRealTimers();
});

describe("quantity scaling", () => {
  it("round-trips a fractional share count through micros", () => {
    for (const quantity of [1, 2.5, 0.000001, 123.456789, 1_000_000]) {
      expect(microsToQuantity(quantityToMicros(quantity))).toBeCloseTo(quantity, 6);
    }
  });

  it("accepts a comma decimal separator, which the FR UI asks for", () => {
    expect(parseQuantityToMicros("2,5")).toBe(2_500_000);
    expect(parseQuantityToMicros("2.5")).toBe(2_500_000);
    expect(parseQuantityToMicros(" 2,5 ")).toBe(2_500_000);
    // The trap this exists for: Number("2,5") is NaN.
    expect(Number("2,5")).toBeNaN();
  });

  it("rejects input that is not a share count", () => {
    expect(parseQuantityToMicros("")).toBeNull();
    expect(parseQuantityToMicros("   ")).toBeNull();
    expect(parseQuantityToMicros("abc")).toBeNull();
    expect(parseQuantityToMicros("Infinity")).toBeNull();
  });

  it("rounds to whole micros rather than truncating", () => {
    expect(parseQuantityToMicros("0.0000005")).toBe(1);
    expect(parseQuantityToMicros("0.0000004")).toBe(0);
  });

  it("validates the post-scaling value, not the typed string", () => {
    expect(quantityProblem("2,5")).toBeNull();
    expect(quantityProblem("1")).toBeNull();
    expect(quantityProblem("")).toBe("empty");
    expect(quantityProblem("0")).toBe("empty");
    expect(quantityProblem("-3")).toBe("empty");
    // Scales to a positive number of shares but rounds to zero micros, which the backend refuses.
    expect(quantityProblem("0.0000001")).toBe("empty");
    expect(quantityProblem(String(MAX_QUANTITY_MICROS / 1_000_000))).toBeNull();
    expect(quantityProblem(String(MAX_QUANTITY_MICROS / 1_000_000 + 1))).toBe(
      "too_large"
    );
  });

  it("formats a share count at the column's full precision without padding", () => {
    expect(formatQuantity(2_500_000, "en-US")).toBe("2.5");
    expect(formatQuantity(1_000_000, "en-US")).toBe("1");
    expect(formatQuantity(1, "en-US")).toBe("0.000001");
  });
});

describe("parseStockStamp", () => {
  it("reads a zone-less SQLite stamp as UTC, not as local time", () => {
    const parsed = parseStockStamp("2026-10-27 12:00:00");

    expect(parsed?.toISOString()).toBe("2026-10-27T12:00:00.000Z");
  });

  it("passes an already-zoned RFC 3339 stamp through unchanged", () => {
    expect(parseStockStamp("2026-10-27T12:00:00Z")?.toISOString()).toBe(
      "2026-10-27T12:00:00.000Z"
    );
    expect(parseStockStamp("2026-10-27T08:00:00-04:00")?.toISOString()).toBe(
      "2026-10-27T12:00:00.000Z"
    );
  });

  it("returns null for anything that is not a stamp", () => {
    expect(parseStockStamp("not a timestamp")).toBeNull();
    expect(parseStockStamp("")).toBeNull();
  });
});

describe("priceAgeHours", () => {
  it("measures a zone-less UTC stamp against now without a timezone shift", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T12:30:00Z"));

    // Would come out as hours off if the stamp were read as local time.
    expect(priceAgeHours("2026-10-27 12:00:00")).toBeCloseTo(0.5, 6);
  });

  it("never reports a negative age for a stamp in the future", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));

    expect(priceAgeHours("2026-10-27 18:00:00")).toBe(0);
  });

  it("is null when there is no stamp at all", () => {
    expect(priceAgeHours(null)).toBeNull();
    expect(priceAgeHours("nonsense")).toBeNull();
  });

  it("crosses the stale threshold exactly at 24 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));

    expect(priceAgeHours("2026-10-27 12:00:00")).toBe(STOCK_STALE_AFTER_HOURS);
    expect(priceAgeHours("2026-10-27 12:00:01")).toBeLessThan(
      STOCK_STALE_AFTER_HOURS
    );
  });
});

describe("relativeQuoteAge", () => {
  it("picks minutes, hours or days from the magnitude", () => {
    expect(relativeQuoteAge(0.1, "en-US")).toBe("6 minutes ago");
    // `numeric: "auto"` is what turns a zero offset into prose instead of "in 0 minutes".
    expect(relativeQuoteAge(0, "en-US")).toBe("this minute");
    expect(relativeQuoteAge(3, "en-US")).toBe("3 hours ago");
    expect(relativeQuoteAge(47, "en-US")).toBe("47 hours ago");
    expect(relativeQuoteAge(48, "en-US")).toBe("2 days ago");
    expect(relativeQuoteAge(72, "en-US")).toBe("3 days ago");
  });
});

describe("formatQuotePrice", () => {
  it("formats in the holding's own currency, not the locale default", () => {
    expect(formatQuotePrice(20_000, "USD", "en-US")).toBe("$200.00");
    expect(formatQuotePrice(20_000, "CAD", "en-US")).toBe("CA$200.00");
    expect(formatQuotePrice(7_250, "GBP", "en-US")).toBe("£72.50");
  });

  it("falls back to a plain number when the currency is unknown or absent", () => {
    expect(formatQuotePrice(20_000, null, "en-US")).toBe("200.00");
    expect(formatQuotePrice(20_000, "NOTACURRENCY", "en-US")).toBe(
      "200.00 NOTACURRENCY"
    );
  });
});

describe("the shared asset type list", () => {
  it("offers exactly the ordered types, stock included, with one i18n key each", () => {
    expect(ASSET_TYPE_VALUES.map((option) => option.value)).toEqual([
      ...ASSET_TYPE_ORDER,
    ]);
    expect(ASSET_TYPE_VALUES.map((option) => option.value)).toContain("stock");
    for (const option of ASSET_TYPE_VALUES) {
      expect(option.key).toMatch(/^assets\./);
    }
  });
});
