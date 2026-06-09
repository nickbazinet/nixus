import { useTranslation } from "react-i18next";

import { BETA_SUPPORT_EMAIL } from "@/content/limitations";
import { betaPagePath, localeFromLanguage } from "@/lib/localePaths";

import { LimitationsList } from "./LimitationsList";

export function BetaSection() {
  const { t, i18n } = useTranslation();
  const mailtoHref = `mailto:${BETA_SUPPORT_EMAIL}?subject=${encodeURIComponent(t("beta.invite.emailSubject"))}`;
  const fullGuideHref = betaPagePath(localeFromLanguage(i18n.language));

  return (
    <section
      id="beta"
      data-testid="beta-section"
      aria-labelledby="beta-heading"
      className="border-y border-border bg-background py-16 md:py-24"
    >
      <div className="mx-auto max-w-[720px] px-6 md:px-8">
        <div className="mb-10 text-center md:mb-12">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-primary">
            {t("beta.eyebrow")}
          </p>
          <h2 id="beta-heading" className="text-display-l text-foreground">
            {t("beta.limitations.heading")}
          </h2>
          <p className="mx-auto mt-4 max-w-[540px] text-lead text-muted-foreground">
            {t("beta.limitations.intro")}
          </p>
        </div>

        <LimitationsList />

        <div
          data-testid="beta-invite"
          className="mt-12 rounded-lg border border-border bg-card p-6 md:p-8"
        >
          <h3 className="text-base font-semibold text-foreground">
            {t("beta.invite.heading")}
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {t("beta.invite.body")}
          </p>
          <div className="mt-6 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <a
              href={mailtoHref}
              data-testid="beta-invite-cta"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-primary/40"
            >
              {t("beta.invite.cta")}
            </a>
            <a
              href={fullGuideHref}
              data-testid="beta-full-guide-link"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              {t("beta.fullGuideLink")}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
