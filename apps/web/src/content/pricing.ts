/**
 * The pricing page's fixed shape: four columns and the rows they are compared
 * on, plus the baked list price each column falls back to.
 *
 * ## The columns are fixed; only the money is live
 *
 * `GET /v1/billing/plans` publishes **paid** plans only, so Local and Nixus
 * Cloud Free have no Stripe Price and can never appear in it — they are baked
 * columns by construction (`lookupKey: null`). Classic and Advance are matched
 * to a catalog entry **by `lookup_key`**, never by `tier`: AD-1 makes `tier` an
 * opaque display string no code anywhere may compare, which is what keeps
 * "add a tier" a Dashboard change. A `lookup_key` this file does not declare is
 * therefore ignored rather than becoming a fifth column.
 *
 * ## The amounts here are a fallback, not the catalog
 *
 * AD-6 forbids an amount or a `price_id` from being the source of truth in
 * code. These amounts exist only so the prerendered HTML is complete and
 * correct when the API cannot be reached; the catalog overrides them per field
 * after hydration. There is no `price_id` anywhere in this app.
 */

import { BILLING_CAPABILITIES, type BillingCapability, type PlanInterval } from "@nixus/shared";

/** Ladder order. Also the column order of the comparison table, so the two agree. */
export const PRICING_COLUMN_IDS = [
  "local",
  "cloudFree",
  "classic",
  "advance",
] as const;
export type PricingColumnId = (typeof PRICING_COLUMN_IDS)[number];

/** Which affordance a column ends in. The page owns the destinations. */
export type PricingCallToAction = "download" | "signIn" | "subscribe";

export interface PricingColumn {
  readonly id: PricingColumnId;
  /** `null` for a column with no Stripe Price. Never a `price_id`. */
  readonly lookupKey: string | null;
  /** Baked list price, integer minor units. Overridden by the live catalog. */
  readonly bakedAmountCents: number;
  /** Baked list currency, uppercase ISO 4217. Overridden by the live catalog. */
  readonly bakedCurrency: string;
  /** `null` on a column that is not a subscription, so it renders no interval. */
  readonly bakedInterval: PlanInterval | null;
  /** The one highlighted column. Exactly one, asserted in the tests. */
  readonly recommended: boolean;
  readonly callToAction: PricingCallToAction;
}

export const PRICING_COLUMNS: readonly PricingColumn[] = [
  {
    id: "local",
    lookupKey: null,
    bakedAmountCents: 0,
    bakedCurrency: "CAD",
    bakedInterval: null,
    recommended: false,
    callToAction: "download",
  },
  {
    id: "cloudFree",
    lookupKey: null,
    bakedAmountCents: 0,
    bakedCurrency: "CAD",
    bakedInterval: null,
    recommended: false,
    callToAction: "signIn",
  },
  {
    id: "classic",
    lookupKey: "classic_monthly_cad",
    bakedAmountCents: 999,
    bakedCurrency: "CAD",
    bakedInterval: "month",
    recommended: false,
    callToAction: "subscribe",
  },
  {
    id: "advance",
    lookupKey: "advance_monthly_cad",
    bakedAmountCents: 1999,
    bakedCurrency: "CAD",
    bakedInterval: "month",
    recommended: true,
    callToAction: "subscribe",
  },
];

export interface PricingFeatureRow {
  readonly id: string;
  /** Columns this row is included in. The single source of every checkmark. */
  readonly includedIn: readonly PricingColumnId[];
  /**
   * The capability that backs this row, where one does.
   *
   * Documentation with teeth rather than a gate: the page renders from
   * `includedIn`, but a test asserts every member of `BILLING_CAPABILITIES` is
   * claimed by exactly one row, so adding a capability to the closed union
   * fails until the pricing page decides how to advertise it.
   */
  readonly capability?: BillingCapability;
  /** Advertised, not yet built. Rendered with the site's usual "coming" note. */
  readonly comingSoon?: boolean;
}

/**
 * The comparison rows, in reading order.
 *
 * "Works with no account" is phrased as a positive for Local rather than as
 * "account required" with three checkmarks, because needing no account is the
 * thing Local is actually selling. "Bring your own AI credentials" is included
 * on every column on purpose — AD-16 gates that a BYO user on any plan,
 * including free, reaches every AI surface, so an all-included row is the
 * correct answer and prevents the page implying AI is Advance-only.
 */
export const PRICING_FEATURE_ROWS: readonly PricingFeatureRow[] = [
  { id: "noAccount", includedIn: ["local"] },
  { id: "localRecords", includedIn: ["local", "cloudFree", "classic", "advance"] },
  { id: "cloudProfile", includedIn: ["cloudFree", "classic", "advance"] },
  { id: "byoAi", includedIn: ["local", "cloudFree", "classic", "advance"] },
  {
    id: "sync",
    includedIn: ["classic", "advance"],
    capability: "multi_device_sync",
  },
  {
    id: "householdNetWorth",
    includedIn: ["classic", "advance"],
    capability: "household_net_worth",
    comingSoon: true,
  },
  { id: "hostedAi", includedIn: ["advance"], capability: "hosted_ai" },
  // Ships today through the Home page's Edit-with-AI composer, so it carries no
  // "coming" note. It needs no capability of its own: the composer is reached
  // through hosted AI, or through a visitor's own AI credentials on any plan.
  { id: "customDashboards", includedIn: ["advance"] },
];

/** Every capability the closed union defines, as advertised by the rows above. */
export const ADVERTISED_CAPABILITIES: readonly BillingCapability[] =
  BILLING_CAPABILITIES.filter((capability) =>
    PRICING_FEATURE_ROWS.some((row) => row.capability === capability),
  );

export function pricingColumn(id: PricingColumnId): PricingColumn {
  const found = PRICING_COLUMNS.find((column) => column.id === id);
  // Unreachable: `id` is a member of the literal union the array is built from,
  // and a test asserts the array covers every member.
  if (found === undefined) throw new Error(`unknown pricing column: ${id}`);
  return found;
}

export function rowIncludes(
  row: PricingFeatureRow,
  columnId: PricingColumnId,
): boolean {
  return row.includedIn.includes(columnId);
}
