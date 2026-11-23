import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../lib/cn"

// Inline and non-modal, always. A recoverable error renders in place next to the thing that failed
// — a modal for a problem the user can fix themselves interrupts the task to tell them about the
// task. The `info` variant also carries the reassurance callouts ("Everything else works without
// this"), which is why the brand tint is the default rather than an alarm colour.
const alertVariants = cva(
  "flex gap-3 rounded-lg border px-4 py-3 text-caption text-ink-dim [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        info: "border-transparent bg-glass [&_svg]:text-brand-ink",
        caution: "border-caution/30 bg-caution-bg [&_svg]:text-caution-ink",
        over: "border-over/30 bg-over-bg [&_svg]:text-over-ink",
      },
    },
    defaultVariants: {
      variant: "info",
    },
  }
)

interface AlertProps
  extends React.ComponentProps<"div">,
    VariantProps<typeof alertVariants> {
  icon?: React.ReactNode
}

function Alert({
  className,
  variant = "info",
  icon,
  role,
  children,
  ...props
}: AlertProps) {
  return (
    <div
      data-slot="alert"
      // `over` is announced because it reports a failure the user has to act on; `info` and
      // `caution` are read in document order like the prose they sit beside.
      role={role ?? (variant === "over" ? "alert" : undefined)}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="alert-title"
      className={cn("text-label text-ink", className)}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="alert-description"
      className={cn("text-caption text-ink-dim", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, alertVariants }
export type { AlertProps }
