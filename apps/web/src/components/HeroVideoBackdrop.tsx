import { heroVideo } from "@/content/media";

/**
 * Optional ambient video layer behind the hero.
 *
 * Renders nothing at all when `heroVideo.src` is unset, which is the shipped
 * default — the hero's existing `hero-bg-{light,dark}.webp` backdrop then stays
 * exactly as measured, including the mask geometry that holds `--ink-dim` above
 * 4.5:1 under the prose column.
 *
 * Three details are load-bearing when a file IS configured:
 *
 * `muted` is not a preference — an unmuted autoplaying video is blocked by every
 * current browser, so without it the layer silently never starts.
 *
 * The reduced-motion path is the `poster` alone, served as a plain background
 * image rather than a paused `<video>`. A paused video element still decodes its
 * first frame and holds the decoder; a background image does not, and WCAG 2.3.3
 * wants the motion gone rather than stopped.
 *
 * `aria-hidden` plus no `controls`: this is atmosphere behind live text, so it
 * carries no information and must not land in the tab order or be announced.
 */
export function HeroVideoBackdrop() {
  if (heroVideo.src === undefined) return null;

  return (
    <div
      aria-hidden="true"
      data-testid="hero-video-backdrop"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      {heroVideo.poster === undefined ? null : (
        <div
          style={{ backgroundImage: `url(${heroVideo.poster})` }}
          className="absolute inset-0 bg-cover bg-center motion-safe:hidden"
        />
      )}
      <video
        src={heroVideo.src}
        poster={heroVideo.poster}
        muted
        loop
        playsInline
        autoPlay
        preload="metadata"
        className="absolute inset-0 hidden size-full object-cover opacity-[0.45] mix-blend-multiply motion-safe:block dark:opacity-90 dark:mix-blend-normal"
      />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-background" />
    </div>
  );
}
