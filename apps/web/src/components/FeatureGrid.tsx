import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { SectionIntro } from "@/components/SectionIntro";
import { IconChip, rampStop } from "@/components/IconChip";
import { features } from "@/content/features";

/**
 * The capability list — deliberately secondary now.
 *
 * This section used to carry the whole product argument as eight equal cards,
 * each with a 36px tinted icon square. Eight identical squares is what made the
 * page read as assembled: every capability got the same visual weight, so none
 * of them got any. The stage showcase above now makes the argument with real
 * screenshots, which frees this section to do the job it is actually good at —
 * letting someone evaluating the product scan the full inventory quickly.
 *
 * So it is built to LOOK secondary: four tight columns, the icon inline beside
 * its title at text size instead of in its own block, and one line of copy each.
 * A section that is secondary in the narrative but primary in visual weight is
 * how a page loses its hierarchy.
 */
export function FeatureGrid() {
  const { t } = useTranslation();
  return (
    <section
      id="features"
      data-testid="feature-grid"
      aria-labelledby="features-heading"
      className="mkt-band-paper mkt-wash mkt-wash-brand mkt-section-y"
    >
      <div className="mkt-page-x mkt-container">
        <SectionIntro
          id="features-heading"
          eyebrow={t("features.eyebrow")}
          heading={t("features.heading")}
          lead={t("features.subhead")}
          align="center"
        />
        <ul
          role="list"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <li key={feature.id}>
                <article
                  data-testid="feature-card"
                  data-reveal-item=""
                  style={{ "--reveal-i": index } as CSSProperties}
                  className="mkt-card h-full border border-border bg-card p-5"
                >
                  <h3 className="flex items-center gap-2.5 text-sm font-semibold text-foreground">
                    <IconChip icon={Icon} stop={rampStop(index)} size="sm" />
                    {t(`features.${feature.id}.title`)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {t(`features.${feature.id}.description`)}
                  </p>
                </article>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
