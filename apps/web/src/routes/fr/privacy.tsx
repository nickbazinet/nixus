import { createFileRoute } from "@tanstack/react-router";

import { PrivacyPage } from "@/components/pages/PrivacyPage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/fr/privacy")({
  head: () => buildMeta({ page: "privacy", locale: "fr" }),
  component: () => <PrivacyPage locale="fr" />,
});
