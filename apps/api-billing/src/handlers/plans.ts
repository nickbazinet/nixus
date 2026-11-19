import type { PlanCatalogResponse } from "@nixus/shared";

import { getCatalog } from "../lib/catalog.ts";

/*
 * `GET /plans` - public, unauthenticated, cacheable (AD-3, AD-6).
 *
 * It carries no user data and no `price_id`, and no amount, currency amount or
 * tier->capability table appears in this file: every value below is read from
 * Stripe at request time and served out of THE single TTL cache, which is also
 * what `cache_ttl_seconds` and the route's `Cache-Control` header derive from.
 *
 * An empty catalog is a correct, non-failing answer for a stack whose Stripe
 * Products have not been created yet: a pricing page hydrating over it keeps its
 * baked fallback copy, which is the designed behaviour rather than a fallback
 * (AD-6).
 */
export async function handlePlans(args: {
  readonly now: Date;
  readonly requestId: string;
}): Promise<PlanCatalogResponse> {
  const catalog = await getCatalog(args);

  return {
    plans: catalog.plans.map((plan) => plan.entry),
    cache_ttl_seconds: catalog.cacheTtlSeconds,
  };
}
