import { Select as SelectPrimitive } from "@base-ui/react/select"
import { ChevronDownIcon, CheckIcon } from "lucide-react"

import { cn } from "../lib/cn"
import { focusRing } from "./focus"

function Select<Value>({ ...props }: SelectPrimitive.Root.Props<Value>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />
}

function SelectTrigger({
  className,
  children,
  ...props
}: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-8 min-h-target-min w-full items-center justify-between gap-2 rounded-sm border border-line-strong bg-card px-2.5 py-1 text-body text-ink transition-colors disabled:cursor-not-allowed disabled:border-line disabled:text-ink-disabled aria-disabled:cursor-not-allowed aria-disabled:border-line aria-disabled:text-ink-disabled aria-invalid:border-over [&>span]:line-clamp-1",
        focusRing,
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon>
        <ChevronDownIcon className="size-4 text-ink-dim" aria-hidden="true" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectValue({ ...props }: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectContent({
  className,
  children,
  ...props
}: SelectPrimitive.Popup.Props) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner sideOffset={4} className="z-50">
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "max-h-[min(var(--available-height),16rem)] min-w-[var(--anchor-width)] overflow-y-auto rounded-lg border border-line-strong bg-card p-1 text-body text-ink shadow-float data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        >
          {children}
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full min-h-target-min cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-body select-none data-highlighted:bg-hover data-highlighted:text-ink data-disabled:pointer-events-none data-disabled:text-ink-disabled",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex size-3.5 items-center justify-center text-brand-ink">
        <CheckIcon className="size-4" aria-hidden="true" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("py-1", className)}
      {...props}
    />
  )
}

function SelectGroupLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-group-label"
      className={cn("px-2 py-1.5 text-caption text-ink-faint", className)}
      {...props}
    />
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
}
