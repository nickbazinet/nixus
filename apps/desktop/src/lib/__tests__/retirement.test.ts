import { describe, it, expect } from "vitest";
import {
  computeRetirementMatrix,
  nestEggMultiplier,
  CURRENT_PACE_TIER_INDEX,
  RETIREMENT_HORIZONS_YEARS,
} from "../retirement";
import type { RetirementInput } from "@/lib/types";

const AGE = 40;

function makeInput(overrides: Partial<RetirementInput> = {}): RetirementInput {
  return {
    account_balances: [],
    avg_monthly_income_cents: 500_000,
    avg_monthly_expense_cents: 300_000,
    income_month_count: 12,
    expense_month_count: 12,
    ...overrides,
  };
}

describe("nestEggMultiplier", () => {
  it("reproduces the traditional 25x multiplier at the calibration anchor (30-year retirement)", () => {
    // Anchored so retiring at 60 with a target end age of 90 (30-year duration) still lands
    // on today's familiar 25x figure — this is the calibration constraint, not a coincidence.
    expect(nestEggMultiplier(60)).toBeCloseTo(25, 0);
  });

  it("requires a bigger multiplier for an earlier retirement age (longer money must last)", () => {
    expect(nestEggMultiplier(45)).toBeGreaterThan(nestEggMultiplier(65));
    expect(nestEggMultiplier(65)).toBeGreaterThan(nestEggMultiplier(85));
  });
});

