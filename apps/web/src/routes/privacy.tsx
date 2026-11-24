import { createFileRoute } from "@tanstack/react-router";

import { PrivacyPage } from "@/components/pages/PrivacyPage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/privacy")({
  head: () => buildMeta({ page: "privacy", locale: "en" }),
  component: () => <PrivacyPage locale="en" />,
});
