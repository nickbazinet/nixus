import { createFileRoute } from "@tanstack/react-router";

import { PrivacyPage } from "@/components/pages/PrivacyPage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/privacy")({
  head: () =>
    buildMeta({
      path: "/privacy",
      title: "Privacy — Nixus",
      description: "No bank logins. Your records live on your computer, and cloud features are off until you turn them on. Exactly what leaves your computer, and when.",
    }),
  component: PrivacyPage,
});