describe("computeRetirementMatrix", () => {
  it("produces a 6x6 grid across tiers and horizons", () => {
    const result = computeRetirementMatrix(makeInput(), 0, AGE);
    expect(result.rows).toHaveLength(6);
    for (const row of result.rows) {
      expect(row).toHaveLength(RETIREMENT_HORIZONS_YEARS.length);
    }
  });

  it("floors the tier base at $100/mo when surplus is zero or negative", () => {
    const result = computeRetirementMatrix(
      makeInput({ avg_monthly_income_cents: 100_000, avg_monthly_expense_cents: 300_000 }),
      0,
      AGE,
    );
    // base = $100 -> tier multiplier 0.5 rounds to $50
    expect(result.tiersMonthlyCents[0]).toBe(5_000);
    expect(result.tiersMonthlyCents[CURRENT_PACE_TIER_INDEX]).toBe(10_000);
  });

  it("computes current invested capital only from retirement-eligible account types", () => {
    const input = makeInput({
      account_balances: [
        { account_type: "tfsa", total_cents: 1_000_000 },
        { account_type: "real_estate", total_cents: 50_000_000 },
        { account_type: "chequing", total_cents: 500_000 },
      ],
    });
    const withRealEstate = computeRetirementMatrix(input, 0, AGE);
    const withoutRealEstate = computeRetirementMatrix(
      makeInput({ account_balances: [{ account_type: "tfsa", total_cents: 1_000_000 }] }),
      0,
      AGE,
    );
    // Real estate and chequing balances must not change the projected value.
    expect(withRealEstate.rows[0][0].projectedValueCents).toBe(
      withoutRealEstate.rows[0][0].projectedValueCents,
    );
  });

  it("requires a bigger nest egg for a younger current age at the same horizon (retiring earlier)", () => {
    const input = makeInput();
    const youngerToday = computeRetirementMatrix(input, 0, 30); // retires at 40 for the 10yr column
    const olderToday = computeRetirementMatrix(input, 0, 75); // retires at 85 for the 10yr column

    const cellIndex = RETIREMENT_HORIZONS_YEARS.indexOf(10);
    expect(youngerToday.columnNestEggCents[cellIndex]).toBeGreaterThan(
      olderToday.columnNestEggCents[cellIndex],
    );
  });

  it("reduces the nest egg requirement (and can flip a cell to achieved) when pension increases", () => {
    const input = makeInput();
    const noPension = computeRetirementMatrix(input, 0, AGE);
    const withPension = computeRetirementMatrix(input, 10_000_000, AGE);

    const cellIndex = RETIREMENT_HORIZONS_YEARS.length - 1;
    expect(
      withPension.rows[CURRENT_PACE_TIER_INDEX][cellIndex].nestEggRequiredCents,
    ).toBeLessThan(
      noPension.rows[CURRENT_PACE_TIER_INDEX][cellIndex].nestEggRequiredCents,
    );
  });

  it("classifies a cell as achieved when projected value meets or exceeds the nest egg", () => {
    const input = makeInput({
      account_balances: [{ account_type: "tfsa", total_cents: 500_000_000_00 }],
      avg_monthly_expense_cents: 100_000,
    });
    const result = computeRetirementMatrix(input, 0, AGE);
    expect(result.rows[CURRENT_PACE_TIER_INDEX][0].status).toBe("achieved");
    expect(result.earliestAchievedYears).toBe(RETIREMENT_HORIZONS_YEARS[0]);
  });

  it("classifies a cell as shortfall with no capital and no pension for a low-savings scenario", () => {
    const input = makeInput({
      avg_monthly_income_cents: 300_000,
      avg_monthly_expense_cents: 295_000,
    });
    const result = computeRetirementMatrix(input, 0, AGE);
    expect(result.rows[0][0].status).not.toBe("achieved");
  });

  it("returns null earliestAchievedYears when the current-pace row never achieves", () => {
    const input = makeInput({
      avg_monthly_income_cents: 300_000,
      avg_monthly_expense_cents: 295_000,
    });
    const result = computeRetirementMatrix(input, 0, AGE);
    expect(result.earliestAchievedYears).toBeNull();
  });

  it("computes columnNestEggCents once per column, shared identically across every tier row", () => {
    const result = computeRetirementMatrix(makeInput(), 0, AGE);
    expect(result.columnNestEggCents).toHaveLength(RETIREMENT_HORIZONS_YEARS.length);
    expect(result.columnNestEggCents.every((c) => c > 0)).toBe(true);
    // Nest egg required is no longer guaranteed to strictly increase with years-from-now: inflation
    // (grows with years) now competes with the shrinking retirement-duration multiplier (shrinks as
    // retirement age approaches TARGET_END_AGE) — that competition is the fix, not a regression.
    // Every row must reference the same per-column nest egg — it does not vary by tier.
    for (const row of result.rows) {
      row.forEach((cell, i) => {
        expect(cell.nestEggRequiredCents).toBe(result.columnNestEggCents[i]);
      });
    }
  });

  it("zeroes annual expenses (and the nest egg) when there is no expense history", () => {
    const result = computeRetirementMatrix(
      makeInput({ avg_monthly_expense_cents: 0, expense_month_count: 0 }),
      0,
      AGE,
    );
    expect(result.columnNestEggCents.every((c) => c === 0)).toBe(true);
    expect(result.rows).toHaveLength(6);
  });

  it("classifies a cell as close when the gap is within 10% of the nest egg required", () => {
    // Zero surplus (income == expense) floors savings at $100/mo, keeping the pension=0 cell deep
    // in shortfall so the bisection below has room to find the shortfall -> close -> achieved edge.
    // Uses the nearest horizon (retirement age 45, duration 45yr) where the multiplier is largest.
    const input = makeInput({ avg_monthly_income_cents: 500_000, avg_monthly_expense_cents: 500_000 });
    const cellIndex = 0;
    const noPensionNestEgg = computeRetirementMatrix(input, 0, AGE).columnNestEggCents[cellIndex];
    expect(
      computeRetirementMatrix(input, 0, AGE).rows[CURRENT_PACE_TIER_INDEX][cellIndex].status,
    ).toBe("shortfall");

    // gapCents is monotonically non-decreasing in pension for this cell (nestEgg shrinks linearly
    // as pension rises, projected value is pension-independent), so bisecting for the smallest
    // pension where status leaves "shortfall" reliably lands on the boundary — which must be
    // "close" (not "achieved") by definition of the ±10% band having nonzero width.
    let lo = 0;
    let hi = noPensionNestEgg;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const status = computeRetirementMatrix(input, mid, AGE).rows[CURRENT_PACE_TIER_INDEX][
        cellIndex
      ].status;
      if (status === "shortfall") {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    expect(
      computeRetirementMatrix(input, hi, AGE).rows[CURRENT_PACE_TIER_INDEX][cellIndex].status,
    ).toBe("close");
  });
});
