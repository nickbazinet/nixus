import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/components/pages/LegalPage";
import { termsFor } from "@/content/legal";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/terms")({
  head: () => buildMeta({ page: "terms", locale: "en" }),
  component: () => <LegalPage doc={termsFor("en")} locale="en" />,
});
