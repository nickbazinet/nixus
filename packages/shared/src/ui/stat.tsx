import * as React from "react"

import { cn } from "../lib/cn"
import { MaskedFigure } from "./money"

interface StatProps extends Omit<React.ComponentProps<"div">, "children"> {
  /** The figure. A string is masked character-by-character; a node is masked wholesale. */
  value: React.ReactNode
  label?: React.ReactNode
  caption?: React.ReactNode
  masked?: boolean
  /** Localized "Amount hidden". Required whenever `masked` can become true. */
  maskedLabel?: string
}

// At most ONE Stat per surface — it is the single number that answers the surface's question. Two
// 34px figures competing on one screen means neither is the answer. A section total or a
// committed-per-month sum is a SubStat.
function Stat({
  value,
  label,
  caption,
  masked = false,
  maskedLabel = "Amount hidden",
  className,
  ...props
}: StatProps) {
  return (
    <div data-slot="stat" className={cn("flex flex-col gap-1", className)} {...props}>
      {label ? (
        <span data-slot="stat-label" className="text-caption text-ink-dim">
          {label}
        </span>
      ) : null}
      <StatFigure
        value={value}
        masked={masked}
        maskedLabel={maskedLabel}
        className="text-display text-ink"
      />
      {caption ? (
        <span data-slot="stat-caption" className="text-caption text-ink-dim">
          {caption}
        </span>
      ) : null}
    </div>
  )
}

// The 26px secondary figure: a section total, a committed-per-month sum. Unlimited per surface.
function SubStat({
  value,
  label,
  caption,
  masked = false,
  maskedLabel = "Amount hidden",
  className,
  ...props
}: StatProps) {
  return (
    <div data-slot="sub-stat" className={cn("flex flex-col gap-1", className)} {...props}>
      {label ? (
        <span data-slot="sub-stat-label" className="text-caption text-ink-dim">
          {label}
        </span>
      ) : null}
      <StatFigure
        value={value}
        masked={masked}
        maskedLabel={maskedLabel}
        className="text-stat text-ink"
      />
      {caption ? (
        <span data-slot="sub-stat-caption" className="text-caption text-ink-dim">
          {caption}
        </span>
      ) : null}
    </div>
  )
}

// A non-string value cannot be masked per character, so it is dropped entirely and replaced by the
// label — leaving the node rendered under a blur would keep the real figure in the accessible tree.
function StatFigure({
  value,
  masked,
  maskedLabel,
  className,
}: {
  value: React.ReactNode
  masked: boolean
  maskedLabel: string
  className: string
}) {
  if (!masked) {
    return (
      <span data-slot="stat-value" className={cn("money", className)}>
        {value}
      </span>
    )
  }
  return (
    <MaskedFigure
      value={typeof value === "string" ? value : "0000"}
      label={maskedLabel}
      className={className}
    />
  )
}

export { Stat, SubStat }
export type { StatProps }
