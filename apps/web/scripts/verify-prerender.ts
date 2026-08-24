/**
 * Offline SEO/locale contract check over the prerendered output.
 *
 * Reads `.output/public` from disk — no server, no network — and fails the
 * build when a route's HTML language, body locale, canonical URL, Open Graph
 * URL, hreflang alternates or JSON-LD disagree with each other, with the route,
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
  EXPECTED_ORIGIN,
  EXPECTED_REPOSITORY_URL,
  EXPECTED_ROUTES,
  RETIRED_ORIGINS,
  SITEMAP_PATHS,
  type ExpectedRoute,
} from "./lib/site-contract.ts";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const failures: string[] = [];

function check(scope: string, condition: boolean, detail: string): void {
  if (condition) return;
  failures.push(`${scope}: ${detail}`);
}

function read(relativePath: string): string {
  return readFileSync(`${WEB_ROOT}${relativePath}`, "utf8");
}

function checkJsonLd(scope: string, html: string): void {
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

function checkRoute(route: ExpectedRoute): void {
  const scope = route.canonicalPath;
  const html = read(`.output/public/${route.htmlFile}`);
  const canonicalUrl = `${EXPECTED_ORIGIN}${route.canonicalPath}`;

  check(scope, htmlLang(html) === route.locale, `<html lang> is ${htmlLang(html)}, expected ${route.locale}`);
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

  const alternates = alternateHrefs(html);
  for (const [hrefLang, path] of [
    ["en", route.alternates.en],
    ["fr", route.alternates.fr],
    ["x-default", route.alternates.en],
  ] as const) {
    const expected = `${EXPECTED_ORIGIN}${path}`;
    check(
      scope,
      alternates.get(hrefLang) === expected,
      `hreflang="${hrefLang}" is ${alternates.get(hrefLang)}, expected ${expected}`,
    );
  }

  for (const retired of RETIRED_ORIGINS) {
    check(scope, !html.includes(retired), `still references retired origin ${retired}`);
  }

  checkJsonLd(scope, html);
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
