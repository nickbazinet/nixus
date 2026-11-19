import { createFileRoute } from "@tanstack/react-router";

import { PricingPage } from "@/components/pages/PricingPage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/pricing")({
  head: () =>
    buildMeta({
      path: "/pricing",
      title: "Pricing — Nixus",
      description: "Nixus is free on your computer and needs no account. NixusCloud adds household views and AI when you want them.",
    }),
  component: PricingPage,
});
