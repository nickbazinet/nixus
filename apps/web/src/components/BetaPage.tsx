import { useTranslation } from "react-i18next";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@nixus/shared";

import { betaQuickFaqIds } from "@/content/betaPage";
import { BETA_SUPPORT_EMAIL } from "@/content/limitations";
import { DownloadCTA } from "@/features/download/DownloadCTA";
import { homePath, localeFromLanguage } from "@/lib/localePaths";

import { BetaFitCards } from "./BetaFitCards";
import { BetaGetStarted } from "./BetaGetStarted";
import { BetaScreenshots } from "./BetaScreenshots";
import { LimitationsList } from "./LimitationsList";

export function BetaPage() {
  const { t, i18n } = useTranslation();
  const locale = localeFromLanguage(i18n.language);
  const faqHomeHref = `${homePath(locale)}#faq`;
  const feedbackMailto = `mailto:${BETA_SUPPORT_EMAIL}?subject=${encodeURIComponent(t("betaPage.feedback.emailSubject"))}`;

  return (
    <div data-testid="beta-page" className="mkt-section-y bg-background">
      <div className="mkt-page-x mx-auto max-w-[720px]">
        <header className="mkt-section-lead text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-primary">
            {t("betaPage.eyebrow")}
          </p>
          <h1 className="text-display-l text-foreground">
            {t("betaPage.hero.heading")}
          </h1>
          <p className="mx-auto mt-4 max-w-[540px] text-lead text-muted-foreground">
            {t("betaPage.hero.lead")}
          </p>
          <div className="mt-8 flex justify-center">
            <DownloadCTA
              size="default"
              showAltOS
              className="max-w-full items-center"
            />
          </div>
        </header>

        <BetaFitCards />
        <BetaScreenshots />

        <section
          id="expect"
          aria-labelledby="beta-expect-heading"
          className="mkt-section-lead"
        >
          <h2
            id="beta-expect-heading"
            className="mb-3 text-xl font-semibold text-foreground"
          >
            {t("beta.limitations.heading")}
          </h2>
          <p className="mb-6 text-sm text-muted-foreground">
            {t("beta.limitations.intro")}
          </p>
          <LimitationsList />
        </section>

        <BetaGetStarted faqHomeHref={faqHomeHref} />

        <section
          id="feedback"
          aria-labelledby="beta-feedback-heading"
          className="mkt-section-lead"
        >
          <h2
            id="beta-feedback-heading"
            className="mb-6 text-xl font-semibold text-foreground"
          >
            {t("betaPage.feedback.heading")}
          </h2>
          <div
            data-testid="beta-feedback-card"
            className="rounded-lg border border-border bg-card p-5 sm:p-6 md:p-8"
          >
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("betaPage.feedback.body")}
            </p>
            <p className="mt-4 rounded-md bg-muted px-4 py-3 text-sm italic text-foreground">
              {t("betaPage.feedback.prompt")}
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              {t("betaPage.feedback.detail")}
            </p>
            <div className="mt-6">
              <a
                href={feedbackMailto}
                data-testid="beta-feedback-cta"
                className="mkt-tap-cta inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-primary/40 sm:w-auto"
              >
                {t("betaPage.feedback.cta")}
              </a>
            </div>
          </div>
        </section>

        <section aria-labelledby="beta-faq-heading">
          <h2
            id="beta-faq-heading"
            className="mb-6 text-xl font-semibold text-foreground"
          >
            {t("betaPage.faq.heading")}
          </h2>
          <Accordion>
            {betaQuickFaqIds.map((id) => (
              <AccordionItem key={id} value={id}>
                <AccordionTrigger className="mkt-tap items-center">
                  <span className="pr-4 text-base font-medium">
                    {t(`faq.${id}.question`)}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <p className="text-muted-foreground">
                    {t(`faq.${id}.answer`)}
                  </p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          <a
            href={faqHomeHref}
            className="mkt-tap mt-6 inline-flex items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("betaPage.faq.moreLink")}
          </a>
        </section>
      </div>
    </div>
  );
}

/** Canonical beta path for meta / sitemap helpers. */
export const BETA_PAGE_PATHS = {
  en: "/beta",
  fr: "/fr/beta",
} as const;
