import * as React from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "../lib/cn"

/**
 * The gradient every brand line icon strokes with (`icon-gradient`). Mount exactly once per
 * document: `url(#nx-icon-gradient)` resolves against the first matching id on the page.
 *
 * `userSpaceOnUse` rather than the default bounding box: a straight horizontal or vertical stroke
 * has a zero-height (or zero-width) box, and an objectBoundingBox gradient on it paints nothing.
 */
function IconGradientDefs() {
  return (
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute size-0 overflow-hidden"
    >
      <defs>
        <linearGradient
          id="nx-icon-gradient"
          gradientUnits="userSpaceOnUse"
          x1="2"
          y1="2"
          x2="22"
          y2="22"
        >
          <stop offset="0%" stopColor="#DE50A4" />
          <stop offset="50%" stopColor="#9978ED" />
          <stop offset="100%" stopColor="#5E78ED" />
        </linearGradient>
      </defs>
    </svg>
  )
}

interface IconChipProps extends Omit<React.ComponentProps<"span">, "children"> {
  icon: LucideIcon
  size?: "sm" | "default" | "lg"
  /** `card` sits the chip on glass (white tile) instead of the default soft brand tile. */
  tone?: "soft" | "card"
}

const chipSize = {
  sm: "size-8 rounded-[10px] [&_svg]:size-4",
  default: "size-10 rounded-xl [&_svg]:size-[18px]",
  lg: "size-12 rounded-2xl [&_svg]:size-5",
} as const

/**
 * A gradient line icon on a soft tile — the charte's icon treatment for card headers, list rows,
 * and metric labels. Always decorative: the text beside it carries the meaning.
 */
function IconChip({ icon: Icon, size = "default", tone = "soft", className, ...props }: IconChipProps) {
  return (
    <span
      data-slot="icon-chip"
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center",
        tone === "soft" ? "bg-brand-soft/70" : "bg-card",
        chipSize[size],
        className
      )}
      {...props}
    >
      <Icon className="icon-gradient" strokeWidth={1.75} />
    </span>
  )
}

export { IconChip, IconGradientDefs }
export type { IconChipProps }
