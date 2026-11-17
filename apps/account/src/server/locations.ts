import type { LocationCountry, LocationsResponse } from "@nixus/shared";

import type { ProfileApi } from "./profile-client.ts";

/**
 * Server-side ISO 3166 catalog cache.
 *
 * The catalog is ~570 KB of JSON and identical for every user, so it is fetched
 * once per warm container and never sent to the browser whole: the form receives a
 * country list, and a country's subdivisions only once that country is selected.
 */

export interface LocationOption {
  readonly code: string;
  readonly name: string;
}

export type CatalogLocale = "en" | "fr";

let cached: LocationsResponse | null = null;

export async function loadCatalog(api: ProfileApi): Promise<LocationsResponse | null> {
  if (cached) return cached;
  const result = await api.getLocations();
  if (!result.ok) return null;
  cached = result.value;
  return cached;
}

function label(entry: { name_en: string; name_fr: string | null }, locale: CatalogLocale): string {
  return locale === "fr" ? (entry.name_fr ?? entry.name_en) : entry.name_en;
}

function byName(left: LocationOption, right: LocationOption): number {
  return left.name.localeCompare(right.name);
}

export function countryOptions(
  catalog: LocationsResponse,
  locale: CatalogLocale,
): readonly LocationOption[] {
  return catalog.countries
    .map((country) => ({ code: country.code, name: label(country, locale) }))
    .sort(byName);
}

function findCountry(
  catalog: LocationsResponse,
  countryCode: string,
): LocationCountry | undefined {
  return catalog.countries.find((country) => country.code === countryCode);
}

export function subdivisionOptions(
  catalog: LocationsResponse,
  countryCode: string | null,
  locale: CatalogLocale,
): readonly LocationOption[] {
  if (countryCode === null) return [];
  const country = findCountry(catalog, countryCode);
  if (!country) return [];
  return country.subdivisions
    .map((subdivision) => ({ code: subdivision.code, name: label(subdivision, locale) }))
    .sort(byName);
}

/** Test seam: the cache is a module singleton by design on a warm container. */
export function __resetCatalogForTests(): void {
  cached = null;
}
