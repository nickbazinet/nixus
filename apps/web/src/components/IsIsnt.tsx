import { useTranslation } from "react-i18next";
import { Check, Minus } from "lucide-react";

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
  "singleUser",
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
      className="mkt-band-paper mkt-section-y"
    >
      <div className="mkt-page-x mx-auto max-w-[1080px]">
        <div className="mkt-section-lead mkt-measure-prose">
          <p className="mb-3 text-xs font-semibold tracking-wider text-primary uppercase">
            {t("isIsnt.eyebrow")}
          </p>
          <h2 id="is-isnt-heading" className="text-display-l text-foreground">
            {t("isIsnt.heading")}
          </h2>
          <p className="mt-4 text-lead text-muted-foreground">
            {t("isIsnt.subhead")}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:gap-8">
          <div
            data-testid="is-isnt-is"
            className="rounded-lg border border-border bg-card p-6 sm:p-8"
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
            className="rounded-lg border border-border bg-card p-6 sm:p-8"
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

        <p className="mt-6 text-sm text-muted-foreground">
          {t("isIsnt.footnote")}
        </p>
      </div>
    </section>
  );
}
