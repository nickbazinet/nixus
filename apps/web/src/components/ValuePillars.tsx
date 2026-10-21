import { useTranslation } from "react-i18next";

import { pillars } from "@/content/pillars";

/**
 * The "why this rather than the alternatives" beat.
 *
 * The audit's missing-section list led with comparison — every competitor in
 * this category runs an explicit "vs. Mint / YNAB / spreadsheets" page. These
 * three pillars already made that argument in copy; what they lacked was a
 * treatment that read as an argument rather than as three more feature cards.
 *
 * So the icon squares are gone and each pillar is set as an editorial column
 * under its own rule. That is also a hierarchy fix: with the trust band above
 * and the capability cards below, a third tinted-icon-square grid is what made
 * three structurally different sections look like one repeated template.
 */
export function ValuePillars() {
  const { t } = useTranslation();
  return (
    <section
      id="why"
      data-testid="value-pillars"
      aria-labelledby="pillars-heading"
      className="mkt-band-paper mkt-section-y"
    >
      <div className="mkt-page-x mx-auto max-w-[1280px]">
        <div className="mkt-section-lead mkt-measure-prose">
          <p className="mb-3 text-xs font-semibold tracking-wider text-primary uppercase">
            {t("pillars.eyebrow")}
          </p>
          <h2 id="pillars-heading" className="text-display-l text-foreground">
            {t("pillars.heading")}
          </h2>
          <p className="mt-4 text-lead text-muted-foreground">
            {t("pillars.subhead")}
          </p>
        </div>
        <ul
          role="list"
          className="grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-10 lg:gap-14"
        >
          {pillars.map((pillar) => (
            <li key={pillar.id}>
              <article data-testid="pillar-card" className="h-full">
                <div aria-hidden="true" className="mkt-rule" />
                <h3 className="text-lg font-semibold text-foreground">
                  {t(`pillars.${pillar.id}.title`)}
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {t(`pillars.${pillar.id}.description`)}
                </p>
                <p className="mt-4 text-sm leading-relaxed text-foreground">
                  {t(`pillars.${pillar.id}.contrast`)}
                </p>
              </article>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
