/**
 * Single source of truth for the site's public identity.
 *
 * Lives in its own leaf module (no imports) so `meta`, `jsonLd` and the link
 * helpers can all depend on it without forming an import cycle.
 *
 * `SITE.url` is the origin only — never a trailing slash. Every consumer goes
 * through `absoluteUrl()` so the root URL is emitted as `<origin>/` in exactly
 * one shape across canonical, og:url, sitemap and JSON-LD.
 */

export const SITE = {
  name: "Nixus",
  defaultTitle: "Nixus — Personal finance, minus the admin",
  defaultDescription:
    "Nixus subtracts the spreadsheets, the chaos and the stress. Drop in a credit card statement and get a clear picture of where you stand and what to do next. Free on your computer, no bank logins.",
  url: "https://nixusapp.com",
  ogImage: "https://nixusapp.com/og-image.png",
  /** This repository's public home — the `origin` remote, also linked site-wide. */
  repositoryUrl: "https://github.com/nickbazinet/nixus",
} as const;

/** Absolute site URL for a root-relative path (`"/"` → `"<origin>/"`). */
export function absoluteUrl(path: string): string {
  return `${SITE.url}${path}`;
}
