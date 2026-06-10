import { createFileRoute } from "@tanstack/react-router";

import { ValuePillars } from "@/components/ValuePillars";
import { AIDemo } from "@/components/AIDemo";
import { BetaSection } from "@/components/BetaSection";
import { DownloadBanner } from "@/components/DownloadBanner";
import { FAQ } from "@/components/FAQ";
import { FeatureGrid } from "@/components/FeatureGrid";
import { Hero } from "@/components/Hero";
import i18n from "@/lib/i18n";
import { buildMeta } from "@/lib/meta";

// Force the i18n language to French before this route's tree renders.
// Initial client hydration already picks up "fr" from the URL via
// `detectInitialLanguage` in lib/i18n, but this loader also handles the
// server-side prerender pass and any future client-side route transitions
// into /fr/ (e.g. if a `<Link>` is added later).
async function ensureFrLanguage(): Promise<void> {
  if (i18n.language?.startsWith("fr")) return;
  await i18n.changeLanguage("fr");
}

export const Route = createFileRoute("/fr/")({
  beforeLoad: ensureFrLanguage,
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
