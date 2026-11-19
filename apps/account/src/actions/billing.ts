import { createServerFn } from "@tanstack/react-start";

import {
  openPortalSession,
  startCheckoutSession,
  type CheckoutOutcome,
  type PortalOutcome,
} from "@/server/billing-checkout";
import {
  ANONYMOUS_BILLING_VIEW,
  EXPIRED_BILLING_VIEW,
  loadBillingSnapshot,
  toEntitlementView,
  type BillingView,
  type EntitlementView,
} from "@/server/billing-view";
import { log } from "@/server/log";
import { billingApiFor } from "@/server/runtime";
import { gate } from "./gate";

/**
 * Server functions for the billing surfaces (billing AD-3, AD-7, AD-8, AD-14).
 *
 * Every one goes through `gate()`, which is the single place the session is
 * resolved and `Origin` is verified on a mutation — so the browser never holds a
 * token, a cross-site POST is a bodyless 403, and a request can only ever reach
 * the billing record of the session that made it.
 *
 * Nothing here logs a promotion code, a URL, a token, or any Stripe identifier.
 * The log entries carry a route, a stable code and `sub`, which is the only
 * identifying value AD-14 permits.
 */

export type { BillingView, EntitlementView };

export type EntitlementSnapshot =
  | { readonly signedIn: false }
  | { readonly signedIn: true; readonly entitlement: EntitlementView | null };

export type StartCheckoutResponse =
  | CheckoutOutcome
  | { readonly kind: "signed_out" };

export type OpenPortalResponse = PortalOutcome | { readonly kind: "signed_out" };

export const loadBillingView = createServerFn({ method: "GET" }).handler(
  async (): Promise<BillingView> => {
    const result = await gate(false);
    if (result.state === "anonymous") return ANONYMOUS_BILLING_VIEW;
    if (result.state === "expired") return EXPIRED_BILLING_VIEW;

    const view = await loadBillingSnapshot(billingApiFor(result.session.accessToken));
    if (view.error !== null) {
      log("info", { route: "/billing", code: view.error, sub: result.session.sub });
    }
    return view;
  },
);

/**
 * The lighter read `/checkout/complete` polls (billing AD-5, AD-9).
 *
 * Separate from `loadBillingView` on purpose: the landing page polls this up to
 * six times and has no use for the plan catalog, so re-fetching it each round
 * would spend the catalog's cache budget on nothing.
 */
export const loadEntitlement = createServerFn({ method: "GET" }).handler(
  async (): Promise<EntitlementSnapshot> => {
    const result = await gate(false);
    if (result.state !== "ok") return { signedIn: false };

    const api = billingApiFor(result.session.accessToken);
    let entitlement;
    try {
      entitlement = await api.getEntitlement();
    } catch {
      return { signedIn: true, entitlement: null };
    }

    if (!entitlement.ok) {
      log("info", {
        route: "/checkout/complete",
        code: entitlement.error.code,
        sub: result.session.sub,
      });
      return { signedIn: true, entitlement: null };
    }
    return { signedIn: true, entitlement: toEntitlementView(entitlement.value) };
  },
);

export const startCheckout = createServerFn({ method: "POST" })
  .inputValidator((data: { plan_lookup_key?: unknown; promotion_code?: unknown }) => ({
    // Carried through as `unknown`: narrowing is `narrowCheckoutInput`'s job, in
    // one place, so the validator cannot disagree with it about what is shaped.
    planLookupKey: data.plan_lookup_key,
    promotionCode: data.promotion_code,
  }))
  .handler(async ({ data }): Promise<StartCheckoutResponse> => {
    const result = await gate(true);
    if (result.state !== "ok") return { kind: "signed_out" };

    const outcome = await startCheckoutSession(billingApiFor(result.session.accessToken), data);
    log("info", {
      route: "/billing/checkout",
      code: `checkout_${outcome.kind}`,
      sub: result.session.sub,
    });
    return outcome;
  });

export const openPortal = createServerFn({ method: "POST" }).handler(
  async (): Promise<OpenPortalResponse> => {
    const result = await gate(true);
    if (result.state !== "ok") return { kind: "signed_out" };

    const outcome = await openPortalSession(billingApiFor(result.session.accessToken));
    log("info", {
      route: "/billing/portal",
      code: `portal_${outcome.kind}`,
      sub: result.session.sub,
    });
    return outcome;
  },
);
