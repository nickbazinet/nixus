import type { LinkHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";

import { DownloadCTA } from "@/features/download/DownloadCTA";

import { AIDemoFigure } from "./AIDemo";

/**
 * CSS backgrounds bypass the preload scanner, so these hrefs live beside the
 * matching `before:bg-[url(...)]` declarations below.
 *
 * One asset per colour scheme, each `media`-scoped so exactly one can ever match:
 * the browser fetches the atmosphere it is about to paint and never the other.
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

/**
 * One backdrop layer, one asset per scheme, plus the shared bottom fade.
 *
 * Light is atmosphere behind live text, so it is held back four ways rather than
 * one: held under half in alpha, `mix-blend-multiply` so the layer can only
 * ever darken the warm paper (the pale skyline keeps the page's warmth instead of
 * washing it toward cool white), a bottom-right anchored mask that dissolves the
 * image out from under the prose column, and the fade that ties its lower edge
 * into the page. The mask is the readability half of the recipe, and it is
 * measured, not decorative: the asset carries a violet blur band on its left edge
 * that landed under the subhead and pulled `--ink-dim` down to 3.47:1 (WCAG 1.4.3
 * wants 4.5:1 for body text), while a plain alpha low enough to fix that — about
 * 0.12 — erased the skyline entirely. Anchoring the atmosphere to the demo side
 * keeps it visible where it is composition and absent where it is noise.
 *
 * Dark keeps the photograph exactly as it always was — normal blending, no mask,
 * `opacity-90`, `cover`, centred — because there the image is the surface, not a
 * wash over one. Its geometry is restated in the `dark:` block so the narrow-width
 * light overrides below cannot reshape it.
 *
 * Below the desktop tier the light recipe changes geometry, not intent. `cover` on
 * a 16:9 asset inside a tall narrow hero scales it to ~2109px wide and centre-crops
 * it, so a phone rendered nothing but a slice of the asset's empty sky: downloaded,
 * paid for, invisible. Instead the layer itself is capped to a band at the top of
 * the hero (`bottom-auto` + a fixed height) and a width-fit image is anchored to
 * that band's bottom edge, so what lands on the page is the skyline and its plaza
 * reflection at full width, with no side seams and no crop of the interesting half.
 * The band's box is the readability half, and its bounds are measured, not chosen:
 * at 375 the eyebrow ends at hero-y 73 and the body copy starts at 224 (640: 278),
 * and the eyebrow sits lower at 640 (the hero's top padding scales with the
 * viewport), the layer runs 104 -> 224 and lands on the display headline alone,
 * where near-black ink clears 3:1 by an order of magnitude. Both small-text runs —
 * the brand eyebrow above and the lead paragraph below — keep clean paper: with the
 * band over the eyebrow it measured 3.23:1 against a 4.5:1 requirement, and merely
 * clipping its fade-in there still only bought 4.62:1. The
 * px-stop mask fades both edges inside the box so the horizon never ends on a line.
 *
 * Every class below is a literal: Tailwind extracts candidates from raw source
 * text, so a mask assembled through a template placeholder compiles to nothing and
 * the atmosphere silently covers the prose again.
 */
const HERO_BACKDROP_CLASS = [
  "before:absolute before:inset-0 before:-z-10 before:bg-cover before:bg-center",
  "before:bg-[url('/hero-bg-light.webp')] before:opacity-[0.45] before:mix-blend-multiply",
  "before:[-webkit-mask-image:radial-gradient(110%_110%_at_90%_90%,#000_0%,#000_30%,transparent_66%)]",
  "before:[mask-image:radial-gradient(110%_110%_at_90%_90%,#000_0%,#000_30%,transparent_66%)]",
  "max-lg:before:top-[104px] max-lg:before:bottom-auto max-lg:before:h-[120px]",
  "max-lg:before:bg-[length:100%_auto] max-lg:before:bg-bottom max-lg:before:bg-no-repeat",
  "max-lg:before:[-webkit-mask-image:linear-gradient(to_bottom,transparent_0px,#000_32px,#000_88px,transparent_120px)]",
  "max-lg:before:[mask-image:linear-gradient(to_bottom,transparent_0px,#000_32px,#000_88px,transparent_120px)]",
  "dark:before:bg-[url('/hero-bg-dark.webp')] dark:before:opacity-90 dark:before:mix-blend-normal",
  "dark:before:top-0 dark:before:bottom-0 dark:before:h-auto",
  "dark:before:bg-cover dark:before:bg-center dark:before:bg-repeat",
  "dark:before:[-webkit-mask-image:none] dark:before:[mask-image:none]",
  "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:-z-10 after:h-32 after:bg-gradient-to-b after:from-transparent after:to-background",
].join(" ");

export type HeroProps = {
  /**
   * Optional eyebrow label rendered above the headline. Translated by
   * the caller (or omitted entirely, as in v1).
   */
  eyebrow?: string;
};

/**
 * Hero (Story 3.1) — Warm Editorial asymmetric composition.
 *
 * Headline + subhead come from i18n keys (`hero.headline`, `hero.subhead`) so
 * the same component renders English on `/` and French on `/fr/` with no
 * per-route prop juggling.
 *
 * The composition is the point: a left prose column at a readable measure beside
 * a wider product demo that carries the AI-import proof. `.mkt-asym-hero` owns
 * the 5/7 split and collapses to one column below the desktop tier, so the phone
 * layout is DOM reading order — headline, subhead, CTA, then proof. This is also
 * the single full download affordance on a phone, because the sticky header no
 * longer carries one.
 *
 * `.mkt-hero-overlap` pulls the demo down into the hero's lower band. The pull
 * (24px → 80px) is always smaller than the hero's own bottom padding
 * (40px → 96px) — both tokens share the same `vw` slope, so the clearance is a
 * constant 16px — which is what lets the visual break the text column's baseline
 * without reaching into the section that follows. `lg:self-end` is what makes
 * the pull visible: the prose column is the taller grid track at desktop, so a
 * centered demo would spend the negative margin on empty row space (measured:
 * 219px of clearance, no overlap at all) instead of hanging past the boundary.
 *
 * `overflow-x-clip` is the counterpart to `.mkt-ambient-light`: the glow is a
 * negative-inset pseudo-element, so at a narrow desktop width (a 1280px window
 * at 200% zoom reflows to 640px) its 5vw spread grows past the page gutter and
 * adds real horizontal document scroll — 5px of WCAG 1.4.10 failure. Clipping
 * one axis stops the sideways bleed and leaves the vertical glow and the overlap
 * pull untouched.
 */
export function Hero({ eyebrow }: HeroProps) {
  const { t } = useTranslation();
  const eyebrowText = eyebrow !== undefined ? eyebrow : t("hero.eyebrow");
  return (
    <section
      data-testid="hero"
      className={`mkt-hero-y relative isolate overflow-x-clip bg-page ${HERO_BACKDROP_CLASS}`}
    >
      <div className="mkt-page-x mkt-asym-hero mx-auto max-w-[1280px]">
        <div className="mkt-measure-lead">
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
          <p className="mt-4 text-lead text-muted-foreground md:mt-6">
            {t("hero.subhead")}
          </p>
          <div className="mt-8 flex md:mt-10">
            <DownloadCTA size="lg" showAltOS className="max-w-full" />
          </div>
        </div>
        <div className="mkt-hero-overlap mkt-ambient-light lg:self-end">
          <AIDemoFigure />
        </div>
      </div>
    </section>
  );
}
