import { createFileRoute } from "@tanstack/react-router";

import { LegalPage } from "@/components/pages/LegalPage";
import { privacyPolicyFor } from "@/content/legal";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/privacy-policy")({
  head: () => buildMeta({ page: "privacyPolicy", locale: "en" }),
  component: () => <LegalPage doc={privacyPolicyFor("en")} locale="en" />,
});
