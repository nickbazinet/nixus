import { describe, expect, it } from "vitest";

import {
  INCOME_BRACKETS,
  INCOME_BRACKET_CURRENCIES,
  PROFILE_BODY_MAX_BYTES,
  PROFILE_MAX_AGE_YEARS,
  PROFILE_MIN_AGE_YEARS,
  VALIDATION_REASONS,
  type ValidationReason,
} from "@nixus/shared";

import { AccountFailureError, type AccountFailure } from "./errors.ts";
import { subdivisionsFor } from "./locations.ts";
import { validateProfileRequest } from "./validation.ts";

/*
 * Server-side validation is final (AD-5) and mirrors
 * `apps/desktop/src-tauri/src/profile_store.rs::save_profile` rule for rule AND in
 * order, so neither surface can accept a document the other refuses.
 */

const NOW = new Date("2026-11-17T00:00:00.000Z");

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    first_name: null,
    last_name: null,
    birth_date: null,
    income_bracket: null,
    income_bracket_currency: null,
    country_code: null,
    subdivision_code: null,
    expected_version: null,
    ...overrides,
  });
}

function refusal(raw: string | undefined): AccountFailure {
  try {
    validateProfileRequest(raw, NOW);
  } catch (error) {
    if (error instanceof AccountFailureError) return error.failure;
    throw error;
  }
  throw new Error("expected a refusal");
}

function accepted(overrides: Record<string, unknown> = {}) {
  return validateProfileRequest(body(overrides), NOW);
}

describe("request body boundary", () => {
  it("refuses a body over the 16 KiB ceiling", () => {
    expect(refusal("x".repeat(PROFILE_BODY_MAX_BYTES + 1))).toEqual({
      code: "payload_too_large",
    });
  });

  it("measures the ceiling in bytes, not characters", () => {
    // Three bytes per character, so half the ceiling in characters is over it.
    const multiByte = "名".repeat(PROFILE_BODY_MAX_BYTES / 2);
    expect(refusal(multiByte)).toEqual({ code: "payload_too_large" });
  });

  it.each([
    ["an absent body", undefined],
    ["an empty body", ""],
    ["malformed JSON", "{"],
    ["a trailing comma", '{"first_name":null,}'],
  ])("refuses %s as body/invalid_format", (_label, raw) => {
    expect(refusal(raw)).toEqual({
      code: "validation",
      field: "body",
      reason: "invalid_format",
    });
  });

  it.each([
    ["an array", "[]"],
    ["a bare string", '"ada"'],
    ["a number", "4"],
    ["null", "null"],
  ])("refuses %s as body/invalid_type", (_label, raw) => {
    expect(refusal(raw)).toMatchObject({
      field: "body",
      reason: "invalid_type",
    });
  });

  it("refuses a member this contract does not define", () => {
    expect(refusal(body({ nickname: "Ada" }))).toEqual({
      code: "validation",
      field: "body",
      reason: "unknown_field",
    });
  });

  it("never echoes the unknown member's name or value", () => {
    const failure = refusal(body({ ssn: "123-45-6789" }));
    expect(JSON.stringify(failure)).not.toContain("ssn");
    expect(JSON.stringify(failure)).not.toContain("123-45-6789");
  });
});

describe("expected_version is mandatory", () => {
  it("refuses an absent member as required", () => {
    const raw = JSON.parse(body()) as Record<string, unknown>;
    delete raw.expected_version;

    expect(refusal(JSON.stringify(raw))).toEqual({
      code: "validation",
      field: "expected_version",
      reason: "required",
    });
  });

  it.each([["3"], [0], [-1], [1.5], [true]])(
    "refuses %s as invalid_type",
    (value) => {
      expect(refusal(body({ expected_version: value }))).toEqual({
        code: "validation",
        field: "expected_version",
        reason: "invalid_type",
      });
    }
  );

  it("accepts null and any positive integer", () => {
    expect(accepted({ expected_version: null }).expectedVersion).toBeNull();
    expect(accepted({ expected_version: 42 }).expectedVersion).toBe(42);
  });
});

