/**
 * Plans, the comparison table and the pricing FAQ.
 *
 * Split along the line that matters: every Stripe fact — the `lookup_key`, the
 * baked amount, the currency, the billing interval, the trial length — is
 * declared **once**, locale-neutrally, below. Everything that is words lives in
 * the copy dictionary, per language. A price change therefore touches one
 * place, and it is impossible for the French column to advertise a different
 * amount or a different Price than the English one.
 *
 * The amounts here are the baked fallback the prerendered HTML ships with. On
 * the client the live catalog (`GET /v1/billing/plans`) overrides them per
 * field, matched by `lookup_key` (AD-6). Nothing here is a Stripe `price_id`.
 */

import { copyFor } from "@/content/index";
import type {
  CompareGroupCopy,
  FaqItem,
  PlanCopy,
  PlanId,
  PlanTrialCopy,
} from "@/content/types";
import type { Locale } from "@/lib/locale";

export type { PlanId } from "@/content/types";

/** A plan's Stripe-side identity. No words, in any language. */
export interface PlanSpec {
  readonly id: PlanId;
  /** `null` for a plan with no Stripe Price. */
  readonly lookupKey: string | null;
  readonly bakedAmountCents: number;
  readonly bakedCurrency: string;
  readonly monthly: boolean;
  readonly highlighted: boolean;
}

/**
 * The free trial's Stripe-side identity.
 *
 * `lookupKey` is a Stripe Price `lookup_key` and nothing else (AD-6): the trial
 * is a second Price on the Advance Product, so it is linked to exactly like any
 * other plan and carries no `price_id` and no amount.
 */
export interface PlanTrialSpec {
  readonly lookupKey: string;
  readonly days: number;
}

export const ADVANCE_TRIAL_SPEC: PlanTrialSpec = {
  lookupKey: "advance_trial",
  days: 7,
};

/** Display order on both the pricing page and the home-page teaser. */
export const PLAN_SPECS: readonly PlanSpec[] = [
  {
    id: "free",
    lookupKey: null,
    bakedAmountCents: 0,
    bakedCurrency: "CAD",
    monthly: false,
    highlighted: false,
  },
  {
    id: "classic",
    lookupKey: "classic_monthly_cad",
    bakedAmountCents: 999,
    bakedCurrency: "CAD",
    monthly: true,
    highlighted: false,
  },
  {
    id: "advance",
    lookupKey: "advance_monthly_cad",
    bakedAmountCents: 1999,
    bakedCurrency: "CAD",
    monthly: true,
    highlighted: true,
  },
];

/** Only Advance carries a published trial Price. */
const TRIAL_PLAN_ID: PlanId = "advance";

/** The trial as a page renders it: Stripe identity plus this language's words. */
export type PlanTrial = PlanTrialSpec & PlanTrialCopy;

/** A plan as a page renders it: Stripe identity plus this language's words. */
export type Plan = PlanSpec & PlanCopy & { readonly trial?: PlanTrial };

export function advanceTrialFor(locale: Locale): PlanTrial {
  return { ...ADVANCE_TRIAL_SPEC, ...copyFor(locale).pricing.trial };
}

export function plansFor(locale: Locale): readonly Plan[] {
  const pricing = copyFor(locale).pricing;
  return PLAN_SPECS.map((spec) => ({
    ...spec,
    ...pricing.plans[spec.id],
    ...(spec.id === TRIAL_PLAN_ID ? { trial: advanceTrialFor(locale) } : {}),
  }));
}

export function compareGroupsFor(locale: Locale): readonly CompareGroupCopy[] {
  return copyFor(locale).pricing.compare.groups;
}

export function pricingFaqFor(locale: Locale): readonly FaqItem[] {
  return copyFor(locale).pricing.faq;
}
