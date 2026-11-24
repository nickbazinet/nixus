/**
 * Offline SEO/locale contract check over the prerendered output.
 *
 * Reads `.output/public` from disk — no server, no network — and fails the
 * build when a route's HTML language, body locale, canonical URL, Open Graph
 * URL, `hreflang` cluster or JSON-LD disagree with each other, with the route,
 * or with the canonical origin.
 *
 * Run: pnpm --filter @nixus/web verify:prerender
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  alternateHrefs,
  htmlLang,
  jsonLdPayloads,
  linkHrefs,
  metaContent,
  visibleText,
} from "./lib/html-contract.ts";
import {
  EXPECTED_LANG_TAG,
  EXPECTED_OG_LOCALE,
  EXPECTED_ORIGIN,
  EXPECTED_REPOSITORY_URL,
  EXPECTED_ROUTES,
  RETIRED_ORIGINS,
  SITEMAP_PATHS,
  type ExpectedLocale,
  type ExpectedRoute,
} from "./lib/site-contract.ts";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const failures: string[] = [];

/**
 * Phrases only one language's bundle can produce, picked from copy the shell
 * renders on every page (the skip link, the footer tagline, the OG image alt)
 * plus a couple of page-level headlines. Deliberately free of apostrophes:
 * React's SSR escapes `'` to `&#x27;`, so a phrase containing one would never
 * match the HTML it is meant to catch.
 */
const LOCALE_ONLY_PHRASES: Record<ExpectedLocale, readonly string[]> = {
  en: [
    "Skip to main content",
    "minus the admin",
    "Free on your computer",
    "Compare the plans",
    "Pricing questions",
    "Start 7-day free trial",
  ],
  fr: [
    "Aller au contenu principal",
    "moins la paperasse",
    "Gratuit sur votre ordinateur",
    "Comparer les forfaits",
    "Questions sur les tarifs",
    "Utilisateurs fondateurs",
  ],
};

function check(scope: string, condition: boolean, detail: string): void {
  if (condition) return;
  failures.push(`${scope}: ${detail}`);
}

function read(relativePath: string): string {
  return readFileSync(`${WEB_ROOT}${relativePath}`, "utf8");
}

function otherLocale(locale: ExpectedLocale): ExpectedLocale {
  return locale === "en" ? "fr" : "en";
}

