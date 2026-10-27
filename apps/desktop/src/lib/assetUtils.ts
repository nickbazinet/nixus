import { Home, Car, Briefcase, Package, LineChart } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { NetWorthBreakdownCategory, PassiveAsset } from "@/lib/types";
import { currencyLocale } from "@/lib/formatCurrency";

export const STOCK_ASSET_TYPE = "stock";

export const ASSET_TYPE_ORDER = [
  "real_estate",
  "vehicle",
  "business",
  "stock",
  "other",
] as const;

export const ASSET_TYPE_KEYS: Record<string, string> = {
  real_estate: "assets.typeRealEstate",
  vehicle: "assets.typeVehicle",
  business: "assets.typeBusiness",
  stock: "assets.typeStock",
  other: "assets.typeOther",
};

/**
 * The single list both asset forms render. It used to be duplicated in each of them, which is how
 * `stock` could have ended up offered on one form and not the other.
 */
export const ASSET_TYPE_VALUES = ASSET_TYPE_ORDER.map((value) => ({
  value: value as string,
  key: ASSET_TYPE_KEYS[value] as string,
}));

const ASSET_TYPE_COLORS: Record<string, string> = {
  real_estate: "#059669",
  vehicle: "#F97316",
  business: "#EC4899",
  stock: "#6366F1",
  other: "#64748B",
};

export const ASSET_TYPE_ICONS: Record<string, LucideIcon> = {
  real_estate: Home,
  vehicle: Car,
  business: Briefcase,
  stock: LineChart,
  other: Package,
};

/** The scaling factor of `quantity_micros`: 1e-6 shares. */
const QUANTITY_SCALE = 1_000_000;

/** Mirrors `db::stock::MAX_QUANTITY_MICROS`, so the form refuses what the backend would refuse. */
export const MAX_QUANTITY_MICROS = 1_000_000_000_000_000;

/** A quote a day old is already a different market, so a stock goes stale far sooner than a house. */
export const STOCK_STALE_AFTER_HOURS = 24;

const MS_PER_HOUR = 3_600_000;

/** Six decimals is the column's full precision; trailing zeroes are noise on a whole-share lot. */
export function formatQuantity(quantityMicros: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 6,
  }).format(quantityMicros / QUANTITY_SCALE);
}

/**
 * Parses a typed share count into scaled integers, or `null` when it is not a number.
 *
 * A comma decimal separator is accepted because the FR UI asks for one ("ex. : 2,5") and a French
 * keyboard's numpad produces one — `Number("2,5")` is `NaN`, which would read as "you typed
 * nothing" rather than "2.5 shares".
 */
export function parseQuantityToMicros(input: string): number | null {
  const normalized = input.trim().replace(",", ".");
  if (normalized === "") return null;

  const quantity = Number(normalized);
  if (!Number.isFinite(quantity)) return null;

  return Math.round(quantity * QUANTITY_SCALE);
}

export function quantityToMicros(quantity: number): number {
  return Math.round(quantity * QUANTITY_SCALE);
}

export function microsToQuantity(quantityMicros: number): number {
  return quantityMicros / QUANTITY_SCALE;
}

/** `null` when the scaled quantity is unusable — the form's one validation rule for the field. */
export function quantityProblem(input: string): "empty" | "too_large" | null {
  const micros = parseQuantityToMicros(input);
  if (micros === null || micros <= 0) return "empty";
  if (micros > MAX_QUANTITY_MICROS) return "too_large";
  return null;
}

/**
 * SQLite's `datetime('now')` is UTC with no zone marker, which `new Date` reads as LOCAL time — so
 * a quote minutes old would show as hours old, or hours in the future. The appended `Z` is what
 * makes "as of" honest. An already-zoned stamp is passed through untouched.
 */
export function parseStockStamp(raw: string): Date | null {
  const normalized = /[Zz]|[+-]\d{2}:?\d{2}$/.test(raw)
    ? raw
    : `${raw.replace(" ", "T")}Z`;
  const parsed = new Date(normalized);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function priceAgeHours(lastPriceAt: string | null): number | null {
  if (!lastPriceAt) return null;
  const stamp = parseStockStamp(lastPriceAt);
  if (!stamp) return null;

  return Math.max(0, (Date.now() - stamp.getTime()) / MS_PER_HOUR);
}

/**
 * A quote is minutes or hours old far more often than days, so the unit follows the magnitude —
 * "as of today" would be the only thing this ever said otherwise.
 */
export function relativeQuoteAge(hours: number, locale: string): string {
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (hours < 1) return relative.format(-Math.round(hours * 60), "minute");
  if (hours < 48) return relative.format(-Math.round(hours), "hour");
  return relative.format(-Math.round(hours / 24), "day");
}

/** Formats a quote in the currency it is quoted in, which is rarely the UI's own. */
export function formatQuotePrice(
  priceCents: number,
  currency: string | null,
  language: string
): string {
  // The regional locale, as for every other amount: under a bare "en" a USD quote renders as "$",
  // indistinguishable from the CAD totals beside it.
  const locale = currencyLocale(language);
  if (!currency) {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(priceCents / 100);
  }

  // A currency code the runtime does not know throws rather than degrading, and the provider — not
  // this app — chose the code.
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(priceCents / 100);
  } catch {
    return `${(priceCents / 100).toFixed(2)} ${currency}`;
  }
}


export function groupAssetsByType(assets: PassiveAsset[]) {
  const groups = new Map<string, PassiveAsset[]>();
  for (const asset of assets) {
    const list = groups.get(asset.asset_type) ?? [];
    list.push(asset);
    groups.set(asset.asset_type, list);
  }
  return [...groups.entries()].sort(
    (a, b) =>
      ASSET_TYPE_ORDER.indexOf(
        a[0] as (typeof ASSET_TYPE_ORDER)[number]
      ) - ASSET_TYPE_ORDER.indexOf(b[0] as (typeof ASSET_TYPE_ORDER)[number])
  );
}

export function buildAssetBreakdown(
  assets: PassiveAsset[],
  getTypeLabel: (assetType: string) => string
): NetWorthBreakdownCategory[] {
  const totals = new Map<string, number>();
  for (const asset of assets) {
    totals.set(
      asset.asset_type,
      (totals.get(asset.asset_type) ?? 0) + asset.value_cents
    );
  }

  const grandTotal = assets.reduce((sum, asset) => sum + asset.value_cents, 0);
  if (grandTotal === 0) return [];

  const categories: NetWorthBreakdownCategory[] = [];
  for (const [assetType, cents] of totals) {
    categories.push({
      name: getTypeLabel(assetType),
      cents,
      percentage: (cents / grandTotal) * 100,
      color: ASSET_TYPE_COLORS[assetType] ?? ASSET_TYPE_COLORS.other,
    });
  }

  categories.sort((a, b) => b.cents - a.cents);
  return categories;
}

export function formatAssetUpdatedAt(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
