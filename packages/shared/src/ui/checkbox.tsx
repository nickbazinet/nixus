import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon, MinusIcon } from "lucide-react"

import { cn } from "../lib/cn"
import { focusRing } from "./focus"

// A 15px visual box inside a 24px hit area. The dense box suits the register; the padded target
// means a low-tech-comfort user reviewing 40–80 imported rows is not hunting a 15px square.
//
// `indeterminate` is not optional polish: a header checkbox that shows "checked" when four of nine
// rows are selected misreports the selection, and the absence of this primitive is why bulk-select
// does not exist in the product today.
function Checkbox({
  className,
  indeterminate = false,
  ...props
}: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      indeterminate={indeterminate}
      className={cn(
        "group/checkbox inline-flex size-target-min shrink-0 items-center justify-center rounded-sm data-disabled:pointer-events-none",
        focusRing,
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="flex size-[15px] items-center justify-center rounded-sm border-[1.5px] border-line-strong bg-card transition-colors group-data-checked/checkbox:border-brand group-data-checked/checkbox:bg-brand group-data-indeterminate/checkbox:border-brand group-data-indeterminate/checkbox:bg-brand group-data-disabled/checkbox:border-line group-data-disabled/checkbox:bg-track"
      >
        <CheckboxPrimitive.Indicator
          className="flex text-brand-on"
          render={<span />}
        >
          {indeterminate ? (
            <MinusIcon className="size-3" strokeWidth={3} />
          ) : (
            <CheckIcon className="size-3" strokeWidth={3} />
          )}
        </CheckboxPrimitive.Indicator>
      </span>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
