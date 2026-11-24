/**
 * Every page of the site, in both languages, in one table.
 *
 * Two shapes come out of the same entry, and they differ for exactly one page:
 *
 * - **Router targets** (`PAGE_PATH`, `pagePath`) are what `<Link to>` takes.
 *   The generated route tree spells the French index `"/fr"` in its `to` union,
 *   so that is the only spelling the router accepts. They are declared
 *   `as const` so each path keeps its literal type and a typo fails compilation
 *   instead of shipping a dead link.
 * - **Canonical paths** (`canonicalPath`) are what `canonical`, `og:url`,
 *   `hreflang` and the sitemap emit. A language root is canonically `/` or
 *   `/fr/` *with* the trailing slash, matching the prerendered
 *   `fr/index.html`. Advertising `/fr` as the canonical would name a second URL
 *   for a page that already has one.
 *
 * French reuses the English slug on purpose. `apps/account` already links out
 * to `nixusapp.com/fr/pricing`, `/fr/features`, `/fr/terms` and friends
 * (`apps/account/src/lib/marketing.ts`), so translated slugs would break links
 * that are already deployed.
 */

import { LOCALES, type Locale } from "./locale";

export const PAGES = [
  "home",
  "features",
  "pricing",
  "mission",
  "privacy",
  "foundingUsers",
  "download",
  "terms",
  "privacyPolicy",
  "notFound",
] as const;

export type PageId = (typeof PAGES)[number];

export const PAGE_PATH = {
  home: { en: "/", fr: "/fr" },
  features: { en: "/features", fr: "/fr/features" },
  pricing: { en: "/pricing", fr: "/fr/pricing" },
  mission: { en: "/mission", fr: "/fr/mission" },
  privacy: { en: "/privacy", fr: "/fr/privacy" },
  foundingUsers: { en: "/founding-users", fr: "/fr/founding-users" },
  download: { en: "/download", fr: "/fr/download" },
  terms: { en: "/terms", fr: "/fr/terms" },
  privacyPolicy: { en: "/privacy-policy", fr: "/fr/privacy-policy" },
  notFound: { en: "/404", fr: "/fr/404" },
} as const satisfies Record<PageId, Record<Locale, string>>;

/**
 * The router target for one page in one language.
 *
 * The inferred return type is the literal union of that page's two paths, so it
 * stays assignable to the router's `to` and an unregistered page is a compile
 * error rather than a 404 nobody notices.
 */
export function pagePath<P extends PageId>(page: P, locale: Locale) {
  const paths = PAGE_PATH[page];
  return locale === "fr" ? paths.fr : paths.en;
}

/** The one page that must never rank, in either language. */
const NOINDEX_PAGES: readonly PageId[] = ["notFound"];

export function isNoindex(page: PageId): boolean {
  return NOINDEX_PAGES.includes(page);
}

/** Canonical path for a page: the router target, with a language root slashed. */
export function canonicalPath(page: PageId, locale: Locale): string {
  const path: string = PAGE_PATH[page][locale];
  return path === "/fr" ? "/fr/" : path;
}

/**
 * Both canonical paths for a page, which is what `hreflang` needs at once.
 *
 * Every page advertises the full cluster plus `x-default`, so the set is
 * reciprocal in both directions — a one-sided alternate is a cluster Google
 * discards.
 */
export function canonicalAlternates(page: PageId): Record<Locale, string> {
  return { en: canonicalPath(page, "en"), fr: canonicalPath(page, "fr") };
}

/** Drop a trailing slash, so `/fr` and `/fr/` compare equal. */
function normalize(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

/** The page a pathname belongs to, in either spelling, or `null` if unknown. */
export function pageFromPath(pathname: string): PageId | null {
  const wanted = normalize(pathname);
  for (const page of PAGES) {
    for (const locale of LOCALES) {
      if (normalize(PAGE_PATH[page][locale]) === wanted) return page;
    }
  }
  return null;
}

/**
 * The equivalent page in `target`, for the header's language switcher.
 *
 * A canonical path, because the switcher is a plain `<a href>` and the browser
 * is about to request that exact URL. An unrecognised path falls back to that
 * language's home, which is the only honest answer when there is no twin.
 */
export function switchLocalePath(pathname: string, target: Locale): string {
  return canonicalPath(pageFromPath(pathname) ?? "home", target);
}
