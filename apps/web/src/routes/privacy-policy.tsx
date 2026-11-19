import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/components/pages/LegalPage";
import { PRIVACY_POLICY } from "@/content/legal";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/privacy-policy")({
  head: () =>
    buildMeta({ path: "/privacy-policy", title: PRIVACY_POLICY.title, description: PRIVACY_POLICY.description }),
  component: () => <LegalPage doc={PRIVACY_POLICY} />,
});
