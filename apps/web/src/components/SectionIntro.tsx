import type { ReactNode } from "react";

/**
 * Section intro block — eyebrow, heading, lead, and an optional aside.
 *
 * Two jobs. It removes the eyebrow/heading/lead markup that was copy-pasted
 * into six sections, and it fixes the dead space that copy-paste created: the
 * text block stops at `--mkt-measure-prose` (704px) inside a container up to
 * 1440px wide, so every intro left roughly 45% of its row empty. On a wide
 * monitor that reads as the band being unfinished.
 *
 * The answer is content, not decoration. `aside` takes whatever supporting fact
 * the section already owned but had stranded elsewhere — a footnote below the
 * grid, a stage index, a summary claim — and seats it in the space the measure
 * gives up. A background image there would fill the pixels without answering a
 * single question the visitor has.
 *
 * `align="center"` exists for the two sections whose content is genuinely
 * centred (the tour, the closing band); it forgoes the aside, because a centred
 * heading with something bolted to its right is just an off-centre heading.
 */

type SectionIntroProps = {
  readonly id: string;
  readonly eyebrow: string;
  readonly heading: string;
  readonly lead?: string;
  readonly aside?: ReactNode;
  readonly align?: "left" | "center";
};

export function SectionIntro({
  id,
  eyebrow,
  heading,
  lead,
  aside,
  align = "left",
}: SectionIntroProps) {
  const text = (
    <div className={align === "center" ? "mx-auto max-w-[44rem]" : undefined}>
      <p className="mb-3 text-xs font-semibold tracking-wider text-primary uppercase">
        {eyebrow}
      </p>
      {/* Never through `cn()`: tailwind-merge reads the unregistered
          `text-display-l` as a colour utility and drops it, which silently
          renders the heading at the inherited 16px. */}
      <h2 id={id} className="text-display-l text-foreground">
        {heading}
      </h2>
      {lead === undefined ? null : (
        <p className="mt-4 text-lead text-muted-foreground">{lead}</p>
      )}
    </div>
  );

  if (align === "center") {
    return (
      <div data-testid="section-intro" className="mkt-section-lead text-center">
        {text}
      </div>
    );
  }

  if (aside === undefined) {
    return (
      <div
        data-testid="section-intro"
        className="mkt-section-lead mkt-measure-prose"
      >
        {text}
      </div>
    );
  }

  return (
    <div
      data-testid="section-intro"
      className="mkt-section-lead grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end lg:gap-16"
    >
      {text}
      <div data-testid="section-intro-aside">{aside}</div>
    </div>
  );
}
