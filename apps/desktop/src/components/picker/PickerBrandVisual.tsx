import { Car, Cloud, Wallet } from "lucide-react";
import { NixusLogo } from "@nixus/shared";

/**
 * The launch screen's decorative second column: one Nixus hub, the two modules that ship today
 * hanging off it locally, and Nixus Cloud drawn as the optional fourth node.
 *
 * It says the one thing this screen has to say visually — *one app, several ways of working* — so the
 * local disclosure below the CTA does not read as a lesser path. The cloud link is dashed and the
 * local ones are solid, because that is the product: local works on its own, cloud is additive.
 *
 * Built from live DOM primitives, the app's own module icons and token classes only. Constraints that
 * are not obvious from the markup:
 *
 * - `aria-hidden` with nothing focusable inside, so it adds neither a tab stop nor an announcement.
 * - The canonical mark is consumed, never redrawn, and its `<linearGradient>` is the only SVG
 *   gradient here. The charte's diagonal ribbon behind the diagram is a CSS background on a skewed
 *   bar, kept well under half opacity — a hint of the brand sweep, never a coloured surface.
 * - No shadow: this is not a floating layer. Boundaries are hairlines and tone, as everywhere else.
 * - A 5-column grid rather than hand-placed offsets: the connector spans share the node columns'
 *   centre line by construction, so nothing needs a negative margin to line up.
 */
export function PickerBrandVisual() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto w-full max-w-sm lg:mx-0 lg:h-full lg:max-w-none"
      data-testid="picker-brand-visual"
    >
      {/* `h-full` is what keeps this level with the action column once the local disclosure expands —
        * a fixed aspect box would leave a short panel stranded beside a tall list. `min-h-80` is the
        * floor for the collapsed state, where the action column is the shorter of the two. */}
      <div className="relative flex h-full min-h-80 items-center justify-center overflow-hidden rounded-xl border border-line bg-brand-soft p-6">
        {/* The charte's ribbon: one skewed bar carrying the pink → violet → blue sweep, crossing the
          * panel behind the diagram and clipped by it at both ends. Low opacity on purpose — it
          * reads as light on the surface rather than as a second element competing with the nodes. */}
        <span className="pointer-events-none absolute -inset-x-20 top-1/2 h-20 -translate-y-1/2 -rotate-[14deg] bg-logo-gradient opacity-[0.13]" />

        {/* `auto` for the node columns and `1fr` for the connector columns is what makes the lines
          * actually touch: a centred node in an equal-width column leaves a gap at each end, and a
          * diagram whose links stop short of its nodes reads as broken rather than connected. */}
        <div className="relative grid w-full grid-cols-[auto_1fr_auto_1fr_auto] items-center">
          <span className="col-start-3 justify-self-center">
            {/* Dashed and dimmer than its siblings: an account is optional, and the drawing says so
              * before any copy has to. */}
            <span className="flex size-14 items-center justify-center rounded-2xl border border-dashed border-line-strong">
              <Cloud className="size-6 text-ink-faint" />
            </span>
          </span>

          <span className="col-start-3 h-8 justify-self-center border-l border-dashed border-line-strong" />

          <span className="col-start-1 flex size-16 items-center justify-center rounded-2xl border border-line-strong bg-card">
            <Wallet className="size-7 icon-gradient" strokeWidth={1.75} />
          </span>
          <span className="col-start-2 h-px w-full bg-line-strong" />
          <span className="col-start-3 flex size-24 items-center justify-center rounded-2xl border border-line-strong bg-card">
            <NixusLogo className="size-12" />
          </span>
          <span className="col-start-4 h-px w-full bg-line-strong" />
          <span className="col-start-5 flex size-16 items-center justify-center rounded-2xl border border-line-strong bg-card">
            <Car className="size-7 icon-gradient" strokeWidth={1.75} />
          </span>
        </div>
      </div>
    </div>
  );
}
