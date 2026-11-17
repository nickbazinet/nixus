import { createFileRoute } from "@tanstack/react-router";

import { loadAccountView } from "@/actions/account";
import { AccountPage } from "@/components/AccountPage";

export const Route = createFileRoute("/fr/profile")({
  loader: () => loadAccountView({ data: { locale: "fr" } }),
  head: () => ({ meta: [{ title: "Profil — Compte Nixus Cloud" }] }),
  component: FrenchProfile,
});

function FrenchProfile() {
  return <AccountPage view={Route.useLoaderData()} locale="fr" />;
}
