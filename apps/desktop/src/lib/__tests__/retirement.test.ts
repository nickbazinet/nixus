import { describe, it, expect } from "vitest";
import {
  computeRetirementMatrix,
  deflateToTodayCents,
  derivedAnchorMonthlyCents,
  nestEggMultiplier,
  pensionCountedForYearsCents,
  pensionForYearsCents,
  ANCHOR_STEP_CENTS,
  CURRENT_PACE_TIER_INDEX,
  DEFAULT_EMPLOYER_PENSION_START_AGE,
  DEFAULT_PENSION_TAX_RATE_PERCENT,
  GOVERNMENT_PENSION_MIN_AGE_CA,
  INFLATION_RATE_ANNUAL,
  RETIREMENT_HORIZONS_YEARS,
  SAVINGS_TIER_MULTIPLIERS,
} from "../retirement";
import type { RetirementPensionInputs } from "../retirement";
import {
  CA_RETIREMENT_TAX_BANDS,
  grossUpCents,
  indexBandsForYears,
} from "../retirement-tax";
import type { RetirementInput } from "@/lib/types";

const AGE = 40;

// Uses the app's real unset-config defaults, so every assertion below reflects a true first load:
// no saved override outside Canada resolves to a flat manual 0%.
const NO_PENSION: RetirementPensionInputs = {
  governmentPensionAnnualCents: 0,
  employerPensionAnnualCents: 0,
  gateGovernmentPensionByAge: false,
  employerPensionStartAge: DEFAULT_EMPLOYER_PENSION_START_AGE,
  taxModel: { kind: "manual", ratePercent: DEFAULT_PENSION_TAX_RATE_PERCENT },
};

function pension(
  overrides: Partial<RetirementPensionInputs>,
): RetirementPensionInputs {
  return { ...NO_PENSION, ...overrides };
}

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
    const result = computeRetirementMatrix(makeInput(), NO_PENSION, AGE);
    expect(result.rows).toHaveLength(6);
    for (const row of result.rows) {
      expect(row).toHaveLength(RETIREMENT_HORIZONS_YEARS.length);
    }
  });

  it("floors the tier base at $100/mo when surplus is zero or negative", () => {
    const result = computeRetirementMatrix(
      makeInput({ avg_monthly_income_cents: 100_000, avg_monthly_expense_cents: 300_000 }),
      NO_PENSION,
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
    const withRealEstate = computeRetirementMatrix(input, NO_PENSION, AGE);
    const withoutRealEstate = computeRetirementMatrix(
      makeInput({ account_balances: [{ account_type: "tfsa", total_cents: 1_000_000 }] }),
      NO_PENSION,
      AGE,
    );
    // Real estate and chequing balances must not change the projected value.
    expect(withRealEstate.rows[0][0].projectedValueCents).toBe(
      withoutRealEstate.rows[0][0].projectedValueCents,
    );
  });

  it("requires a bigger nest egg for a younger current age at the same horizon (retiring earlier)", () => {
    const input = makeInput();
    const youngerToday = computeRetirementMatrix(input, NO_PENSION, 30); // retires at 40 for the 10yr column
    const olderToday = computeRetirementMatrix(input, NO_PENSION, 75); // retires at 85 for the 10yr column

    const cellIndex = RETIREMENT_HORIZONS_YEARS.indexOf(10);
    expect(youngerToday.columnNestEggCents[cellIndex]).toBeGreaterThan(
      olderToday.columnNestEggCents[cellIndex],
    );
  });

  it("reduces the nest egg requirement (and can flip a cell to achieved) when pension increases", () => {
    const input = makeInput();
    const noPension = computeRetirementMatrix(input, NO_PENSION, AGE);
    const withPension = computeRetirementMatrix(
      input,
      pension({ governmentPensionAnnualCents: 10_000_000 }),
      AGE,
    );

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
    const result = computeRetirementMatrix(input, NO_PENSION, AGE);
    expect(result.rows[CURRENT_PACE_TIER_INDEX][0].status).toBe("achieved");
    expect(result.earliestAchievedYears).toBe(RETIREMENT_HORIZONS_YEARS[0]);
  });

  it("classifies a cell as shortfall with no capital and no pension for a low-savings scenario", () => {
    const input = makeInput({
      avg_monthly_income_cents: 300_000,
      avg_monthly_expense_cents: 295_000,
    });
    const result = computeRetirementMatrix(input, NO_PENSION, AGE);
    expect(result.rows[0][0].status).not.toBe("achieved");
  });

  it("returns null earliestAchievedYears when the current-pace row never achieves", () => {
    const input = makeInput({
      avg_monthly_income_cents: 300_000,
      avg_monthly_expense_cents: 295_000,
    });
    const result = computeRetirementMatrix(input, NO_PENSION, AGE);
    expect(result.earliestAchievedYears).toBeNull();
  });

  it("computes columnNestEggCents once per column, shared identically across every tier row", () => {
    const result = computeRetirementMatrix(makeInput(), NO_PENSION, AGE);
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
      NO_PENSION,
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
    const noPensionNestEgg = computeRetirementMatrix(input, NO_PENSION, AGE).columnNestEggCents[cellIndex];
    expect(
      computeRetirementMatrix(input, NO_PENSION, AGE).rows[CURRENT_PACE_TIER_INDEX][cellIndex].status,
    ).toBe("shortfall");

    // gapCents is monotonically non-decreasing in pension for this cell (nestEgg shrinks linearly
    // as pension rises, projected value is pension-independent), so bisecting for the smallest
    // pension where status leaves "shortfall" reliably lands on the boundary — which must be
    // "close" (not "achieved") by definition of the ±10% band having nonzero width.
    let lo = 0;
    let hi = noPensionNestEgg;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const status = computeRetirementMatrix(
        input,
        pension({ governmentPensionAnnualCents: mid }),
        AGE,
      ).rows[CURRENT_PACE_TIER_INDEX][cellIndex].status;
      if (status === "shortfall") {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    expect(
      computeRetirementMatrix(
        input,
        pension({ governmentPensionAnnualCents: hi }),
        AGE,
      ).rows[CURRENT_PACE_TIER_INDEX][cellIndex].status,
    ).toBe("close");
  });
});

