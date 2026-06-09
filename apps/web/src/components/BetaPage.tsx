import { useTranslation } from "react-i18next";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@nixus/shared";

import {
  betaFitBadIds,
  betaFitGoodIds,
  betaGetStartedStepIds,
  betaQuickFaqIds,
  betaScreenshots,
} from "@/content/betaPage";
import {
  BETA_SUPPORT_EMAIL,
} from "@/content/limitations";
import { DownloadCTA } from "@/features/download/DownloadCTA";
import {
  homePath,
  localeFromLanguage,
} from "@/lib/localePaths";

import { LimitationsList } from "./LimitationsList";

export function BetaPage() {
  const { t, i18n } = useTranslation();
  const locale = localeFromLanguage(i18n.language);
  const faqHomeHref = `${homePath(locale)}#faq`;
  const feedbackMailto = `mailto:${BETA_SUPPORT_EMAIL}?subject=${encodeURIComponent(t("betaPage.feedback.emailSubject"))}`;

  return (
    <div data-testid="beta-page" className="bg-background py-16 md:py-24">
      <div className="mx-auto max-w-[720px] px-6 md:px-8">
        {/* Hero */}
        <header className="mb-14 text-center md:mb-16">
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
            <DownloadCTA size="default" showAltOS />
          </div>
        </header>

        {/* Is this for you? */}
        <section
          aria-labelledby="beta-fit-heading"
          className="mb-14 md:mb-16"
        >
          <h2
            id="beta-fit-heading"
            className="mb-6 text-xl font-semibold text-foreground"
          >
            {t("betaPage.fit.heading")}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div
              data-testid="beta-fit-good"
              className="rounded-lg border border-emerald-200/80 bg-card p-5 dark:border-emerald-900/50"
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
              className="rounded-lg border border-red-200/70 bg-card p-5 dark:border-red-900/40"
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

        {/* Screenshots */}
        <section
          aria-labelledby="beta-screenshots-heading"
          className="mb-14 md:mb-16"
        >
          <h2
            id="beta-screenshots-heading"
            className="mb-6 text-xl font-semibold text-foreground"
          >
            {t("betaPage.screenshots.heading")}
          </h2>
          <div className="space-y-5">
            {betaScreenshots.map((shot) => (
              <figure
                key={shot.id}
                data-testid={`beta-screenshot-${shot.id}`}
                className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
              >
                {shot.src ? (
                  <img
                    src={shot.src}
                    alt={t(`betaPage.screenshots.${shot.id}.alt`)}
                    className="aspect-[16/10] w-full object-cover object-top"
                    loading="lazy"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="flex aspect-[16/10] items-center justify-center bg-gradient-to-br from-muted to-accent px-6 text-center text-sm font-medium text-muted-foreground"
                  >
                    {t(`betaPage.screenshots.${shot.id}.placeholder`)}
                  </div>
                )}
                <figcaption className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
                  {t(`betaPage.screenshots.${shot.id}.caption`)}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* Limitations */}
        <section
          id="expect"
          aria-labelledby="beta-expect-heading"
          className="mb-14 md:mb-16"
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

        {/* Get started */}
        <section
          aria-labelledby="beta-start-heading"
          className="mb-14 md:mb-16"
        >
          <h2
            id="beta-start-heading"
            className="mb-6 text-xl font-semibold text-foreground"
          >
            {t("betaPage.getStarted.heading")}
          </h2>
          <ol className="space-y-0 divide-y divide-border">
            {betaGetStartedStepIds.map((id, index) => (
              <li
                key={id}
                className="flex gap-4 py-5 first:pt-0 last:pb-0"
              >
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground"
                >
                  {index + 1}
                </span>
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">
                    {t(`betaPage.getStarted.${id}.title`)}
                  </p>
                  <p className="mt-1 leading-relaxed">
                    {t(`betaPage.getStarted.${id}.body`)}
                  </p>
                  {id === "install" ? (
                    <a
                      href={faqHomeHref}
                      className="mt-2 inline-block text-primary underline-offset-4 hover:underline"
                    >
                      {t("betaPage.getStarted.installHelpLink")}
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-8 flex justify-center">
            <DownloadCTA size="default" showAltOS />
          </div>
        </section>

        {/* Feedback */}
        <section
          id="feedback"
          aria-labelledby="beta-feedback-heading"
          className="mb-14 md:mb-16"
        >
          <h2
            id="beta-feedback-heading"
            className="mb-6 text-xl font-semibold text-foreground"
          >
            {t("betaPage.feedback.heading")}
          </h2>
          <div
            data-testid="beta-feedback-card"
            className="rounded-lg border border-border bg-card p-6 md:p-8"
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
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-primary/40"
              >
                {t("betaPage.feedback.cta")}
              </a>
            </div>
          </div>
        </section>

        {/* Quick FAQ */}
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
                <AccordionTrigger>
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
            className="mt-6 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline"
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
