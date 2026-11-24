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
  billingCustomerKey,
  CHECKOUT_LOCK_ATTRIBUTE,
  CHECKOUT_SESSION_ID_ATTRIBUTE,
  entitlementKey,
  getItem,
  STRIPE_CUSTOMER_ID_ATTRIBUTE,
  writeCheckoutLock,
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
 * Checkout Session but before recording it. The lock is a LAPSING timestamp
 * rather than a flag, so a crashed request cannot hold an account forever.
 *
 * It does not make a returning user wait: once the holder's session is
 * recorded, a new attempt asks Stripe to expire it and takes the lock over. Only
 * a session that is mid-creation, or one that just completed, answers
 * `checkout_in_progress`.
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
 *
 * `subscription_data.trial_period_days` is the ONLY way a Checkout Session
 * starts a free trial. Stripe's Checkout guide names `trial_period_days` and
 * `trial_end` under `subscription_data` and nothing else: a trial configured on
 * the Price is not read here (`recurring.trial_period_days` is not even a
 * creatable Price parameter), and the newer Trial Offer objects are documented
 * as unsupported by Checkout Sessions outside a private preview. So the length
 * travels from Stripe PRICE metadata through the catalog to this parameter, and
 * a Price with no trial produces NO trial key at all.
 *
 * Managed Payments supports a trialing subscription - its changelog records the
 * trial confirmation email and optional no-card trials - and
 * `subscription_data.trial_period_days` is absent from its forbidden-parameter
 * table. Two parameters are deliberately NOT sent with it:
 * `payment_method_collection`, so the default `always` stands and the card is
 * collected up front as the offer states, and `trial_settings`, whose only
 * purpose is the missing-payment-method case that therefore cannot arise.
 */
