import { createFileRoute } from "@tanstack/react-router";

import { FeaturesPage } from "@/components/pages/FeaturesPage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/features")({
  head: () => buildMeta({ page: "features", locale: "en" }),
  component: () => <FeaturesPage locale="en" />,
});
