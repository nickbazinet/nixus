import * as React from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import type { LucideIcon } from "lucide-react"

import { cn } from "../lib/cn"
import { focusRing } from "./focus"
import { IconChip } from "./icon-chip"

// The elevation recipe lives here and nowhere else: bg-card over bg-page carries the boundary,
// the hairline reinforces it, and `shadow: none` is a rule rather than a default. Call sites pass
// content, never elevation.
//
// `flush` is for content that owns the card's full width — a Table, a BulkBar, an Alert, a stack of
// setting rows. Without it every such call site has to cancel both the padding and the gap by hand,
// which is how call sites end up restating the recipe.
//
// `tone` is the charte's three card surfaces: `default` white on the cool page, `glass` the
// "couleur du verre" callout (suggestions, insights, heads-ups — at most one or two per surface), and
// `featured` the violet-outlined card that answers the surface's question. One featured card per
// surface; two means neither is the answer.
//
// Presentational by default. `interactive` exists only for a card that IS a link to a detail
// surface — pass `render={<Link />}` so the whole card is one focusable target with one accessible
// name. A card with competing inner click targets is the anti-pattern this replaces.
function Card({
  className,
  size = "default",
  interactive = false,
  flush = false,
  tone = "default",
  render,
  ...props
}: useRender.ComponentProps<"div"> & {
  size?: "default" | "sm"
  interactive?: boolean
  flush?: boolean
  tone?: "default" | "glass" | "featured"
}) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "group/card flex flex-col gap-4 overflow-hidden rounded-xl border border-line bg-card py-card-pad text-body text-ink has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-4 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
          tone === "glass" && "border-transparent bg-glass",
          tone === "featured" && "border-2 border-feature shadow-feature",
          flush && "gap-0 py-0 data-[size=sm]:gap-0 data-[size=sm]:py-0",
          interactive && cn("cursor-pointer hover:bg-hover", focusRing),
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "card",
      size,
      tone,
      interactive,
      flush,
    },
  })
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-card-pad group-data-[size=sm]/card:px-4 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3",
        className
      )}
      {...props}
    />
  )
}

// `icon` renders the charte's gradient line icon on a soft tile ahead of the title.
function CardTitle({
  className,
  icon,
  children,
  ...props
}: React.ComponentProps<"div"> & { icon?: LucideIcon }) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-display text-h1 text-ink",
        icon && "flex items-center gap-3",
        className
      )}
      {...props}
    >
      {icon ? <IconChip icon={icon} /> : null}
      {icon ? <span className="min-w-0">{children}</span> : children}
    </div>
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-caption text-ink-dim", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-card-pad group-data-[size=sm]/card:px-4", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-xl border-t border-line bg-card px-card-pad py-4 group-data-[size=sm]/card:p-4",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
