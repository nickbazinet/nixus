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

export type ExpectedLocale = "en";

export type ExpectedRoute = {
  /** Canonical path, exactly as it must appear in canonical/og:url. */
  canonicalPath: string;
  locale: ExpectedLocale;
  /** Prerendered object, relative to the static output root. */
  htmlFile: string;
  /** Distinctive body copy the shell always renders. */
  localeMarker: string;
};

const MARKER = "Skip to main content";

function route(canonicalPath: string): ExpectedRoute {
  const htmlFile = canonicalPath === "/" ? "index.html" : `${canonicalPath.slice(1)}/index.html`;
  return { canonicalPath, locale: "en", htmlFile, localeMarker: MARKER };
}

export const EXPECTED_ROUTES: readonly ExpectedRoute[] = [
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
].map(route);

/** Paths the sitemap is expected to advertise: indexable routes only. */
export const SITEMAP_PATHS: readonly string[] = EXPECTED_ROUTES.filter(
  (route) => !route.canonicalPath.endsWith("/404"),
).map((route) => route.canonicalPath);
