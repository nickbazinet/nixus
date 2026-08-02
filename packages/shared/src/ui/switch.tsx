import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "../lib/cn"
import { focusRing } from "./focus"

// The track is 24px tall so the control meets the minimum interactive target on its own, without a
// separate padded wrapper.
//
// The thumb is ink-dim when off and brand-on when on rather than white in both states: white on
// `line-strong` measures under 2:1 in dark mode, so the knob — the primary non-colour carrier of
// the switch's state — would effectively disappear for exactly the users who most need it. These two
// tokens clear 3:1 against their own track in both modes.
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-line-strong p-0.5 transition-colors data-checked:bg-brand data-disabled:pointer-events-none data-disabled:bg-line",
        focusRing,
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="size-5 rounded-full bg-ink-dim transition-transform data-checked:translate-x-4 data-checked:bg-brand-on data-disabled:bg-ink-disabled"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
