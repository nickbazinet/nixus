import { createFileRoute } from "@tanstack/react-router";

import { FeaturesPage } from "@/components/pages/FeaturesPage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/features")({
  head: () =>
    buildMeta({
      path: "/features",
      title: "Features — Nixus",
      description: "Statement import in seconds, next actions, TFSA, RRSP and FHSA tracking, budgets and net worth history. Personal finance with the busywork taken out.",
    }),
  component: FeaturesPage,
});
