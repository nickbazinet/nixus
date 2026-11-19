import type { CheckoutResponse } from "@nixus/shared";
import type Stripe from "stripe";

import { getCatalog, planForLookupKey } from "../lib/catalog.ts";
import {
  checkoutCancelUrl,
  checkoutSuccessUrl,
  portalReturnUrl,
} from "../lib/destinations.ts";
import {
  hasLiveStripeSubscription,
  toEntitlementRecord,
} from "../lib/entitlement.ts";
import { fail, failValidation } from "../lib/errors.ts";
import { getStripeClient } from "../lib/stripe.ts";
import {
  acquireCheckoutLock,
  billingCustomerKey,
  CHECKOUT_LOCK_ATTRIBUTE,
  entitlementKey,
  getItem,
  STRIPE_CUSTOMER_ID_ATTRIBUTE,
} from "../lib/table.ts";
import type { ValidatedCheckoutRequest } from "../lib/validation.ts";
import { SUBSCRIPTION_SUB_METADATA_KEY } from "./webhook.ts";

/*
 * `POST /checkout` (AD-8, AD-18).
 *
 * There is deliberately NO customer-identifier parameter: the Stripe customer is
 * ALWAYS resolved from the caller's own `BILLING_CUSTOMER` record, so a token can
 * only ever open a checkout for the account it was issued to (AD-3).
 *
 * Commerce UI is Stripe-hosted without exception. Nixus renders no card field on
 * any surface, and Stripe Elements, embedded Checkout and every other in-page
 * payment component are forbidden rather than merely unused - that prohibition is
 * what keeps the integration at SAQ-A scope (AD-8).
 */

/**
 * How long the `checkout_lock` holds, in seconds.
 *
 * Five minutes: long enough to cover a request that crashed after creating a
 * Checkout Session but before answering, and short enough that a user who
 * abandoned a session can start another without support. The lock is a LAPSING
 * timestamp rather than a flag, so a crashed request cannot hold an account
 * forever, and it is never explicitly released - the window IS the "a checkout is
 * already in progress" answer.
 */
export const CHECKOUT_LOCK_TTL_SECONDS = 300;

/** Derived from the `sub` and from nothing else, which is what makes customer
 * creation at-most-once per account under retries AND concurrency (AD-18).
 * `customers.search` is deliberately NOT used: it is not read-after-write
 * consistent, so it can report "no customer" for one that exists. */
function customerIdempotencyKey(sub: string): string {
  return `nixus-billing-customer-${sub}`;
}

async function resolvePromotionCode(args: {
  readonly stripe: Stripe;
  readonly submitted: string;
}): Promise<string> {
  // `code` matching is case-insensitive and exact. A code that does not resolve
  // is `promotion_invalid`, and the SUBMITTED value is never echoed in the
  // error body or written to a log line (AD-14).
  const found = await args.stripe.promotionCodes.list({
    code: args.submitted,
    active: true,
  });

  const promotionCode = found.data[0];
  if (promotionCode === undefined) fail("promotion_invalid");
  // The `discounts` form takes the PromotionCode object's id (`promo_...`),
  // never the customer-facing code string.
  return promotionCode.id;
}

/**
 * The Checkout Session parameters, built so that every parameter Managed
 * Payments forbids is ABSENT rather than present-and-falsy - sending any of them
 * is an error, and `adaptive_pricing`, `automatic_tax`, `tax_id_collection`,
 * `payment_method_types`, `payment_method_configuration`,
 * `shipping_address_collection`, `shipping_options`, `invoice_creation` and the
 * `subscription_data` tax, fee, destination and invoice members are all
 * therefore unmentioned.
 *
 * `allow_promotion_codes` and `discounts` are MUTUALLY EXCLUSIVE and cannot both
 * be sent - not even with one set to `false` or `null`, because `null`
 * serialises to an empty string and still conflicts. So exactly one key is
 * constructed: `allow_promotion_codes: true` when no code was supplied,
 * `discounts` when one was.
 */
export function checkoutSessionParams(args: {
  readonly sub: string;
  readonly customerId: string;
  readonly priceId: string;
  readonly promotionCodeId: string | null;
}): Stripe.Checkout.SessionCreateParams {
  const { sub, promotionCodeId } = args;

  return {
    mode: "subscription",
    managed_payments: { enabled: true },
    customer: args.customerId,
    line_items: [{ price: args.priceId, quantity: 1 }],
    // Both halves of AD-8's linkage: the session carries it for the
    // `checkout.session.completed` event, and `subscription_data.metadata` puts
    // it on the Subscription so it appears on every later event.
    client_reference_id: sub,
    subscription_data: { metadata: { [SUBSCRIPTION_SUB_METADATA_KEY]: sub } },
    success_url: checkoutSuccessUrl(),
    cancel_url: checkoutCancelUrl(),
    ...(promotionCodeId === null
      ? { allow_promotion_codes: true }
      : { discounts: [{ promotion_code: promotionCodeId }] }),
  };
}

