import * as React from "react"

import { cn } from "../lib/cn"

// The marker is `aria-hidden` on purpose: the required state is announced by `aria-required` on the
// control itself, so reading the asterisk too would announce the requirement twice, once as the
// word "asterisk". Call sites must set `aria-required` (or the native `required`) on the input —
// four sampled forms currently validate on submit only, with no required markers at all, so a user
// fills five fields before learning what was wrong.
function Label({
  className,
  required = false,
  children,
  ...props
}: React.ComponentProps<"label"> & { required?: boolean }) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-1 text-label text-ink select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:text-ink-disabled peer-disabled:cursor-not-allowed peer-disabled:text-ink-disabled",
        className
      )}
      {...props}
    >
      {children}
      {required ? (
        <span data-slot="label-required" aria-hidden="true" className="text-over">
          *
        </span>
      ) : null}
    </label>
  )
}

export { Label }
