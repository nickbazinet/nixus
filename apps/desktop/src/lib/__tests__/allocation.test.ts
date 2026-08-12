import { describe, it, expect } from "vitest";
import { sumAllocationCents, validateAllocationTotal } from "../allocation";

describe("sumAllocationCents", () => {
  it("returns 0 for an empty draft map", () => {
    expect(sumAllocationCents({})).toBe(0);
  });

  it("adds every draft amount", () => {
    expect(sumAllocationCents({ 1: 25_000, 2: 10_000, 3: 1 })).toBe(35_001);
  });

  it("treats a zero draft as a skipped project rather than an error", () => {
    expect(sumAllocationCents({ 1: 25_000, 2: 0, 3: 0 })).toBe(25_000);
  });
});

describe("validateAllocationTotal", () => {
  it("accepts a total below the surplus", () => {
    expect(validateAllocationTotal(25_000, 40_000)).toEqual({
      ok: true,
      overageCents: 0,
    });
  });

  // FR7 blocks only when the total *exceeds* the surplus, so the boundary itself is allowed.
  it("accepts a total exactly equal to the surplus", () => {
    expect(validateAllocationTotal(40_000, 40_000)).toEqual({
      ok: true,
      overageCents: 0,
    });
  });

  it("rejects a total one cent over the surplus and reports the overage", () => {
    expect(validateAllocationTotal(40_001, 40_000)).toEqual({
      ok: false,
      overageCents: 1,
    });
  });

  it("accepts a zero total against a zero surplus", () => {
    expect(validateAllocationTotal(0, 0)).toEqual({
      ok: true,
      overageCents: 0,
    });
  });

  it("rejects any positive total when there is no surplus", () => {
    expect(validateAllocationTotal(500, 0)).toEqual({
      ok: false,
      overageCents: 500,
    });
  });
});
