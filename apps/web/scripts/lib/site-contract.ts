/**
 * The public-identity contract the built site is verified against.
 *
 * Deliberately independent of `src/lib/site.ts` and `src/lib/routes.ts`: these
 * verifiers exist to catch the application drifting off the intended identity,
 * so their expected values are declared here rather than read back out of the
 * code under test.
 */

export const EXPECTED_ORIGIN = "https://nixusapp.com";
export const EXPECTED_REPOSITORY_URL = "https://github.com/nickbazinet/nixus";

/** Hostnames retired from the site's identity; must not appear in output. */
export const RETIRED_ORIGINS = ["https://nixus.nicolasbazinet.net"] as const;

export type ExpectedLocale = "en" | "fr";

/** `<html lang>` and `hreflang`, per locale. Regional: the copy is Canadian. */
export const EXPECTED_LANG_TAG: Record<ExpectedLocale, string> = {
  en: "en-CA",
  fr: "fr-CA",
};

export const EXPECTED_OG_LOCALE: Record<ExpectedLocale, string> = {
  en: "en_CA",
  fr: "fr_CA",
};

export type ExpectedRoute = {
  /** Canonical path, exactly as it must appear in canonical/og:url. */
  canonicalPath: string;
  locale: ExpectedLocale;
  /** Prerendered object, relative to the static output root. */
  htmlFile: string;
  /** Distinctive body copy that only this locale's bundle produces. */
  localeMarker: string;
  /** hreflang alternates this route must advertise. */
  alternates: Record<ExpectedLocale, string>;
};

/**
 * The skip link, which the shell renders on every page in both languages. It is
 * the one string guaranteed present no matter what a page's own copy says, so a
 * page that prerendered through the wrong locale is caught even if the rest of
 * its content happens to be brand names.
 */
const MARKER: Record<ExpectedLocale, string> = {
  en: "Skip to main content",
  fr: "Aller au contenu principal",
};

/**
 * One entry per page per language, English first.
 *
 * The French slug is the English slug under `/fr`, and a language root carries
 * its trailing slash — `/fr/`, never `/fr` — because that is the object the
 * prerender writes and therefore the only URL worth advertising.
 */
const PAGE_SLUGS: readonly string[] = [
  "/",
  "/features",
  "/pricing",
  "/mission",
  "/privacy",
  "/founding-users",
  "/download",
  "/terms",
  "/privacy-policy",
  "/404",
];

function frenchPath(enPath: string): string {
  return enPath === "/" ? "/fr/" : `/fr${enPath}`;
}

function htmlFile(canonicalPath: string): string {
  return canonicalPath.endsWith("/")
    ? `${canonicalPath.slice(1)}index.html`
    : `${canonicalPath.slice(1)}/index.html`;
}

function route(canonicalPath: string, locale: ExpectedLocale, enPath: string): ExpectedRoute {
  return {
    canonicalPath,
    locale,
    htmlFile: htmlFile(canonicalPath),
    localeMarker: MARKER[locale],
    alternates: { en: enPath, fr: frenchPath(enPath) },
  };
}

export const EXPECTED_ROUTES: readonly ExpectedRoute[] = PAGE_SLUGS.flatMap((enPath) => [
  route(enPath, "en", enPath),
  route(frenchPath(enPath), "fr", enPath),
]);

/** Paths the sitemap is expected to advertise: indexable routes only. */
export const SITEMAP_PATHS: readonly string[] = EXPECTED_ROUTES.filter(
  (route) => !route.canonicalPath.endsWith("/404"),
).map((route) => route.canonicalPath);
