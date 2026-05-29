import { useTranslation } from "react-i18next";

import { features } from "@/content/features";

export function FeatureGrid() {
  const { t } = useTranslation();
  return (
    <section
      data-testid="feature-grid"
      aria-labelledby="features-heading"
      className="bg-accent/40 dark:bg-accent/30 py-16 md:py-24"
    >
      <div className="mx-auto max-w-[1280px] px-6 md:px-8">
        <div className="mb-12 text-center md:mb-16">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-primary">
            {t("features.eyebrow")}
          </p>
          <h2 id="features-heading" className="text-display-l text-foreground">
            {t("features.heading")}
          </h2>
          <p className="mx-auto mt-4 max-w-[540px] text-lead text-muted-foreground">
            {t("features.subhead")}
          </p>
        </div>
        <ul
          role="list"
          className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
        >
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <li key={feature.id}>
                <article
                  data-testid="feature-card"
                  className="h-full rounded-lg border border-border bg-card p-6 transition-colors hover:border-slate-300"
                >
                  <div className="mb-4 inline-flex size-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
                    <Icon aria-hidden="true" className="size-5" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground">
                    {t(`features.${feature.id}.title`)}
                  </h3>
                  <p className="mt-2 text-sm text-muted-foreground">
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
