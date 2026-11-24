import { createFileRoute } from "@tanstack/react-router";

import { HomePage } from "@/components/pages/HomePage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/fr/")({
  head: () => buildMeta({ page: "home", locale: "fr" }),
  component: () => <HomePage locale="fr" />,
});
