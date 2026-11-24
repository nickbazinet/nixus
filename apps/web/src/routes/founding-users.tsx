import { createFileRoute } from "@tanstack/react-router";

import { FoundingUsersPage } from "@/components/pages/FoundingUsersPage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/founding-users")({
  head: () => buildMeta({ page: "foundingUsers", locale: "en" }),
  component: () => <FoundingUsersPage locale="en" />,
});
