import { useMutation, useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import {
  type BillingCapability,
  type BillingErrorCode,
} from "@nixus/shared";
import { HOSTED_AI_STATUS_TTL_MS, queryKeys } from "@/lib/constants";

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
 * Hosted AI through Nixus infrastructure, named once and typed against the shared union so a
 * misspelling is a compile error rather than a gate that silently never opens.
 *
 * The only capability any surface names today. Every other gate asks "does this account hold at
 * least one capability", which needs no name at all.
 */
export const HOSTED_AI_CAPABILITY: BillingCapability = "hosted_ai";

/**
 * `get_billing_entitlement`'s wire shape, mirroring Rust's `BillingEntitlementView`.
 *
 * Three fields, and the absences are the contract. `capabilities` is the only field a gate may
 * read (AD-13). `tier` is an opaque label a surface may print and must never compare. And there
 * is no usage figure, because the limit, the charged count and the period never cross IPC (AD-9).
 */
export interface BillingEntitlement {
  /**
   * Whether this is an answer at all. `false` covers both "nobody has asked yet" and "the
   * entitlement could not be established", and neither may render a consequence: an upsell shown
   * over a flaky connection is sold to a user who may already own the thing.
   */
  readonly established: boolean;
  readonly tier: string | null;
  readonly capabilities: readonly BillingCapability[];
}

/** The answer that makes no claim — the shape a gate sees before anything has resolved. */
const UNESTABLISHED: BillingEntitlement = {
  established: false,
  tier: null,
  capabilities: [],
};

/**
 * What the signed-in account's entitlement grants, as a list of capabilities.
 *
 * `enabled` is the caller's to supply, for the same reason `useCloudAiPremium`'s is: the command
 * resolves a call-time Cognito token, so reading it under a local profile would open the OS secure
 * store for a profile that has no account at all.
 *
 * `staleTime` matches Rust's own status TTL and `retry: false` mirrors the hosted read: Rust
 * answers fail-closed, so a rejection is a local IPC fault rather than a transient upstream one,
 * and TanStack's default three attempts would re-open the OS secure store on each.
 */
export function useBillingEntitlement({ enabled }: { enabled: boolean }) {
  return useQuery({
    queryKey: queryKeys.billingEntitlement,
    queryFn: () => invoke<BillingEntitlement>("get_billing_entitlement"),
    enabled,
    staleTime: HOSTED_AI_STATUS_TTL_MS,
    retry: false,
  });
}

/**
 * Whether the account verifiably holds a paid plan, which is the question "manage my plan" asks.
 *
 * "At least one capability", never a tier and never `hosted_ai`: a Classic subscriber holds
 * `multi_device_sync` and `household_net_worth` and no hosted AI, and gating the Portal on the
 * hosted-AI boolean left that paying customer unable to manage or cancel their own subscription.
 */
export function holdsPaidPlan(entitlement: BillingEntitlement): boolean {
  return entitlement.established && entitlement.capabilities.length > 0;
}

/** Whether the account verifiably holds one named capability. */
export function holdsCapability(
  entitlement: BillingEntitlement,
  capability: BillingCapability,
): boolean {
  return entitlement.established && entitlement.capabilities.includes(capability);
}

/**
 * Whether the account verifiably does NOT hold one named capability — the state an upgrade
 * repairs, and deliberately not `!holdsCapability`.
 *
 * The negation is the trap this function exists to close: `!holdsCapability` is also true for an
 * entitlement that could not be established, so an upsell gated on it is shown to a user whose
 * connection failed and who may already own the capability being sold (AD-9).
 */
export function lacksCapability(
  entitlement: BillingEntitlement,
  capability: BillingCapability,
): boolean {
  return entitlement.established && !entitlement.capabilities.includes(capability);
}

/** The gate's answer before the query has resolved, so no caller has to spell the absence. */
export function entitlementOrUnestablished(
  data: BillingEntitlement | undefined,
): BillingEntitlement {
  return data ?? UNESTABLISHED;
}


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
    case "no_subscription":
      return "billing.errorNoSubscription";
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
