import type { RetirementInput } from "@/lib/types";
import {
  CA_RETIREMENT_TAX_BANDS,
  effectiveRateFor,
  grossUpCents,
  indexBandsForYears,
} from "@/lib/retirement-tax";

/**
 * Avg CPP new-beneficiary retirement pension at 65 ($877.01/mo, Apr 2026) +
 * max OAS pension age 65-74 ($751.97/mo, Jul-Sep 2026), per Canada.ca. Hardcoded
 * reference default, not a live fetch — mirrors `tfsa/constants.rs`'s
 * known-as-of-date pattern. Update this constant (and the comment) when
 * Government of Canada publishes new rate tables.
 */
export const CA_DEFAULT_PENSION_ANNUAL_CENTS = 1_954_800; // known as of Q3 2026

/**
 * Age at which the combined CPP + OAS figure above becomes payable. CPP's standard age is 65
 * (earliest 60, reduced) and OAS has no option before 65, and the default constant is itself the
 * "OAS age 65-74" amount — so counting it before 65 overstates reality. Only applied when the
 * profile's country is Canada; no other country's eligibility rules are modeled.
 */
export const GOVERNMENT_PENSION_MIN_AGE_CA = 65;

/**
 * Start-age default when the config key has never been set. Most workplace plans key their
 * unreduced payout to the same age statutory pensions use.
 */
export const DEFAULT_EMPLOYER_PENSION_START_AGE = 65;

/** Tax-rate default when no override is saved and no auto curve applies — 0 reproduces the pre-tax (gross) baseline exactly. */
export const DEFAULT_PENSION_TAX_RATE_PERCENT = 0;

/**
 * How retirement income gets taxed.
 *
 * `manual` is the user's own flat estimate, applied to pension income only — the model this page
 * shipped with, and still what a saved override means. `auto` hands the question to
 * `CA_RETIREMENT_TAX_BANDS` instead: nothing is withheld from the pension, and the *total* income a
 * column must produce is grossed up through the band table.
 *
 * A saved manual rate always wins over `auto`, so nobody's own number is ever silently replaced.
 */
export type RetirementTaxModel =
  | { kind: "auto" }
  | { kind: "manual"; ratePercent: number };

/** The two independently-tracked pension estimates, plus when each becomes payable and how it is taxed. */
export interface RetirementPensionInputs {
  governmentPensionAnnualCents: number;
  employerPensionAnnualCents: number;
  gateGovernmentPensionByAge: boolean;
  employerPensionStartAge: number;
  taxModel: RetirementTaxModel;
}

/**
 * GROSS pension income payable at the retirement age represented by a given horizon column. Each
 * pension is withheld entirely for columns landing before its own start age; whatever survives is
 * returned pre-tax, because which tax treatment applies is the tax model's business, not this
 * function's — see `pensionCountedForYearsCents`.
 */
export function pensionForYearsCents(
  pension: RetirementPensionInputs,
  currentAge: number,
  years: number,
): number {
  const ageAtRetirement = currentAge + years;
  const governmentEligible =
    !pension.gateGovernmentPensionByAge ||
    ageAtRetirement >= GOVERNMENT_PENSION_MIN_AGE_CA;
  const employerEligible = ageAtRetirement >= pension.employerPensionStartAge;

  return (
    (employerEligible ? pension.employerPensionAnnualCents : 0) +
    (governmentEligible ? pension.governmentPensionAnnualCents : 0)
  );
}

/**
 * The pension figure the gap calculation subtracts from the income a column has to produce.
 *
 * `manual` withholds its flat rate here, exactly as `pensionForYearsCents` itself did before the auto
 * model existed — so a saved rate keeps behaving identically, and 0% still reproduces the gross
 * baseline. `auto` withholds nothing here on purpose: its gross-up already taxes total retirement
 * income, pension included, so taxing the pension again here would tax it twice.
 */
export function pensionCountedForYearsCents(
  pension: RetirementPensionInputs,
  currentAge: number,
  years: number,
): number {
  const grossCents = pensionForYearsCents(pension, currentAge, years);
  if (pension.taxModel.kind === "auto") return grossCents;

  return Math.round(grossCents * (1 - pension.taxModel.ratePercent / 100));
}

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
export const INFLATION_RATE_ANNUAL = 0.025;

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
/**
 * Granularity of the tier ladder, and therefore of any explicit anchor override. Exported so the
 * anchor slider's `step` cannot drift from the rounding the ladder applies — a slider moving in $10
 * increments while the ladder snaps to $50 shows a readout the grid disagrees with.
 */
