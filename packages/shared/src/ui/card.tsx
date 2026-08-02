import * as React from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "../lib/cn"
import { focusRing } from "./focus"

// The elevation recipe lives here and nowhere else: bg-card over bg-page carries the boundary,
// the hairline reinforces it, and `shadow: none` is a rule rather than a default. Call sites pass
// content, never elevation.
//
// `flush` is for content that owns the card's full width — a Table, a BulkBar, an Alert, a stack of
// setting rows. Without it every such call site has to cancel both the padding and the gap by hand,
// which is how call sites end up restating the recipe.
//
// Presentational by default. `interactive` exists only for a card that IS a link to a detail
// surface — pass `render={<Link />}` so the whole card is one focusable target with one accessible
// name. A card with competing inner click targets is the anti-pattern this replaces.
function Card({
  className,
  size = "default",
  interactive = false,
  flush = false,
  render,
  ...props
}: useRender.ComponentProps<"div"> & {
  size?: "default" | "sm"
  interactive?: boolean
  flush?: boolean
}) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "group/card flex flex-col gap-4 overflow-hidden rounded-lg border border-line bg-card py-card-pad text-body text-ink has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-lg *:[img:last-child]:rounded-b-lg",
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
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-lg px-card-pad group-data-[size=sm]/card:px-3 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-h3 text-ink", className)}
      {...props}
    />
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
      className={cn("px-card-pad group-data-[size=sm]/card:px-3", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-lg border-t border-line bg-chrome p-card-pad group-data-[size=sm]/card:p-3",
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