describe("computeRetirementMatrix options", () => {
  const SURPLUS_INPUT = makeInput({
    avg_monthly_income_cents: 500_000,
    avg_monthly_expense_cents: 300_000,
    account_balances: [{ account_type: "tfsa", total_cents: 5_000_000 }],
  });

  it("reproduces the no-options matrix exactly when the options bag is empty", () => {
    expect(
      computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE, {}),
    ).toStrictEqual(computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE));
  });

  it("reproduces the no-options matrix exactly when both overrides are undefined", () => {
    expect(
      computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE, {
        anchorMonthlyCents: undefined,
        horizons: undefined,
      }),
    ).toStrictEqual(computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE));
  });

  it("reproduces the no-options matrix exactly when handed the default horizons explicitly", () => {
    expect(
      computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE, {
        horizons: [5, 10, 15, 20, 25, 30],
      }),
    ).toStrictEqual(computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE));
  });

  it("derives the same anchor the no-options ladder pins its current-pace row to", () => {
    expect(derivedAnchorMonthlyCents(SURPLUS_INPUT)).toBe(
      computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE)
        .tiersMonthlyCents[CURRENT_PACE_TIER_INDEX],
    );
  });

  it("floors the derived anchor at $100/mo but never an explicit one", () => {
    const negativeSurplus = makeInput({
      avg_monthly_income_cents: 100_000,
      avg_monthly_expense_cents: 300_000,
    });
    expect(derivedAnchorMonthlyCents(negativeSurplus)).toBe(100_00);
    expect(
      computeRetirementMatrix(negativeSurplus, NO_PENSION, AGE, {
        anchorMonthlyCents: 50_00,
      }).tiersMonthlyCents[CURRENT_PACE_TIER_INDEX],
    ).toBe(50_00);
  });

  it("zeroes every tier when the explicit anchor is $0, leaving columns as the only variable", () => {
    const result = computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE, {
      anchorMonthlyCents: 0,
    });
    expect(result.tiersMonthlyCents).toEqual([0, 0, 0, 0, 0, 0]);
    for (const row of result.rows) {
      expect(row.every((cell) => cell.monthlySavingsCents === 0)).toBe(true);
      // Identical savings across rows means each row differs only by its horizon column, and every
      // row must therefore be an identical copy of the first.
      expect(row).toStrictEqual(result.rows[0]);
    }
  });

  it("rounds an explicit anchor to the $50 ladder step", () => {
    const anchorOf = (cents: number) =>
      computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE, {
        anchorMonthlyCents: cents,
      }).tiersMonthlyCents[CURRENT_PACE_TIER_INDEX];

    expect(ANCHOR_STEP_CENTS).toBe(50_00);
    expect(anchorOf(1_237_00)).toBe(1_250_00);
    expect(anchorOf(1_212_00)).toBe(1_200_00);
  });

  it("scales the whole ladder off an explicit anchor, keeping the tier multipliers", () => {
    const result = computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE, {
      anchorMonthlyCents: 1_000_00,
    });
    expect(result.tiersMonthlyCents).toEqual(
      SAVINGS_TIER_MULTIPLIERS.map((m) => 1_000_00 * m),
    );
  });

  it("overrides the derived surplus rather than combining with it", () => {
    const overridden = computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE, {
      anchorMonthlyCents: 1_000_00,
    });
    const derivedOnly = computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE);
    expect(derivedAnchorMonthlyCents(SURPLUS_INPUT)).toBe(2_000_00);
    expect(overridden.tiersMonthlyCents[CURRENT_PACE_TIER_INDEX]).toBe(1_000_00);
    expect(
      overridden.rows[CURRENT_PACE_TIER_INDEX][0].projectedValueCents,
    ).toBeLessThan(
      derivedOnly.rows[CURRENT_PACE_TIER_INDEX][0].projectedValueCents,
    );
  });

  it("leaves the nest egg untouched when only the anchor changes", () => {
    expect(
      computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE, {
        anchorMonthlyCents: 4_000_00,
      }).columnNestEggCents,
    ).toEqual(
      computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE)
        .columnNestEggCents,
    );
  });

  const HORIZON_ZOOMS: ReadonlyArray<{
    label: string;
    stepYears: number;
    columns: readonly number[];
  }> = [
    { label: "6y", stepYears: 1, columns: [1, 2, 3, 4, 5, 6] },
    { label: "12y", stepYears: 2, columns: [2, 4, 6, 8, 10, 12] },
    { label: "30y", stepYears: 5, columns: [5, 10, 15, 20, 25, 30] },
  ];

  for (const { label, stepYears, columns } of HORIZON_ZOOMS) {
    it(`lays out the ${label} zoom columns at step*1..step*6`, () => {
      const horizons = Array.from(
        { length: RETIREMENT_HORIZONS_YEARS.length },
        (_, i) => stepYears * (i + 1),
      );
      expect(horizons).toEqual(columns);

      const result = computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE, {
        horizons,
      });
      expect(result.columnNestEggCents).toHaveLength(columns.length);
      for (const row of result.rows) {
        expect(row.map((cell) => cell.years)).toEqual(columns);
      }
    });
  }

  it("recomputes nest egg and projected value per column when the horizons shrink", () => {
    const zoomedIn = computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE, {
      horizons: [1, 2, 3, 4, 5, 6],
    });
    const zoomedOut = computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE);

    // The 5yr column is the last of the 6y zoom and the first of the 30y default; same horizon, so
    // both the per-column nest egg and the projected value must agree exactly.
    expect(zoomedIn.columnNestEggCents[4]).toBe(zoomedOut.columnNestEggCents[0]);
    expect(zoomedIn.rows[CURRENT_PACE_TIER_INDEX][4]).toStrictEqual(
      zoomedOut.rows[CURRENT_PACE_TIER_INDEX][0],
    );
    // A 1yr column has far less compounding than any default column.
    expect(
      zoomedIn.rows[CURRENT_PACE_TIER_INDEX][0].projectedValueCents,
    ).toBeLessThan(
      zoomedOut.rows[CURRENT_PACE_TIER_INDEX][0].projectedValueCents,
    );
  });

  it("reports earliestAchievedYears from the overridden columns, not the default ones", () => {
    const alreadyRich = makeInput({
      account_balances: [{ account_type: "tfsa", total_cents: 500_000_000_00 }],
      avg_monthly_expense_cents: 100_000,
    });
    expect(
      computeRetirementMatrix(alreadyRich, NO_PENSION, AGE, {
        horizons: [1, 2, 3, 4, 5, 6],
      }).earliestAchievedYears,
    ).toBe(1);
  });

  it("applies an anchor override and a horizon override together", () => {
    const result = computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE, {
      anchorMonthlyCents: 0,
      horizons: [2, 4, 6, 8, 10, 12],
    });
    expect(result.tiersMonthlyCents).toEqual([0, 0, 0, 0, 0, 0]);
    expect(result.rows[0].map((cell) => cell.years)).toEqual([
      2, 4, 6, 8, 10, 12,
    ]);
  });
});

