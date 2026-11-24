import { createFileRoute } from "@tanstack/react-router";

import { NotFoundPage } from "@/components/pages/NotFoundPage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/404")({
  head: () => buildMeta({ page: "notFound", locale: "en" }),
  component: () => <NotFoundPage locale="en" />,
});
