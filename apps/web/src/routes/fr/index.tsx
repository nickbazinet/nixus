import { createFileRoute } from "@tanstack/react-router";

import { ValuePillars } from "@/components/ValuePillars";
import { BetaSection } from "@/components/BetaSection";
import { DownloadBanner } from "@/components/DownloadBanner";
import { FAQ } from "@/components/FAQ";
import { FeatureGrid } from "@/components/FeatureGrid";
import { FoundingSection } from "@/components/FoundingSection";
import { HERO_BACKDROP_PRELOADS, Hero } from "@/components/Hero";
import { applyRouteLocale } from "@/lib/i18n";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/fr/")({
  beforeLoad: () => applyRouteLocale("fr"),
  head: () => {
    const meta = buildMeta({ locale: "fr" });
    return { ...meta, links: [...meta.links, ...HERO_BACKDROP_PRELOADS] };
  },
  component: HomePageFr,
});

function HomePageFr() {
  return (
    <>
      <Hero />
      <DownloadBanner />
      <FoundingSection />
      <ValuePillars />
      <FeatureGrid />
      <BetaSection />
      <FAQ />
    </>
  );
}