describe("pension eligibility per horizon column", () => {
  const HORIZON_5_INDEX = RETIREMENT_HORIZONS_YEARS.indexOf(5);
  const HORIZON_30_INDEX = RETIREMENT_HORIZONS_YEARS.indexOf(30);
  const GOVERNMENT_CENTS = 1_954_800;
  // Age 50 so the 5yr column retires at 55 (before the CA gate) and the 30yr column at 80 (after).
  const AGE_STRADDLING_GATE = 50;

  it("excludes the government pension for a gated column retiring before age 65", () => {
    const input = makeInput();
    const gated = computeRetirementMatrix(
      input,
      pension({
        governmentPensionAnnualCents: GOVERNMENT_CENTS,
        gateGovernmentPensionByAge: true,
      }),
      AGE_STRADDLING_GATE,
    );
    const ungated = computeRetirementMatrix(
      input,
      NO_PENSION,
      AGE_STRADDLING_GATE,
    );

    expect(AGE_STRADDLING_GATE + 5).toBeLessThan(GOVERNMENT_PENSION_MIN_AGE_CA);
    expect(gated.columnNestEggCents[HORIZON_5_INDEX]).toBe(
      ungated.columnNestEggCents[HORIZON_5_INDEX],
    );
  });

  it("applies the government pension in full for a gated column retiring at or after age 65", () => {
    const input = makeInput();
    const gated = computeRetirementMatrix(
      input,
      pension({
        governmentPensionAnnualCents: GOVERNMENT_CENTS,
        gateGovernmentPensionByAge: true,
      }),
      AGE_STRADDLING_GATE,
    );
    const ungated = computeRetirementMatrix(
      input,
      NO_PENSION,
      AGE_STRADDLING_GATE,
    );

    expect(AGE_STRADDLING_GATE + 30).toBeGreaterThanOrEqual(
      GOVERNMENT_PENSION_MIN_AGE_CA,
    );
    expect(gated.columnNestEggCents[HORIZON_30_INDEX]).toBeLessThan(
      ungated.columnNestEggCents[HORIZON_30_INDEX],
    );
  });

  it("applies the government pension at every age when the gate is off (non-CA)", () => {
    const input = makeInput();
    const ungatedPension = computeRetirementMatrix(
      input,
      pension({
        governmentPensionAnnualCents: GOVERNMENT_CENTS,
        gateGovernmentPensionByAge: false,
      }),
      AGE_STRADDLING_GATE,
    );
    const noPension = computeRetirementMatrix(
      input,
      NO_PENSION,
      AGE_STRADDLING_GATE,
    );

    for (const index of RETIREMENT_HORIZONS_YEARS.keys()) {
      expect(ungatedPension.columnNestEggCents[index]).toBeLessThan(
        noPension.columnNestEggCents[index],
      );
    }
  });

  it("applies the employer pension for every column once its start age is met, gate or not", () => {
    const input = makeInput();
    const withEmployer = computeRetirementMatrix(
      input,
      pension({
        employerPensionAnnualCents: GOVERNMENT_CENTS,
        gateGovernmentPensionByAge: true,
        employerPensionStartAge: AGE_STRADDLING_GATE,
      }),
      AGE_STRADDLING_GATE,
    );
    const noPension = computeRetirementMatrix(
      input,
      NO_PENSION,
      AGE_STRADDLING_GATE,
    );

    for (const index of RETIREMENT_HORIZONS_YEARS.keys()) {
      expect(withEmployer.columnNestEggCents[index]).toBeLessThan(
        noPension.columnNestEggCents[index],
      );
    }
  });

  it("treats an employer pension identically to a government pension once past the gate age", () => {
    const input = makeInput();
    const employerOnly = computeRetirementMatrix(
      input,
      pension({
        employerPensionAnnualCents: GOVERNMENT_CENTS,
        gateGovernmentPensionByAge: true,
        employerPensionStartAge: AGE_STRADDLING_GATE,
      }),
      AGE_STRADDLING_GATE,
    );
    const governmentOnly = computeRetirementMatrix(
      input,
      pension({
        governmentPensionAnnualCents: GOVERNMENT_CENTS,
        gateGovernmentPensionByAge: true,
      }),
      AGE_STRADDLING_GATE,
    );

    expect(employerOnly.columnNestEggCents[HORIZON_30_INDEX]).toBe(
      governmentOnly.columnNestEggCents[HORIZON_30_INDEX],
    );
    expect(employerOnly.columnNestEggCents[HORIZON_5_INDEX]).toBeLessThan(
      governmentOnly.columnNestEggCents[HORIZON_5_INDEX],
    );
  });
});

