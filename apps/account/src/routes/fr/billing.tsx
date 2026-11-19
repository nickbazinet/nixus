import { createFileRoute, redirect } from "@tanstack/react-router";

import { loadAccountPage } from "@/actions/page";
import { AccountPage } from "@/components/AccountPage";
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
    const data = await loadAccountPage("fr");
    if (!data.account.signedIn || !data.billing.signedIn) {
      throw redirect({ href: billingLoginLocation("fr") });
    }
    return data;
  },
  staleTime: Infinity,
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
  const { account, billing } = Route.useLoaderData();
  return (
    <AccountPage
      account={account}
      billing={billing}
      locale="fr"
      initialSection="subscription"
      planParam={Route.useSearch().plan ?? null}
    />
  );
}
