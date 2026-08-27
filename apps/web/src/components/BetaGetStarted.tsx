import { useTranslation } from "react-i18next";

import { betaGetStartedStepIds } from "@/content/betaPage";
import { DownloadCTA } from "@/features/download/DownloadCTA";

/** Numbered install walkthrough, closed by a second download affordance. */
export function BetaGetStarted({ faqHomeHref }: { faqHomeHref: string }) {
  const { t } = useTranslation();

  return (
    <section aria-labelledby="beta-start-heading" className="mkt-section-lead">
      <h2
        id="beta-start-heading"
        className="mb-6 text-xl font-semibold text-foreground"
      >
        {t("betaPage.getStarted.heading")}
      </h2>
      <ol className="space-y-0 divide-y divide-border">
        {betaGetStartedStepIds.map((id, index) => (
          <li key={id} className="flex gap-3 py-5 first:pt-0 last:pb-0 sm:gap-4">
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground"
            >
              {index + 1}
            </span>
            <div className="min-w-0 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">
                {t(`betaPage.getStarted.${id}.title`)}
              </p>
              <p className="mt-1 leading-relaxed">
                {t(`betaPage.getStarted.${id}.body`)}
              </p>
              {id === "install" ? (
                <a
                  href={faqHomeHref}
                  className="mkt-tap mt-2 inline-flex items-center text-primary underline-offset-4 hover:underline"
                >
                  {t("betaPage.getStarted.installHelpLink")}
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-8 flex justify-center">
        <DownloadCTA
          size="default"
          showAltOS
          className="max-w-full items-center"
        />
      </div>
    </section>
  );
}
