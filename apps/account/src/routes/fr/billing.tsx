import { createFileRoute, redirect } from "@tanstack/react-router";

import { loadBillingView } from "@/actions/billing";
import { BillingPanel } from "@/components/BillingPanel";
import { billingLoginLocation } from "@/server/destinations";

/** `GET /fr/billing` — the French half of the billing page. See `routes/billing.tsx`. */
export const Route = createFileRoute("/fr/billing")({
  // The member is OMITTED rather than nulled when absent, because a narrowed
  // search object the router cannot round-trip makes it redirect to a canonical
  // url: `GET /billing` would answer `/billing?plan=null`, which is both ugly
  // and an extra hop in front of the sign-in gate.
  validateSearch: (search: Record<string, unknown>): { plan?: string } =>
    typeof search.plan === "string" ? { plan: search.plan } : {},
  loader: async () => {
    const view = await loadBillingView();
    if (!view.signedIn) throw redirect({ href: billingLoginLocation("fr") });
    return view;
  },
  head: () => ({
    meta: [
      { title: "Forfait et facturation — Compte Nixus Cloud" },
      {
        name: "description",
        content: "Consultez votre forfait Nixus Cloud, changez-le ou annulez-le.",
      },
    ],
  }),
  component: FrenchBilling,
});

function FrenchBilling() {
  return (
    <BillingPanel
      view={Route.useLoaderData()}
      locale="fr"
      planParam={Route.useSearch().plan ?? null}
    />
  );
}
