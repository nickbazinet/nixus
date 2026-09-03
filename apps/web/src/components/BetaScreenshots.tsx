import { useTranslation } from "react-i18next";

import { betaScreenshots } from "@/content/betaPage";

import { ProductFrame } from "./ProductFrame";

/**
 * The beta page's one full-band movement: product plates at the wide editorial
 * measure while every prose section stays on `.mkt-measure-prose`. Width is the
 * emphasis here, which is why this section carries no display-scale heading.
 *
 * A slot with no asset renders nothing. The previous gradient panel was a
 * fabricated screenshot — a visitor read it as a product surface that does not
 * exist — and DESIGN.md's launch-surface rule against placeholder bars is the
 * same judgement.
 */
export function BetaScreenshots() {
  const { t } = useTranslation();

  return (
    <section
      aria-labelledby="beta-screenshots-heading"
      className="mkt-section-lead mt-2 sm:mt-6"
    >
      <div aria-hidden="true" className="mkt-rule" />
      <h2
        id="beta-screenshots-heading"
        className="text-xl font-semibold text-foreground"
      >
        {t("betaPage.screenshots.heading")}
      </h2>
      <div className="mt-8 space-y-8 sm:mt-10 sm:space-y-12">
        {betaScreenshots.map((shot) =>
          shot.src === undefined ? null : (
            <ProductFrame
              key={shot.id}
              kind="image"
              id={`beta-screenshot-${shot.id}`}
              src={shot.src}
              alt={t(`betaPage.screenshots.${shot.id}.alt`)}
              caption={t(`betaPage.screenshots.${shot.id}.caption`)}
            />
          ),
        )}
      </div>
    </section>
  );
}
