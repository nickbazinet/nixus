import type {
  LocationCountry,
  LocationSubdivision,
  LocationsResponse,
} from "@nixus/shared";

/*
 * `GET /locations` and the country/subdivision half of AD-5's validation, both
 * served from the one bundled ISO 3166 dataset. The import is a relative path
 * into `packages/shared/data/` rather than a copy: a second `iso3166*.json`
 * anywhere in the repository fails a test in `@nixus/shared`.
 */
import dataset from "../../../../packages/shared/data/iso3166.json";

const COUNTRIES: readonly LocationCountry[] = dataset.countries;

const BY_CODE: ReadonlyMap<string, LocationCountry> = new Map(
  COUNTRIES.map((country) => [country.code, country])
);

const NO_SUBDIVISIONS: readonly LocationSubdivision[] = [];

export function countryExists(code: string): boolean {
  return BY_CODE.has(code);
}

export function subdivisionsFor(
  countryCode: string
): readonly LocationSubdivision[] {
  return BY_CODE.get(countryCode)?.subdivisions ?? NO_SUBDIVISIONS;
}

export function locationsResponse(): LocationsResponse {
  return { countries: COUNTRIES };
}

/** Build-time assertion hook: the Makefile refuses an artifact with no catalog. */
export function bundledCountryCount(): number {
  return COUNTRIES.length;
}
