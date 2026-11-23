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
//
// Two looks, one per navigation level:
// - `underline` (default): a module's top-level tabs. Items sit on a hairline rule and the active one
//   carries the brand-gradient bar.
// - `pills`: the second level under a destination. Soft capsules, no rule; the active one fills
//   with the rail's brand tint.
function SegmentedNav({
  className,
  variant = "underline",
  ...props
}: React.ComponentProps<"nav"> & { variant?: "underline" | "pills" }) {
  return (
    <nav
      data-slot="segmented-nav"
      data-variant={variant}
      className={cn(
        "group/segmented-nav flex overflow-x-auto",
        variant === "underline" ? "items-end gap-2 border-b border-line" : "items-center gap-1.5",
        className
      )}
      {...props}
    />
  )
}

// Underline: the bar is a pseudo-element overlapping the container's rule by 1px, so activating an
// item never shifts the row. Pills: the tint is the only state change, so items keep their box.
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
          "relative inline-flex min-h-target-min items-center whitespace-nowrap no-underline transition-colors",
          // underline
          "group-data-[variant=underline]/segmented-nav:px-5 group-data-[variant=underline]/segmented-nav:pt-2 group-data-[variant=underline]/segmented-nav:pb-3.5 group-data-[variant=underline]/segmented-nav:font-display group-data-[variant=underline]/segmented-nav:text-[17px] group-data-[variant=underline]/segmented-nav:font-semibold",
          "group-data-[variant=underline]/segmented-nav:after:absolute group-data-[variant=underline]/segmented-nav:after:inset-x-0 group-data-[variant=underline]/segmented-nav:after:-bottom-px group-data-[variant=underline]/segmented-nav:after:h-[3px] group-data-[variant=underline]/segmented-nav:after:rounded-full",
          // pills
          "group-data-[variant=pills]/segmented-nav:h-9 group-data-[variant=pills]/segmented-nav:rounded-md group-data-[variant=pills]/segmented-nav:px-3.5 group-data-[variant=pills]/segmented-nav:text-label",
          active
            ? cn(
                "text-ink",
                "group-data-[variant=underline]/segmented-nav:after:bg-button-gradient",
                "group-data-[variant=pills]/segmented-nav:bg-rail-on group-data-[variant=pills]/segmented-nav:text-rail-on-ink"
              )
            : "text-ink-dim hover:text-ink group-data-[variant=pills]/segmented-nav:hover:bg-hover",
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
