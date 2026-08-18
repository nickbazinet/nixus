/**
 * A single marginal band of a blended income-tax curve. Bands are ordered ascending by `fromCents`,
 * the first starts at 0, and every rate must stay strictly below 100% — a 100% band would mean no
 * gross income can ever net a positive target, which `grossUpCents` has no answer for. All three
 * invariants are pinned in `retirement-tax.test.ts` rather than re-checked at runtime.
 */
export interface RetirementTaxBand {
  /** Lower bound of the band, in cents of annual income. */
  fromCents: number;
  /** Marginal rate on income above `fromCents`. Percent (0-100), not a 0-1 fraction. */
  ratePercent: number;
}

/**
 * Blended federal + average-provincial marginal curve for a Canadian retiree, known as of 2026.
 * Hardcoded reference table, not a live fetch — same known-as-of-date pattern as
 * `CA_DEFAULT_PENSION_ANNUAL_CENTS` and `tfsa/constants.rs`. Update the numbers AND the year in
 * `retirement-tax.test.ts`'s golden-value block together, so a stale table fails by name in CI.
 *
 * Deliberately coarse, and deliberately not a province picker:
 * - Rates are federal brackets (15 / 20.5 / 26 / 29-33%) plus a rough average of the provincial
 *   curves layered on top. Any single province lands within a few points of these.
 * - The first band is generous on purpose ($22k at 0%). It informally absorbs the credits a retiree
 *   actually claims — basic personal amount, age amount, pension income amount — instead of
 *   modelling each one. Federal credits alone already cover roughly this much income.
 *
 * This is an estimate for planning, never a tax calculation: no province or territory, no OAS
 * clawback, no per-account withdrawal treatment (every dollar is treated as fully taxable).
 */
export const CA_RETIREMENT_TAX_BANDS: readonly RetirementTaxBand[] = [
  { fromCents: 0, ratePercent: 0 },
  { fromCents: 22_000_00, ratePercent: 21 },
  { fromCents: 57_000_00, ratePercent: 30 },
  { fromCents: 115_000_00, ratePercent: 38 },
  { fromCents: 178_000_00, ratePercent: 45 },
] as const;

/** Upper bound of band `index`, i.e. where the next band starts — the last band is open-ended. */
function bandCeilingCents(
  bands: readonly RetirementTaxBand[],
  index: number,
): number {
  return index + 1 < bands.length ? bands[index + 1].fromCents : Infinity;
}

/**
 * Tax owed on `grossCents` of annual income under `bands`.
 *
 * Returns unrounded cents on purpose. Rounding here would break the exact
 * `taxForCents`/`grossUpCents` inverse relationship the auto model is built on, and the matrix
 * already rounds once at the very end — the same treatment `futureAnnualSpend` gets.
 */
export function taxForCents(
  grossCents: number,
  bands: readonly RetirementTaxBand[],
): number {
  if (grossCents <= 0) return 0;

  let taxCents = 0;
  for (let index = 0; index < bands.length; index++) {
    const { fromCents, ratePercent } = bands[index];
    if (grossCents <= fromCents) break;
    const taxableInBand =
      Math.min(grossCents, bandCeilingCents(bands, index)) - fromCents;
    taxCents += taxableInBand * (ratePercent / 100);
  }

  return taxCents;
}

/**
 * The gross annual income needed to be left with `netTargetCents` after tax — the exact algebraic
 * inverse of `gross - taxForCents(gross)`, with no bisection.
 *
 * This is what resolves the circularity between withdrawals and tax: taxing a withdrawal requires
 * knowing the withdrawal, which requires knowing the tax. Asking "what gross income nets the spend I
 * want" instead of "what tax do I owe on this spend" removes the loop entirely.
 *
 * Net income rises strictly with gross (every rate is below 100%), so the band holding the answer is
 * the highest one whose own lower bound already nets at or below the target; inside that band net
 * grows at a constant `1 - rate`, which inverts directly.
 */
export function grossUpCents(
  netTargetCents: number,
  bands: readonly RetirementTaxBand[],
): number {
  if (netTargetCents <= 0) return 0;

  for (let index = bands.length - 1; index >= 0; index--) {
    const { fromCents, ratePercent } = bands[index];
    const netAtBandFloor = fromCents - taxForCents(fromCents, bands);
    if (netTargetCents < netAtBandFloor) continue;
    return (
      fromCents + (netTargetCents - netAtBandFloor) / (1 - ratePercent / 100)
    );
  }

  // Unreachable for a well-formed table: band 0 starts at 0, which nets 0, and the target is > 0.
  return 0;
}

/**
 * Blended (not marginal) rate actually paid on `grossCents`, as a percent (0-100) — the single
 * number that answers "what tax rate is this model applying to me".
 */
export function effectiveRateFor(
  grossCents: number,
  bands: readonly RetirementTaxBand[],
): number {
  if (grossCents <= 0) return 0;
  return (taxForCents(grossCents, bands) / grossCents) * 100;
}

/**
 * The same curve with every threshold inflated `years` into the future.
 *
 * Retirement spending in the matrix is already expressed in future dollars, so comparing it against
 * today's thresholds would invent decades of bracket creep and overstate the tax on an unchanged
 * standard of living. Inflating the thresholds by the same factor the spend uses keeps the estimate
 * in real terms: equal real income pays an equal effective rate at every horizon.
 *
 * The rate is passed in rather than imported so this module stays independent of the matrix's
 * assumptions — `retirement.ts` owns `INFLATION_RATE_ANNUAL` and hands it over.
 */
export function indexBandsForYears(
  bands: readonly RetirementTaxBand[],
  years: number,
  inflationRateAnnual: number,
): readonly RetirementTaxBand[] {
  if (years <= 0) return bands;
  const inflationFactor = Math.pow(1 + inflationRateAnnual, years);
  return bands.map((band) => ({
    ...band,
    fromCents: band.fromCents * inflationFactor,
  }));
}
