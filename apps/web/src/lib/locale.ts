/**
 * The two languages the marketing site ships in.
 *
 * English lives at the root and French under `/fr`, with identical slugs on
 * both sides (`/pricing` ⇄ `/fr/pricing`). The URL is the *only* locale
 * authority: the site is fully prerendered, so a stored preference or an
 * `Accept-Language` redirect would hand a crawler a different page than the one
 * it asked for. A visitor changes language with the header switcher, which is a
 * real navigation to the other language's own URL.
 *
 * A leaf module with no imports, so `routes`, `meta`, `jsonLd` and the content
 * dictionary can all depend on it without forming a cycle.
 */

export const LOCALES = ["en", "fr"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/**
 * `<html lang>` and `hreflang` values. Regional rather than bare `en`/`fr`
 * because the copy is Canadian on both sides: amounts are CAD, and the product
 * is built around TFSA/RRSP/FHSA (CELI/REER/CELIAPP).
 */
export const LANG_TAG = {
  en: "en-CA",
  fr: "fr-CA",
} as const satisfies Record<Locale, string>;

/** Open Graph spells the same tags with an underscore. */
export const OG_LOCALE = {
  en: "en_CA",
  fr: "fr_CA",
} as const satisfies Record<Locale, string>;

// Matches the FR prefix only on a route boundary, so `/frobnicate` stays EN
// while `/fr`, `/fr/` and `/fr/pricing` resolve to FR.
const FR_ROUTE_PREFIX = /^\/fr(?=\/|$)/;

/**
 * Resolve the locale that owns a route from its pathname alone.
 *
 * The pathname is the only order-independent locale signal during prerender,
 * which renders every route through one module with a concurrency pool. Reading
 * locale from any mutable shared state is how an English page ends up serving
 * French HTML.
 */
export function localeFromPath(pathname: string): Locale {
  return FR_ROUTE_PREFIX.test(pathname) ? "fr" : "en";
}

/** The other language, for `og:locale:alternate` and the language switcher. */
export function otherLocale(locale: Locale): Locale {
  return locale === "en" ? "fr" : "en";
}