describe("employer pension start age", () => {
  const HORIZON_5_INDEX = RETIREMENT_HORIZONS_YEARS.indexOf(5);
  const HORIZON_30_INDEX = RETIREMENT_HORIZONS_YEARS.indexOf(30);
  const EMPLOYER_CENTS = 4_000_000;
  const GOVERNMENT_CENTS = 1_954_800;
  // Age 30 so the 5yr column retires at 35 (before a 65 start age) and the 30yr column at 60.
  const YOUNG_AGE = 30;

  it("excludes the employer pension from a column retiring before its start age", () => {
    const input = makeInput();
    const withEmployer = computeRetirementMatrix(
      input,
      pension({
        employerPensionAnnualCents: EMPLOYER_CENTS,
        employerPensionStartAge: 65,
      }),
      YOUNG_AGE,
    );
    const noPension = computeRetirementMatrix(input, NO_PENSION, YOUNG_AGE);

    expect(YOUNG_AGE + 5).toBeLessThan(65);
    expect(withEmployer.columnNestEggCents[HORIZON_5_INDEX]).toBe(
      noPension.columnNestEggCents[HORIZON_5_INDEX],
    );
  });

  it("includes the employer pension in a column retiring at or after its start age", () => {
    const input = makeInput();
    const startAge = 55;
    const withEmployer = computeRetirementMatrix(
      input,
      pension({
        employerPensionAnnualCents: EMPLOYER_CENTS,
        employerPensionStartAge: startAge,
      }),
      YOUNG_AGE,
    );
    const noPension = computeRetirementMatrix(input, NO_PENSION, YOUNG_AGE);

    expect(YOUNG_AGE + 30).toBeGreaterThanOrEqual(startAge);
    expect(withEmployer.columnNestEggCents[HORIZON_30_INDEX]).toBeLessThan(
      noPension.columnNestEggCents[HORIZON_30_INDEX],
    );
  });

  it("includes the employer pension exactly at the boundary column, not one column later", () => {
    // A 40-year-old whose plan starts at 50 must see the 10yr column (age 50) count it — an
    // off-by-one in the `>=` comparison would silently defer it to the 15yr column.
    expect(
      pensionForYearsCents(
        pension({
          employerPensionAnnualCents: EMPLOYER_CENTS,
          employerPensionStartAge: 50,
        }),
        40,
        10,
      ),
    ).toBe(EMPLOYER_CENTS);
    expect(
      pensionForYearsCents(
        pension({
          employerPensionAnnualCents: EMPLOYER_CENTS,
          employerPensionStartAge: 50,
        }),
        40,
        9,
      ),
    ).toBe(0);
  });

  it("excludes both pensions when each column lands before its own start age", () => {
    const input = makeInput();
    const bothGated = computeRetirementMatrix(
      input,
      pension({
        governmentPensionAnnualCents: GOVERNMENT_CENTS,
        employerPensionAnnualCents: EMPLOYER_CENTS,
        gateGovernmentPensionByAge: true,
        employerPensionStartAge: 65,
      }),
      YOUNG_AGE,
    );
    const noPension = computeRetirementMatrix(input, NO_PENSION, YOUNG_AGE);

    expect(YOUNG_AGE + 5).toBeLessThan(GOVERNMENT_PENSION_MIN_AGE_CA);
    expect(
      pensionForYearsCents(
        pension({
          governmentPensionAnnualCents: GOVERNMENT_CENTS,
          employerPensionAnnualCents: EMPLOYER_CENTS,
          gateGovernmentPensionByAge: true,
          employerPensionStartAge: 65,
        }),
        YOUNG_AGE,
        5,
      ),
    ).toBe(0);
    expect(bothGated.columnNestEggCents[HORIZON_5_INDEX]).toBe(
      noPension.columnNestEggCents[HORIZON_5_INDEX],
    );
  });
});

