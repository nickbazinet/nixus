import { cn } from "@nixus/shared";

/**
 * Warm Editorial section heading block.
 *
 * Owns the three-part editorial rhythm — eyebrow, heading, optional
 * description — plus the thin editorial rule the marketing direction leans on.
 * Every string is caller-supplied: this primitive carries no product, FAQ, or
 * locale copy of its own, so a call site is always the single source of its
 * words.
 *
 * Two shapes are supported by construction:
 *   two-part   — eyebrow + heading (a section that needs no lead sentence)
 *   three-part — eyebrow + heading + description
 *
 * See DESIGN.md "Marketing — Warm Editorial": the heading names exactly one
 * fluid type role and the viewport resolves it, so no call site restates a
 * breakpoint pair.
 */

/** Heading rank is a caller decision — a page owns its outline, not this block. */
type EditorialHeadingLevel = "h1" | "h2" | "h3";

type EditorialAlign = "left" | "center";

type EditorialHeadingProps = {
  /** Rendered on the heading element so a section's `aria-labelledby` resolves. */
  readonly id: string;
  readonly eyebrow: string;
  readonly heading: string;
  /** Omitted entirely when absent — never an empty paragraph. */
  readonly description?: string;
  readonly level?: EditorialHeadingLevel;
  readonly align?: EditorialAlign;
  /** The thin editorial rule closing the block. Opt out for tight stacks. */
  readonly rule?: boolean;
  readonly className?: string;
};

/**
 * One fluid type role per rank. `h1` and `h2` take the marketing display
 * roles; `h3` sits at card-heading scale because a card heading rendered at
 * display size reads as a second page title.
 *
 * Colour is baked in and these must NEVER go through `cn()` — tailwind-merge
 * reads an unregistered `text-*` as a colour and drops the role, which renders
 * the heading at the inherited 16px.
 */
const HEADING_CLASS: Record<EditorialHeadingLevel, string> = {
  h1: "text-display-xl text-foreground",
  h2: "text-display-l text-foreground",
  h3: "text-xl font-semibold text-foreground",
};

/** Also never through `cn()`: `text-muted-foreground` would drop `text-lead`. */
const DESCRIPTION_CLASS = "mt-4 max-w-[540px] text-lead text-muted-foreground";

export function EditorialHeading({
  id,
  eyebrow,
  heading,
  description,
  level = "h2",
  align = "left",
  rule = true,
  className,
}: EditorialHeadingProps) {
  const Heading = level;
  const isCentered = align === "center";

  return (
    <div
      data-testid="editorial-heading"
      data-align={align}
      className={cn(isCentered ? "text-center" : "text-left", className)}
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-primary">
        {eyebrow}
      </p>
      <Heading id={id} className={HEADING_CLASS[level]}>
        {heading}
      </Heading>
      {description === undefined ? null : (
        <p
          className={
            isCentered ? `${DESCRIPTION_CLASS} mx-auto` : DESCRIPTION_CLASS
          }
        >
          {description}
        </p>
      )}
      {rule ? (
        <div
          aria-hidden="true"
          data-testid="editorial-heading-rule"
          className={cn("mt-6 h-px w-16 bg-border", isCentered && "mx-auto")}
        />
      ) : null}
    </div>
  );
}
