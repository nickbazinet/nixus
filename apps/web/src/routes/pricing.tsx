import { createFileRoute } from "@tanstack/react-router";

import { PricingPage } from "@/components/pages/PricingPage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/pricing")({
  head: () => buildMeta({ page: "pricing", locale: "en" }),
  component: () => <PricingPage locale="en" />,
});