describe("manual pension tax rate", () => {
  const HORIZON_30_INDEX = RETIREMENT_HORIZONS_YEARS.indexOf(30);
  const GROSS_CENTS = 5_000_000;
  const ELIGIBLE_EVERYWHERE = {
    governmentPensionAnnualCents: GROSS_CENTS,
    gateGovernmentPensionByAge: false,
    employerPensionStartAge: 18,
  } as const;

  function manual(ratePercent: number): RetirementPensionInputs["taxModel"] {
    return { kind: "manual", ratePercent };
  }

  it("reduces the combined eligible pension by the rate before the gap calc", () => {
    expect(
      pensionCountedForYearsCents(
        pension({ ...ELIGIBLE_EVERYWHERE, taxModel: manual(20) }),
        AGE,
        10,
      ),
    ).toBe(GROSS_CENTS * 0.8);
  });

  it("leaves the pension itself gross, whatever the rate", () => {
    expect(
      pensionForYearsCents(
        pension({ ...ELIGIBLE_EVERYWHERE, taxModel: manual(20) }),
        AGE,
        10,
      ),
    ).toBe(GROSS_CENTS);
  });

  it("taxes the employer and government pensions as one combined figure", () => {
    expect(
      pensionCountedForYearsCents(
        pension({
          governmentPensionAnnualCents: GROSS_CENTS,
          employerPensionAnnualCents: GROSS_CENTS,
          gateGovernmentPensionByAge: false,
          employerPensionStartAge: 18,
          taxModel: manual(25),
        }),
        AGE,
        10,
      ),
    ).toBe(2 * GROSS_CENTS * 0.75);
  });

  it("taxes only the pensions a column is actually eligible for", () => {
    // The excluded employer pension must not be taxed into a partial contribution — an ineligible
    // pension contributes exactly zero, not `gross * (1 - rate)`.
    expect(
      pensionCountedForYearsCents(
        pension({
          governmentPensionAnnualCents: GROSS_CENTS,
          employerPensionAnnualCents: GROSS_CENTS,
          gateGovernmentPensionByAge: false,
          employerPensionStartAge: 99,
          taxModel: manual(20),
        }),
        AGE,
        10,
      ),
    ).toBe(GROSS_CENTS * 0.8);
  });

  it("zeroes the pension entirely at a 100% rate", () => {
    expect(
      pensionCountedForYearsCents(
        pension({ ...ELIGIBLE_EVERYWHERE, taxModel: manual(100) }),
        AGE,
        10,
      ),
    ).toBe(0);
  });

  it("matches the pre-tax baseline exactly at the 0% default", () => {
    const taxed = pension({
      ...ELIGIBLE_EVERYWHERE,
      taxModel: manual(DEFAULT_PENSION_TAX_RATE_PERCENT),
    });
    expect(pensionCountedForYearsCents(taxed, AGE, 10)).toBe(GROSS_CENTS);
    expect(pensionForYearsCents(taxed, AGE, 10)).toBe(GROSS_CENTS);
    expect(DEFAULT_PENSION_TAX_RATE_PERCENT).toBe(0);
  });

  it("raises the nest egg required relative to an untaxed pension", () => {
    const input = makeInput();
    const untaxed = computeRetirementMatrix(
      input,
      pension({ ...ELIGIBLE_EVERYWHERE, taxModel: manual(0) }),
      AGE,
    );
    const taxed = computeRetirementMatrix(
      input,
      pension({ ...ELIGIBLE_EVERYWHERE, taxModel: manual(20) }),
      AGE,
    );

    expect(taxed.columnNestEggCents[HORIZON_30_INDEX]).toBeGreaterThan(
      untaxed.columnNestEggCents[HORIZON_30_INDEX],
    );
  });

  it("is pure withholding: a taxed pension equals owning only the after-tax amount", () => {
    // The formula this page shipped with, restated — nothing the auto branch adds may change what a
    // rate saved before it existed means.
    const input = makeInput();
    const taxed = computeRetirementMatrix(
      input,
      pension({ ...ELIGIBLE_EVERYWHERE, taxModel: manual(25) }),
      AGE,
    );
    const smallerButUntaxed = computeRetirementMatrix(
      input,
      pension({
        ...ELIGIBLE_EVERYWHERE,
        governmentPensionAnnualCents: GROSS_CENTS * 0.75,
        taxModel: manual(0),
      }),
      AGE,
    );

    expect(taxed.columnNestEggCents).toEqual(
      smallerButUntaxed.columnNestEggCents,
    );
  });

  it("leaves a zero-pension matrix untouched at any rate", () => {
    const input = makeInput();
    expect(
      computeRetirementMatrix(input, pension({ taxModel: manual(40) }), AGE)
        .columnNestEggCents,
    ).toEqual(computeRetirementMatrix(input, NO_PENSION, AGE).columnNestEggCents);
  });

  it("returns whole cents so the gap calc never inherits a fractional pension", () => {
    const taxed = pensionCountedForYearsCents(
      pension({
        governmentPensionAnnualCents: 1_954_801,
        gateGovernmentPensionByAge: false,
        employerPensionStartAge: 18,
        taxModel: manual(33),
      }),
      AGE,
      10,
    );
    expect(Number.isInteger(taxed)).toBe(true);
  });
});

