import { createFileRoute, redirect } from "@tanstack/react-router";

import { loadAccountView } from "@/actions/account";
import { ProfilePanel } from "@/components/ProfilePanel";
import { loginLocation } from "@/server/destinations";

export const Route = createFileRoute("/fr/profile")({
  loader: async () => {
    const view = await loadAccountView({ data: { locale: "fr" } });
    if (!view.signedIn) throw redirect({ href: loginLocation("fr") });
    return view;
  },
  head: () => ({ meta: [{ title: "Profil — Compte Nixus Cloud" }] }),
  component: FrenchProfile,
});

function FrenchProfile() {
  return <ProfilePanel view={Route.useLoaderData()} locale="fr" />;
}
