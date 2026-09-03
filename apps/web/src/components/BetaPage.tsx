import { useTranslation } from "react-i18next";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@nixus/shared";

import { betaQuickFaqIds } from "@/content/betaPage";
import { contactMailto } from "@/content/contact";
import { homePath, localeFromLanguage } from "@/lib/localePaths";

import { BetaGetStarted } from "./BetaGetStarted";
import { BetaScreenshots } from "./BetaScreenshots";
import { EditorialHeading } from "./EditorialHeading";
import { FoundingPitch } from "./FoundingPitch";
import { LimitationsList } from "./LimitationsList";

/**
 * The band is sized for product imagery (1024px, matching the AI-demo
 * showcase); prose sits left on `.mkt-measure-prose` inside it. That imbalance
 * is the composition, so the two measures are separate classes rather than one
 * shared `max-w`.
 *
 * `.mkt-rule` opens each movement — one rule treatment for the whole page,
 * which is why every `EditorialHeading` here passes `rule={false}` rather than
 * stacking the primitive's own hairline on top of it.
 */
export function BetaPage() {
  const { t, i18n } = useTranslation();
  const locale = localeFromLanguage(i18n.language);
  const faqHomeHref = `${homePath(locale)}#faq`;
  const programMailto = contactMailto(t("betaPage.feedback.emailSubject"));

  return (
    <div data-testid="beta-page" className="mkt-section-y bg-background">
      <div className="mkt-page-x mx-auto max-w-[1024px]">
        <header className="mkt-section-lead mkt-measure-prose">
          <EditorialHeading
            id="beta-hero-heading"
            level="h1"
            align="left"
            rule={false}
            eyebrow={t("betaPage.eyebrow")}
            heading={t("betaPage.hero.heading")}
            description={t("betaPage.hero.lead")}
          />
          <div className="mt-8">
            <a
              href={programMailto}
              data-testid="beta-hero-cta"
              className="mkt-tap-cta inline-flex max-w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-primary/40"
            >
              {t("betaPage.feedback.cta")}
            </a>
          </div>
        </header>

        <div className="mkt-measure-prose">
          <FoundingPitch showCta={false} />
        </div>

        <BetaScreenshots />

        <section
          id="expect"
          aria-labelledby="beta-expect-heading"
          className="mkt-section-lead mkt-measure-prose"
        >
          <div aria-hidden="true" className="mkt-rule" />
          <EditorialHeading
            id="beta-expect-heading"
            level="h2"
            align="left"
            rule={false}
            eyebrow={t("beta.eyebrow")}
            heading={t("betaPage.expect.heading")}
            description={t("betaPage.expect.intro")}
          />
          <div className="mt-8">
            <LimitationsList />
          </div>
        </section>

        <BetaGetStarted faqHomeHref={faqHomeHref} />

        <section
          id="feedback"
          aria-labelledby="beta-feedback-heading"
          className="mkt-section-lead mkt-measure-prose"
        >
          <div aria-hidden="true" className="mkt-rule" />
          <h2
            id="beta-feedback-heading"
            className="text-xl font-semibold text-foreground"
          >
            {t("betaPage.feedback.heading")}
          </h2>
          <div
            data-testid="beta-feedback-card"
            className="mt-6 rounded-lg border border-border bg-card p-5 sm:p-6 md:p-8"
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
                href={programMailto}
                data-testid="beta-feedback-cta"
                className="mkt-tap-cta inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-primary/40 sm:w-auto"
              >
                {t("betaPage.feedback.cta")}
              </a>
            </div>
          </div>
        </section>

        <section
          aria-labelledby="beta-faq-heading"
          className="mkt-measure-prose"
        >
          <div aria-hidden="true" className="mkt-rule" />
          <h2
            id="beta-faq-heading"
            className="text-xl font-semibold text-foreground"
          >
            {t("betaPage.faq.heading")}
          </h2>
          <div className="mt-6">
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
          </div>
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
