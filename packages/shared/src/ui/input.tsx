import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "../lib/cn"
import { focusRing } from "./focus"

// `money` is not decoration: an amount field set in proportional figures makes a column of entered
// values impossible to compare, and a bare `<input type="number">` gives spinners plus locale-
// dependent decimal handling on a field where the user is typing their own money. Every amount
// input in the product goes through this prop.
function Input({
  className,
  type,
  money = false,
  ...props
}: React.ComponentProps<"input"> & { money?: boolean }) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      data-money={money || undefined}
      className={cn(
        "h-8 min-h-target-min w-full min-w-0 rounded-sm border border-line-strong bg-card px-2.5 py-1 text-body text-ink transition-colors file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-label file:text-ink placeholder:text-ink-faint disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-line disabled:text-ink-disabled aria-disabled:cursor-not-allowed aria-disabled:border-line aria-disabled:text-ink-disabled aria-invalid:border-over",
        money && "money text-right",
        focusRing,
        className
      )}
      {...props}
    />
  )
}

export { Input }
