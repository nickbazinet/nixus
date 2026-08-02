import * as React from "react"

import { cn } from "../lib/cn"
import { focusRing } from "./focus"

type AttentionStatus = "over" | "caution" | "good" | "neutral"

interface AttentionRowProps {
  status: AttentionStatus
  name: React.ReactNode
  figure?: React.ReactNode
  badge?: React.ReactNode
  /**
   * One coherent localized sentence — "Restaurants, over budget by $86". Every visual part of the
   * row is hidden from assistive tech so the announcement is this sentence and nothing else, rather
   * than four disconnected fragments whose order varies by screen reader.
   */
  accessibleName: string
  onActivate?: () => void
  className?: string
  "data-testid"?: string
}

// Shape differentiates status, not just hue: `over` is a filled dot, `caution` is a ring. Amber
// against crimson is the single most confusable pair under deuteranopia and protanopia, and the dot
// column is the fastest scan path in a stacked list — so the badge text, while WCAG-sufficient on
// its own, would still leave a colourblind user with materially less signal on the scan.
//
// data-slot="status-dot" plus data-status are what the forced-colors block hooks to keep the filled
// and ring dots distinguishable once Windows overrides both fills.
const dotClasses: Record<AttentionStatus, string> = {
  over: "bg-over",
  caution: "border-[1.5px] border-caution bg-transparent",
  good: "bg-good",
  neutral: "bg-ink-faint",
}

function AttentionRow({
  status,
  name,
  figure,
  badge,
  accessibleName,
  onActivate,
  className,
  "data-testid": testId,
}: AttentionRowProps) {
  const content = (
    <>
      <span
        data-slot="status-dot"
        data-status={status}
        aria-hidden="true"
        className={cn("size-[7px] shrink-0 rounded-full", dotClasses[status])}
      />
      <span
        aria-hidden="true"
        className="min-w-0 flex-1 truncate text-caption text-ink"
      >
        {name}
      </span>
      {figure ? (
        <span
          aria-hidden="true"
          className="money text-caption font-semibold text-ink"
        >
          {figure}
        </span>
      ) : null}
      {badge ? <span aria-hidden="true">{badge}</span> : null}
    </>
  )

  const shared = cn(
    "flex w-full items-center gap-2.5 border-b border-line py-2 text-left last:border-b-0",
    className
  )

  if (onActivate) {
    return (
      <button
        type="button"
        data-slot="attention-row"
        data-testid={testId}
        aria-label={accessibleName}
        onClick={onActivate}
        className={cn(shared, "min-h-target-min hover:bg-hover", focusRing)}
      >
        {content}
      </button>
    )
  }

  return (
    <div data-slot="attention-row" data-testid={testId} className={shared}>
      <span className="sr-only">{accessibleName}</span>
      {content}
    </div>
  )
}

export { AttentionRow }
export type { AttentionRowProps, AttentionStatus }
