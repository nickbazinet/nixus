/**
 * Every visitor-facing asset the site expects you to supply, in one place.
 *
 * This file exists so that adding imagery is a content edit, not a code change.
 * Set a path, drop the file in `apps/web/public/`, and the matching section
 * renders it; leave a path `undefined` and that section renders a stand-in at
 * the correct aspect ratio instead. The layout is identical either way, so a
 * section can be designed, reviewed, and tested at every breakpoint before its
 * asset exists.
 *
 * Paths are site-root absolute (`/product/tour.mp4` -> `public/product/tour.mp4`).
 *
 * ## Replacing the stage screenshots
 *
 * The four showcase screenshots are configured in `content/stages.ts`, not here,
 * because each one is bound to a specific stage. They must be framed **16:10
 * (1600 × 1000)** — see `SHOWCASE_ASPECT`. That is not a preference: the four
 * rows alternate sides, so an inconsistent ratio makes the visual column's
 * height swing between rows and strands dead space under the shorter text
 * columns. Capture the full app window rather than a scrolled-into crop.
 */

export type MediaAsset = {
  readonly src?: string;
};

/**
 * Optional ambient video behind the hero headline.
 *
 * Left unset deliberately. While it is unset the hero keeps the existing
 * `hero-bg-{light,dark}.webp` backdrop, whose mask geometry is measured against
 * the prose column for WCAG 1.4.3 contrast — so an unset value is a working
 * state, not a missing one.
 *
 * When you do set it: `poster` is required, because it is what a visitor sees
 * under `prefers-reduced-motion` and before the video's first frame decodes.
 * Supply a short, near-static, silent loop — the hero sets type over this layer,
 * and anything with hard cuts or high local contrast will fail the same contrast
 * requirement the webp mask was built to satisfy.
 */
export const heroVideo: {
  readonly src?: string;
  readonly poster?: string;
} = {
  src: undefined,
  poster: undefined,
};

/**
 * The product-tour film. The one slot on the page that wants a real edit rather
 * than a screenshot — a short run through import, budget, and dashboard.
 */
export const productTour: {
  readonly src?: string;
  readonly poster?: string;
} = {
  src: undefined,
  poster: undefined,
};
