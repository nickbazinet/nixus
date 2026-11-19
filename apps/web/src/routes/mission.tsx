import { createFileRoute } from "@tanstack/react-router";

import { MissionPage } from "@/components/pages/MissionPage";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/mission")({
  head: () =>
    buildMeta({
      path: "/mission",
      title: "Our mission — Nixus",
      description: "Improve the financial stability of the average Canadian. Why Nixus exists, what it promises, and what it cannot do yet.",
    }),
  component: MissionPage,
});
