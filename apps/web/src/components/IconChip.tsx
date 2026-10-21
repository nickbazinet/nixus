import type { LucideIcon } from "lucide-react";

/**
 * A tinted icon chip, coloured by position on the logo-gradient ramp.
 *
 * This is the one place section icons get their colour. Before it, five
 * sections each hand-rolled their own chip: the trust band used a bare purple
 * glyph, the step cards a lavender square, the feature grid an inline-styled
 * chip drawn from chart-1..8, and the privacy cards another bare glyph. They
 * read as five different design languages on one page, and the feature grid's
 * choice was the worst of them — chart-5..8 are teal, gold, olive and grey, so
 * half the grid left the brand palette entirely.
 *
 * `stop` is 1-4 and maps to `--chart-1..4`, which are the logo's own hue
 * journey: periwinkle, violet, purple, pink. Capping at four is the point, not
 * a limitation — it keeps every chip on the gradient, and a section with more
 * than four items cycles with `index % 4` rather than reaching for a fifth hue.
 *
 * Decorative by construction (`aria-hidden`): every chip sits beside a text
 * label that carries the meaning.
 */
export type RampStop = 1 | 2 | 3 | 4;

type IconChipProps = {
  readonly icon: LucideIcon;
  readonly stop: RampStop;
  readonly size?: "sm" | "md";
};

const SIZE = {
  sm: { box: "size-7", icon: "size-4" },
  md: { box: "size-9", icon: "size-[18px]" },
} as const;

/** Cycles any index onto the four-stop ramp. */
export function rampStop(index: number): RampStop {
  return ((index % 4) + 1) as RampStop;
}

export function IconChip({ icon: Icon, stop, size = "md" }: IconChipProps) {
  return (
    <span
      aria-hidden="true"
      data-stop={stop}
      className={`mkt-chip inline-flex shrink-0 items-center justify-center rounded-md ${SIZE[size].box}`}
    >
      <Icon className={SIZE[size].icon} />
    </span>
  );
}