export const ANCHOR_STEP_CENTS = 50_00; // $50
/** Floor for the *derived* anchor only. An explicit override is the user's word and bypasses it. */
const ANCHOR_FLOOR_CENTS = 100_00; // $100

export type RetirementCellStatus = "achieved" | "close" | "shortfall";

/**
 * A nominal (future) figure restated in today's purchasing power, undoing the same inflation the
 * nest-egg formula compounded in. Presentation only — status is still decided on the nominal
 * figures, so nothing here can move a colour.
 */
export function deflateToTodayCents(
  nominalCents: number,
  years: number,
): number {
  return Math.round(nominalCents / Math.pow(1 + INFLATION_RATE_ANNUAL, years));
}

export interface RetirementCell {
  years: number;
  monthlySavingsCents: number;
  projectedValueCents: number;
  /** `projectedValueCents` in today's purchasing power. Display only — never an input to `status`. */
  projectedValueTodayCents: number;
  nestEggRequiredCents: number;
  gapCents: number;
  status: RetirementCellStatus;
}

export interface RetirementMatrixResult {
  tiersMonthlyCents: number[];
  rows: RetirementCell[][];
  /** Nest egg required per horizon column — independent of savings tier, shown once per column. */
  columnNestEggCents: number[];
  /**
   * `columnNestEggCents` in today's purchasing power — what the grid actually shows. Deflating is
   * what makes the column order match the legend's claim: retiring earlier needs more money, so the
   * earlier column must read higher.
   */
  columnNestEggTodayCents: number[];
  /** Year label of the earliest `achieved` column on the current-pace row, or null if none. */
  earliestAchievedYears: number | null;
}

/**
 * Ephemeral "what if" overrides for the grid. Both are optional and neither is persisted: omitting
 * the bag entirely reproduces the derived-only matrix exactly.
 */
export interface RetirementMatrixOptions {
  /**
   * Explicit tier-ladder anchor, replacing the derived surplus AND bypassing its $100 floor. The
   * floor exists to keep a derived ladder legible when surplus is zero or negative; a user who
   * drags to $0 has said $0, and silently answering a different question than the one asked is
   * worse than a row of zeroes.
   */
  anchorMonthlyCents?: number;
  /** Horizon columns as years-from-now. Defaults to `RETIREMENT_HORIZONS_YEARS`. */
  horizons?: readonly number[];
}

export const HORIZON_ZOOMS = ["6y", "12y", "30y"] as const;
export type HorizonZoom = (typeof HORIZON_ZOOMS)[number];
/** The zoom whose columns equal `RETIREMENT_HORIZONS_YEARS`, so it is what the page opens on. */
export const DEFAULT_HORIZON_ZOOM: HorizonZoom = "30y";

const HORIZON_ZOOM_STEP_YEARS: Record<HorizonZoom, number> = {
  "6y": 1,
  "12y": 2,
  "30y": 5,
};

/**
 * Column layout for a zoom: always six columns, only the year step changes. Keeping the count fixed
 * is what makes zooming feel like zooming — the grid's shape never moves, just its scale.
 */
export function horizonsForZoom(zoom: HorizonZoom): readonly number[] {
  const stepYears = HORIZON_ZOOM_STEP_YEARS[zoom];
  return Array.from(
    { length: RETIREMENT_HORIZONS_YEARS.length },
    (_, index) => stepYears * (index + 1),
  );
}

function roundToNearest(cents: number, stepCents: number): number {
  return Math.round(cents / stepCents) * stepCents;
}

function anchorMonthlyCents(
  avgMonthlySurplusCents: number,
  explicitAnchorCents: number | undefined,
): number {
  if (explicitAnchorCents !== undefined) {
    return roundToNearest(explicitAnchorCents, ANCHOR_STEP_CENTS);
  }
  return Math.max(
    roundToNearest(avgMonthlySurplusCents, ANCHOR_STEP_CENTS),
    ANCHOR_FLOOR_CENTS,
  );
}

