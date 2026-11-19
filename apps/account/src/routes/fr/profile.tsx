import { createFileRoute, redirect } from "@tanstack/react-router";

import { loadAccountPage } from "@/actions/page";
import { AccountPage } from "@/components/AccountPage";
import { loginLocation } from "@/server/destinations";

/** `GET /fr/profile` — the French half of the account page. See `routes/profile.tsx`. */
export const Route = createFileRoute("/fr/profile")({
  loader: async () => {
    const data = await loadAccountPage("fr");
    if (!data.account.signedIn) throw redirect({ href: loginLocation("fr") });
    return data;
  },
  staleTime: Infinity,
  head: () => ({ meta: [{ title: "Profil — Compte Nixus Cloud" }] }),
  component: FrenchProfile,
});

function FrenchProfile() {
  const { account, billing } = Route.useLoaderData();
  return (
    <AccountPage
      account={account}
      billing={billing}
      locale="fr"
      initialSection="personal"
      planParam={null}
    />
  );
}
