import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "../lib/cn"

interface SliderProps
  extends Omit<SliderPrimitive.Root.Props<number>, "children"> {
  /**
   * Accessible name of the thumb's range input. Required, and it is the accessible name — a bare
   * slider announces a naked number, which is meaningless for the one control on a page whose
   * whole job is "how much per month". Same contract as `Meter`'s `label`.
   */
  label: string
  /** Spoken instead of the raw number — "$1,250" rather than "125000". */
  valueText?: string
}

// Anatomy is Base UI's: Root > Control > Track > (Indicator, Thumb). The Track must be `relative`
// because Base UI positions the Thumb absolutely against it; nothing may clip, since a 24px thumb
// deliberately overhangs a 7px track.
//
// 7px track height matches `Meter` so a draggable amount and a read-only ratio sit on the same
// visual rail. `Meter`'s own comment names the exception this component now takes up: a meter is
// allowed to be 7px tall because it is never a drag target, and "if that ever changes, the hit area
// must expand independently of the 7px visual height". That is exactly what happens here — the
// Control is a full `min-h-target-min` band (Base UI treats a track press as a value change, so the
// whole 24px strip is actionable) and the Thumb is a 24px box with a 16px knob drawn inside it,
// mirroring `Checkbox`'s 15px-box-in-24px-target pattern.
//
// The knob is `bg-brand-on` per the spec, but the fill alone cannot carry it: `brand-on` is #FFFFFF
// in light mode over a #EDF1F6 track (~1.1:1) and #1E1B4B in dark mode over a #212C3E track
// (~1.1:1), so at the low end of the range the knob would vanish in BOTH themes — the same trap
// `Switch` documents for a white thumb on `line-strong`. The `border-brand` ring is therefore
// load-bearing, not decoration: brand clears 3:1 against the unfilled track and against its own
// indicator in both modes, so the knob's boundary is always visible wherever it sits.
//
// The focus ring cannot reuse the shared `focusRing` constant: focus lands on Base UI's nested
// `<input type="range">`, which is visually hidden with `clip-path: inset(50%)` — its own outline is
// clipped away. `has-[:focus-visible]:` hoists the same ring tokens onto the thumb box instead.
//
// `thumbAlignment="edge"` rather than Base UI's default `center`: centring puts the thumb's midpoint
// on the control's edge, so at both extremes half of the 24px hit target hangs outside the control
// and over whatever sits beside it. Insetting keeps the whole target addressable at min and max.
function Slider({ label, valueText, className, ...props }: SliderProps) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      thumbAlignment="edge"
      className={cn("group/slider w-full", className)}
      {...props}
    >
      <SliderPrimitive.Control
        data-slot="slider-control"
        className="flex min-h-target-min w-full touch-none items-center select-none data-disabled:pointer-events-none"
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative h-[7px] w-full rounded-full bg-track"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-indicator"
            className="h-full rounded-full bg-brand data-disabled:bg-line-strong"
          />
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            getAriaLabel={() => label}
            getAriaValueText={valueText ? () => valueText : undefined}
            className="flex size-target-min items-center justify-center rounded-full has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus-ring has-[:focus-visible]:outline-offset-2"
          >
            <span
              aria-hidden="true"
              className="size-4 rounded-full border-2 border-brand bg-brand-on transition-colors group-data-disabled/slider:border-line-strong"
            />
          </SliderPrimitive.Thumb>
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
export type { SliderProps }
