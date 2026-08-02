import * as React from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"

import { cn } from "../lib/cn"
import { focusRing } from "./focus"

// Sub-surface navigation within a destination. Never more than five items.
//
// These are REAL navigation links, not an ARIA tablist. `Tab` moves between them and `Enter`
// activates, and arrow keys are deliberately not bound: arrow-key movement is the tablist
// convention, and applying it to elements a screen reader still announces as "link" confuses anyone
// who knows the pattern. Pass the router's link through `render` — e.g. render={<Link to="..." />}.
function SegmentedNav({
  className,
  ...props
}: React.ComponentProps<"nav">) {
  return (
    <nav
      data-slot="segmented-nav"
      className={cn(
        "flex items-end gap-1 border-b border-line bg-chrome px-page-x pt-3",
        className
      )}
      {...props}
    />
  )
}

// The active item reads as continuous with the page beneath it: page-coloured fill, hairlines on
// three sides only, and a 1px overlap that covers the container's bottom rule. The transparent
// border on the inactive state is what keeps the items from shifting by a pixel when activated.
function SegmentedNavItem({
  className,
  active = false,
  render,
  ...props
}: useRender.ComponentProps<"a"> & { active?: boolean }) {
  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(
      {
        "aria-current": active ? "page" : undefined,
        className: cn(
          "inline-flex min-h-target-min items-center rounded-t-md border border-transparent px-3 py-1.5 text-label text-ink-dim no-underline transition-colors hover:text-ink",
          active && "-mb-px border-x-line border-t-line bg-page text-ink",
          focusRing,
          className
        ),
      },
      props
    ),
    render,
    state: {
      slot: "segmented-nav-item",
      active,
    },
  })
}

export { SegmentedNav, SegmentedNavItem }
