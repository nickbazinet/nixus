import type { RetirementInput } from "@/lib/types";

/**
 * Avg CPP new-beneficiary retirement pension at 65 ($877.01/mo, Apr 2026) +
 * max OAS pension age 65-74 ($751.97/mo, Jul-Sep 2026), per Canada.ca. Hardcoded
 * reference default, not a live fetch — mirrors `tfsa/constants.rs`'s
 * known-as-of-date pattern. Update this constant (and the comment) when
 * Government of Canada publishes new rate tables.
 */
export const CA_DEFAULT_PENSION_ANNUAL_CENTS = 1_954_800; // known as of Q3 2026

const RETIREMENT_ELIGIBLE_TYPES = [
  "tfsa",
  "rrsp",
  "fhsa",
  "non_registered",
  "crypto",
] as const;

/** Same 7% annual rate used for these account types in `src/lib/projection.ts`. */
const GROWTH_RATE_ANNUAL = 0.07;
const SPENDING_RATIO_IN_RETIREMENT = 0.8;
const INFLATION_RATE_ANNUAL = 0.025;

/**
 * Planning assumption for how long retirement must be funded. The traditional "25x"/4% rule
 * assumes a fixed ~30-year retirement (e.g. retire at 65, plan to 95) — applying it flat to every
 * retirement age is wrong: retiring earlier means the portfolio must fund more years of
 * withdrawals, so it needs a bigger multiplier, not the same one. This models that duration
 * explicitly as a present-value-of-annuity factor instead of a flat constant.
 */
const TARGET_END_AGE = 90;
const ANCHOR_DURATION_YEARS = 30; // the duration at which the multiplier must equal 25 (today's rule)
const ANCHOR_MULTIPLIER = 25; // inverse of the 4% safe withdrawal rate

/** PV-of-ordinary-annuity factor: cents needed today per $1/yr of withdrawals for `years`, at rate `r`. */
function annuityFactor(r: number, years: number): number {
  if (years <= 0) return 0;
  if (r === 0) return years;
  return (1 - Math.pow(1 + r, -years)) / r;
}

/**
 * Solve for the real drawdown-phase rate `r` such that a 30-year retirement still reproduces the
 * traditional 25x multiplier — bisection because `annuityFactor` has no closed-form inverse in `r`.
 * Computed once at module load; deterministic (fixed inputs, fixed iteration count).
 */
