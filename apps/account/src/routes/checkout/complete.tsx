import { createFileRoute, redirect } from "@tanstack/react-router";

import { loadEntitlement } from "@/actions/billing";
import { CheckoutCompletePanel } from "@/components/CheckoutCompletePanel";
import { billingLoginLocation } from "@/server/destinations";

/**
 * `GET /checkout/complete` — Stripe's `success_url` (billing AD-5, AD-8).
 *
 * The loader takes ONE read; the bounded polling happens in the panel, because
 * blocking the first paint on a webhook that has not landed yet would leave the
 * visitor on a blank page after a successful payment.
 *
 * It carries no query parameter of its own. The session identifies the account,
 * so there is nothing for Stripe to hand back and nothing for a visitor to
 * forge: a `session_id` in the URL would be a value this page would have to
 * trust, and it is not asked for.
 */
export const Route = createFileRoute("/checkout/complete")({
  loader: async () => {
    const snapshot = await loadEntitlement();
    if (!snapshot.signedIn) throw redirect({ href: billingLoginLocation("en") });
    return snapshot.entitlement;
  },
  head: () => ({
    meta: [
      { title: "Thank you — Nixus Cloud account" },
      { name: "description", content: "Your Nixus Cloud plan is being updated." },
    ],
  }),
  component: EnglishCheckoutComplete,
});

function EnglishCheckoutComplete() {
  return <CheckoutCompletePanel initial={Route.useLoaderData()} locale="en" />;
}
