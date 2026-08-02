import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../lib/cn"

// A badge is a LABEL, never a control — do not pass an interactive element to `render`, and do not
// use one as a filter chip. It carries no hover, no focus ring, and no pointer affordance for that
// reason.
//
// Text is mandatory in every badge: a user who cannot separate amber from crimson loses nothing
// because the word is always there. And the word is never a bare adjective — `stale` reads
// "Updated 6 weeks ago", not "Stale" beside an unexplained age.
//
// Deliberately NOT uppercase, though {typography.micro} specifies it. DESIGN.md's own reasoning
// bans all-caps on rapidly scanned content, and uppercased `stale` reads "UPDATED 6 WEEKS AGO".
// The mocks agree: sentence-case pills, uppercase reserved for eyebrows via `text-micro uppercase`.
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-md px-1.5 py-0.5 text-micro whitespace-nowrap [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        good: "bg-good-bg text-good-ink",
        caution: "bg-caution-bg text-caution-ink",
        over: "bg-over-bg text-over-ink",
        neutral: "bg-neutral-bg text-neutral-ink",
        brand: "bg-brand-soft text-brand-ink",
        outline: "border border-line-strong text-ink",
        // Deprecated shadcn-era names, kept so the apps/desktop migration wave can land in pieces.
        // Each points at the spine style it should become; delete once no call site uses them.
        default: "bg-brand-soft text-brand-ink",
        secondary: "bg-neutral-bg text-neutral-ink",
        destructive: "bg-over-bg text-over-ink",
        ghost: "bg-neutral-bg text-neutral-ink",
        link: "border border-line-strong text-ink",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
)

function Badge({
  className,
  variant = "neutral",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
