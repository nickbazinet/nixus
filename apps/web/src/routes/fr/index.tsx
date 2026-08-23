import { createFileRoute } from "@tanstack/react-router";

import { ValuePillars } from "@/components/ValuePillars";
import { AIDemo } from "@/components/AIDemo";
import { BetaSection } from "@/components/BetaSection";
import { DownloadBanner } from "@/components/DownloadBanner";
import { FAQ } from "@/components/FAQ";
import { FeatureGrid } from "@/components/FeatureGrid";
import { Hero } from "@/components/Hero";
import { applyRouteLocale } from "@/lib/i18n";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/fr/")({
  beforeLoad: () => applyRouteLocale("fr"),
  head: () => buildMeta({ locale: "fr", path: "/fr/" }),
  component: HomePageFr,
});

function HomePageFr() {
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
