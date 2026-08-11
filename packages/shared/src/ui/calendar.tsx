import * as React from "react"
import { DayPicker } from "react-day-picker"
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react"

import { cn } from "../lib/cn"
import { buttonVariants } from "./button"

type CalendarProps = React.ComponentProps<typeof DayPicker>

const chevronByOrientation = {
  left: ChevronLeft,
  right: ChevronRight,
  up: ChevronUp,
  down: ChevronDown,
} as const

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout,
  ...props
}: CalendarProps) {
  // The two caption layouts are different markup, not a variation on one tree. "label" (the
  // default, and what every other caller renders) is a single `caption_label` span; the dropdown
  // layouts replace it with a `dropdowns` container holding one `dropdown_root` per control, each
  // wrapping BOTH a native <select> AND its own `caption_label` copy of the value. So every class
  // the layouts share has to branch, or styling the dropdowns would move the label layout.
  const isDropdown = captionLayout?.startsWith("dropdown") ?? false

  return (
    <DayPicker
      data-slot="calendar"
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      // Only the dropdown layout anchors its nav arrows here; the label layout's arrows resolve
      // against the popover, and that is the placement its callers already ship.
      className={cn("p-3", isDropdown && "relative", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-2",
        month: "flex flex-col gap-4",
        month_caption: "flex justify-center pt-1 relative items-center w-full",
        caption_label: isDropdown
          ? // RDP marks this copy aria-hidden and keeps the accessible name on the <select>, so here
            // it is purely the visible face of the control.
            "inline-flex h-7 items-center gap-1 px-2 text-label text-ink [&>svg]:text-ink-dim"
          : "text-h3 text-ink",
        dropdowns: "flex items-center justify-center gap-1.5 text-label text-ink",
        dropdown_root: cn(
          "relative inline-flex items-center rounded-sm border border-line-strong bg-card transition-colors hover:bg-hover",
          // The focus target is the transparent <select> inside, whose own ring would be invisible,
          // so the wrapper draws it — same two properties as `focusRing`.
          "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus-ring has-[:focus-visible]:outline-offset-2"
        ),
        // Transparent and overlaid, never hidden: the native select stays the focusable,
        // keyboard-operable, screen-reader-announced control, sitting on top of its own label.
        dropdown: "absolute inset-0 cursor-pointer opacity-0",
        nav: isDropdown
          ? // top-4 == p-3 plus the caption's pt-1, and size-7 arrows match the h-7 controls, so the
            // arrows land on the caption row instead of colliding with it.
            "absolute inset-x-3 top-4 flex items-center justify-between"
          : "flex items-center gap-1",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "size-7 bg-transparent p-0 text-ink-dim hover:text-ink",
          !isDropdown && "absolute left-1 top-0"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "size-7 bg-transparent p-0 text-ink-dim hover:text-ink",
          !isDropdown && "absolute right-1 top-0"
        ),
        month_grid: "w-full border-collapse space-x-1",
        weekdays: "flex",
        weekday:
          "w-8 rounded-md text-caption text-ink-faint",
        week: "flex w-full mt-2",
        day: cn(
          "relative p-0 text-center text-body focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-hover [&:has([aria-selected].day-outside)]:bg-hover [&:has([aria-selected].day-range-end)]:rounded-r-md",
          props.mode === "range"
            ? "[&:has(>.day-range-end)]:rounded-r-md [&:has(>.day-range-start)]:rounded-l-md first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md"
            : "[&:has([aria-selected])]:rounded-md"
        ),
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "size-8 p-0 text-body"
        ),
        range_start: "day-range-start rounded-l-md",
        range_end: "day-range-end rounded-r-md",
        selected:
          "bg-brand text-brand-on hover:bg-brand-ink hover:text-brand-on focus:bg-brand focus:text-brand-on",
        today: "bg-brand-soft text-brand-ink",
        outside: "day-outside text-ink-faint aria-selected:text-ink-faint",
        disabled: "text-ink-disabled",
        range_middle: "aria-selected:bg-brand-soft aria-selected:text-brand-ink",
        hidden: "invisible",
        ...classNames,
      }}
        components={{
        Chevron: ({ orientation = "left" }) => {
          const Icon = chevronByOrientation[orientation]
          const isNavArrow = orientation === "left" || orientation === "right"
          return (
            <Icon
              className={isNavArrow ? "size-4" : "size-3.5"}
              aria-hidden="true"
            />
          )
        },
      }}
      {...props}
    />
  )
}

export { Calendar }
export type { CalendarProps }
