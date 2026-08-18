import { describe, it, expect } from "vitest";
import {
  CA_RETIREMENT_TAX_BANDS,
  effectiveRateFor,
  grossUpCents,
  indexBandsForYears,
  taxForCents,
} from "../retirement-tax";
import type { RetirementTaxBand } from "../retirement-tax";
import { INFLATION_RATE_ANNUAL } from "../retirement";

const BANDS = CA_RETIREMENT_TAX_BANDS;

/** What `grossUpCents` is the inverse of. */
function netForCents(
  grossCents: number,
  bands: readonly RetirementTaxBand[] = BANDS,
): number {
  return grossCents - taxForCents(grossCents, bands);
}

// Every figure below is unrounded on purpose (see `taxForCents`), so equality is asserted to a
// millionth of a cent rather than exactly — a rounded table would break the algebraic inverse.
const CENTS_PRECISION = 6;

describe("CA_RETIREMENT_TAX_BANDS invariants", () => {
  it("starts at zero income with a zero-rate band", () => {
    expect(BANDS[0].fromCents).toBe(0);
    expect(BANDS[0].ratePercent).toBe(0);
  });

  it("is a genuinely progressive curve, not a flat rate wearing a table", () => {
    expect(BANDS.length).toBeGreaterThanOrEqual(3);
    expect(BANDS[BANDS.length - 1].ratePercent).toBeGreaterThan(
      BANDS[0].ratePercent,
    );
  });

  it("orders thresholds strictly ascending", () => {
    for (let i = 1; i < BANDS.length; i++) {
      expect(BANDS[i].fromCents).toBeGreaterThan(BANDS[i - 1].fromCents);
    }
  });

  it("never lowers the marginal rate as income rises", () => {
    for (let i = 1; i < BANDS.length; i++) {
      expect(BANDS[i].ratePercent).toBeGreaterThanOrEqual(
        BANDS[i - 1].ratePercent,
      );
    }
  });

  it("keeps every rate strictly below 100%, so a gross-up always has an answer", () => {
    // At 100% no gross income can net a positive target and `grossUpCents` would divide by zero.
    for (const band of BANDS) {
      expect(band.ratePercent).toBeGreaterThanOrEqual(0);
      expect(band.ratePercent).toBeLessThan(100);
    }
  });
});

describe("CA_RETIREMENT_TAX_BANDS golden values, blended federal + average provincial as of 2026", () => {
  it("leaves the first $22k of retirement income untaxed", () => {
    // The generous first band stands in for the credits a retiree actually claims (basic personal,
    // age, pension income) instead of modelling each of them.
    expect(BANDS[1].fromCents).toBe(22_000_00);
    expect(taxForCents(22_000_00, BANDS)).toBe(0);
    expect(taxForCents(21_999_99, BANDS)).toBe(0);
  });

  it("taxes $50k of income at $5,880, an 11.76% blended rate", () => {
    expect(taxForCents(50_000_00, BANDS)).toBeCloseTo(5_880_00, CENTS_PRECISION);
    expect(effectiveRateFor(50_000_00, BANDS)).toBeCloseTo(11.76, 6);
  });

  it("taxes $80k of income at $14,250, a 17.81% blended rate", () => {
    expect(taxForCents(80_000_00, BANDS)).toBeCloseTo(
      14_250_00,
      CENTS_PRECISION,
    );
    expect(effectiveRateFor(80_000_00, BANDS)).toBeCloseTo(17.8125, 6);
  });

  it("taxes $200k of income at $58,590, a 29.30% blended rate", () => {
    expect(taxForCents(200_000_00, BANDS)).toBeCloseTo(
      58_590_00,
      CENTS_PRECISION,
    );
    expect(effectiveRateFor(200_000_00, BANDS)).toBeCloseTo(29.295, 6);
  });

  it("needs $57,500 of gross income to net a $50k retirement spend", () => {
    expect(grossUpCents(50_000_00, BANDS)).toBeCloseTo(
      57_500_00,
      CENTS_PRECISION,
    );
  });
});

describe("taxForCents", () => {
  it("owes nothing on zero or negative income", () => {
    expect(taxForCents(0, BANDS)).toBe(0);
    expect(taxForCents(-1_000_00, BANDS)).toBe(0);
  });

  it("taxes each band marginally rather than applying one rate to the whole amount", () => {
    const secondBand = BANDS[1];
    const justInside = secondBand.fromCents + 1_000_00;
    expect(taxForCents(justInside, BANDS)).toBeCloseTo(
      1_000_00 * (secondBand.ratePercent / 100),
      CENTS_PRECISION,
    );
    // A flat-rate reading of the same table would charge the rate on the whole $23k.
    expect(taxForCents(justInside, BANDS)).toBeLessThan(
      justInside * (secondBand.ratePercent / 100),
    );
  });

  it("never decreases as income rises", () => {
    let previous = 0;
    for (let gross = 0; gross <= 300_000_00; gross += 2_500_00) {
      const tax = taxForCents(gross, BANDS);
      expect(tax).toBeGreaterThanOrEqual(previous);
      previous = tax;
    }
  });

  it("keeps tax strictly below income at every level, so net income always rises", () => {
    for (let gross = 1_00; gross <= 500_000_00; gross += 7_777_00) {
      expect(taxForCents(gross, BANDS)).toBeLessThan(gross);
    }
  });
});

