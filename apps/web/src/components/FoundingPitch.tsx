import { useTranslation } from "react-i18next";

import { contactMailto } from "@/content/contact";
import { foundingFocusIds } from "@/content/foundingPitch";

export type FoundingPitchProps = {
  readonly showCta?: boolean;
};

export function FoundingPitch({ showCta = true }: FoundingPitchProps) {
  const { t } = useTranslation();
  const programMailto = contactMailto(t("betaPage.feedback.emailSubject"));

  return (
    <section
      id="founding-users"
      data-testid="founding-pitch"
      aria-labelledby="founding-pitch-heading"
      className="mkt-section-lead"
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-primary">
        {t("founding.pitch.eyebrow")}
      </p>
      <h2
        id="founding-pitch-heading"
        className="text-xl font-semibold text-foreground sm:text-2xl"
      >
        {t("founding.pitch.heading")}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {t("founding.pitch.audience")}
      </p>
      <div className="mt-6 rounded-lg border border-border bg-card p-5 sm:p-6 md:p-8">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("founding.pitch.focusIntro")}
        </p>
        <ul
          role="list"
          data-testid="founding-pitch-focus"
          className="mt-3 list-disc space-y-2 pl-5 text-sm text-foreground"
        >
          {foundingFocusIds.map((id) => (
            <li key={id}>{t(`founding.pitch.focus.${id}`)}</li>
          ))}
        </ul>
        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
          {t("founding.pitch.earlyAccess")}
        </p>
        <p className="mt-4 text-sm leading-relaxed font-medium text-foreground">
          {t("founding.pitch.exchange")}
        </p>
        {showCta ? (
          <div className="mt-6 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4">
            <a
              href={programMailto}
              data-testid="founding-pitch-cta"
              className="mkt-tap-cta inline-flex max-w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-primary/40"
            >
              {t("founding.pitch.cta")}
            </a>
            <p className="text-sm break-words text-muted-foreground">
              {t("founding.pitch.ctaNote")}
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
