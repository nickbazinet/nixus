import * as React from "react"

import { cn } from "../lib/cn"

interface MeterProps extends Omit<React.ComponentProps<"div">, "children"> {
  value: number
  min?: number
  max?: number
  /**
   * Required, and it is the accessible name. A meter is never the only indicator of state, so the
   * component cannot be constructed without the label that a figure or badge is paired with.
   */
  label: string
  /** Spoken instead of the raw percentage — "3.2 of 6 months covered" rather than "53". */
  valueText?: string
}

// 7px track, brand fill, pill ends. Never a drag target: if that ever changes, the hit area must
// expand independently of the 7px visual height, which is the one documented exception to the 24px
// minimum-target rule.
//
// The fill is always brand. Status does not live here — an over-budget category is carried by the
// badge and figure beside the meter, because brand means brand and action and nothing else.
//
// data-slot="meter" and data-slot="meter-fill" are both load-bearing: the forced-colors block gives
// the track a system-mapped border and opts the fill out of the override, because under Windows High
// Contrast the ratio IS the information and a flattened fill destroys it.
function Meter({
  value,
  min = 0,
  max = 100,
  label,
  valueText,
  className,
  ...props
}: MeterProps) {
  const span = max - min
  const ratio = span > 0 ? (value - min) / span : 0
  const percent = Math.round(Math.min(100, Math.max(0, ratio * 100)) * 10) / 10

  return (
    <div
      data-slot="meter"
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuetext={valueText}
      className={cn("h-[7px] w-full overflow-hidden rounded-full bg-track", className)}
      {...props}
    >
      <div
        data-slot="meter-fill"
        className="h-full rounded-full bg-brand transition-[width] duration-300"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

export { Meter }
export type { MeterProps }
