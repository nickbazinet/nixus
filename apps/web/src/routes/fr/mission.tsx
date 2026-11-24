import { createFileRoute } from "@tanstack/react-router";

import { MissionPage } from "@/components/pages/MissionPage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/fr/mission")({
  head: () => buildMeta({ page: "mission", locale: "fr" }),
  component: () => <MissionPage locale="fr" />,
});
