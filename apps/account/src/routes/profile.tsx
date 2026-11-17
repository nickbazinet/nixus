import { createFileRoute } from "@tanstack/react-router";

import { loadAccountView } from "@/actions/account";
import { AccountPage } from "@/components/AccountPage";

export const Route = createFileRoute("/profile")({
  loader: () => loadAccountView({ data: { locale: "en" } }),
  head: () => ({ meta: [{ title: "Profile — Nixus Cloud account" }] }),
  component: EnglishProfile,
});

function EnglishProfile() {
  return <AccountPage view={Route.useLoaderData()} locale="en" />;
}
