import type { Locale } from "@/lib/site";

// Matches the FR prefix only on a route boundary, so `/frobnicate` stays EN
// while `/fr`, `/fr/` and `/fr/beta` resolve to FR.
const FR_ROUTE_PREFIX = /^\/fr(?=\/|$)/;

/** Return the locale-aware path prefix for marketing routes. */
export function localePrefix(locale: Locale): string {
  return locale === "fr" ? "/fr" : "";
}

/** Beta program page path for the given locale. */
export function betaPagePath(locale: Locale): string {
  return locale === "fr" ? "/fr/beta" : "/beta";
}

/** Home path for the given locale. */
export function homePath(locale: Locale): string {
  return locale === "fr" ? "/fr/" : "/";
}

/**
 * Per-locale 404 paths, used as each other's hreflang alternates. Falling back
 * to the home alternates advertises `/` as the French counterpart of `/404`,
 * a non-reciprocal cluster that Google discards.
 */
export const NOT_FOUND_PAGE_PATHS: Record<Locale, string> = {
  en: "/404",
  fr: "/fr/404",
};

/** Resolve locale from i18n language tag. */
export function localeFromLanguage(language: string | undefined): Locale {
  return language?.startsWith("fr") ? "fr" : "en";
}

/**
 * Resolve the locale that owns a route, from its pathname alone.
 *
 * The URL is the only order-independent locale signal during prerender, so
 * this is what `<html lang>` and the i18n provider derive from.
 */
export function localeFromPath(pathname: string): Locale {
  return FR_ROUTE_PREFIX.test(pathname) ? "fr" : "en";
}