/**
 * The Customer Portal, not a second Checkout Session: an account that already
 * has a live subscription changes plan through the portal (AD-18), and a payment
 * method can only be changed there because Stripe does not permit updating
 * `subscription.default_payment_method` through the API for a Managed Payments
 * subscription (AD-8).
 *
 * UNVERIFIED, and recorded as such: Stripe's documentation has no dedicated
 * "Managed Payments + Customer Portal" page, and portal support is confirmed
 * only indirectly through that update-parameter note. Confirm in the sandbox
 * before live mode.
 */
export async function createPortalSessionUrl(args: {
  readonly stripe: Stripe;
  readonly customerId: string;
}): Promise<string> {
  const session = await args.stripe.billingPortal.sessions.create({
    customer: args.customerId,
    return_url: portalReturnUrl(),
  });
  return session.url;
}

async function hasLiveSubscription(sub: string): Promise<boolean> {
  const stored = await getItem(entitlementKey(sub));
  if (stored === undefined) return false;
  // The authority's own record, not a second Stripe read (AD-4) - and the
  // RECORDED STRIPE state, not the effective one, because a live admin override
  // pins effective status to `none` (AD-2) and double-charged whoever had paid.
  return hasLiveStripeSubscription(toEntitlementRecord(stored));
}

function storedCustomerId(
  item: Record<string, unknown> | undefined,
): string | null {
  const value = item?.[STRIPE_CUSTOMER_ID_ATTRIBUTE];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function handleCheckout(args: {
  readonly sub: string;
  readonly request: ValidatedCheckoutRequest;
  readonly now: Date;
  readonly requestId: string;
}): Promise<CheckoutResponse> {
  const { sub, request, now, requestId } = args;
  const nowSeconds = Math.floor(now.getTime() / 1000);

  const stripe = await getStripeClient();
  const existing = await getItem(billingCustomerKey(sub));

  if (await hasLiveSubscription(sub)) {
    const customerId = storedCustomerId(existing);
    if (customerId === null) {
      // A live entitlement with no recorded customer is a server-side
      // inconsistency, not something the caller can fix or should be told about.
      fail("unavailable");
    }
    return {
      url: await createPortalSessionUrl({ stripe, customerId }),
      destination: "portal",
    };
  }

  // Validated against the CURRENT catalog before Stripe is called, and the
  // submitted value is not echoed (AD-8).
  const catalog = await getCatalog({ now, requestId });
  const plan = planForLookupKey(catalog, request.planLookupKey);
  if (plan === null) {
    failValidation("plan_lookup_key", "not_allowed");
  }

  const promotionCodeId =
    request.promotionCode === null
      ? null
      : await resolvePromotionCode({ stripe, submitted: request.promotionCode });

  // At most once per `sub`, by idempotency key rather than by the lock: two
  // genuinely concurrent requests both call this and both receive the SAME
  // customer (AD-18).
  const customerId =
    storedCustomerId(existing) ??
    (
      await stripe.customers.create(
        { metadata: { [SUBSCRIPTION_SUB_METADATA_KEY]: sub } },
        { idempotencyKey: customerIdempotencyKey(sub) },
      )
    ).id;

  // Recorded BEFORE the session URL is returned, in the same conditional write
  // that takes the lock - so a webhook can always resolve back to the account,
  // and a second concurrent attempt is refused rather than answered with a
  // second session URL.
  const lock = await acquireCheckoutLock({
    nowSeconds,
    item: {
      ...billingCustomerKey(sub),
      ...existing,
      ...billingCustomerKey(sub),
      [STRIPE_CUSTOMER_ID_ATTRIBUTE]: customerId,
      [CHECKOUT_LOCK_ATTRIBUTE]: nowSeconds + CHECKOUT_LOCK_TTL_SECONDS,
      price_lookup_key: plan.entry.lookup_key,
      updated_at: now.toISOString(),
    },
  });
  if (lock === "already_locked") {
    fail("checkout_in_progress");
  }

  const session = await stripe.checkout.sessions.create(
    checkoutSessionParams({
      sub,
      customerId,
      priceId: plan.priceId,
      promotionCodeId,
    }),
  );

  if (session.url === null) {
    fail("unavailable");
  }
  return { url: session.url, destination: "checkout" };
}
