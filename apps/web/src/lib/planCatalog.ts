/**
 * Client for the public plan catalog, `GET /v1/billing/plans`.
 *
 * ## Why the page is baked first and hydrated second (AD-6, INVESTIGATION B6)
 *
 * An operator must be able to change a price in the Stripe Dashboard and have
 * the advertised price move with no deploy. The pricing page must also keep its
 * SEO value and keep working when the API is down. Those two pull in opposite
 * directions, so the page does both: the prerendered HTML carries complete,
 * correct baked prices, and this module replaces the amount, currency and
 * interval *after* hydration when the live catalog answers.
 *
 * Three rules follow from that, and all three are enforced here rather than at
 * the call site:
 *
 * 1. **Nothing in here may run during prerender.** The fetch is reached only
 *    from `useEffect` (see `usePlanCatalog`), which the prerender pass never
 *    runs, so `crawlLinks` prerendering never depends on a runtime API.
 * 2. **Failure is silent.** A refused, slow, non-200 or malformed response
 *    resolves to "no live data" and leaves the baked copy in place. Nothing is
 *    thrown, nothing is logged, no error state is exposed for a banner to
 *    render.
 * 3. **One cache owner, one bound (AD-6).** `cache_ttl_seconds` is the single
 *    cache bound in the system; CloudFront derives the response's own
 *    `Cache-Control` from it and the browser HTTP cache honours that. So this
 *    module passes no `cache` option and adds no in-memory memo — a second
 *    layer would be a second bound.
 */

import {
  PLAN_INTERVALS,
  isPlanLookupKeyShaped,
  type PlanCatalogEntry,
  type PlanCatalogResponse,
  type PlanInterval,
} from "@nixus/shared";

import { planCatalogUrl } from "./billingApi";

/**
 * The wire member names this parser reads, tied to the shared contract at
 * compile time. `satisfies` is what makes that tie real: renaming a member in
 * `packages/shared/src/types/billing.ts` fails compilation here instead of
 * silently producing a catalog in which every field falls back to baked.
 */
const ENTRY_FIELD = {
  lookupKey: "lookup_key",
  amountCents: "unit_amount_cents",
  currency: "currency",
  interval: "interval",
} as const satisfies Record<string, keyof PlanCatalogEntry>;

const RESPONSE_FIELD = {
  plans: "plans",
  cacheTtlSeconds: "cache_ttl_seconds",
} as const satisfies Record<string, keyof PlanCatalogResponse>;

/**
 * One catalog entry, narrowed field by field.
 *
 * Every member is independently nullable because a malformed field falls back
 * on its own: a catalog entry that publishes a good amount and a nonsense
 * interval must still move the price. All-or-nothing validation would discard a
 * correct amount because of an unrelated typo.
 */
export interface LivePlanPrice {
  readonly amountCents: number | null;
  readonly currency: string | null;
  readonly interval: PlanInterval | null;
}

/** Live entries by `lookup_key`. A key no column declares is simply never read. */
export type LivePlanPrices = ReadonlyMap<string, LivePlanPrice>;

export interface PlanCatalog {
  readonly prices: LivePlanPrices;
  /**
   * The catalog's own TTL, carried for diagnostics only.
   *
   * Deliberately not acted on: AD-6 makes this the system's single cache bound,
   * already expressed as the response's `Cache-Control`. Starting a timer or a
   * memo on it here would be the second cache owner that invariant forbids.
   */
  readonly cacheTtlSeconds: number | null;
}

export const EMPTY_PLAN_CATALOG: PlanCatalog = {
  prices: new Map<string, LivePlanPrice>(),
  cacheTtlSeconds: null,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Integer minor units, as Stripe reports them.
 *
 * Zero is valid — a $0 Price is a legitimate catalog entry — so the guard is
 * "safe non-negative integer", never truthiness. No arithmetic happens on this
 * value anywhere; it travels as minor units all the way to `Intl.NumberFormat`.
 */
function readAmountCents(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

/** Uppercase ISO 4217. Normalised rather than rejected on case alone. */
function readCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function readInterval(value: unknown): PlanInterval | null {
  return typeof value === "string" &&
    (PLAN_INTERVALS as readonly string[]).includes(value)
    ? (value as PlanInterval)
    : null;
}

/**
 * Parse one entry into its key and its per-field values.
 *
 * An entry whose `lookup_key` is absent or not key-shaped is dropped outright:
 * without a key there is no column to apply it to. Every other defect degrades
 * to `null` on that field alone.
 */
function readEntry(value: unknown): readonly [string, LivePlanPrice] | null {
  const record = asRecord(value);
  if (record === null) return null;

  const lookupKey = record[ENTRY_FIELD.lookupKey];
  if (!isPlanLookupKeyShaped(lookupKey)) return null;

  return [
    lookupKey,
    {
      amountCents: readAmountCents(record[ENTRY_FIELD.amountCents]),
      currency: readCurrency(record[ENTRY_FIELD.currency]),
      interval: readInterval(record[ENTRY_FIELD.interval]),
    },
  ];
}

/**
 * Normalise any response body into a catalog.
 *
 * Takes `unknown` on purpose. The page must survive a proxy returning an HTML
 * error page with a 200, a newer server adding members, and a truncated body —
 * none of which a cast would survive, and all of which land here as "no usable
 * entry" rather than as an exception.
 */
export function toPlanCatalog(body: unknown): PlanCatalog {
  const record = asRecord(body);
  if (record === null) return EMPTY_PLAN_CATALOG;

  const rawPlans = record[RESPONSE_FIELD.plans];
  const prices = new Map<string, LivePlanPrice>();
  if (Array.isArray(rawPlans)) {
    for (const rawEntry of rawPlans) {
      const parsed = readEntry(rawEntry);
      if (parsed === null) continue;
      // First wins. A duplicate `lookup_key` is a server-side defect; taking
      // the first keeps one response always rendering the same page.
      if (prices.has(parsed[0])) continue;
      prices.set(parsed[0], parsed[1]);
    }
  }

  return {
    prices,
    cacheTtlSeconds: readAmountCents(record[RESPONSE_FIELD.cacheTtlSeconds]),
  };
}

/**
 * Fetch the catalog, or report that there is none.
 *
 * Never rejects and never writes to the console: the caller's only correct
 * response to a failure is to keep showing baked prices, so a failure carries
 * no information worth surfacing to a visitor reading a pricing page.
 */
export async function loadPlanCatalog(
  signal?: AbortSignal,
): Promise<PlanCatalog | null> {
  try {
    const response = await fetch(planCatalogUrl(), {
      signal,
      headers: { accept: "application/json" },
      // No `cache` option on purpose: the default honours the response's own
      // `Cache-Control`, which AD-6 derives from `cache_ttl_seconds`. Passing
      // `no-store` or `reload` here would override the system's single bound.
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const catalog = toPlanCatalog(body);
    // An answer with no usable entry is indistinguishable from no answer, and
    // reporting it as a catalog would replace nothing while claiming it had.
    return catalog.prices.size > 0 ? catalog : null;
  } catch {
    return null;
  }
}
