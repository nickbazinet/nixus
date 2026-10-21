import { BetaSection } from "@/components/BetaSection";
import { ClosingCTA } from "@/components/ClosingCTA";
import { DownloadBanner } from "@/components/DownloadBanner";
import { FAQ } from "@/components/FAQ";
import { FeatureGrid } from "@/components/FeatureGrid";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { IsIsnt } from "@/components/IsIsnt";
import { PrivacySection } from "@/components/PrivacySection";
import { ProductTour } from "@/components/ProductTour";
import { StageShowcase } from "@/components/StageShowcase";
import { TrustStrip } from "@/components/TrustStrip";
import { ValuePillars } from "@/components/ValuePillars";

/**
 * The homepage composition, shared by `/` and `/fr/`.
 *
 * Extracted because the two routes previously listed the same sections
 * independently, so every structural change had to be made twice and a missed
 * one would ship a French page with different content — a silent divergence no
 * test covered. The routes now own only their locale, meta, and preloads.
 *
 * Section order is the visitor's decision path, not visual symmetry. Each
 * section has one job: hook (hero), grounds to keep reading (trust), why this
 * rather than the alternatives (pillars), what the routine actually is (how it
 * works), prove each claim with the real surface (stages), see the whole thing
 * move (tour), inventory the rest (features), answer the objection this audience
 * leads with (privacy), qualify honestly (is/isn't), invite (founding), resolve
 * residual doubt (FAQ), convert (closing).
 *
 * The tour sits AFTER the stage showcase rather than before it. Ahead of the
 * proof a visitor has no vocabulary for what they are watching; after it, the
 * film reads as confirmation of four claims they have already been shown.
 *
 * Two orderings are deliberate corrections to the previous page.
 *
 * The founding-user ask used to sit second, directly under the hero — asking a
 * visitor to join a program before showing them a single product surface. It now
 * lands after the proof and the honest qualification, where a reader has what
 * they need to say yes.
 *
 * The page used to end on the FAQ, so a convinced visitor's last impression was
 * a list of caveats with nowhere to act. `ClosingCTA` is the resolution.
 *
 * Bands alternate paper / tint strictly, so no two adjacent sections share a
 * surface, and `--mkt-band-deep` is spent exactly once, on the closing band.
 */
export function HomeSections() {
  return (
    <>
      <Hero />
      <DownloadBanner />
      <TrustStrip />
      <ValuePillars />
      <HowItWorks />
      <StageShowcase />
      <ProductTour />
      <FeatureGrid />
      <PrivacySection />
      <IsIsnt />
      <BetaSection />
      <FAQ />
      <ClosingCTA />
    </>
  );
}
