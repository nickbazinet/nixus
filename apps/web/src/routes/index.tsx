import { createFileRoute } from "@tanstack/react-router";

import { HomePage } from "@/components/pages/HomePage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/")({
  head: () => buildMeta({ page: "home", locale: "en" }),
  component: () => <HomePage locale="en" />,
});
