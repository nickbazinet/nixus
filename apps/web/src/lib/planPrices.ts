import type { PlanInterval } from "@nixus/shared";

import type { Plan, PlanTrial } from "@/content/pricing";
import { fill } from "@/content/index";
import type { LivePlanPrices } from "@/lib/planCatalog";
import { LANG_TAG, type Locale } from "@/lib/locale";
import { usePlanCatalog } from "@/lib/usePlanCatalog";

export interface DisplayPrice {
  readonly amount: string;
  /** "/month", "/mois", "/an", or "" for a one-off / free plan. */
  readonly interval: string;
}

/**
 * How each wire interval is said in each language.
 *
 * Lives here rather than in the copy dictionary because the key is the billing
 * contract's own enum (`PLAN_INTERVALS`): a new interval published by the
 * catalog fails compilation here, where the formatting is, instead of silently
 * rendering an English word on a French page.
 */
const INTERVAL_LABEL = {
  en: { month: "month", year: "year" },
  fr: { month: "mois", year: "an" },
} as const satisfies Record<Locale, Record<PlanInterval, string>>;

/**
 * Format minor units as the locale writes money.
 *
 * `fr-CA` is what puts the symbol after the amount and the comma in the middle
 * — "19,99 $", with a non-breaking space — so the French page reads like a
 * Canadian price rather than an English one with French labels around it.
 */
function formatAmount(cents: number, currency: string, locale: Locale): string {
  const whole = cents % 100 === 0;
  try {
    return new Intl.NumberFormat(LANG_TAG[locale], {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    const amount = (cents / 100).toFixed(whole ? 0 : 2);
    return locale === "fr" ? `${amount.replace(".", ",")}\u00A0$` : `$${amount}`;
  }
}

export function resolveDisplayPrice(
  plan: Plan,
  live: LivePlanPrices,
  locale: Locale,
): DisplayPrice {
  const entry = plan.lookupKey === null ? undefined : live.get(plan.lookupKey);
  // `??`, never `||`: a live amount of 0 is a real price.
  const cents = entry?.amountCents ?? plan.bakedAmountCents;
  const currency = entry?.currency ?? plan.bakedCurrency;
  const interval: PlanInterval | null =
    entry?.interval ?? (plan.monthly ? "month" : null);
  return {
    amount: formatAmount(cents, currency, locale),
    interval: interval ? `/${INTERVAL_LABEL[locale][interval]}` : "",
  };
}

/** Baked prices on first render (prerender-safe), live ones once the catalog answers. */
export function usePlanPrices(
  plans: readonly Plan[],
  locale: Locale,
): ReadonlyArray<DisplayPrice> {
  const { prices } = usePlanCatalog();
  return plans.map((plan) => resolveDisplayPrice(plan, prices, locale));
}

/**
 * The trial disclosure, with the price after the trial filled in.
 *
 * The amount is never written into the copy: it is the plan's own resolved
 * price, so a price change in the Stripe Dashboard moves the "then …" sentence
 * at the same moment it moves the number above the button, with no deploy and no
 * chance of the two disagreeing. That holds in both languages, because both
 * read the same resolved `DisplayPrice`.
 */
export function trialMicrocopy(trial: PlanTrial, price: DisplayPrice): string {
  return fill(trial.microcopy, { price: `${price.amount}${price.interval}` });
}
