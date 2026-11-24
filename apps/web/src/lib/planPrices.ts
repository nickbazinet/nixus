import type { Plan, PlanTrial } from "@/content/pricing";
import type { LivePlanPrices } from "@/lib/planCatalog";
import { usePlanCatalog } from "@/lib/usePlanCatalog";

export interface DisplayPrice {
  readonly amount: string;
  /** "/month", "/year", or "" for a one-off / free plan. */
  readonly interval: string;
}

function formatAmount(cents: number, currency: string): string {
  const whole = cents % 100 === 0;
  try {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(whole ? 0 : 2)}`;
  }
}

export function resolveDisplayPrice(plan: Plan, live: LivePlanPrices): DisplayPrice {
  const entry = plan.lookupKey === null ? undefined : live.get(plan.lookupKey);
  // `??`, never `||`: a live amount of 0 is a real price.
  const cents = entry?.amountCents ?? plan.bakedAmountCents;
  const currency = entry?.currency ?? plan.bakedCurrency;
  const interval = entry?.interval ?? (plan.monthly ? "month" : null);
  return {
    amount: formatAmount(cents, currency),
    interval: interval ? `/${interval}` : "",
  };
}

/** Baked prices on first render (prerender-safe), live ones once the catalog answers. */
export function usePlanPrices(plans: readonly Plan[]): ReadonlyArray<DisplayPrice> {
  const { prices } = usePlanCatalog();
  return plans.map((plan) => resolveDisplayPrice(plan, prices));
}

/**
 * The trial disclosure, with the price after the trial filled in.
 *
 * The amount is never written into the copy: it is the plan's own resolved
 * price, so a price change in the Stripe Dashboard moves the "then …" sentence
 * at the same moment it moves the number above the button, with no deploy and no
 * chance of the two disagreeing.
 */
export function trialMicrocopy(trial: PlanTrial, price: DisplayPrice): string {
  return trial.microcopy.replace("{price}", `${price.amount}${price.interval}`);
}
