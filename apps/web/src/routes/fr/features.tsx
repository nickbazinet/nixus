import { createFileRoute } from "@tanstack/react-router";

import { FeaturesPage } from "@/components/pages/FeaturesPage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/fr/features")({
  head: () => buildMeta({ page: "features", locale: "fr" }),
  component: () => <FeaturesPage locale="fr" />,
});