describe("field types and normalization", () => {
  it.each([
    "first_name",
    "last_name",
    "birth_date",
    "income_bracket",
    "income_bracket_currency",
    "country_code",
    "subdivision_code",
  ])("refuses a non-string %s as invalid_type", (field) => {
    expect(refusal(body({ [field]: 7 }))).toEqual({
      code: "validation",
      field,
      reason: "invalid_type",
    });
  });

  it("trims strings and treats a blank one as unset", () => {
    const result = accepted({ first_name: "  Ada  ", last_name: "   " });
    expect(result.fields.first_name).toBe("Ada");
    expect(result.fields.last_name).toBeNull();
  });

  it("treats an absent field as unset rather than refusing it", () => {
    const result = validateProfileRequest(
      JSON.stringify({ expected_version: null }),
      NOW
    );
    expect(result.fields.first_name).toBeNull();
    expect(result.fields.subdivision_code).toBeNull();
  });
});

describe("birth_date", () => {
  it.each([
    ["1985-3-14", "an unpadded month"],
    ["85-03-14", "a two-digit year"],
    ["1985-02-30", "a day that does not exist"],
    ["1985-13-01", "a month that does not exist"],
    ["14/03/1985", "another locale's order"],
    ["1985-03-14T00:00:00Z", "a timestamp"],
  ])("refuses %s (%s) as invalid_format", (value) => {
    expect(refusal(body({ birth_date: value }))).toEqual({
      code: "validation",
      field: "birth_date",
      reason: "invalid_format",
    });
  });

  it("refuses a date after the server's current UTC date", () => {
    expect(refusal(body({ birth_date: "2026-11-18" }))).toMatchObject({
      reason: "in_future",
    });
  });

  it("accepts the server's current UTC date as not in the future, then refuses the age", () => {
    expect(refusal(body({ birth_date: "2026-11-17" }))).toMatchObject({
      reason: "too_young",
    });
  });

  it("refuses an age under the minimum and over the maximum", () => {
    expect(refusal(body({ birth_date: "2010-01-01" }))).toMatchObject({
      field: "birth_date",
      reason: "too_young",
    });
    expect(refusal(body({ birth_date: "1850-01-01" }))).toMatchObject({
      reason: "too_old",
    });
  });

  it("treats both age-window boundaries as inclusive", () => {
    const minimum = `${NOW.getUTCFullYear() - PROFILE_MIN_AGE_YEARS}-11-17`;
    const maximum = `${NOW.getUTCFullYear() - PROFILE_MAX_AGE_YEARS}-11-17`;

    expect(accepted({ birth_date: minimum }).fields.birth_date).toBe(minimum);
    expect(accepted({ birth_date: maximum }).fields.birth_date).toBe(maximum);
  });

  it("counts a birthday that has not happened yet this year as a year younger", () => {
    const notYet = `${NOW.getUTCFullYear() - PROFILE_MIN_AGE_YEARS}-11-18`;
    expect(refusal(body({ birth_date: notYet }))).toMatchObject({
      reason: "too_young",
    });
  });

  it("never echoes the submitted date", () => {
    expect(JSON.stringify(refusal(body({ birth_date: "2010-04-05" })))).not.toContain(
      "2010"
    );
  });
});

describe("country and subdivision cross-check", () => {
  it("accepts a country from the ISO dataset and clears a blank one", () => {
    expect(accepted({ country_code: "CA" }).fields.country_code).toBe("CA");
    expect(accepted({ country_code: "  " }).fields.country_code).toBeNull();
  });

  it("refuses a country the dataset does not define", () => {
    expect(refusal(body({ country_code: "ZZ" }))).toEqual({
      code: "validation",
      field: "country_code",
      reason: "not_allowed",
    });
  });

  it("refuses a subdivision with no country", () => {
    expect(refusal(body({ subdivision_code: "CA-QC" }))).toEqual({
      code: "validation",
      field: "subdivision_code",
      reason: "requires_country",
    });
  });

  it("refuses a subdivision for a country that has none", () => {
    const withoutSubdivisions = "VA";
    expect(subdivisionsFor(withoutSubdivisions)).toHaveLength(0);

    expect(
      refusal(
        body({ country_code: withoutSubdivisions, subdivision_code: "VA-01" })
      )
    ).toEqual({
      code: "validation",
      field: "subdivision_code",
      reason: "no_subdivisions",
    });
  });

  it("refuses a subdivision that belongs to another country", () => {
    expect(
      refusal(body({ country_code: "US", subdivision_code: "CA-QC" }))
    ).toEqual({
      code: "validation",
      field: "subdivision_code",
      reason: "not_allowed",
    });
  });

  it("accepts a matching pair", () => {
    const result = accepted({ country_code: "CA", subdivision_code: "CA-QC" });
    expect(result.fields.subdivision_code).toBe("CA-QC");
  });

  /* Order is the rule: an unknown country must blame the country, not the
   * subdivision that could not possibly have been checked against it. */
  it("blames the country, not the subdivision, when the country is unknown", () => {
    expect(
      refusal(body({ country_code: "ZZ", subdivision_code: "CA-QC" }))
    ).toMatchObject({ field: "country_code" });
  });

  /* And the date is checked before either, exactly as save_profile does. */
  it("reports the birth date before a bad country", () => {
    expect(
      refusal(body({ birth_date: "oops", country_code: "ZZ" }))
    ).toMatchObject({ field: "birth_date" });
  });
});

