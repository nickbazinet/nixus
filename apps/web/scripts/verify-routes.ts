/**
 * Offline proof that the CloudFront viewer-request rewrite resolves every
 * public route to an object that actually exists in the static output, and
 * leaves asset URIs alone.
 *
 * Sitemap-advertised paths are the crawler's contract, so they are the input:
 * a route in the sitemap that the edge cannot resolve is a 404 in Search
 * Console. Run: pnpm --filter @nixus/web verify:routes
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  loadRewriteHandler,
  rewriteUri,
} from "../infra/cloudfront/loadRewriteHandler.ts";
import {
  EXPECTED_ORIGIN,
  EXPECTED_ROUTES,
} from "./lib/site-contract.ts";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));
const STATIC_ROOT = `${WEB_ROOT}.output/public`;
const rewrite = loadRewriteHandler();
const failures: string[] = [];

function check(scope: string, condition: boolean, detail: string): void {
  if (condition) return;
  failures.push(`${scope}: ${detail}`);
}

function sitemapPaths(): string[] {
  const sitemap = readFileSync(`${WEB_ROOT}public/sitemap.xml`, "utf8");
  return Array.from(
    sitemap.matchAll(/<loc>([^<]+)<\/loc>/g),
    (match) => match[1].slice(EXPECTED_ORIGIN.length),
  );
}

function checkRoutesResolve(paths: readonly string[], source: string): void {
  for (const path of paths) {
    const uri = rewriteUri(rewrite, path);
    check(
      `${source} ${path}`,
      existsSync(`${STATIC_ROOT}${uri}`),
      `rewrites to ${uri}, which is not in the static output`,
    );
  }
}

function checkAssetsPassThrough(): void {
  for (const asset of [
    "/robots.txt",
    "/sitemap.xml",
    "/og-image.png",
    "/favicon.svg",
    "/favicon.ico",
    "/icon-512.png",
    "/apple-touch-icon.png",
  ]) {
    const uri = rewriteUri(rewrite, asset);
    check(`asset ${asset}`, uri === asset, `was rewritten to ${uri}`);
    check(
      `asset ${asset}`,
      existsSync(`${STATIC_ROOT}${uri}`),
      "is missing from the static output",
    );
  }
}

function checkUnknownRouteIsNotHomepage(): void {
  for (const unknown of ["/does-not-exist", "/fr/does-not-exist"]) {
    const uri = rewriteUri(rewrite, unknown);
    check(`unknown ${unknown}`, uri !== "/index.html", "was mapped to the homepage");
    check(
      `unknown ${unknown}`,
      !existsSync(`${STATIC_ROOT}${uri}`),
      `resolved to an existing object (${uri}), so CloudFront would answer 200`,
    );
  }
}

const sitemapRoutes = sitemapPaths();
check("sitemap.xml", sitemapRoutes.length > 0, "advertises no routes");
checkRoutesResolve(sitemapRoutes, "sitemap");
checkRoutesResolve(
  EXPECTED_ROUTES.map((route) => route.canonicalPath),
  "route",
);
checkAssetsPassThrough();
checkUnknownRouteIsNotHomepage();

if (failures.length > 0) {
  console.error(`verify:routes — ${failures.length} rewrite violation(s):`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  throw new Error("edge route verification failed");
}

console.log(
  `verify:routes — ${sitemapRoutes.length} sitemap routes and ${EXPECTED_ROUTES.length} built routes resolve through the rewrite; assets pass through untouched.`,
);
