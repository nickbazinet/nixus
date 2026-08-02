import * as React from "react"

import { cn } from "../lib/cn"

interface StepProgressProps extends Omit<React.ComponentProps<"div">, "children"> {
  completed: number
  total: number
  /** Required, and it is the accessible name — "Months of history collected". */
  label: string
  /** Spoken instead of the raw number — "1 of 3 months". */
  valueText?: string
}

// Discrete pips, not a continuous bar. `Meter` cannot express this: the value here is a COUNT of
// finished months, and rendering 1-of-3 as a 33%-filled bar implies the app is a third of the way
// through the current month, which it does not know.
//
// This turns "not enough data" into something with an end date, which is the whole reason the
// insufficient-data state reads as a first-class state rather than as the app being broken.
//
// data-slot="meter" earns the forced-colors system border; the pips opt out of the override because
// filled-versus-empty IS the information.
function StepProgress({
  completed,
  total,
  label,
  valueText,
  className,
  ...props
}: StepProgressProps) {
  const filled = Math.min(Math.max(completed, 0), total)

  return (
    <div
      data-slot="meter"
      role="progressbar"
      aria-label={label}
      aria-valuenow={filled}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuetext={valueText}
      className={cn("flex justify-center gap-1.5", className)}
      {...props}
    >
      {Array.from({ length: total }, (_step, index) => (
        <span
          key={index}
          aria-hidden="true"
          data-slot="meter-fill"
          className={cn(
            "h-[5px] w-8 rounded-full",
            index < filled ? "bg-brand" : "bg-line-strong"
          )}
        />
      ))}
    </div>
  )
}

export { StepProgress }
export type { StepProgressProps }
