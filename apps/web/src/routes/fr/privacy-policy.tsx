import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/components/pages/LegalPage";
import { privacyPolicyFor } from "@/content/legal";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/fr/privacy-policy")({
  head: () => buildMeta({ page: "privacyPolicy", locale: "fr" }),
  component: () => <LegalPage doc={privacyPolicyFor("fr")} locale="fr" />,
});
