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

/**
 * Per-locale pricing paths, used as each other's hreflang alternates. A record
 * as well as a function because `head()` needs the pair at once, exactly the
 * way `TERMS_PAGE_PATHS` is consumed.
 */
export const PRICING_PAGE_PATHS: Record<Locale, string> = {
  en: "/pricing",
  fr: "/fr/pricing",
};

/** Pricing page path for the given locale. */
export function pricingPagePath(locale: Locale): string {
  return PRICING_PAGE_PATHS[locale];
}

/**
 * The account app, which is a separate origin with its own deploy (AD-10).
 *
 * A plain cross-origin link with a neutral label, and nothing more: the marketing
 * site reads no session and renders no signed-in state, so it stays fully static
 * and cacheable. Signed-in state on this site is explicitly deferred.
 */
export function accountAppUrl(locale: Locale): string {
  return locale === "fr"
    ? "https://account.nixusapp.com/fr"
    : "https://account.nixusapp.com";
}

/**
 * Where a pricing-page plan button sends a visitor.
 *
 * The checkout flow itself lives in the account app (AD-8 keeps every commerce
 * surface Stripe-hosted and out of this origin), so the marketing site only
 * hands over which plan was chosen. A plan travels as its `lookup_key`, never
 * as a Stripe `price_id` — AD-6 keeps price identity in the Dashboard.
 */
export function billingPlanUrl(locale: Locale, planLookupKey: string): string {
  return `${accountAppUrl(locale)}/billing?plan=${encodeURIComponent(planLookupKey)}`;
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
