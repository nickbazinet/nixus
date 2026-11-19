/**
 * Where the public billing API lives. The only place in `apps/web` that names
 * that host.
 *
 * There is no central config module in this app — the established convention is
 * a `VITE_`-prefixed variable read at exactly one call site with a hard default
 * (`__root.tsx` does the same for the Cloudflare analytics token), so this is
 * the smallest addition consistent with that. It is a leaf module with no
 * imports, like `site.ts`, so every consumer can depend on it without forming a
 * cycle.
 *
 * The default is production. Setting `VITE_BILLING_API_URL` points the pricing
 * page at a Stripe test-mode deployment during development with no code change
 * — see `apps/web/README.md` and `.env.example`.
 */

const DEFAULT_BILLING_API_ORIGIN = "https://api.nixusapp.com";

/** The catalog path is part of the published contract, not a configurable. */
const PLAN_CATALOG_PATH = "/v1/billing/plans";

function withoutTrailingSlash(origin: string): string {
  return origin.endsWith("/") ? origin.replace(/\/+$/, "") : origin;
}

/**
 * Configured origin, or production.
 *
 * An empty or non-string value falls back rather than producing a request to
 * `undefined/v1/...`: a misconfigured dev `.env` must leave the page on its
 * baked copy, not break it.
 */
export function billingApiOrigin(): string {
  const configured: unknown = import.meta.env.VITE_BILLING_API_URL;
  if (typeof configured !== "string" || configured.trim().length === 0) {
    return DEFAULT_BILLING_API_ORIGIN;
  }
  return withoutTrailingSlash(configured.trim());
}

/** Absolute URL of `GET /v1/billing/plans`. Public, unauthenticated, cacheable. */
export function planCatalogUrl(): string {
  return `${billingApiOrigin()}${PLAN_CATALOG_PATH}`;
}
