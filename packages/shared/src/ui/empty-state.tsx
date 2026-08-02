import * as React from "react"

import { cn } from "../lib/cn"

interface EmptyStateProps extends Omit<React.ComponentProps<"div">, "title"> {
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  /** Exactly one. Two competing actions in an empty state is a decision the user cannot make yet. */
  action?: React.ReactNode
}

// Never a blank card. An empty state says what is missing, why it matters, and the one thing to do
// about it — and it never reads as though the app is broken.
function EmptyState({
  icon,
  title,
  description,
  action,
  children,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "mx-auto flex max-w-md flex-col items-center px-5 py-8 text-center",
        className
      )}
      {...props}
    >
      {icon ? (
        <span
          data-slot="empty-state-glyph"
          aria-hidden="true"
          className="mb-3 grid size-10 place-items-center rounded-lg bg-track text-ink-dim [&_svg]:size-4"
        >
          {icon}
        </span>
      ) : null}
      <p data-slot="empty-state-title" className="text-h2 text-ink">
        {title}
      </p>
      {description ? (
        <p
          data-slot="empty-state-description"
          className="mt-1.5 text-caption text-ink-dim"
        >
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
      {children}
    </div>
  )
}

export { EmptyState }
export type { EmptyStateProps }
