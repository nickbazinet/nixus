import {
  isPlanLookupKeyShaped,
  isPromotionCodeShaped,
  type BillingErrorCode,
  type BillingValidationField,
  type BillingValidationReason,
  type CheckoutDestination,
} from "@nixus/shared";

import type { BillingApi } from "./billing-client.ts";

/**
 * The checkout and portal paths' awkward outcomes, in one place.
 *
 * Modelled as a union rather than thrown, for the same reason `profile-save.ts`
 * models a save that way: two of these are not errors and must not read as one.
 *
 *  - `checkout_in_progress` means a Checkout Session the user opened minutes ago
 *    is still live (billing AD-18). "A checkout is already open" is the honest
 *    sentence; a generic failure would push them into retrying, which is exactly
 *    what the lock exists to stop.
 *  - `promotion_invalid` belongs next to the promotion-code field, and the
 *    submitted code is NEVER carried back into this union — not in a value, not
 *    in a message (billing AD-8, AD-14).
 *  - `indeterminate` is a request whose response was never observed. A Checkout
 *    Session may exist and the lock may be held, so "it failed" would be a lie;
 *    the UI says it could not be confirmed and to try again shortly.
 */

export interface CheckoutRefusal {
  readonly code: BillingErrorCode;
  readonly field: BillingValidationField | null;
  readonly reason: BillingValidationReason | null;
}

export type CheckoutOutcome =
  /** `destination` is the SERVER's answer under AD-18; the UI only opens `url`. */
  | {
      readonly kind: "redirect";
      readonly url: string;
      readonly destination: CheckoutDestination;
    }
  | { readonly kind: "checkout_in_progress" }
  | { readonly kind: "promotion_invalid" }
  | ({ readonly kind: "rejected" } & CheckoutRefusal)
  | { readonly kind: "indeterminate" };

export type PortalOutcome =
  | { readonly kind: "redirect"; readonly url: string }
  | { readonly kind: "rejected"; readonly code: BillingErrorCode }
  | { readonly kind: "indeterminate" };

export interface CheckoutInput {
  readonly planLookupKey: unknown;
  readonly promotionCode: unknown;
}

export interface NarrowedCheckoutInput {
  readonly planLookupKey: string | null;
  readonly promotionCode: string | null;
  /** True when a code was submitted at all, so a malformed one is told apart from none. */
  readonly promotionCodeSubmitted: boolean;
}

/**
 * Shape narrowing only (billing AD-8).
 *
 * The billing API is the single validation authority — whether a `lookup_key`
 * names a published Price, and whether a promotion code is redeemable, are its
 * answers. This decides only what the member's type is before it crosses the
 * wire, so a malformed value costs no Stripe call and is refused without being
 * echoed.
 */
export function narrowCheckoutInput(input: CheckoutInput): NarrowedCheckoutInput {
  const submitted =
    typeof input.promotionCode === "string" && input.promotionCode.trim() !== "";
  return {
    planLookupKey: isPlanLookupKeyShaped(input.planLookupKey) ? input.planLookupKey : null,
    promotionCode: isPromotionCodeShaped(input.promotionCode) ? input.promotionCode : null,
    promotionCodeSubmitted: submitted,
  };
}

function refuse(
  field: BillingValidationField,
  reason: BillingValidationReason,
): CheckoutOutcome {
  return { kind: "rejected", code: "validation", field, reason };
}

export async function startCheckoutSession(
  api: BillingApi,
  input: CheckoutInput,
): Promise<CheckoutOutcome> {
  const narrowed = narrowCheckoutInput(input);
  if (narrowed.planLookupKey === null) {
    return refuse("plan_lookup_key", "invalid_format");
  }
  if (narrowed.promotionCodeSubmitted && narrowed.promotionCode === null) {
    return refuse("promotion_code", "invalid_format");
  }

  let result;
  try {
    result = await api.startCheckout({
      planLookupKey: narrowed.planLookupKey,
      promotionCode: narrowed.promotionCode,
    });
  } catch {
    return { kind: "indeterminate" };
  }

  if (result.ok) {
    return {
      kind: "redirect",
      url: result.value.url,
      destination: result.value.destination,
    };
  }

  const { error } = result;
  if (error.code === "checkout_in_progress") return { kind: "checkout_in_progress" };
  if (error.code === "promotion_invalid") return { kind: "promotion_invalid" };
  // A `validation` refusal blaming the promotion code is the same conversation
  // as `promotion_invalid` to a user, and is routed to the field either way.
  return {
    kind: "rejected",
    code: error.code,
    field: "field" in error ? error.field : null,
    reason: "reason" in error ? error.reason : null,
  };
}

export async function openPortalSession(api: BillingApi): Promise<PortalOutcome> {
  let result;
  try {
    result = await api.createPortalSession();
  } catch {
    // A portal session is a read as far as the user is concerned: nothing was
    // charged and nothing was changed, so "could not be confirmed" is honest.
    return { kind: "indeterminate" };
  }
  return result.ok
    ? { kind: "redirect", url: result.value.url }
    : { kind: "rejected", code: result.error.code };
}