describe("automatic tax estimate", () => {
  const HORIZON_30_INDEX = RETIREMENT_HORIZONS_YEARS.indexOf(30);
  const GROSS_CENTS = 5_000_000;
  const AUTO: RetirementPensionInputs["taxModel"] = { kind: "auto" };
  const ELIGIBLE_EVERYWHERE = {
    governmentPensionAnnualCents: GROSS_CENTS,
    gateGovernmentPensionByAge: false,
    employerPensionStartAge: 18,
  } as const;

  it("raises the nest egg above the untaxed baseline in every column", () => {
    const input = makeInput();
    const auto = computeRetirementMatrix(
      input,
      pension({ taxModel: AUTO }),
      AGE,
    );
    const untaxed = computeRetirementMatrix(input, NO_PENSION, AGE);

    for (const index of RETIREMENT_HORIZONS_YEARS.keys()) {
      expect(auto.columnNestEggCents[index]).toBeGreaterThan(
        untaxed.columnNestEggCents[index],
      );
    }
  });

  it("grosses the spend up through the bands indexed to that column's own horizon", () => {
    // With no pension the untaxed nest egg is exactly `futureSpend * multiplier`, so dividing it
    // back out recovers the column's spend without restating the inflation formula here. Auto must
    // then require the gross-up of that spend, against thresholds inflated the same number of years.
    const input = makeInput();
    const auto = computeRetirementMatrix(
      input,
      pension({ taxModel: AUTO }),
      AGE,
    );
    const untaxed = computeRetirementMatrix(input, NO_PENSION, AGE);

    RETIREMENT_HORIZONS_YEARS.forEach((years, index) => {
      const multiplier = nestEggMultiplier(AGE + years);
      const futureSpendCents = untaxed.columnNestEggCents[index] / multiplier;
      const indexedBands = indexBandsForYears(
        CA_RETIREMENT_TAX_BANDS,
        years,
        INFLATION_RATE_ANNUAL,
      );

      expect(auto.columnNestEggCents[index]).toBeCloseTo(
        grossUpCents(futureSpendCents, indexedBands) * multiplier,
        -1,
      );
    });
  });

  it("counts the pension gross, since the gross-up already taxes total income", () => {
    // Withholding here as well would tax the pension twice: once inside the gross-up, once again on
    // the way into the gap calc.
    const p = pension({ ...ELIGIBLE_EVERYWHERE, taxModel: AUTO });
    expect(pensionCountedForYearsCents(p, AGE, 10)).toBe(GROSS_CENTS);
    expect(pensionCountedForYearsCents(p, AGE, 10)).toBe(
      pensionForYearsCents(p, AGE, 10),
    );
  });

  it("still respects each pension's own start-age gate", () => {
    expect(
      pensionCountedForYearsCents(
        pension({
          governmentPensionAnnualCents: GROSS_CENTS,
          employerPensionAnnualCents: GROSS_CENTS,
          gateGovernmentPensionByAge: true,
          employerPensionStartAge: 99,
          taxModel: AUTO,
        }),
        30,
        5,
      ),
    ).toBe(0);
  });

  it("clamps the gap to zero when gross pension already covers the grossed-up need", () => {
    const generous = pension({
      governmentPensionAnnualCents: 100_000_000,
      gateGovernmentPensionByAge: false,
      employerPensionStartAge: 18,
      taxModel: AUTO,
    });
    expect(
      computeRetirementMatrix(makeInput(), generous, AGE).columnNestEggCents,
    ).toEqual(RETIREMENT_HORIZONS_YEARS.map(() => 0));
  });

  it("still requires nothing when there is no expense history to gross up", () => {
    const result = computeRetirementMatrix(
      makeInput({ avg_monthly_expense_cents: 0, expense_month_count: 0 }),
      pension({ taxModel: AUTO }),
      AGE,
    );
    expect(result.columnNestEggCents.every((cents) => cents === 0)).toBe(true);
  });

  it("is overridden by a saved manual rate, which wins even at 0%", () => {
    const input = makeInput();
    const auto = computeRetirementMatrix(
      input,
      pension({ ...ELIGIBLE_EVERYWHERE, taxModel: AUTO }),
      AGE,
    );
    const overridden = computeRetirementMatrix(
      input,
      pension({ ...ELIGIBLE_EVERYWHERE, taxModel: { kind: "manual", ratePercent: 0 } }),
      AGE,
    );

    expect(overridden.columnNestEggCents[HORIZON_30_INDEX]).toBeLessThan(
      auto.columnNestEggCents[HORIZON_30_INDEX],
    );
    expect(overridden.columnNestEggCents).toEqual(
      computeRetirementMatrix(
        input,
        pension({ ...ELIGIBLE_EVERYWHERE, taxModel: { kind: "manual", ratePercent: 0 } }),
        AGE,
      ).columnNestEggCents,
    );
  });
});

