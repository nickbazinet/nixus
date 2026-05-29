import { Home, Car, Briefcase, Package } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { NetWorthBreakdownCategory, PassiveAsset } from "@/lib/types";

export const ASSET_TYPE_ORDER = [
  "real_estate",
  "vehicle",
  "business",
  "other",
] as const;

export const ASSET_TYPE_KEYS: Record<string, string> = {
  real_estate: "assets.typeRealEstate",
  vehicle: "assets.typeVehicle",
  business: "assets.typeBusiness",
  other: "assets.typeOther",
};

const ASSET_TYPE_COLORS: Record<string, string> = {
  real_estate: "#059669",
  vehicle: "#F97316",
  business: "#EC4899",
  other: "#64748B",
};

export const ASSET_TYPE_ICONS: Record<string, LucideIcon> = {
  real_estate: Home,
  vehicle: Car,
  business: Briefcase,
  other: Package,
};

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
