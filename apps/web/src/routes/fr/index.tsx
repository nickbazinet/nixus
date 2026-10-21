import { createFileRoute } from "@tanstack/react-router";

import { HomeSections } from "@/components/HomeSections";
import { HERO_BACKDROP_PRELOADS } from "@/components/Hero";
import { applyRouteLocale } from "@/lib/i18n";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/fr/")({
  beforeLoad: () => applyRouteLocale("fr"),
  head: () => {
    const meta = buildMeta({ locale: "fr" });
    return { ...meta, links: [...meta.links, ...HERO_BACKDROP_PRELOADS] };
  },
  component: HomeSections,
});
