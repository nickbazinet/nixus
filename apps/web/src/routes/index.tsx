import { createFileRoute } from "@tanstack/react-router";

import { ValuePillars } from "@/components/ValuePillars";
import { AIDemo } from "@/components/AIDemo";
import { BetaSection } from "@/components/BetaSection";
import { DownloadBanner } from "@/components/DownloadBanner";
import { FAQ } from "@/components/FAQ";
import { FeatureGrid } from "@/components/FeatureGrid";
import { HERO_BACKDROP_PRELOADS, Hero } from "@/components/Hero";
import { applyRouteLocale } from "@/lib/i18n";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/")({
  beforeLoad: () => applyRouteLocale("en"),
  head: () => {
    const meta = buildMeta({ locale: "en" });
    return { ...meta, links: [...meta.links, ...HERO_BACKDROP_PRELOADS] };
  },
  component: HomePage,
});

function HomePage() {
  return (
    <>
      <Hero />
      <DownloadBanner />
      <ValuePillars />
      <AIDemo />
      <FeatureGrid />
      <BetaSection />
      <FAQ />
    </>
  );
}
