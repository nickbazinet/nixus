import { createFileRoute } from "@tanstack/react-router";

import { ValuePillars } from "@/components/ValuePillars";
import { AIDemo } from "@/components/AIDemo";
import { BetaSection } from "@/components/BetaSection";
import { DownloadBanner } from "@/components/DownloadBanner";
import { FAQ } from "@/components/FAQ";
import { FeatureGrid } from "@/components/FeatureGrid";
import { Hero } from "@/components/Hero";
import { buildMeta } from "@/lib/meta";

export const Route = createFileRoute("/")({
  head: () => buildMeta({ locale: "en" }),
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
