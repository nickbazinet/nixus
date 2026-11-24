import { createFileRoute } from "@tanstack/react-router";

import { PricingPage } from "@/components/pages/PricingPage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/fr/pricing")({
  head: () => buildMeta({ page: "pricing", locale: "fr" }),
  component: () => <PricingPage locale="fr" />,
});
