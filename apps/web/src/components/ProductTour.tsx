import type { CSSProperties } from "react";
import { Play } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SectionIntro } from "@/components/SectionIntro";
import { TourPlayer } from "@/components/TourPlayer";
import { productTour } from "@/content/media";

/**
 * The product-tour band.
 *
 * The frame is shaped by the film, not by a layout default. `width` and `height`
 * in `content/media.ts` become `--mkt-tour-ratio`, and the same ratio is used
 * whether or not a film is configured, so the stand-in reserves exactly the box
 * the film will fill and the page does not move when it lands. `.mkt-tour` in
 * `main.css` explains the width cap that keeps the whole frame on screen.
 *
 * The film is the surface, so it gets no white mat — that treatment is for UI
 * screenshots, which need a border to read as a captured window. A black stage
 * also absorbs the recording's own margin: a window captured on a black canvas
 * is the film's content, not letterboxing to be hidden.
 *
 * It loads only when played (`preload="none"` in `TourPlayer`), so a visitor who
 * never presses play pays for the poster and nothing else.
 *
 * The caption does two jobs. It tells the reader what is in the film, and it is
 * the text alternative for a video with no audio and no captions to carry the
 * information — a visitor who cannot watch still learns what it shows.
 *
 * While no file is configured the band renders a stand-in rather than
 * disappearing. Its copy is written for a VISITOR, not for whoever is wiring the
 * asset up; the wiring instructions live in `content/media.ts`.
 */
export function ProductTour() {
  const { t } = useTranslation();
  const { src, poster, width, height } = productTour;
  const hasFilm = src !== undefined;
  const frame = { "--mkt-tour-ratio": (width / height).toFixed(4) } as CSSProperties;

  return (
    <section
      id="tour"
      data-testid="product-tour"
      aria-labelledby="tour-heading"
      className="mkt-band-tint mkt-wash mkt-wash-violet mkt-section-y border-y border-border"
    >
      <div className="mkt-page-x mx-auto max-w-[68rem] 2xl:max-w-[80rem]">
        <SectionIntro
          id="tour-heading"
          eyebrow={t("tour.eyebrow")}
          heading={t("tour.heading")}
          align="center"
        />

        <figure
          data-testid="product-tour-frame"
          data-reveal-item=""
          style={frame}
          className="mkt-tour"
        >
          <div
            data-testid="product-tour-stage"
            className={`mkt-tour-stage mkt-product-frame mkt-panel relative overflow-hidden border border-border ${hasFilm ? "bg-black" : "bg-brand-soft"}`}
          >
            {hasFilm ? (
              <TourPlayer src={src} poster={poster} />
            ) : (
              <div
                data-testid="product-tour-placeholder"
                role="img"
                aria-label={t("tour.placeholder.label")}
                className="flex size-full flex-col items-center justify-center gap-3 border border-dashed border-brand/30 px-6 text-center"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex size-12 items-center justify-center rounded-full border border-line-strong bg-card"
                >
                  <Play className="size-5 text-brand-ink" />
                </span>
                <p className="text-base font-medium text-foreground">
                  {t("tour.placeholder.label")}
                </p>
                <p className="max-w-[420px] text-sm text-muted-foreground">
                  {t("tour.placeholder.hint")}
                </p>
              </div>
            )}
          </div>
          {hasFilm ? (
            <figcaption className="mt-3 text-center text-sm text-muted-foreground">
              {t("tour.caption")}
            </figcaption>
          ) : null}
        </figure>
      </div>
    </section>
  );
}
