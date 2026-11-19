import { useMutation } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { BillingErrorCode } from "@nixus/shared";

/**
 * The one place a plan's lookup key is written in the frontend.
 *
 * Not in a component, and deliberately not assembled from a tier name either: the server
 * validates this string against the live Stripe catalog, so a key spelled in two places is a
 * refused Checkout waiting for whichever copy drifts first. Adding a plan is a change here and
 * nowhere else.
 */
export const ADVANCE_PLAN_LOOKUP_KEY = "advance_monthly_cad";

/**
 * Opens Stripe-hosted Checkout for a plan in the **system browser**.
 *
 * Nothing comes back: the Rust command answers `()`, because the server-issued URL never leaves
 * the Rust billing module (AD-8). There is therefore no URL for this hook to mishandle, no
 * in-app navigation to perform, and no payment component anywhere in the app.
 *
 * The server decides where the user actually lands (AD-18) — an account that already subscribes
 * is routed to the Customer Portal rather than to a second Checkout — so no caller here may
 * reason about which surface opens.
 */
export function useOpenBillingCheckout() {
  return useMutation({
    mutationFn: (planLookupKey: string) =>
      invoke<void>("open_billing_checkout", { plan_lookup_key: planLookupKey }),
  });
}

/** Opens the Stripe-hosted Customer Portal in the system browser. Same shape, same reasons. */
export function useOpenBillingPortal() {
  return useMutation({
    mutationFn: () => invoke<void>("open_billing_portal"),
  });
}

/**
 * i18n key for a billing refusal, keyed on `code`.
 *
 * Exhaustive with no `default`, so a code added to the shared union is a compile error here
 * rather than a silent generic sentence. The grouping is by what the user has to DO:
 * `rate_limited` and `unavailable` share one "try again shortly" key, and every code with its
 * own next action gets its own.
 *
 * `client_too_old` is its own key and names an update, never a sign-in: the server will not
 * serve this build, and no amount of re-authenticating changes that.
 */
export function billingMessageKey(code: BillingErrorCode): string {
  switch (code) {
    case "unauthorized":
      return "billing.errorSignedOut";
    case "reauthentication_required":
      return "billing.errorReauthenticationRequired";
    case "client_too_old":
      return "billing.errorClientTooOld";
    case "premium_required":
      return "billing.errorNoPlanToManage";
    case "validation":
      return "billing.errorRefused";
    case "version_conflict":
      return "billing.errorVersionConflict";
    case "promotion_invalid":
      return "billing.errorPromotionInvalid";
    case "checkout_in_progress":
      return "billing.errorAlreadyOpen";
    case "rate_limited":
    case "unavailable":
      return "billing.errorUnavailable";
  }
}

/**
 * Whether the user has to act in the auth layer before this can work.
 *
 * `client_too_old` is deliberately excluded: it is the one refusal that looks like an auth
 * problem and is not one, and signing the user out over it would be exactly the "a client
 * limitation read as an auth failure" confusion AD-12 exists to prevent.
 */
export function billingNeedsSignIn(code: BillingErrorCode): boolean {
  return code === "unauthorized" || code === "reauthentication_required";
}
