import type { ProjectionInput } from "@/lib/types";

export interface ProjectionPoint {
  month: number;
  label: string;
  total_cents: number;
  /** Wealth growth from returns on today's balances only (no new savings). */
  investment_gain_cents: number;
  breakdown: Record<string, number>;
}

export const INCOME_GROWTH_RATE = 0.03; // 3% annual wage growth
export const EXPENSE_GROWTH_RATE = 0.02; // 2% annual inflation

const ANNUAL_RATES: Record<string, number> = {
  tfsa: 0.07,
  rrsp: 0.07,
  fhsa: 0.07,
  non_registered: 0.07,
  crypto: 0.07,
  real_estate: 0.039,
  vehicle: -0.15,
  chequing: 0,
  savings: 0,
  credit_card: 0,
  business: 0,
  other: 0,
};

function getMonthlyRate(type: string): number {
  const annual = ANNUAL_RATES[type] ?? 0;
  if (annual === 0) return 0;
  return Math.pow(1 + annual, 1 / 12) - 1;
}

function formatLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function computeProjection(
  input: ProjectionInput,
  months: number,
): ProjectionPoint[] {
  const balances: Record<string, number> = {};

  for (const ab of input.account_balances) {
    const key = ab.account_type;
    balances[key] = (balances[key] ?? 0) + ab.total_cents;
  }

  for (const av of input.asset_values) {
    const key = av.asset_type;
    balances[key] = (balances[key] ?? 0) + av.total_cents;
  }

  const monthlyIncomeGrowth = Math.pow(1 + INCOME_GROWTH_RATE, 1 / 12) - 1;
  const monthlyExpenseGrowth = Math.pow(1 + EXPENSE_GROWTH_RATE, 1 / 12) - 1;
  let currentIncome = input.avg_monthly_income_cents;
  let currentExpenses = input.avg_monthly_expense_cents;

  // Distribute positive cash flow proportionally across growth accounts.
  // Negative cash flow (spending > income) is drawn from cash accounts.
  const growthTypes = Object.entries(balances).filter(
    ([type]) => (ANNUAL_RATES[type] ?? 0) > 0,
  );
  const growthTotal = growthTypes.reduce((s, [, v]) => s + Math.max(v, 0), 0);

  // Weights for distributing positive cash flow across growth accounts
  const growthWeights: Record<string, number> = {};
  if (growthTotal > 0) {
    for (const [type, val] of growthTypes) {
      growthWeights[type] = Math.max(val, 0) / growthTotal;
    }
  }

  // Cash bucket for negative cash flow withdrawals
  const cashBucket =
    balances["savings"] !== undefined
      ? "savings"
      : balances["chequing"] !== undefined
        ? "chequing"
        : "cash";
  if (!(cashBucket in balances)) {
    balances[cashBucket] = 0;
  }

  const passiveBalances: Record<string, number> = { ...balances };
  const startCents = Object.values(balances).reduce((s, v) => s + v, 0);

  const now = new Date();
  const points: ProjectionPoint[] = [];

  for (let m = 0; m <= months; m++) {
    if (m > 0) {
      // Grow income and expenses
      currentIncome *= 1 + monthlyIncomeGrowth;
      currentExpenses *= 1 + monthlyExpenseGrowth;
      const netCashFlow = currentIncome - currentExpenses;

      // Apply monthly growth
      for (const key of Object.keys(balances)) {
        const rate = getMonthlyRate(key);
        if (rate !== 0) {
          balances[key] *= 1 + rate;
        }
      }

      for (const key of Object.keys(passiveBalances)) {
        const rate = getMonthlyRate(key);
        if (rate !== 0) {
          passiveBalances[key] *= 1 + rate;
        }
      }

      // Distribute net cash flow
      if (netCashFlow > 0 && growthTotal > 0) {
        for (const [type, weight] of Object.entries(growthWeights)) {
          balances[type] += netCashFlow * weight;
        }
      } else {
        balances[cashBucket] += netCashFlow;
      }
    }

    const date = new Date(now.getFullYear(), now.getMonth() + m, 1);
    const totalCents = Object.values(balances).reduce((s, v) => s + v, 0);
    const passiveTotalCents = Object.values(passiveBalances).reduce(
      (s, v) => s + v,
      0,
    );

    points.push({
      month: m,
      label: formatLabel(date),
      total_cents: Math.round(totalCents),
      investment_gain_cents: Math.round(passiveTotalCents) - startCents,
      breakdown: { ...balances },
    });
  }

  return points;
}
