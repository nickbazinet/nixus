import { useTranslation } from "react-i18next";

import { pillars } from "@/content/pillars";

/**
 * Three positioning pillars — the “why Nixus” beat between hero and demo.
 * Copy lives in i18n under `pillars.*`.
 */
export function ValuePillars() {
  const { t } = useTranslation();
  return (
    <section
      data-testid="value-pillars"
      aria-labelledby="pillars-heading"
      className="border-y border-border bg-background py-16 md:py-20"
    >
      <div className="mx-auto max-w-[1280px] px-6 md:px-8">
        <div className="mb-12 text-center md:mb-14">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-primary">
            {t("pillars.eyebrow")}
          </p>
          <h2 id="pillars-heading" className="text-display-l text-foreground">
            {t("pillars.heading")}
          </h2>
          <p className="mx-auto mt-4 max-w-[640px] text-lead text-muted-foreground">
            {t("pillars.subhead")}
          </p>
        </div>
        <ul
          role="list"
          className="grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-6 lg:gap-10"
        >
          {pillars.map((pillar) => {
            const Icon = pillar.icon;
            return (
              <li key={pillar.id}>
                <article
                  data-testid="pillar-card"
                  className="h-full text-center md:text-left"
                >
                  <div className="mx-auto mb-4 inline-flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary md:mx-0">
                    <Icon aria-hidden="true" className="size-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-foreground">
                    {t(`pillars.${pillar.id}.title`)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {t(`pillars.${pillar.id}.description`)}
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
