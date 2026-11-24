import { createFileRoute } from "@tanstack/react-router";

import { MissionPage } from "@/components/pages/MissionPage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/mission")({
  head: () => buildMeta({ page: "mission", locale: "en" }),
  component: () => <MissionPage locale="en" />,
});