function checkJsonLd(scope: string, html: string, locale: ExpectedLocale): void {
  const payloads = jsonLdPayloads(html);
  check(scope, payloads.length === 1, `expected 1 ld+json block, got ${payloads.length}`);
  if (payloads.length !== 1) return;

  const parsed: unknown = JSON.parse(payloads[0]);
  if (typeof parsed !== "object" || parsed === null) {
    check(scope, false, "ld+json is not an object");
    return;
  }
  const graph = (parsed as { "@graph"?: unknown })["@graph"];
  if (!Array.isArray(graph)) {
    check(scope, false, "ld+json has no @graph array");
    return;
  }
  const types = graph.map((node) => (node as { "@type"?: string })["@type"]);
  check(scope, types.includes("WebSite"), `@graph is missing WebSite (${types.join(", ")})`);
  check(
    scope,
    types.includes("Organization"),
    `@graph is missing Organization (${types.join(", ")})`,
  );

  // The graph is embedded in one document, so claiming any language other than
  // this page's own contradicts its <html lang> and its hreflang cluster.
  const website = graph.find((node) => (node as { "@type"?: string })["@type"] === "WebSite");
  const inLanguage = (website as { inLanguage?: unknown } | undefined)?.inLanguage;
  check(
    scope,
    inLanguage === EXPECTED_LANG_TAG[locale],
    `ld+json inLanguage is ${JSON.stringify(inLanguage)}, expected ${EXPECTED_LANG_TAG[locale]}`,
  );

  for (const url of payloads[0].match(/https?:\/\/[^"]+/g) ?? []) {
    check(
      scope,
      url.startsWith(`${EXPECTED_ORIGIN}/`) ||
        url === "https://schema.org" ||
        url === EXPECTED_REPOSITORY_URL,
      `ld+json references off-origin URL ${url}`,
    );
  }
}

function checkAlternates(scope: string, html: string, route: ExpectedRoute): void {
  const alternates = alternateHrefs(html);
  const expected = new Map<string, string>([
    [EXPECTED_LANG_TAG.en, `${EXPECTED_ORIGIN}${route.alternates.en}`],
    [EXPECTED_LANG_TAG.fr, `${EXPECTED_ORIGIN}${route.alternates.fr}`],
    // English is what an unmatched visitor gets, which is what x-default means.
    ["x-default", `${EXPECTED_ORIGIN}${route.alternates.en}`],
  ]);

  check(
    scope,
    alternates.size === expected.size,
    `advertises ${alternates.size} hreflang alternates (${[...alternates.keys()].join(", ")}), expected ${[...expected.keys()].join(", ")}`,
  );
  for (const [hrefLang, href] of expected) {
    check(
      scope,
      alternates.get(hrefLang) === href,
      `hreflang="${hrefLang}" is ${alternates.get(hrefLang)}, expected ${href}`,
    );
  }
}

function checkNoLeakedLanguage(scope: string, html: string, locale: ExpectedLocale): void {
  const haystack = html.toLowerCase();
  for (const phrase of LOCALE_ONLY_PHRASES[otherLocale(locale)]) {
    check(
      scope,
      !haystack.includes(phrase.toLowerCase()),
      `contains ${otherLocale(locale)}-only copy "${phrase}"`,
    );
  }
  // The same list, positively: the page must carry its own language's copy.
  const own = LOCALE_ONLY_PHRASES[locale][0];
  check(scope, haystack.includes(own.toLowerCase()), `is missing ${locale} copy "${own}"`);
}

function checkRoute(route: ExpectedRoute): void {
  const scope = route.canonicalPath;
  const html = read(`.output/public/${route.htmlFile}`);
  const canonicalUrl = `${EXPECTED_ORIGIN}${route.canonicalPath}`;
  const expectedLang = EXPECTED_LANG_TAG[route.locale];

  check(scope, htmlLang(html) === expectedLang, `<html lang> is ${htmlLang(html)}, expected ${expectedLang}`);
  check(
    scope,
    visibleText(html).includes(route.localeMarker),
    `body copy is not ${route.locale}: missing "${route.localeMarker}"`,
  );

  const canonicals = linkHrefs(html, "canonical");
  check(scope, canonicals.length === 1, `expected 1 canonical link, got ${canonicals.length}`);
  check(scope, canonicals[0] === canonicalUrl, `canonical is ${canonicals[0]}, expected ${canonicalUrl}`);

  const ogUrl = metaContent(html, { property: "og:url" });
  check(scope, ogUrl === canonicalUrl, `og:url is ${ogUrl}, expected ${canonicalUrl}`);

  const ogLocale = metaContent(html, { property: "og:locale" });
  check(
    scope,
    ogLocale === EXPECTED_OG_LOCALE[route.locale],
    `og:locale is ${ogLocale}, expected ${EXPECTED_OG_LOCALE[route.locale]}`,
  );
  const ogAlternate = metaContent(html, { property: "og:locale:alternate" });
  check(
    scope,
    ogAlternate === EXPECTED_OG_LOCALE[otherLocale(route.locale)],
    `og:locale:alternate is ${ogAlternate}, expected ${EXPECTED_OG_LOCALE[otherLocale(route.locale)]}`,
  );

  checkAlternates(scope, html, route);
  checkNoLeakedLanguage(scope, html, route.locale);

  for (const retired of RETIRED_ORIGINS) {
    check(scope, !html.includes(retired), `still references retired origin ${retired}`);
  }

  checkJsonLd(scope, html, route.locale);
}

function checkCrawlerFiles(): void {
  const robots = read("public/robots.txt");
  check(
    "robots.txt",
    robots.includes(`Sitemap: ${EXPECTED_ORIGIN}/sitemap.xml`),
    `does not advertise ${EXPECTED_ORIGIN}/sitemap.xml`,
  );

  const sitemap = read("public/sitemap.xml");
  const locations = Array.from(
    sitemap.matchAll(/<loc>([^<]+)<\/loc>/g),
    (match) => match[1],
  );
  check(
    "sitemap.xml",
    locations.join("|") === SITEMAP_PATHS.map((path) => `${EXPECTED_ORIGIN}${path}`).join("|"),
    `lists ${locations.join(", ")}`,
  );

  for (const retired of RETIRED_ORIGINS) {
    check("robots.txt", !robots.includes(retired), `still references ${retired}`);
    check("sitemap.xml", !sitemap.includes(retired), `still references ${retired}`);
  }
}

for (const route of EXPECTED_ROUTES) {
  checkRoute(route);
}
checkCrawlerFiles();

if (failures.length > 0) {
  console.error(`verify:prerender — ${failures.length} contract violation(s):`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  throw new Error("prerender contract verification failed");
}

console.log(
  `verify:prerender — ${EXPECTED_ROUTES.length} routes on ${EXPECTED_ORIGIN}: language, canonical, og:url, hreflang and JSON-LD agree.`,
);
