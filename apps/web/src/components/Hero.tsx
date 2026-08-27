import type { LinkHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";

import { DownloadCTA } from "@/features/download/DownloadCTA";

/**
 * CSS backgrounds bypass the preload scanner, so keep these route-local hrefs
 * beside the matching `before:bg-[url(...)]` declarations below.
 */
export const HERO_BACKDROP_PRELOADS = [
  {
    rel: "preload",
    as: "image",
    href: "/hero-bg-light.webp",
    media: "(prefers-color-scheme: light)",
    fetchPriority: "high",
  },
  {
    rel: "preload",
    as: "image",
    href: "/hero-bg-dark.webp",
    media: "(prefers-color-scheme: dark)",
    fetchPriority: "high",
  },
] as const satisfies readonly LinkHTMLAttributes<HTMLLinkElement>[];

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
 *
 * The headline names one fluid type role (`text-display-xl`) rather than the
 * `text-display-l md:text-display-xl` pair it used to carry — see DESIGN.md
 * "Marketing site — responsive tier". This is also the single full download
 * affordance on a phone, because the sticky header no longer carries one.
 */
export function Hero({ eyebrow }: HeroProps) {
  const { t } = useTranslation();
  const eyebrowText = eyebrow !== undefined ? eyebrow : t("hero.eyebrow");
  return (
    <section
      data-testid="hero"
      className="mkt-hero-y relative isolate overflow-hidden bg-gradient-to-b from-slate-50 to-background before:absolute before:inset-0 before:-z-10 before:bg-[url('/hero-bg-light.webp')] before:bg-cover before:bg-center before:opacity-90 dark:before:bg-[url('/hero-bg-dark.webp')] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:-z-10 after:h-32 after:bg-gradient-to-b after:from-transparent after:to-background"
    >
      <div className="mkt-page-x relative mx-auto flex max-w-[960px] flex-col items-center text-center">
        {eyebrowText ? (
          <p
            data-testid="hero-eyebrow"
            className="mb-4 text-sm font-medium uppercase tracking-wider text-primary md:mb-6"
          >
            {eyebrowText}
          </p>
        ) : null}
        <h1 className="text-display-xl text-foreground">
          {t("hero.headline")}
        </h1>
        <p className="mx-auto mt-4 max-w-[600px] text-lead text-muted-foreground md:mt-6">
          {t("hero.subhead")}
        </p>
        <div className="mt-8 flex w-full justify-center md:mt-10">
          <DownloadCTA size="lg" showAltOS className="max-w-full items-center" />
        </div>
      </div>
    </section>
  );
}
