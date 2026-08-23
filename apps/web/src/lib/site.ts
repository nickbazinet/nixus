/**
 * Single source of truth for the site's public identity.
 *
 * Lives in its own leaf module (no imports) so `meta`, `jsonLd`, `i18n` and
 * `localePaths` can all depend on it without forming an import cycle.
 *
 * `SITE.url` is the origin only — never a trailing slash. Every consumer goes
 * through `absoluteUrl()` so the root URL is emitted as `<origin>/` in exactly
 * one shape across canonical, og:url, hreflang, sitemap and JSON-LD.
 */

export type Locale = "en" | "fr";

export const SITE = {
  name: "Nixus",
  defaultTitle: "Nixus — Local financial copilot for Canadians",
  defaultDescription:
    "Automate spreadsheet upkeep without bank passwords. Upload statements, get next-action guidance, track budget and net worth locally. Finance and car in one desktop app.",
  url: "https://nixusapp.com",
  ogImage: "https://nixusapp.com/og-image.png",
  twitterHandle: "",
  /** This repository's public home — the `origin` remote, also linked site-wide. */
  repositoryUrl: "https://github.com/nickbazinet/nixus",
} as const;

/** Path prefix for each locale. EN lives at the root; FR under /fr/. */
export const LOCALE_PATH: Record<Locale, string> = {
  en: "/",
  fr: "/fr/",
};

/** Absolute site URL for a root-relative path (`"/"` → `"<origin>/"`). */
export function absoluteUrl(path: string): string {
  return `${SITE.url}${path}`;
}
