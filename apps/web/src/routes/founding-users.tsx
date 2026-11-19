import { createFileRoute } from "@tanstack/react-router";

import { FoundingUsersPage } from "@/components/pages/FoundingUsersPage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/founding-users")({
  head: () =>
    buildMeta({
      path: "/founding-users",
      title: "Founding Users — Nixus",
      description: "Help build Nixus. Founding Users get early access at a discounted price for good, in exchange for honest feedback.",
    }),
  component: FoundingUsersPage,
});
