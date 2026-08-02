import * as React from "react"

import { cn } from "../lib/cn"

interface SkeletonProps extends React.ComponentProps<"div"> {
  /**
   * Must match the real content count. The shipped app hardcodes 2–3 rows regardless of what is
   * loading, which is why nearly every list jumps when data lands.
   */
  rows?: number
}

// Per-card, never a global spinner. Chrome — toolbar, column heads, footer — resolves immediately;
// only the cells are skeletons.
//
// `aria-busy` on the container states that content is pending; the bars are `aria-hidden` so the
// pulse is never announced as content.
function Skeleton({ rows = 1, className, ...props }: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      aria-busy="true"
      className={cn("flex w-full flex-col gap-2", className)}
      {...props}
    >
      {Array.from({ length: Math.max(1, rows) }, (_unused, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="block h-3 w-full animate-pulse rounded-sm bg-track"
        />
      ))}
    </div>
  )
}

export { Skeleton }
export type { SkeletonProps }
