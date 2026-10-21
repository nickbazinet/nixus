import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";

import { contactMailto } from "@/content/contact";
import { foundingFocusIds } from "@/content/foundingPitch";
import { betaPagePath, localeFromLanguage } from "@/lib/localePaths";

/**
 * The homepage's single founding-user block.
 *
 * Previously this section led with the six-item limitations list and then
 * attached an invite card to the bottom of it. The limitations now have their
 * own designed section (`IsIsnt`), so repeating them here was the page's one
 * genuine content duplication — and burying a conversion card under a
 * disclaimer list was the wrong frame for an invitation anyway.
 *
 * What it carries instead is qualification: the spreadsheet checklist that was
 * previously stranded in a second, near-identical founding block higher up the
 * page. One block, one ask, and the reader can tell in four seconds whether the
 * program is aimed at them.
 *
 * The CTA is a ghost button, not a brand fill. Downloading is the page's primary
 * action everywhere, and a second brand-filled button two sections above the
 * closing band made the page look like it had two conclusions. Joining a
 * feedback program is also a genuinely softer ask than installing the app, so
 * the lower emphasis matches the request.
 */
export function BetaSection() {
  const { t, i18n } = useTranslation();
  const mailtoHref = contactMailto(t("beta.invite.emailSubject"));
  const fullGuideHref = betaPagePath(localeFromLanguage(i18n.language));

  return (
    <section
      id="beta"
      data-testid="beta-section"
      aria-labelledby="beta-heading"
      className="mkt-band-tint mkt-section-y border-y border-border"
    >
      <div className="mkt-page-x mx-auto max-w-[1080px]">
        <div
          data-testid="beta-invite"
          className="grid grid-cols-1 gap-8 rounded-lg border border-border bg-card p-6 sm:p-8 lg:grid-cols-2 lg:gap-12 lg:p-10"
        >
          <div>
            <p className="mb-3 text-xs font-semibold tracking-wider text-primary uppercase">
              {t("beta.eyebrow")}
            </p>
            <h2 id="beta-heading" className="text-display-l text-foreground">
              {t("beta.invite.heading")}
            </h2>
            <p className="mt-4 text-base leading-relaxed text-muted-foreground">
              {t("beta.invite.body")}
            </p>
            <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4">
              <a
                href={mailtoHref}
                data-testid="beta-invite-cta"
                className="mkt-tap-cta inline-flex items-center justify-center rounded-md border border-line-strong bg-card px-4 py-2 text-sm font-medium whitespace-nowrap text-foreground outline-none transition-colors hover:bg-hover focus-visible:ring-3 focus-visible:ring-primary/40"
              >
                {t("beta.invite.cta")}
              </a>
              <a
                href={fullGuideHref}
                data-testid="beta-full-guide-link"
                className="mkt-tap inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline sm:justify-start"
              >
                {t("beta.fullGuideLink")}
                <ArrowRight aria-hidden="true" className="size-4" />
              </a>
            </div>
          </div>

          <div className="border-t border-border pt-8 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-12">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {t("founding.pitch.focusIntro")}
            </p>
            <ul
              role="list"
              data-testid="beta-focus-list"
              className="mt-4 flex flex-col gap-2"
            >
              {foundingFocusIds.map((id) => (
                <li key={id} className="flex gap-3 text-sm">
                  <span
                    aria-hidden="true"
                    className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary"
                  />
                  <span className="text-foreground">
                    {t(`founding.pitch.focus.${id}`)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm leading-relaxed font-medium text-foreground">
              {t("founding.pitch.exchange")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
