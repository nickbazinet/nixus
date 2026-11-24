import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/components/pages/LegalPage";
import { termsFor } from "@/content/legal";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/fr/terms")({
  head: () => buildMeta({ page: "terms", locale: "fr" }),
  component: () => <LegalPage doc={termsFor("fr")} locale="fr" />,
});
