import {
  isEntitlementSource,
  toBillingCapabilities,
  toEntitlementStatus,
  type BillingCapability,
  type BillingErrorCode,
  type EntitlementResponse,
  type EntitlementSource,
  type EntitlementStatus,
  type PlanCatalogEntry,
} from "@nixus/shared";

import type { BillingApi } from "./billing-client.ts";

/**
 * What the billing page is allowed to know (billing AD-1, AD-13, AD-14).
 *
 * Three rules are enforced by this shape rather than by review:
 *
 *  1. **No statement crosses to the browser.** `EntitlementResponse.statement`
 *     is a signed token for a DEVICE consumer; a server-side consumer reads the
 *     record (AD-4). Dropping it here means the page cannot leak statement bytes
 *     into HTML, a log line or a client cache (AD-14).
 *  2. **`tier` is display-only.** It is carried as the opaque string it is, and
 *     nothing in this module or anything downstream compares it. Every decision
 *     below is made on `status` or on `capabilities[]` (AD-1).
 *  3. **Unknown values narrow instead of throwing.** A capability, status or
 *     source a newer server introduced is normalised onto the closed unions, so
 *     a new tier never breaks this page (AD-13's additive-only evolution).
 */

export interface EntitlementView {
  /** Opaque lowercase code from Stripe Product metadata. Rendered, never compared. */
  readonly tier: string;
  readonly status: EntitlementStatus;
  /** Epoch seconds, or `null` on a free entitlement which has no period. */
  readonly currentPeriodEnd: number | null;
  readonly capabilities: readonly BillingCapability[];
  readonly monthlyRequestLimit: number | null;
  readonly source: EntitlementSource;
}

export interface BillingView {
  readonly signedIn: boolean;
  readonly entitlement: EntitlementView | null;
  readonly plans: readonly PlanCatalogEntry[];
  /**
   * Whether a Customer Portal session can be opened at all.
   *
   * Derived from `status`, never from `tier`: an account that has never had a
   * subscription has no Stripe customer, so `POST /portal` would answer
   * `unavailable` and offering the button would be a dead end.
   */
  readonly portalAvailable: boolean;
  readonly error: BillingErrorCode | null;
}

export const ANONYMOUS_BILLING_VIEW: BillingView = {
  signedIn: false,
  entitlement: null,
  plans: [],
  portalAvailable: false,
  error: null,
};

export const EXPIRED_BILLING_VIEW: BillingView = {
  ...ANONYMOUS_BILLING_VIEW,
  error: "unauthorized",
};

/** `none` is an ordinary signed-in free account, and the only status with no portal. */
export function hasPortal(status: EntitlementStatus): boolean {
  return status !== "none";
}

export function toEntitlementView(response: EntitlementResponse): EntitlementView {
  return {
    tier: typeof response.tier === "string" && response.tier !== "" ? response.tier : "free",
    status: toEntitlementStatus(response.status),
    currentPeriodEnd:
      typeof response.current_period_end === "number" ? response.current_period_end : null,
    capabilities: toBillingCapabilities(response.capabilities),
    monthlyRequestLimit:
      typeof response.monthly_request_limit === "number" ? response.monthly_request_limit : null,
    source: isEntitlementSource(response.source) ? response.source : "stripe",
  };
}

function byDisplayOrder(
  left: PlanCatalogEntry,
  right: PlanCatalogEntry,
): number {
  return left.display_order - right.display_order;
}

/**
 * The two reads the page needs, in parallel, each degrading on its own.
 *
 * The catalog is public and the entitlement is not, so one failing must not
 * blank the other: a visitor whose entitlement could not be read still sees the
 * plans, and a visitor whose catalog read failed still sees what they are paying
 * for and can still reach the portal.
 */
export async function loadBillingSnapshot(api: BillingApi): Promise<BillingView> {
  const [entitlementResult, plansResult] = await Promise.all([
    api.getEntitlement().catch(() => null),
    api.getPlans().catch(() => null),
  ]);

  const entitlement =
    entitlementResult !== null && entitlementResult.ok
      ? toEntitlementView(entitlementResult.value)
      : null;

  const plans =
    plansResult !== null && plansResult.ok ? [...plansResult.value.plans].sort(byDisplayOrder) : [];

  const error =
    entitlementResult === null
      ? "unavailable"
      : entitlementResult.ok
        ? null
        : entitlementResult.error.code;

  return {
    signedIn: true,
    entitlement,
    plans,
    portalAvailable: entitlement !== null && hasPortal(entitlement.status),
    error,
  };
}
