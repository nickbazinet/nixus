import { createFileRoute } from "@tanstack/react-router";

import { SignInPanel } from "@/components/SignInPanel";

export const Route = createFileRoute("/fr/")({
  head: () => ({ meta: [{ title: "Compte Nixus Cloud" }] }),
  component: () => <SignInPanel locale="fr" />,
});
