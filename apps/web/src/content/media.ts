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
 * The product-tour film.
 *
 * `width` and `height` are the film's own pixel size, and the frame on the page
 * takes its SHAPE from those two numbers — there is no 16:9 anywhere in the
 * layout. That is why a screen recording of a window (1546 x 1080 here) fits
 * with no letterboxing and no re-edit. `media.test.ts` reads the real size out
 * of the file and fails if these numbers disagree with it, so replacing the
 * film cannot silently leave the frame the wrong shape.
 *
 * To replace it: drop the new MP4 in `public/product/`, update `src`, `width`
 * and `height`, and give the file a NEW NAME (`tour-v2.mp4`, not `tour-v1.mp4`
 * again). Media is cached for a week, so reusing a name leaves returning
 * visitors on the old film until their cache expires.
 *
 * `poster` is the still shown before play. Export it at the film's exact shape;
 * a different shape is letterboxed until the first frame replaces it.
 *
 * What the file should be: H.264 in an MP4, no audio track, "fast start" (index
 * at the front, so it can begin playing before it has finished downloading),
 * ideally under ~6 MB. It loads only when a visitor presses play.
 */
export const productTour: {
  readonly src?: string;
  readonly poster?: string;
  readonly width: number;
  readonly height: number;
} = {
  src: "/product/tour-v1.mp4",
  poster: "/product/tour-v1-poster.webp",
  width: 1546,
  height: 1080,
};

/**
 * The closing band's photograph.
 *
 * The only band on the page where imagery belongs, because it is the only one
 * with no body copy for a picture to endanger — the photo sits in its own
 * column, never behind text. A person using Nixus at a desk or kitchen table
 * reads better here than another screenshot: the page has already shown four of
 * those, and this moment is about the decision, not the feature.
 */
export const closingPhoto: {
  readonly src?: string;
} = {
  /* 1400 x 933 (3:2) WebP, 108 KB. The slot's declared aspect must stay in step
   * with this file's real ratio, or the stand-in reserves a different box than
   * the asset and the band shifts on load. */
  src: "/product/closing-couple.webp",
};
