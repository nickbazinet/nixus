import { useTranslation } from "react-i18next";
import { Play } from "lucide-react";

import { productTour } from "@/content/media";

/**
 * The product-tour band.
 *
 * Carries `controls` and no autoplay, unlike the hero's ambient layer: this is
 * content a visitor chooses to watch, so it must be startable, pausable, and
 * seekable. `preload="none"` keeps a film the visitor may never play out of the
 * page's load budget — the poster frame is all that ships until they click.
 *
 * While no file is configured the band renders a stand-in rather than
 * disappearing, so the section's rhythm is verifiable now. The stand-in's copy
 * is written for a VISITOR, not for whoever is wiring the asset up: a review
 * build that tells the public which directory to drop an MP4 into is worse than
 * no placeholder at all. The wiring instructions live in `content/media.ts`,
 * where the person who needs them is already looking.
 */
export function ProductTour() {
  const { t } = useTranslation();
  const hasFilm = productTour.src !== undefined;

  return (
    <section
      id="tour"
      data-testid="product-tour"
      aria-labelledby="tour-heading"
      className="mkt-band-tint mkt-section-y border-y border-border"
    >
      <div className="mkt-page-x mx-auto max-w-[960px]">
        <div className="mkt-section-lead text-center">
          <p className="mb-3 text-xs font-semibold tracking-wider text-primary uppercase">
            {t("tour.eyebrow")}
          </p>
          <h2 id="tour-heading" className="text-display-l text-foreground">
            {t("tour.heading")}
          </h2>
          <p className="mx-auto mt-4 max-w-[540px] text-lead text-muted-foreground">
            {t("tour.subhead")}
          </p>
        </div>

        <figure
          data-testid="product-tour-frame"
          className="mkt-product-frame rounded-xl border border-border bg-card p-2 sm:p-3"
        >
          {hasFilm ? (
            <video
              data-testid="product-tour-video"
              src={productTour.src}
              poster={productTour.poster}
              controls
              playsInline
              preload="none"
              className="aspect-video h-auto w-full rounded-lg bg-track"
            >
              {t("tour.unsupported")}
            </video>
          ) : (
            <div
              data-testid="product-tour-placeholder"
              role="img"
              aria-label={t("tour.placeholder.label")}
              className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line-strong bg-track px-6 text-center"
            >
              <span
                aria-hidden="true"
                className="inline-flex size-12 items-center justify-center rounded-full border border-line-strong bg-card"
              >
                <Play className="size-5 text-primary" />
              </span>
              <p className="text-base font-medium text-foreground">
                {t("tour.placeholder.label")}
              </p>
              <p className="max-w-[420px] text-sm text-muted-foreground">
                {t("tour.placeholder.hint")}
              </p>
            </div>
          )}
          {hasFilm ? (
            <figcaption className="px-1 pt-3 pb-1 text-sm text-muted-foreground sm:px-2">
              {t("tour.caption")}
            </figcaption>
          ) : null}
        </figure>
      </div>
    </section>
  );
}
