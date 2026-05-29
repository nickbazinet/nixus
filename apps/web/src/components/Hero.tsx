import { useTranslation } from "react-i18next";

import { DownloadCTA } from "@/features/download/DownloadCTA";

export type HeroProps = {
  /**
   * Optional eyebrow label rendered above the headline. Translated by
   * the caller (or omitted entirely, as in v1).
   */
  eyebrow?: string;
};

/**
 * Hero (Story 3.1) — Variant B, centered.
 *
 * Headline + subhead come from i18n keys (`hero.headline`, `hero.subhead`)
 * so the same component renders English on `/` and French on `/fr/` with
 * no per-route prop juggling.
 */
export function Hero({ eyebrow }: HeroProps) {
  const { t } = useTranslation();
  return (
    <section
      data-testid="hero"
      className="relative isolate overflow-hidden bg-gradient-to-b from-slate-50 to-background pt-24 pb-16 md:pt-32 md:pb-24 before:absolute before:inset-0 before:-z-10 before:bg-[url('/hero-bg-light.webp')] before:bg-cover before:bg-center before:opacity-90 dark:before:bg-[url('/hero-bg-dark.webp')] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:-z-10 after:h-32 after:bg-gradient-to-b after:from-transparent after:to-background"
    >
      <div className="relative mx-auto flex max-w-[960px] flex-col items-center px-6 text-center md:px-8">
        {eyebrow ? (
          <p
            data-testid="hero-eyebrow"
            className="mb-6 text-sm font-medium uppercase tracking-wider text-muted-foreground"
          >
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-display-l md:text-display-xl text-foreground">
          {t("hero.headline")}
        </h1>
        <p className="mx-auto mt-6 max-w-[600px] text-lead text-muted-foreground">
          {t("hero.subhead")}
        </p>
        <div className="mt-10 flex justify-center">
          <DownloadCTA size="lg" showAltOS />
        </div>
      </div>
    </section>
  );
}
