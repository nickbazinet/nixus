import {
  CURRENT_PACE_TIER_INDEX,
  type RetirementMatrixResult,
} from "@/lib/retirement";

/**
 * The one column of the grid the summary figures speak about: the earliest age the current pace
 * actually clears, or — when nothing in view clears — the furthest age shown, which is the deadline
 * the headline names. Everything on the surface (tiles, callout, chart title) reads this, so the
 * page can never quote one age in a figure and a different one in a sentence.
 */
export interface RetirementFocus {
  columnIndex: number;
  years: number;
  age: number;
  projectedTodayCents: number;
  nestEggTodayCents: number;
  /** Projected as a share of what is needed, rounded. Null when nothing is needed. */
  readyPercent: number | null;
  achieved: boolean;
  /** Furthest age in view — the horizon the "not on track" sentence is bounded by. */
  horizonYears: number;
  monthlySavingsCents: number;
}

export function retirementFocus(
  matrix: RetirementMatrixResult,
  currentAge: number,
): RetirementFocus | null {
  const row = matrix.rows[CURRENT_PACE_TIER_INDEX];
  if (!row || row.length === 0) return null;

  const achievedIndex = row.findIndex((cell) => cell.status === "achieved");
  const columnIndex = achievedIndex === -1 ? row.length - 1 : achievedIndex;
  const cell = row[columnIndex];
  const nestEggTodayCents =
    matrix.columnNestEggTodayCents[columnIndex] ?? cell.nestEggRequiredCents;

  return {
    columnIndex,
    years: cell.years,
    age: currentAge + cell.years,
    projectedTodayCents: cell.projectedValueTodayCents,
    nestEggTodayCents,
    readyPercent:
      nestEggTodayCents > 0
        ? Math.round((cell.projectedValueTodayCents / nestEggTodayCents) * 100)
        : null,
    achieved: achievedIndex !== -1,
    horizonYears: row[row.length - 1].years,
    monthlySavingsCents: cell.monthlySavingsCents,
  };
}

/**
 * The surface's one sentence, as an i18n key plus arguments. Lives beside the focus derivation
 * rather than inside the grid, because the sentence is now the callout's body while the grid is
 * only the evidence for it.
 */
export function retirementHeadline(
  matrix: RetirementMatrixResult,
  focus: RetirementFocus,
  isExploring: boolean,
  currentAge: number,
  formattedExpense: string,
  formattedPace: string,
): { key: string; args: Record<string, string | number> } {
  const key =
    matrix.earliestAchievedYears != null
      ? isExploring
        ? "retirement.headlineExploringWithAge"
        : "retirement.headlineAchievedWithAge"
      : isExploring
        ? "retirement.headlineExploringNotAchieved"
        : "retirement.headlineNotAchieved";

  return {
    key,
    args: {
      expense: formattedExpense,
      amount: formattedPace,
      horizon: focus.horizonYears,
      age: currentAge + (matrix.earliestAchievedYears ?? 0),
      years: matrix.earliestAchievedYears ?? 0,
    },
  };
}
