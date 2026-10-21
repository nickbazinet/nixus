import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import { SectionIntro } from "@/components/SectionIntro";
import { IconChip, rampStop } from "@/components/IconChip";
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
      className="mkt-band-tint mkt-wash mkt-wash-pink mkt-section-y border-y border-border"
    >
      <div className="mkt-page-x mkt-container">
        <SectionIntro
          id="how-it-works-heading"
          eyebrow={t("howItWorks.eyebrow")}
          heading={t("howItWorks.heading")}
          lead={t("howItWorks.subhead")}
          align="center"
        />

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
                data-reveal-item=""
                style={{ "--reveal-i": index } as CSSProperties}
                className="mkt-card mkt-panel flex flex-col gap-4 border border-border bg-card p-6 md:p-7"
              >
                <div className="flex items-center gap-3">
                  <IconChip icon={Icon} stop={rampStop(index)} />
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

      </div>
    </section>
  );
}
