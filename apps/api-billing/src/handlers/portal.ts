import type { PortalResponse } from "@nixus/shared";

import { fail } from "../lib/errors.ts";
import { getStripeClient } from "../lib/stripe.ts";
import {
  billingCustomerKey,
  getItem,
  STRIPE_CUSTOMER_ID_ATTRIBUTE,
} from "../lib/table.ts";
import { createPortalSessionUrl } from "./checkout.ts";

/*
 * `POST /portal` (AD-3, AD-8).
 *
 * It takes no customer identifier for the same reason `handleCheckout` does not:
 * the Stripe customer is resolved from the CALLER'S OWN `BILLING_CUSTOMER`
 * record, so a portal session can never be minted for someone else's customer.
 *
 * Payment-method changes link here rather than to a custom form, because Stripe
 * does not permit updating a Managed Payments subscription's default payment
 * method through the API - so no such path is built (AD-8).
 */
export async function handlePortal(args: {
  readonly sub: string;
  readonly now: Date;
}): Promise<PortalResponse> {
  void args.now;

  const stored = await getItem(billingCustomerKey(args.sub));
  const customerId = stored?.[STRIPE_CUSTOMER_ID_ATTRIBUTE];

  if (typeof customerId !== "string" || customerId.length === 0) {
    // A caller who has never checked out has no portal to open. A clean refusal
    // rather than a 500, and the account is never named in it (AD-14).
    fail("no_subscription");
  }

  const stripe = await getStripeClient();
  return { url: await createPortalSessionUrl({ stripe, customerId }) };
}
