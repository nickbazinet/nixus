import { useState, useMemo } from "react"
import { format, parse } from "date-fns"
import { CalendarIcon } from "lucide-react"

import { cn } from "../lib/cn"
import { Button } from "./button"
import { Calendar } from "./calendar"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

interface DatePickerProps {
  value?: string
  onChange: (date: string) => void
  placeholder?: string
  id?: string
  "aria-invalid"?: boolean
  disabled?: boolean
  className?: string
}

function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  id,
  "aria-invalid": ariaInvalid,
  disabled,
  className,
}: DatePickerProps) {
  const [open, setOpen] = useState(false)

  const dateValue = useMemo(() => {
    if (!value) return undefined
    const parsed = parse(value, "yyyy-MM-dd", new Date())
    return isNaN(parsed.getTime()) ? undefined : parsed
  }, [value])

  const handleSelect = (day: Date | undefined) => {
    if (day) {
      onChange(format(day, "yyyy-MM-dd"))
      setOpen(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            disabled={disabled}
            aria-invalid={ariaInvalid}
            className={cn(
              "w-full justify-start text-left font-normal",
              !value && "text-muted-foreground",
              ariaInvalid &&
                "border-destructive ring-3 ring-destructive/20 dark:border-destructive/50 dark:ring-destructive/40",
              className
            )}
          />
        }
      >
        <CalendarIcon className="mr-2 size-4" />
        {dateValue ? format(dateValue, "MMM d, yyyy") : placeholder}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={dateValue}
          onSelect={handleSelect}
          defaultMonth={dateValue}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
export type { DatePickerProps }
