import { useTranslation } from "react-i18next";

import { MediaSlot } from "@/components/MediaSlot";
import { closingPhoto } from "@/content/media";
import { DownloadCTA } from "@/features/download/DownloadCTA";

/**
 * The closing CTA band.
 *
 * The page previously ended on the FAQ, so the last thing a convinced visitor
 * saw was a list of caveats with no way to act on the decision they had just
 * made. This band is the page's one crescendo: `--mkt-band-deep` is the only
 * brand-tinted full-bleed surface on the site, and it earns that by holding the
 * primary action.
 *
 * It is also the one band on the page where a photograph belongs, and the
 * reasoning is worth stating because the answer elsewhere is no. Every other
 * band carries 14px body copy, and imagery behind body copy is how the hero
 * ended up needing a four-part mask recipe to hold `--ink-dim` above 4.5:1.
 * This band has a headline, one lead line, and a button — so a photograph can
 * sit BESIDE the copy in its own column, with no text over it at all, and still
 * do the emotional work a download moment wants. Monarch closes on exactly this
 * composition.
 *
 * `--brand` itself still only fills the button; the band is `brand-soft`, a
 * tint, so "brand means brand and action" is unchanged.
 */
export function ClosingCTA() {
  const { t } = useTranslation();

  return (
    <section
      data-testid="closing-cta"
      aria-labelledby="closing-cta-heading"
      className="mkt-band-deep mkt-section-y border-t border-border"
    >
      <div className="mkt-page-x mkt-container">
        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-16">
          <div>
            <h2
              id="closing-cta-heading"
              className="text-display-l text-foreground"
            >
              {t("closing.heading")}
            </h2>
            <p className="mt-4 max-w-[34rem] text-lead text-muted-foreground">
              {t("closing.subhead")}
            </p>
            <div className="mt-8 flex md:mt-10">
              <DownloadCTA size="lg" showAltOS className="max-w-full" />
            </div>
            <p className="mt-5 text-sm text-muted-foreground">
              {t("closing.footnote")}
            </p>
          </div>

          <div
            data-testid="closing-cta-media"
            data-reveal-item=""
            className="mkt-product-frame mkt-panel overflow-hidden"
          >
            <MediaSlot
              aspect="3/2"
              src={closingPhoto.src}
              label={t("closing.media.label")}
              hint={t("closing.media.hint")}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
