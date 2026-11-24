import type { TFunction } from "i18next";
import {
  isPlanLookupKeyShaped,
  type BillingCapability,
  type EntitlementStatus,
  type PlanCatalogEntry,
} from "@nixus/shared";

import type { Locale } from "./i18n";

/**
 * Display helpers for the billing surfaces (billing AD-1, AD-6, AD-16).
 *
 * Everything here renders; nothing here decides. `tier` is an opaque string, so
 * it is only ever resolved to a sentence through the locale files, and no
 * function in this module branches on its value.
 */

/**
 * How many polls `/checkout/complete` makes, and how far apart.
 *
 * Stripe returns the visitor to `success_url` as soon as the hosted Checkout
 * finishes, which is normally BEFORE the `checkout.session.completed` webhook has
 * converged the entitlement (billing AD-5). So the landing page polls
 * `GET /entitlement` on a bound: 6 attempts, 2 seconds apart, so at most 12
 * seconds of waiting on top of the initial server-rendered read.
 *
 * Exhausting the bound is NEVER reported as a failure. The payment did go
 * through — Stripe said so by sending the visitor here — and the honest answer
 * is that the plan is still updating.
 */
export const CHECKOUT_POLL_ATTEMPTS = 6;
export const CHECKOUT_POLL_INTERVAL_MS = 2_000;

/**
 * The `?plan=` deep link the marketing site's pricing page builds.
 *
 * Two gates, in order: the contract's shape check, then membership of the
 * catalog the page actually loaded — because a key that matches the pattern may
 * still name no Price (billing AD-6, AD-8).
 *
 * An unknown or malformed value resolves to `null`, which the page renders as an
 * ORDINARY billing page. It is never echoed, never an error page, and never
 * forwarded to the billing API: a visitor who followed a stale pricing link gets
 * the plan list, not a refusal.
 */
export function resolvePlanDeepLink(
  plans: readonly PlanCatalogEntry[],
  value: unknown,
): PlanCatalogEntry | null {
  if (!isPlanLookupKeyShaped(value)) return null;
  return plans.find((plan) => plan.lookup_key === value) ?? null;
}

const INTL_LOCALE: Record<Locale, string> = { en: "en-CA", fr: "fr-CA" };

/**
 * The list price, in the currency Stripe reported it in.
 *
 * Nixus stores no money: the amount and currency are read from the catalog for
 * display only (billing AD-6). The page states separately that the visitor's own
 * currency applies at checkout and that tax is included (AD-16).
 */
export function formatPlanPrice(plan: PlanCatalogEntry, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: "currency",
    currency: plan.currency,
    currencyDisplay: "code",
  }).format(plan.unit_amount_cents / 100);
}

/** The list amount alone, with the local symbol ("$9.99"); the code is shown beside it. */
export function formatPlanAmount(plan: PlanCatalogEntry, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: "currency",
    currency: plan.currency,
    currencyDisplay: "narrowSymbol",
  }).format(plan.unit_amount_cents / 100);
}

/**
 * The catalog entry to show a subscriber's list price from, for display only.
 *
 * The entitlement carries no price, so the price shown beside the plan name is
 * read from the catalog. It is shown only when exactly one entry carries the
 * subscription's tier: with a monthly and a yearly price for one tier there is
 * no telling which one is being paid, and a wrong amount is worse than none.
 */
export function listPriceFor(
  plans: readonly PlanCatalogEntry[],
  tier: string,
): PlanCatalogEntry | null {
  const matches = plans.filter((plan) => plan.tier === tier);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/** One tier's published prices, so a monthly and a yearly entry read as one plan. */
export interface TierPlans {
  readonly tier: string;
  readonly displayOrder: number;
  readonly monthly: PlanCatalogEntry | null;
  readonly yearly: PlanCatalogEntry | null;
}

/**
 * Groups the catalog by its opaque tier code, in display order. The tier is only
 * ever a grouping key here, never compared to a literal (AD-1).
 */
export function groupPlansByTier(plans: readonly PlanCatalogEntry[]): TierPlans[] {
  const grouped = new Map<string, TierPlans>();
  for (const plan of plans) {
    const current = grouped.get(plan.tier);
    grouped.set(plan.tier, {
      tier: plan.tier,
      displayOrder: Math.min(current?.displayOrder ?? plan.display_order, plan.display_order),
      monthly: plan.interval === "month" ? plan : (current?.monthly ?? null),
      yearly: plan.interval === "year" ? plan : (current?.yearly ?? null),
    });
  }
  return [...grouped.values()].sort((a, b) => a.displayOrder - b.displayOrder);
}

export interface YearlySavings {
  readonly yearOfMonthlyCents: number;
  readonly savedCents: number;
  readonly percent: number;
}

/**
 * What paying yearly saves against twelve monthly payments, or `null` when the
 * two prices cannot be compared or yearly is not cheaper.
 */
export function yearlySavings(tier: TierPlans): YearlySavings | null {
  const { monthly, yearly } = tier;
  if (monthly === null || yearly === null) return null;
  if (monthly.currency !== yearly.currency) return null;

  const yearOfMonthlyCents = monthly.unit_amount_cents * 12;
  const savedCents = yearOfMonthlyCents - yearly.unit_amount_cents;
  if (yearOfMonthlyCents <= 0 || savedCents <= 0) return null;

  return {
    yearOfMonthlyCents,
    savedCents,
    percent: Math.round((savedCents / yearOfMonthlyCents) * 100),
  };
}

/** Whole-cents amount in the plan's currency with the local symbol ("$9.99"). */
export function formatCentsAmount(cents: number, currency: string, locale: Locale): string {
  return new Intl.NumberFormat(INTL_LOCALE[locale], {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  }).format(cents / 100);
}

/** Epoch seconds in the active locale's own long date form, or `null` if absent. */
export function formatPeriodEnd(epochSeconds: number | null, locale: Locale): string | null {
  if (epochSeconds === null || !Number.isFinite(epochSeconds)) return null;
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(epochSeconds * 1000));
}

/**
 * The tier's display name, keyed by the opaque code (AD-1's i18n convention).
 *
 * The fallback is the whole point: adding a tier is a Stripe Dashboard change
 * with no deploy, so a code these locale files have never seen WILL arrive. It
 * resolves to `billing.tier.unknown` — a neutral "Nixus Cloud plan" — rather
 * than to a blank, to the raw metadata code, or to a crash. The status, renewal
 * date, capability list and plan buttons all still render, so the page stays
 * fully usable on a tier it cannot name.
 */
export function tierDisplayName(t: TFunction, tier: string): string {
  return t([`billing.tier.${tier}`, "billing.tier.unknown"]);
}

export function capabilityLabel(t: TFunction, capability: BillingCapability): string {
  return t(`billing.capability.${capability}`);
}

export function statusLabel(t: TFunction, status: EntitlementStatus): string {
  return t(`billing.status.${status}`);
}
