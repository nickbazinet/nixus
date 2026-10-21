import { useTranslation } from "react-i18next";
import type { CSSProperties } from "react";
import { Check, Minus } from "lucide-react";

import { SectionIntro } from "@/components/SectionIntro";

/**
 * "What Nixus is — and isn't", as two facing columns.
 *
 * The content was already the page's strongest asset and its flattest surface: a
 * single grey bullet list of six limitations, which reads as a disclaimer a
 * visitor skims past. Splitting it into what the product IS beside what it is
 * NOT turns the same honesty into a comparison a visitor can self-select
 * against, and gives the claims somewhere to land.
 *
 * The two columns use shape, not just colour, to separate: a check against a
 * dash. DESIGN.md's attention-row rule — status must never be carried by hue
 * alone — applies here even though neither column is a status, because the
 * is/isn't read is exactly the kind of binary that fails under CVD if colour is
 * doing the work.
 */

const IS_IDS = ["spreadsheet", "localData", "noLogins", "canadian"] as const;
const ISNT_IDS = [
  "noBankSync",
  "desktopOnly",
  "noHousehold",
  "preAlphaStability",
  "notProfessionalAdvice",
] as const;

export function IsIsnt() {
  const { t } = useTranslation();

  return (
    <section
      id="honest"
      data-testid="is-isnt"
      aria-labelledby="is-isnt-heading"
      className="mkt-band-paper mkt-wash mkt-wash-pink mkt-section-y"
    >
      <div className="mkt-page-x mkt-container">
        <SectionIntro
          id="is-isnt-heading"
          eyebrow={t("isIsnt.eyebrow")}
          heading={t("isIsnt.heading")}
          lead={t("isIsnt.subhead")}
          align="center"
        />

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
          <div
            data-testid="is-isnt-is"
            data-reveal-item=""
            className="mkt-card mkt-panel mkt-tint-brand border p-6 sm:p-8"
          >
            <h3 className="text-base font-semibold text-foreground">
              {t("isIsnt.is.heading")}
            </h3>
            <ul role="list" className="mt-5 flex flex-col gap-4">
              {IS_IDS.map((id) => (
                <li key={id} className="flex gap-3">
                  <Check
                    aria-hidden="true"
                    className="mt-[3px] size-4 shrink-0 text-good"
                  />
                  <span className="text-sm leading-relaxed text-foreground">
                    {t(`isIsnt.is.items.${id}`)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div
            data-testid="is-isnt-isnt"
            data-reveal-item=""
            style={{ "--reveal-i": 1 } as CSSProperties}
            className="mkt-card mkt-panel mkt-tint-neutral border p-6 sm:p-8"
          >
            <h3 className="text-base font-semibold text-foreground">
              {t("isIsnt.isnt.heading")}
            </h3>
            <ul role="list" className="mt-5 flex flex-col gap-4">
              {ISNT_IDS.map((id) => (
                <li key={id} className="flex gap-3">
                  <Minus
                    aria-hidden="true"
                    className="mt-[3px] size-4 shrink-0 text-ink-faint"
                  />
                  <span className="text-sm leading-relaxed text-muted-foreground">
                    {t(`beta.limitations.items.${id}`)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

      </div>
    </section>
  );
}
