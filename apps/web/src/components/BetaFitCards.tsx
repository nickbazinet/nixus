import { useTranslation } from "react-i18next";

import { betaFitBadIds, betaFitGoodIds } from "@/content/betaPage";

/** "Is this for you?" — the two qualifying columns on the beta page. */
export function BetaFitCards() {
  const { t } = useTranslation();

  return (
    <section aria-labelledby="beta-fit-heading" className="mkt-section-lead">
      <h2
        id="beta-fit-heading"
        className="mb-6 text-xl font-semibold text-foreground"
      >
        {t("betaPage.fit.heading")}
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div
          data-testid="beta-fit-good"
          className="rounded-lg border border-emerald-200/80 bg-card p-4 sm:p-5 dark:border-emerald-900/50"
        >
          <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            {t("betaPage.fit.good.heading")}
          </h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            {betaFitGoodIds.map((id) => (
              <li key={id}>{t(`betaPage.fit.good.${id}`)}</li>
            ))}
          </ul>
        </div>
        <div
          data-testid="beta-fit-bad"
          className="rounded-lg border border-red-200/70 bg-card p-4 sm:p-5 dark:border-red-900/40"
        >
          <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">
            {t("betaPage.fit.bad.heading")}
          </h3>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            {betaFitBadIds.map((id) => (
              <li key={id}>{t(`betaPage.fit.bad.${id}`)}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