describe("income bracket and its currency", () => {
  it("accepts every allow-listed bracket with a currency", () => {
    for (const bracket of INCOME_BRACKETS) {
      expect(
        accepted({ income_bracket: bracket, income_bracket_currency: "CAD" })
          .fields.income_bracket
      ).toBe(bracket);
    }
  });

  it("accepts every allow-listed currency", () => {
    for (const currency of INCOME_BRACKET_CURRENCIES) {
      expect(
        accepted({ income_bracket_currency: currency }).fields
          .income_bracket_currency
      ).toBe(currency);
    }
  });

  it("uppercases the currency before the allow-list check", () => {
    expect(
      accepted({ income_bracket_currency: " cad " }).fields
        .income_bracket_currency
    ).toBe("CAD");
  });

  it("refuses a bracket and a currency outside their allow-lists", () => {
    expect(refusal(body({ income_bracket: "150k" }))).toEqual({
      code: "validation",
      field: "income_bracket",
      reason: "not_allowed",
    });
    expect(refusal(body({ income_bracket_currency: "XBT" }))).toEqual({
      code: "validation",
      field: "income_bracket_currency",
      reason: "not_allowed",
    });
  });

  /* Asymmetric on purpose: the bracket needs the currency, and the refusal is
   * reported against the currency the user has yet to pick. */
  it("refuses a bracket without a currency, against income_bracket_currency", () => {
    expect(refusal(body({ income_bracket: "100k_149k" }))).toEqual({
      code: "validation",
      field: "income_bracket_currency",
      reason: "required",
    });
  });

  it("permits a currency without a bracket", () => {
    const result = accepted({ income_bracket_currency: "EUR" });
    expect(result.fields.income_bracket).toBeNull();
    expect(result.fields.income_bracket_currency).toBe("EUR");
  });

  it("refuses an unknown bracket before the companion rule fires", () => {
    expect(refusal(body({ income_bracket: "nope" }))).toMatchObject({
      field: "income_bracket",
      reason: "not_allowed",
    });
  });
});

describe("every reason in the contract is reachable from a request", () => {
  /* A reason nothing can produce is a reason no client has to handle, and the
   * closed enum is what the desktop and the account app switch on. */
  const profileReasons: readonly ValidationReason[] = [
    "invalid_type",
    "invalid_format",
    "required",
    "not_allowed",
    "in_future",
    "too_young",
    "too_old",
    "requires_country",
    "no_subdivisions",
    "unknown_field",
  ];

  it("covers every profile-route reason, leaving only the avatar's own", () => {
    const produced = new Set<ValidationReason>();
    const cases: (string | undefined)[] = [
      body({ first_name: 7 }),
      body({ birth_date: "1985-3-14" }),
      body({ income_bracket: "100k_149k" }),
      body({ country_code: "ZZ" }),
      body({ birth_date: "2026-11-18" }),
      body({ birth_date: "2010-01-01" }),
      body({ birth_date: "1850-01-01" }),
      body({ subdivision_code: "CA-QC" }),
      body({ country_code: "VA", subdivision_code: "VA-01" }),
      body({ nickname: "Ada" }),
    ];

    for (const raw of cases) {
      const failure = refusal(raw);
      if (failure.code === "validation") produced.add(failure.reason);
    }

    expect([...produced].sort()).toEqual([...profileReasons].sort());
    expect(
      VALIDATION_REASONS.filter((reason) => !produced.has(reason))
    ).toEqual(["dimensions_exceeded"]);
  });
});
