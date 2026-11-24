import { createFileRoute } from "@tanstack/react-router";

import { FoundingUsersPage } from "@/components/pages/FoundingUsersPage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/fr/founding-users")({
  head: () => buildMeta({ page: "foundingUsers", locale: "fr" }),
  component: () => <FoundingUsersPage locale="fr" />,
});
