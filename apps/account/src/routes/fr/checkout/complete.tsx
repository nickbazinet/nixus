import { createFileRoute, redirect } from "@tanstack/react-router";

import { loadEntitlement } from "@/actions/billing";
import { CheckoutCompletePanel } from "@/components/CheckoutCompletePanel";
import { billingLoginLocation } from "@/server/destinations";

/** `GET /fr/checkout/complete` — the French landing page. See `routes/checkout/complete.tsx`. */
export const Route = createFileRoute("/fr/checkout/complete")({
  loader: async () => {
    const snapshot = await loadEntitlement();
    if (!snapshot.signedIn) throw redirect({ href: billingLoginLocation("fr") });
    return snapshot.entitlement;
  },
  head: () => ({
    meta: [
      { title: "Merci — Compte Nixus Cloud" },
      { name: "description", content: "Votre forfait Nixus Cloud est en cours de mise à jour." },
    ],
  }),
  component: FrenchCheckoutComplete,
});

function FrenchCheckoutComplete() {
  return <CheckoutCompletePanel initial={Route.useLoaderData()} locale="fr" />;
}
