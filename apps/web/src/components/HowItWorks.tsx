import { useTranslation } from "react-i18next";
import { Check, Compass, FileUp, Sparkles, type LucideIcon } from "lucide-react";

/**
 * The three-step on-ramp.
 *
 * The page previously jumped from the hero into capability lists, which assumes
 * the visitor already knows what using a budgeting app involves. Someone who has
 * never kept a budget does not, and that is half the audience this site has to
 * serve. Three steps, each one sentence, answers "what will I actually be doing"
 * before any feature is named.
 *
 * Three is the ceiling, not a starting point: the product's whole claim is that
 * the routine is short, and a five-step diagram argues the opposite.
 *
 * The cards are separated by a real gap rather than sharing one bordered strip
 * with hairline dividers. That first version read as a single three-column
 * table, which is the wrong mental model for a sequence — and the step numerals
 * were set at 24px, outweighing the step titles they were labelling.
 */
const STEP_ICONS: readonly LucideIcon[] = [FileUp, Sparkles, Compass];

const STEP_IDS = ["upload", "categorize", "review"] as const;

export function HowItWorks() {
  const { t } = useTranslation();

  return (
    <section
      id="how-it-works"
      data-testid="how-it-works"
      aria-labelledby="how-it-works-heading"
      className="mkt-band-tint mkt-section-y border-y border-border"
    >
      <div className="mkt-page-x mx-auto max-w-[1280px]">
        <div className="mkt-section-lead mkt-measure-prose">
          <p className="mb-3 text-xs font-semibold tracking-wider text-primary uppercase">
            {t("howItWorks.eyebrow")}
          </p>
          <h2
            id="how-it-works-heading"
            className="text-display-l text-foreground"
          >
            {t("howItWorks.heading")}
          </h2>
          <p className="mt-4 text-lead text-muted-foreground">
            {t("howItWorks.subhead")}
          </p>
        </div>

        <ol
          role="list"
          className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6"
        >
          {STEP_IDS.map((stepId, index) => {
            const Icon = STEP_ICONS[index];
            return (
              <li
                key={stepId}
                data-testid="how-it-works-step"
                className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6 md:p-7"
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="inline-flex size-9 items-center justify-center rounded-md bg-brand-soft text-brand-ink"
                  >
                    <Icon className="size-[18px]" />
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-xs font-semibold tracking-wider text-ink-faint tabular-nums"
                  >
                    {t("howItWorks.stepLabel", { number: index + 1 })}
                  </span>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    {t(`howItWorks.${stepId}.title`)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {t(`howItWorks.${stepId}.body`)}
                  </p>
                </div>
                <p className="mt-auto flex items-start gap-2 border-t border-border pt-4 text-sm font-medium text-foreground">
                  <Check
                    aria-hidden="true"
                    className="mt-[3px] size-4 shrink-0 text-good"
                  />
                  {t(`howItWorks.${stepId}.detail`)}
                </p>
              </li>
            );
          })}
        </ol>

        <p className="mt-6 text-sm text-muted-foreground">
          {t("howItWorks.footnote")}
        </p>
      </div>
    </section>
  );
}
