import { useTranslation } from "react-i18next";

import { DownloadCTA } from "@/features/download/DownloadCTA";

/**
 * The closing CTA band.
 *
 * The page previously ended on the FAQ, so the last thing a convinced visitor
 * saw was a list of caveats with no way to act on the decision they had just
 * made. This band is the page's one crescendo: `--mkt-band-deep` is the only
 * brand-tinted full-bleed surface on the site, and it earns that by being the
 * band that holds the primary action.
 *
 * `--brand` itself still only fills the button inside — the band is `brand-soft`,
 * a tint, which keeps DESIGN.md's "brand means brand and action, nothing else"
 * rule intact rather than bending it for a flourish.
 */
export function ClosingCTA() {
  const { t } = useTranslation();

  return (
    <section
      data-testid="closing-cta"
      aria-labelledby="closing-cta-heading"
      className="mkt-band-deep mkt-section-y border-t border-border"
    >
      <div className="mkt-page-x mx-auto max-w-[720px] text-center">
        <h2
          id="closing-cta-heading"
          className="text-display-l text-foreground"
        >
          {t("closing.heading")}
        </h2>
        <p className="mx-auto mt-4 max-w-[540px] text-lead text-muted-foreground">
          {t("closing.subhead")}
        </p>
        <div className="mt-8 flex justify-center md:mt-10">
          <DownloadCTA size="lg" showAltOS className="max-w-full" />
        </div>
        <p className="mt-5 text-sm text-muted-foreground">
          {t("closing.footnote")}
        </p>
      </div>
    </section>
  );
}
