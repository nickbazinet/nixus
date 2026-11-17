import {
  INCOME_BRACKETS,
  INCOME_BRACKET_CURRENCIES,
  PROFILE_BODY_MAX_BYTES,
  PROFILE_FIELD_NAMES,
  PROFILE_MAX_AGE_YEARS,
  PROFILE_MIN_AGE_YEARS,
  type IncomeBracket,
  type IncomeBracketCurrency,
  type ProfileFields,
} from "@nixus/shared";

import {
  decodeJsonBody,
  readExpectedVersion,
  readNormalizedString,
} from "./body.ts";
import { failValidation } from "./errors.ts";
import { countryExists, subdivisionsFor } from "./locations.ts";

/*
 * The server is the final validation authority (AD-5). Every rule and the ORDER
 * they run in mirror `apps/desktop/src-tauri/src/profile_store.rs::save_profile`,
 * so a document the desktop's own validator accepts is never refused here and
 * vice versa - in particular the country check runs before the subdivision check,
 * so an unknown country blames `country_code` rather than the subdivision.
 */

export interface ValidatedProfileRequest {
  readonly fields: ProfileFields;
  readonly expectedVersion: number | null;
}

const PROFILE_BODY_MEMBERS: readonly string[] = [
  ...PROFILE_FIELD_NAMES,
  "expected_version",
];

interface CalendarDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Strict, zero-padded `YYYY-MM-DD` and a real calendar date, or nothing. */
function parseCalendarDate(value: string): CalendarDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Rejects 2026-02-30 and 2026-13-01: `Date.UTC` rolls them over, so a
  // round-trip is what proves the components name the day they claim to.
  const rolled = new Date(Date.UTC(year, month - 1, day));
  if (
    rolled.getUTCFullYear() !== year ||
    rolled.getUTCMonth() !== month - 1 ||
    rolled.getUTCDate() !== day
  ) {
    return undefined;
  }

  return { year, month, day };
}

function utcToday(now: Date): CalendarDate {
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
  };
}

function isAfter(candidate: CalendarDate, other: CalendarDate): boolean {
  if (candidate.year !== other.year) return candidate.year > other.year;
  if (candidate.month !== other.month) return candidate.month > other.month;
  return candidate.day > other.day;
}

export function ageOn(birth: CalendarDate, today: CalendarDate): number {
  let age = today.year - birth.year;
  if (
    today.month < birth.month ||
    (today.month === birth.month && today.day < birth.day)
  ) {
    age -= 1;
  }
  return age;
}

export function validateBirthDate(
  value: string | null,
  now: Date
): string | null {
  if (value === null) return null;

  const birth = parseCalendarDate(value);
  if (!birth) {
    failValidation("birth_date", "invalid_format");
  }

  const today = utcToday(now);
  if (isAfter(birth, today)) {
    failValidation("birth_date", "in_future");
  }

  const age = ageOn(birth, today);
  if (age < PROFILE_MIN_AGE_YEARS) {
    failValidation("birth_date", "too_young");
  }
  if (age > PROFILE_MAX_AGE_YEARS) {
    failValidation("birth_date", "too_old");
  }

  return value;
}

export function validateCountryCode(value: string | null): string | null {
  if (value === null) return null;
  if (!countryExists(value)) {
    failValidation("country_code", "not_allowed");
  }
  return value;
}

export function validateSubdivisionCode(
  value: string | null,
  countryCode: string | null
): string | null {
  if (value === null) return null;

  if (countryCode === null) {
    failValidation("subdivision_code", "requires_country");
  }

  const subdivisions = subdivisionsFor(countryCode);
  if (subdivisions.length === 0) {
    failValidation("subdivision_code", "no_subdivisions");
  }
  if (!subdivisions.some((subdivision) => subdivision.code === value)) {
    failValidation("subdivision_code", "not_allowed");
  }

  return value;
}

export function validateIncomeBracket(
  value: string | null
): IncomeBracket | null {
  if (value === null) return null;
  if (!(INCOME_BRACKETS as readonly string[]).includes(value)) {
    failValidation("income_bracket", "not_allowed");
  }
  return value as IncomeBracket;
}

/** Uppercased BEFORE the allow-list check, as `profile_store.rs` does. */
export function validateIncomeBracketCurrency(
  value: string | null
): IncomeBracketCurrency | null {
  if (value === null) return null;

  const normalized = value.toUpperCase();
  if (!(INCOME_BRACKET_CURRENCIES as readonly string[]).includes(normalized)) {
    failValidation("income_bracket_currency", "not_allowed");
  }
  return normalized as IncomeBracketCurrency;
}

export function validateProfileRequest(
  raw: string | undefined,
  now: Date
): ValidatedProfileRequest {
  const body = decodeJsonBody({
    raw,
    maxBytes: PROFILE_BODY_MAX_BYTES,
    allowedMembers: PROFILE_BODY_MEMBERS,
  });

  const expectedVersion = readExpectedVersion(body);

  // Types first, in the contract's own field order, so a wrong-typed member is
  // never reported as a semantic refusal of a value it does not hold.
  const raws = {
    first_name: readNormalizedString(body, "first_name"),
    last_name: readNormalizedString(body, "last_name"),
    birth_date: readNormalizedString(body, "birth_date"),
    income_bracket: readNormalizedString(body, "income_bracket"),
    income_bracket_currency: readNormalizedString(
      body,
      "income_bracket_currency"
    ),
    country_code: readNormalizedString(body, "country_code"),
    subdivision_code: readNormalizedString(body, "subdivision_code"),
  };

  const birthDate = validateBirthDate(raws.birth_date, now);
  const countryCode = validateCountryCode(raws.country_code);
  const subdivisionCode = validateSubdivisionCode(
    raws.subdivision_code,
    countryCode
  );
  const incomeBracket = validateIncomeBracket(raws.income_bracket);
  const incomeBracketCurrency = validateIncomeBracketCurrency(
    raws.income_bracket_currency
  );

  // Asymmetric by design: a bracket without a currency is refused against the
  // currency the user has yet to pick, while a currency without a bracket is
  // permitted and inert.
  if (incomeBracket !== null && incomeBracketCurrency === null) {
    failValidation("income_bracket_currency", "required");
  }

  return {
    expectedVersion,
    fields: {
      first_name: raws.first_name,
      last_name: raws.last_name,
      birth_date: birthDate,
      income_bracket: incomeBracket,
      income_bracket_currency: incomeBracketCurrency,
      country_code: countryCode,
      subdivision_code: subdivisionCode,
    },
  };
}
