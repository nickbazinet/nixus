import * as React from "react"

import { cn } from "../lib/cn"

/**
 * The section kicker: the logo's minus-sign pill followed by a short uppercase label — "FINANCE",
 * "SUGGESTED NEXT STEP". Never a heading on its own; it sits above one.
 */
function Eyebrow({ className, children, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="eyebrow"
      className={cn(
        "flex items-center gap-2.5 text-micro font-bold tracking-[0.12em] text-brand-ink uppercase",
        className
      )}
      {...props}
    >
      <span aria-hidden="true" className="h-1.5 w-7 shrink-0 rounded-full bg-pill-gradient" />
      {children}
    </p>
  )
}

export { Eyebrow }