describe("today's-dollars display figures", () => {
  const SURPLUS_INPUT = makeInput({
    avg_monthly_income_cents: 800_000,
    avg_monthly_expense_cents: 500_000,
    account_balances: [{ account_type: "tfsa", total_cents: 5_000_000 }],
  });

  const deflatedBy = (cents: number, years: number) =>
    Math.round(cents / Math.pow(1 + INFLATION_RATE_ANNUAL, years));

  it("deflates every cell's projected value by its own column's inflation factor", () => {
    const result = computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE);

    for (const row of result.rows) {
      for (const cell of row) {
        expect(cell.projectedValueTodayCents).toBe(
          deflatedBy(cell.projectedValueCents, cell.years),
        );
      }
    }
  });

  it("deflates the per-column nest egg with the identical factor its cells use", () => {
    const result = computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE);

    result.columnNestEggTodayCents.forEach((todayCents, index) => {
      const years = RETIREMENT_HORIZONS_YEARS[index];
      expect(todayCents).toBe(deflatedBy(result.columnNestEggCents[index], years));
      expect(deflateToTodayCents(result.columnNestEggCents[index], years)).toBe(
        todayCents,
      );
    });
  });

  it("leaves a nominal figure untouched at a zero-year horizon", () => {
    expect(deflateToTodayCents(1_234_567, 0)).toBe(1_234_567);

    const result = computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE, {
      horizons: [0, 1, 2, 3, 4, 5],
    });
    expect(result.columnNestEggTodayCents[0]).toBe(result.columnNestEggCents[0]);
    expect(result.rows[CURRENT_PACE_TIER_INDEX][0].projectedValueTodayCents).toBe(
      result.rows[CURRENT_PACE_TIER_INDEX][0].projectedValueCents,
    );
  });

  it("reads below the nominal figure for every column with years to inflate over", () => {
    const result = computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE);

    result.columnNestEggTodayCents.forEach((todayCents, index) => {
      expect(todayCents).toBeLessThan(result.columnNestEggCents[index]);
    });
  });

  it("orders the columns so retiring earlier needs more, which the nominal figures do not", () => {
    const result = computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE);
    const today = result.columnNestEggTodayCents;
    const nominal = result.columnNestEggCents;

    for (let index = 1; index < today.length; index++) {
      expect(today[index]).toBeLessThan(today[index - 1]);
    }
    // The contradiction this spec removes: at least one nominal pair rises left-to-right, which is
    // what made the grid read as "retiring later costs more" against its own legend.
    expect(nominal.some((cents, index) => index > 0 && cents > nominal[index - 1])).toBe(
      true,
    );
  });

  it("deflates by the overridden horizon's own years, not the default column's", () => {
    const zoomedIn = computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE, {
      horizons: [1, 2, 3, 4, 5, 6],
    });
    const zoomedOut = computeRetirementMatrix(SURPLUS_INPUT, NO_PENSION, AGE);

    // 5 years is the 5th column of the 6y zoom and the 1st of the default, so both must agree.
    expect(zoomedIn.columnNestEggTodayCents[4]).toBe(
      zoomedOut.columnNestEggTodayCents[0],
    );
    expect(
      zoomedIn.rows[CURRENT_PACE_TIER_INDEX][4].projectedValueTodayCents,
    ).toBe(zoomedOut.rows[CURRENT_PACE_TIER_INDEX][0].projectedValueTodayCents);
  });

  it("cannot move a status: the deflation scales both sides of every gap equally", () => {
    // Restating `cellStatus` against the deflated pair. One factor per column divides the projected
    // value and the nest egg alike, so the sign of the gap and its size relative to the 10% band both
    // survive — which is the proof that displaying today's dollars cannot recolour a cell.
    const statusFromDeflated = (projectedCents: number, nestEggCents: number) => {
      const gapCents = projectedCents - nestEggCents;
      if (gapCents >= 0) return "achieved";
      if (nestEggCents > 0 && gapCents >= -0.1 * nestEggCents) return "close";
      return "shortfall";
    };

    for (const p of [
      NO_PENSION,
      pension({ governmentPensionAnnualCents: 1_954_800 }),
      pension({ taxModel: { kind: "auto" } }),
    ]) {
      const result = computeRetirementMatrix(SURPLUS_INPUT, p, AGE);

      for (const row of result.rows) {
        row.forEach((cell, index) => {
          expect(
            statusFromDeflated(
              cell.projectedValueTodayCents,
              result.columnNestEggTodayCents[index],
            ),
          ).toBe(cell.status);
        });
      }
    }
  });

  it("applies one factor per column to the header figure and every cell under it", () => {
    const result = computeRetirementMatrix(
      SURPLUS_INPUT,
      pension({ governmentPensionAnnualCents: 1_954_800 }),
      AGE,
    );

    for (const row of result.rows) {
      row.forEach((cell, index) => {
        expect(cell.nestEggRequiredCents).toBe(result.columnNestEggCents[index]);
        expect(
          deflateToTodayCents(result.columnNestEggCents[index], cell.years),
        ).toBe(result.columnNestEggTodayCents[index]);
        expect(deflateToTodayCents(cell.projectedValueCents, cell.years)).toBe(
          cell.projectedValueTodayCents,
        );
      });
    }
  });
});
