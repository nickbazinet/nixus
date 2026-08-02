import * as React from "react"
import { DayPicker } from "react-day-picker"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "../lib/cn"
import { buttonVariants } from "./button"

type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      data-slot="calendar"
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-2",
        month: "flex flex-col gap-4",
        month_caption: "flex justify-center pt-1 relative items-center w-full",
        caption_label: "text-h3 text-ink",
        nav: "flex items-center gap-1",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "absolute left-1 top-0 size-7 bg-transparent p-0 text-ink-dim hover:text-ink"
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "absolute right-1 top-0 size-7 bg-transparent p-0 text-ink-dim hover:text-ink"
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
        Chevron: ({ orientation }) => {
          const Icon = orientation === "left" ? ChevronLeft : ChevronRight
          return <Icon className="size-4" aria-hidden="true" />
        },
      }}
      {...props}
    />
  )
}

export { Calendar }
export type { CalendarProps }