function solveDrawdownRate(): number {
  let lo = 0.0001;
  let hi = 0.2;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    // annuityFactor(r, n) decreases as r increases, so narrow toward ANCHOR_MULTIPLIER accordingly.
    if (annuityFactor(mid, ANCHOR_DURATION_YEARS) > ANCHOR_MULTIPLIER) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

const DRAWDOWN_REAL_RATE = solveDrawdownRate();

export function nestEggMultiplier(retirementAge: number): number {
  const duration = Math.max(1, TARGET_END_AGE - retirementAge);
  return annuityFactor(DRAWDOWN_REAL_RATE, duration);
}

export const SAVINGS_TIER_MULTIPLIERS = [0.5, 1, 1.5, 2, 2.5, 3] as const;
export const RETIREMENT_HORIZONS_YEARS = [5, 10, 15, 20, 25, 30] as const;
/** Index of the tier representing "your current pace" (multiplier === 1). */
export const CURRENT_PACE_TIER_INDEX = 1;

export type RetirementCellStatus = "achieved" | "close" | "shortfall";

export interface RetirementCell {
  years: number;
  monthlySavingsCents: number;
  projectedValueCents: number;
  nestEggRequiredCents: number;
  gapCents: number;
  status: RetirementCellStatus;
}

export interface RetirementMatrixResult {
  tiersMonthlyCents: number[];
  rows: RetirementCell[][];
  /** Nest egg required per horizon column — independent of savings tier, shown once per column. */
  columnNestEggCents: number[];
  /** Year label of the earliest `achieved` column on the current-pace row, or null if none. */
  earliestAchievedYears: number | null;
}

function roundToNearest(cents: number, stepCents: number): number {
  return Math.round(cents / stepCents) * stepCents;
}

function computeTiersMonthlyCents(avgMonthlySurplusCents: number): number[] {
  const floorCents = 100_00; // $100
  const baseCents = Math.max(
    roundToNearest(avgMonthlySurplusCents, 50_00),
    floorCents,
  );
  return SAVINGS_TIER_MULTIPLIERS.map((m) =>
    roundToNearest(baseCents * m, 50_00),
  );
}

function currentInvestedCapitalCents(input: RetirementInput): number {
  return input.account_balances
    .filter((b) =>
      (RETIREMENT_ELIGIBLE_TYPES as readonly string[]).includes(
        b.account_type,
      ),
    )
    .reduce((sum, b) => sum + b.total_cents, 0);
}

function nestEggRequiredCents(
  annualExpensesCents: number,
  years: number,
  pensionAnnualCents: number,
  currentAge: number,
): number {
  const futureAnnualSpend =
    annualExpensesCents *
    SPENDING_RATIO_IN_RETIREMENT *
    Math.pow(1 + INFLATION_RATE_ANNUAL, years);
  const gapAfterPension = Math.max(0, futureAnnualSpend - pensionAnnualCents);
  return gapAfterPension * nestEggMultiplier(currentAge + years);
}

/** Future value of current capital + an ordinary monthly annuity, both at the shared growth rate. */
function projectedValueCents(
  currentCapitalCents: number,
  monthlySavingsCents: number,
  years: number,
): number {
  const monthlyRate = Math.pow(1 + GROWTH_RATE_ANNUAL, 1 / 12) - 1;
  const months = years * 12;

  const capitalFv = currentCapitalCents * Math.pow(1 + monthlyRate, months);

  const annuityFv =
    monthlyRate === 0
      ? monthlySavingsCents * months
      : monthlySavingsCents *
        ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);

  return capitalFv + annuityFv;
}

function cellStatus(
  gapCents: number,
  nestEggCents: number,
): RetirementCellStatus {
  if (gapCents >= 0) return "achieved";
  if (nestEggCents > 0 && gapCents >= -0.1 * nestEggCents) return "close";
  return "shortfall";
}

export function computeRetirementMatrix(
  input: RetirementInput,
  pensionAnnualCents: number,
  currentAge: number,
): RetirementMatrixResult {
  const annualExpensesCents = input.avg_monthly_expense_cents * 12;
  const currentCapitalCents = currentInvestedCapitalCents(input);
  const tiersMonthlyCents = computeTiersMonthlyCents(
    input.avg_monthly_income_cents - input.avg_monthly_expense_cents,
  );

  const rows = tiersMonthlyCents.map((monthlySavingsCents) =>
    RETIREMENT_HORIZONS_YEARS.map((years): RetirementCell => {
      const nestEggCents = nestEggRequiredCents(
        annualExpensesCents,
        years,
        pensionAnnualCents,
        currentAge,
      );
      const projectedCents = projectedValueCents(
        currentCapitalCents,
        monthlySavingsCents,
        years,
      );
      const gapCents = projectedCents - nestEggCents;
      return {
        years,
        monthlySavingsCents,
        projectedValueCents: Math.round(projectedCents),
        nestEggRequiredCents: Math.round(nestEggCents),
        gapCents: Math.round(gapCents),
        status: cellStatus(gapCents, nestEggCents),
      };
    }),
  );

  const currentPaceRow = rows[CURRENT_PACE_TIER_INDEX];
  const earliestAchieved = currentPaceRow?.find(
    (cell) => cell.status === "achieved",
  );

  const columnNestEggCents = RETIREMENT_HORIZONS_YEARS.map((years) =>
    Math.round(
      nestEggRequiredCents(annualExpensesCents, years, pensionAnnualCents, currentAge),
    ),
  );

  return {
    tiersMonthlyCents,
    rows,
    columnNestEggCents,
    earliestAchievedYears: earliestAchieved?.years ?? null,
  };
}
