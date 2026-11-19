/**
 * Resolving a column's price from the live catalog, and rendering it as money.
 *
 * Two rules live here rather than in the component:
 *
 * 1. **Per field, not all-or-nothing.** A live entry contributes only the
 *    members it actually published; anything absent or malformed falls back to
 *    that column's baked value on its own.
 * 2. **Money never becomes a float before the formatting boundary.** The amount
 *    travels as integer minor units into `formatMoney`, which is the single
 *    place in the monorepo that divides by 100, immediately inside
 *    `Intl.NumberFormat`. No arithmetic on money happens in `apps/web`.
 */

import { formatMoney, type PlanInterval } from "@nixus/shared";

import type { PricingColumn } from "@/content/pricing";
import type { LivePlanPrices } from "./planCatalog";
import type { Locale } from "./site";

/**
 * The number format each locale renders money in.
 *
 * Pinned to the Canadian variants rather than left to the runtime default:
 * these are CAD list prices for a Canadian product, and an unpinned
 * `Intl.NumberFormat` would group and place the symbol differently depending on
 * the visitor's machine, which is a rendering difference no test could hold.
 */
const MONEY_LOCALE: Record<Locale, string> = {
  en: "en-CA",
  fr: "fr-CA",
};

export interface ResolvedPlanPrice {
  /** Integer minor units. */
  readonly amountCents: number;
  /** Uppercase ISO 4217. */
  readonly currency: string;
  readonly interval: PlanInterval | null;
}

/**
 * The column's price after the live catalog has had its say.
 *
 * A column with no `lookupKey` has no Stripe Price and is never looked up, so
 * an entry carrying a key this page does not declare can never reach a column.
 */
export function resolvePlanPrice(
  column: PricingColumn,
  live: LivePlanPrices,
): ResolvedPlanPrice {
  const entry = column.lookupKey === null ? undefined : live.get(column.lookupKey);

  return {
    // `??`, never `||`: a live amount of 0 is a real price and must not fall
    // back to the baked one.
    amountCents: entry?.amountCents ?? column.bakedAmountCents,
    currency: entry?.currency ?? column.bakedCurrency,
    interval: entry?.interval ?? column.bakedInterval,
  };
}

/**
 * Render an amount for display.
 *
 * `showCurrencyCode` is on because the symbol alone is ambiguous: `$9.99` reads
 * as USD to most of the visitors Adaptive Pricing is there for, and the page's
 * whole footnote rests on the list price being recognisably CAD.
 */
export function formatPlanAmount(
  price: ResolvedPlanPrice,
  locale: Locale,
): string {
  return formatMoney({
    cents: price.amountCents,
    currency: price.currency,
    locale: MONEY_LOCALE[locale],
    showCurrencyCode: true,
  });
}