describe("grossUpCents", () => {
  it("needs nothing to net nothing", () => {
    expect(grossUpCents(0, BANDS)).toBe(0);
    expect(grossUpCents(-5_000_00, BANDS)).toBe(0);
  });

  it("is exactly the inverse of taxForCents at every income level", () => {
    for (let netTarget = 0; netTarget <= 400_000_00; netTarget += 3_333_00) {
      expect(netForCents(grossUpCents(netTarget, BANDS))).toBeCloseTo(
        netTarget,
        CENTS_PRECISION,
      );
    }
  });

  it("is exactly the inverse in the other direction too, including at every band boundary", () => {
    const boundaries = BANDS.flatMap((band) => [
      band.fromCents,
      band.fromCents + 1,
      Math.max(0, band.fromCents - 1),
    ]);
    for (const gross of [...boundaries, 1, 37_512_34, 260_000_00]) {
      expect(grossUpCents(netForCents(gross), BANDS)).toBeCloseTo(
        gross,
        CENTS_PRECISION,
      );
    }
  });

  it("returns the target untouched while it stays inside the zero-rate band", () => {
    expect(grossUpCents(10_000_00, BANDS)).toBe(10_000_00);
    expect(grossUpCents(BANDS[1].fromCents, BANDS)).toBe(BANDS[1].fromCents);
  });

  it("always asks for at least the target, and strictly more once tax applies", () => {
    expect(grossUpCents(30_000_00, BANDS)).toBeGreaterThan(30_000_00);
    expect(grossUpCents(150_000_00, BANDS)).toBeGreaterThan(150_000_00);
  });

  it("never decreases as the target rises", () => {
    let previous = 0;
    for (let netTarget = 0; netTarget <= 300_000_00; netTarget += 2_500_00) {
      const gross = grossUpCents(netTarget, BANDS);
      expect(gross).toBeGreaterThanOrEqual(previous);
      previous = gross;
    }
  });
});

describe("effectiveRateFor", () => {
  it("reports zero on zero, negative, or fully-credited income", () => {
    expect(effectiveRateFor(0, BANDS)).toBe(0);
    expect(effectiveRateFor(-1_000_00, BANDS)).toBe(0);
    expect(effectiveRateFor(BANDS[1].fromCents, BANDS)).toBe(0);
  });

  it("stays below the top marginal rate no matter how high income goes", () => {
    const topRate = BANDS[BANDS.length - 1].ratePercent;
    for (const gross of [50_000_00, 200_000_00, 1_000_000_00, 10_000_000_00]) {
      expect(effectiveRateFor(gross, BANDS)).toBeLessThan(topRate);
    }
  });

  it("never decreases as income rises", () => {
    let previous = 0;
    for (let gross = 1_00; gross <= 400_000_00; gross += 2_500_00) {
      const rate = effectiveRateFor(gross, BANDS);
      expect(rate).toBeGreaterThanOrEqual(previous);
      previous = rate;
    }
  });
});

describe("indexBandsForYears", () => {
  it("leaves the curve alone at the present horizon", () => {
    expect(indexBandsForYears(BANDS, 0, INFLATION_RATE_ANNUAL)).toEqual(BANDS);
  });

  it("inflates every threshold by the compounded rate, leaving the rates themselves alone", () => {
    const years = 30;
    const indexed = indexBandsForYears(BANDS, years, INFLATION_RATE_ANNUAL);
    const factor = Math.pow(1 + INFLATION_RATE_ANNUAL, years);

    expect(indexed).toHaveLength(BANDS.length);
    indexed.forEach((band, i) => {
      expect(band.fromCents).toBeCloseTo(
        BANDS[i].fromCents * factor,
        CENTS_PRECISION,
      );
      expect(band.ratePercent).toBe(BANDS[i].ratePercent);
    });
  });

  it("uses the same inflation rate the matrix inflates spending by", () => {
    // If these two ever diverge, a horizon column would compare future-dollar spending against
    // differently-inflated thresholds and invent bracket creep out of the mismatch.
    expect(INFLATION_RATE_ANNUAL).toBe(0.025);
  });

  it("charges the same effective rate on equal real income 30 years out", () => {
    const years = 30;
    const factor = Math.pow(1 + INFLATION_RATE_ANNUAL, years);
    const indexed = indexBandsForYears(BANDS, years, INFLATION_RATE_ANNUAL);

    for (const todayGross of [30_000_00, 60_000_00, 120_000_00, 250_000_00]) {
      expect(effectiveRateFor(todayGross * factor, indexed)).toBeCloseTo(
        effectiveRateFor(todayGross, BANDS),
        9,
      );
    }
  });

  it("grosses up an inflated spend by the same real amount, not a crept-up one", () => {
    const years = 30;
    const factor = Math.pow(1 + INFLATION_RATE_ANNUAL, years);
    const indexed = indexBandsForYears(BANDS, years, INFLATION_RATE_ANNUAL);
    const todaySpend = 48_000_00;

    expect(grossUpCents(todaySpend * factor, indexed)).toBeCloseTo(
      grossUpCents(todaySpend, BANDS) * factor,
      4,
    );
    // Against un-indexed thresholds the same real spend would be pushed into higher bands.
    expect(grossUpCents(todaySpend * factor, BANDS)).toBeGreaterThan(
      grossUpCents(todaySpend, BANDS) * factor,
    );
  });

  it("stays an inverse pair after indexing", () => {
    const indexed = indexBandsForYears(BANDS, 15, INFLATION_RATE_ANNUAL);
    for (let netTarget = 0; netTarget <= 300_000_00; netTarget += 11_111_00) {
      expect(
        netForCents(grossUpCents(netTarget, indexed), indexed),
      ).toBeCloseTo(netTarget, CENTS_PRECISION);
    }
  });
});
