import { useTranslation } from "react-i18next";

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
      className="mkt-band-paper mkt-section-y"
    >
      <div className="mkt-page-x mx-auto max-w-[1280px]">
        <div className="mkt-section-lead mkt-measure-prose">
          <p className="mb-3 text-xs font-semibold tracking-wider text-primary uppercase">
            {t("features.eyebrow")}
          </p>
          <h2 id="features-heading" className="text-display-l text-foreground">
            {t("features.heading")}
          </h2>
          <p className="mt-4 text-lead text-muted-foreground">
            {t("features.subhead")}
          </p>
        </div>
        <ul
          role="list"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
        >
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <li key={feature.id}>
                <article
                  data-testid="feature-card"
                  className="h-full rounded-lg border border-border bg-card p-5"
                >
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Icon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-primary"
                    />
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