export function checkoutSessionParams(args: {
  readonly sub: string;
  readonly customerId: string;
  readonly priceId: string;
  readonly promotionCodeId: string | null;
  /** From the catalog entry's `trial_period_days`. `null` is "no trial". */
  readonly trialPeriodDays: number | null;
}): Stripe.Checkout.SessionCreateParams {
  const { sub, promotionCodeId, trialPeriodDays } = args;

  return {
    mode: "subscription",
    managed_payments: { enabled: true },
    customer: args.customerId,
    line_items: [{ price: args.priceId, quantity: 1 }],
    // Both halves of AD-8's linkage: the session carries it for the
    // `checkout.session.completed` event, and `subscription_data.metadata` puts
    // it on the Subscription so it appears on every later event.
    client_reference_id: sub,
    subscription_data: {
      metadata: { [SUBSCRIPTION_SUB_METADATA_KEY]: sub },
      ...(trialPeriodDays === null
        ? {}
        : { trial_period_days: trialPeriodDays }),
    },
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

function storedLock(item: Record<string, unknown> | undefined): number | null {
  const value = item?.[CHECKOUT_LOCK_ATTRIBUTE];
  return typeof value === "number" ? value : null;
}

function storedSessionId(item: Record<string, unknown> | undefined): string | null {
  const value = item?.[CHECKOUT_SESSION_ID_ATTRIBUTE];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stripeStatusCode(error: unknown): number | null {
  const value = (error as { statusCode?: unknown } | null)?.statusCode;
  return typeof value === "number" ? value : null;
}

/** A 4xx is Stripe refusing the request outright, so nothing was created. Any
 * other failure may have created the session and must keep the lock. */
function refusedOutright(error: unknown): boolean {
  const status = stripeStatusCode(error);
  return status !== null && status >= 400 && status < 500;
}

type SessionState = "open" | "complete" | "gone";

async function sessionState(stripe: Stripe, sessionId: string): Promise<SessionState> {
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (error) {
    // Unknown to this Stripe account, so it can never complete here.
    if (stripeStatusCode(error) === 404) return "gone";
    throw error;
  }
  if (session.status === "open") return "open";
  if (session.status === "complete") return "complete";
  return "gone";
}

/**
 * Closes the session a previous attempt opened, and says what became of it.
 *
 * `expire` is refused for a session that is no longer open, which is how a
 * session completing at this same moment is told apart from one this call
 * closed: the status is read again rather than assumed.
 */
async function closePreviousSession(
  stripe: Stripe,
  sessionId: string,
): Promise<SessionState> {
  const state = await sessionState(stripe, sessionId);
  if (state !== "open") return state;
  try {
    const expired = await stripe.checkout.sessions.expire(sessionId);
    if (expired.status === "expired") return "gone";
  } catch {
    // Completed, or already expired by a concurrent attempt. Read it again.
  }
  return sessionState(stripe, sessionId);
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

  const heldUntil = storedLock(existing);
  const previousSessionId = storedSessionId(existing);
  const liveHolder =
    heldUntil !== null && heldUntil > nowSeconds
      ? { heldUntil, sessionId: previousSessionId }
      : null;

  // The holder has not recorded its session yet, so there is nothing to close.
  if (liveHolder !== null && liveHolder.sessionId === null) {
    fail("checkout_in_progress");
  }

  // Closed even once the lock has lapsed: a session stays payable for a day,
  // far longer than the lock, and an open one is a second subscription waiting.
  if (previousSessionId !== null) {
    const previous = await closePreviousSession(stripe, previousSessionId);
    if (previous === "open") fail("unavailable");
    if (previous === "complete" && liveHolder !== null) fail("checkout_in_progress");
  }

  const unlocked: Record<string, unknown> = {
    ...existing,
    ...billingCustomerKey(sub),
    [STRIPE_CUSTOMER_ID_ATTRIBUTE]: customerId,
    price_lookup_key: plan.entry.lookup_key,
    updated_at: now.toISOString(),
  };
  delete unlocked[CHECKOUT_LOCK_ATTRIBUTE];
  delete unlocked[CHECKOUT_SESSION_ID_ATTRIBUTE];
  const lockUntil = nowSeconds + CHECKOUT_LOCK_TTL_SECONDS;
  const locked = { ...unlocked, [CHECKOUT_LOCK_ATTRIBUTE]: lockUntil };
  const owned = { kind: "owned", heldUntil: lockUntil } as const;

  // Recorded BEFORE the session URL is returned, in the same conditional write
  // that takes the lock - so a webhook can always resolve back to the account,
  // and a second concurrent attempt is refused rather than answered with a
  // second session URL.
  const lock = await writeCheckoutLock({
    item: locked,
    claim:
      liveHolder?.sessionId != null
        ? { kind: "take_over", heldUntil: liveHolder.heldUntil, sessionId: liveHolder.sessionId }
        : { kind: "acquire", nowSeconds },
  });
  if (lock === "lost") {
    fail("checkout_in_progress");
  }

  let session;
  try {
    session = await stripe.checkout.sessions.create(
      checkoutSessionParams({
        sub,
        customerId,
        priceId: plan.priceId,
        promotionCodeId,
        trialPeriodDays: plan.entry.trial_period_days,
      }),
    );
  } catch (error) {
    if (refusedOutright(error)) {
      // Nothing was created, so a retry should not wait out the lock.
      await writeCheckoutLock({ item: unlocked, claim: owned }).catch(() => undefined);
    }
    throw error;
  }

  const recorded = await writeCheckoutLock({
    item: { ...locked, [CHECKOUT_SESSION_ID_ATTRIBUTE]: session.id },
    claim: owned,
  });
  if (recorded === "lost") {
    // The lock lapsed under this request and another attempt holds it now. This
    // session is unrecorded, so it is closed rather than left payable.
    await stripe.checkout.sessions.expire(session.id).catch(() => undefined);
    fail("checkout_in_progress");
  }

  if (session.url === null) {
    fail("unavailable");
  }
  return { url: session.url, destination: "checkout" };
}
