/**
 * The public-identity contract the built site is verified against.
 *
 * Deliberately independent of `src/lib/site.ts`: these verifiers exist to catch
 * the application drifting off the intended identity, so their expected values
 * are declared here rather than read back out of the code under test.
 */

export const EXPECTED_ORIGIN = "https://nixusapp.com";
export const EXPECTED_REPOSITORY_URL = "https://github.com/nickbazinet/nixus";

/** Hostnames retired from the site's identity; must not appear in output. */
export const RETIRED_ORIGINS = ["https://nixus.nicolasbazinet.net"] as const;

export type ExpectedLocale = "en" | "fr";

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

const HOME_ALTERNATES: Record<ExpectedLocale, string> = { en: "/", fr: "/fr/" };
const BETA_ALTERNATES: Record<ExpectedLocale, string> = {
  en: "/beta",
  fr: "/fr/beta",
};
const NOT_FOUND_ALTERNATES: Record<ExpectedLocale, string> = {
  en: "/404",
  fr: "/fr/404",
};
const TERMS_ALTERNATES: Record<ExpectedLocale, string> = {
  en: "/terms",
  fr: "/fr/terms",
};
const PRIVACY_ALTERNATES: Record<ExpectedLocale, string> = {
  en: "/privacy",
  fr: "/fr/privacy",
};

const MARKER: Record<ExpectedLocale, string> = {
  en: "Skip to main content",
  fr: "Aller au contenu principal",
};

export const EXPECTED_ROUTES: readonly ExpectedRoute[] = [
  {
    canonicalPath: "/",
    locale: "en",
    htmlFile: "index.html",
    localeMarker: MARKER.en,
    alternates: HOME_ALTERNATES,
  },
  {
    canonicalPath: "/fr/",
    locale: "fr",
    htmlFile: "fr/index.html",
    localeMarker: MARKER.fr,
    alternates: HOME_ALTERNATES,
  },
  {
    canonicalPath: "/beta",
    locale: "en",
    htmlFile: "beta/index.html",
    localeMarker: MARKER.en,
    alternates: BETA_ALTERNATES,
  },
  {
    canonicalPath: "/fr/beta",
    locale: "fr",
    htmlFile: "fr/beta/index.html",
    localeMarker: MARKER.fr,
    alternates: BETA_ALTERNATES,
  },
  {
    canonicalPath: "/terms",
    locale: "en",
    htmlFile: "terms/index.html",
    localeMarker: MARKER.en,
    alternates: TERMS_ALTERNATES,
  },
  {
    canonicalPath: "/fr/terms",
    locale: "fr",
    htmlFile: "fr/terms/index.html",
    localeMarker: MARKER.fr,
    alternates: TERMS_ALTERNATES,
  },
  {
    canonicalPath: "/privacy",
    locale: "en",
    htmlFile: "privacy/index.html",
    localeMarker: MARKER.en,
    alternates: PRIVACY_ALTERNATES,
  },
  {
    canonicalPath: "/fr/privacy",
    locale: "fr",
    htmlFile: "fr/privacy/index.html",
    localeMarker: MARKER.fr,
    alternates: PRIVACY_ALTERNATES,
  },
  {
    canonicalPath: "/404",
    locale: "en",
    htmlFile: "404/index.html",
    localeMarker: MARKER.en,
    alternates: NOT_FOUND_ALTERNATES,
  },
  {
    canonicalPath: "/fr/404",
    locale: "fr",
    htmlFile: "fr/404/index.html",
    localeMarker: MARKER.fr,
    alternates: NOT_FOUND_ALTERNATES,
  },
];

/** Paths the sitemap is expected to advertise: indexable routes only. */
export const SITEMAP_PATHS: readonly string[] = EXPECTED_ROUTES.filter(
  (route) => !route.canonicalPath.endsWith("/404"),
).map((route) => route.canonicalPath);
