import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/components/pages/LegalPage";
import { TERMS } from "@/content/legal";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/terms")({
  head: () =>
    buildMeta({ path: "/terms", title: TERMS.title, description: TERMS.description }),
  component: () => <LegalPage doc={TERMS} />,
});
