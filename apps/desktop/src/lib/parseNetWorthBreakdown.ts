import type { NetWorthBreakdownCategory } from "@/lib/types";

interface BreakdownJson {
  cash_cents: number;
  crypto_cents: number;
  housing_cents: number;
  tfsa_cents: number;
  rrsp_cents: number;
  fhsa_cents: number;
  non_registered_cents: number;
  business_cents: number;
  vehicles_cents: number;
  other_cents: number;
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  cash_cents: { label: "Cash", color: "#0D9488" },
  tfsa_cents: { label: "TFSA", color: "#0EA5E9" },
  rrsp_cents: { label: "RRSP", color: "#9333EA" },
  fhsa_cents: { label: "FHSA", color: "#7C3AED" },
  non_registered_cents: { label: "Non-registered", color: "#6366F1" },
  crypto_cents: { label: "Crypto", color: "#F59E0B" },
  housing_cents: { label: "Housing", color: "#059669" },
  business_cents: { label: "Business", color: "#EC4899" },
  vehicles_cents: { label: "Vehicles", color: "#F97316" },
  other_cents: { label: "Other", color: "#64748B" },
};

export function parseNetWorthBreakdown(
  breakdownJson: string
): NetWorthBreakdownCategory[] {
  const data: BreakdownJson = JSON.parse(breakdownJson);

  const total = Object.values(data).reduce((sum, val) => sum + val, 0);
  if (total === 0) return [];

  const categories: NetWorthBreakdownCategory[] = [];

  for (const [key, cents] of Object.entries(data)) {
    if (cents === 0) continue;
    const config = CATEGORY_CONFIG[key];
    if (!config) continue;

    categories.push({
      name: config.label,
      cents,
      percentage: (cents / total) * 100,
      color: config.color,
    });
  }

  categories.sort((a, b) => b.cents - a.cents);
  return categories;
}
