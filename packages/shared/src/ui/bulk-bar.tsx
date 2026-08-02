import * as React from "react"

import { cn } from "../lib/cn"

interface BulkBarProps {
  /**
   * Localized, and it states the count — "4 selected". Rendered as the live-region content, so it
   * is what gets announced when a selection changes.
   */
  countLabel: string
  /**
   * The selected sum. Pass a <Money /> node. A count alone does not tell the user whether they are
   * about to delete $12 or $1,200, which is the whole reason this bar exists rather than a counter.
   */
  sum?: React.ReactNode
  /** `Esc` clears the selection from anywhere, per the global overlay/selection key contract. */
  onClear: () => void
  /** The header checkbox slot, so its indeterminate state stays adjacent to the count it explains. */
  leading?: React.ReactNode
  /** The actions: change category, link to account, delete. */
  children?: React.ReactNode
  className?: string
  "data-testid"?: string
}

function BulkBar({
  countLabel,
  sum,
  onClear,
  leading,
  children,
  className,
  "data-testid": testId,
}: BulkBarProps) {
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClear()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClear])

  return (
    <div
      data-slot="bulk-bar"
      data-testid={testId}
      aria-live="polite"
      className={cn(
        "flex items-center gap-2.5 border-b border-line bg-brand-soft px-3.5 py-2.5",
        className
      )}
    >
      {leading}
      <span className="text-label text-brand-ink">{countLabel}</span>
      {sum ? (
        <span className="text-caption text-ink-dim">
          <span aria-hidden="true">&middot; </span>
          {sum}
        </span>
      ) : null}
      <span className="flex-1" />
      {children}
    </div>
  )
}

export { BulkBar }
export type { BulkBarProps }