/**
 * The anchor the matrix derives with no override — the slider's initial value, its reset target, and
 * the reference the "exploring" state is measured against. Exported so those three all read the same
 * number the grid does instead of each re-deriving it.
 */
export function derivedAnchorMonthlyCents(input: RetirementInput): number {
  return anchorMonthlyCents(
    input.avg_monthly_income_cents - input.avg_monthly_expense_cents,
    undefined,
  );
}

function computeTiersMonthlyCents(
  avgMonthlySurplusCents: number,
  explicitAnchorCents?: number,
): number[] {
  const baseCents = anchorMonthlyCents(
    avgMonthlySurplusCents,
    explicitAnchorCents,
  );
  return SAVINGS_TIER_MULTIPLIERS.map((m) =>
    roundToNearest(baseCents * m, ANCHOR_STEP_CENTS),
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
  pension: RetirementPensionInputs,
  currentAge: number,
): number {
  const futureAnnualSpend =
    annualExpensesCents *
    SPENDING_RATIO_IN_RETIREMENT *
    Math.pow(1 + INFLATION_RATE_ANNUAL, years);
  const pensionAnnualCents = pensionCountedForYearsCents(
    pension,
    currentAge,
    years,
  );
  // `auto` asks the harder question: not "what does this spend cost in tax" but "what gross income
  // nets this spend" — which is the same number a retiree actually has to withdraw. `manual` keeps
  // targeting the spend itself, since its rate was already withheld from the pension above.
  const grossIncomeNeededCents =
    pension.taxModel.kind === "auto"
      ? grossUpCents(
          futureAnnualSpend,
          indexBandsForYears(
            CA_RETIREMENT_TAX_BANDS,
            years,
            INFLATION_RATE_ANNUAL,
          ),
        )
      : futureAnnualSpend;
  const gapAfterPension = Math.max(
    0,
    grossIncomeNeededCents - pensionAnnualCents,
  );
  return gapAfterPension * nestEggMultiplier(currentAge + years);
}

/**
 * The blended rate the auto model is applying today, for display only — the matrix never reads it.
 * Pinned to `years = 0` (un-inflated spend against un-inflated thresholds) because a rate quoted in
 * 30-year-out dollars would be the same number anyway and a needlessly confusing thing to show.
 */
export function autoEstimatedTaxRatePercent(annualExpensesCents: number): number {
  const annualSpendCents = annualExpensesCents * SPENDING_RATIO_IN_RETIREMENT;
  return effectiveRateFor(
    grossUpCents(annualSpendCents, CA_RETIREMENT_TAX_BANDS),
    CA_RETIREMENT_TAX_BANDS,
  );
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
  pension: RetirementPensionInputs,
  currentAge: number,
  options?: RetirementMatrixOptions,
): RetirementMatrixResult {
  const annualExpensesCents = input.avg_monthly_expense_cents * 12;
  const currentCapitalCents = currentInvestedCapitalCents(input);
  const horizons = options?.horizons ?? RETIREMENT_HORIZONS_YEARS;
  const tiersMonthlyCents = computeTiersMonthlyCents(
    input.avg_monthly_income_cents - input.avg_monthly_expense_cents,
    options?.anchorMonthlyCents,
  );

  const rows = tiersMonthlyCents.map((monthlySavingsCents) =>
    horizons.map((years): RetirementCell => {
      const nestEggCents = nestEggRequiredCents(
        annualExpensesCents,
        years,
        pension,
        currentAge,
      );
      const projectedCents = projectedValueCents(
        currentCapitalCents,
        monthlySavingsCents,
        years,
      );
      const gapCents = projectedCents - nestEggCents;
      const projectedRoundedCents = Math.round(projectedCents);
      return {
        years,
        monthlySavingsCents,
        projectedValueCents: projectedRoundedCents,
        projectedValueTodayCents: deflateToTodayCents(
          projectedRoundedCents,
          years,
        ),
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

  const columnNestEggCents = horizons.map((years) =>
    Math.round(
      nestEggRequiredCents(annualExpensesCents, years, pension, currentAge),
    ),
  );

  return {
    tiersMonthlyCents,
    rows,
    columnNestEggCents,
    columnNestEggTodayCents: columnNestEggCents.map((cents, index) =>
      deflateToTodayCents(cents, horizons[index]),
    ),
    earliestAchievedYears: earliestAchieved?.years ?? null,
  };
}
