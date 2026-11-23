import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../lib/cn"
import { focusRing } from "./focus"

// `min-h-target-min` / `min-w-target-min` keep the hit area at 24px independently of the visual
// size, so the smallest icon button is still reachable by a low-tech-comfort user with a trackpad.
//
// The disabled treatment is the {components.disabled} token set — a dim is never a state on its
// own, so every disabled button must ALSO carry native `disabled` or `aria-disabled`; both are
// styled here so either spelling looks correct.
const buttonVariants = cva(
  cn(
    "group/button inline-flex min-h-target-min min-w-target-min shrink-0 items-center justify-center gap-1.5 rounded-full border border-transparent bg-clip-padding text-label whitespace-nowrap transition-colors select-none active:translate-y-px disabled:pointer-events-none disabled:border-line disabled:bg-card disabled:text-ink-disabled aria-disabled:pointer-events-none aria-disabled:border-line aria-disabled:bg-card aria-disabled:text-ink-disabled aria-invalid:border-over [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    focusRing
  ),
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-clip-border bg-origin-border bg-button-gradient text-brand-on shadow-[0_8px_20px_-12px_rgba(110,80,210,0.75)] hover:brightness-110 disabled:bg-none disabled:shadow-none aria-disabled:bg-none aria-disabled:shadow-none",
        outline:
          "border-line-strong bg-card text-ink hover:border-brand/40 hover:bg-hover aria-expanded:bg-hover",
        secondary: "bg-brand-soft text-brand-ink hover:brightness-[0.97]",
        ghost: "text-ink hover:bg-hover aria-expanded:bg-hover",
        destructive: "border-over bg-over text-over-on hover:bg-over-ink",
        link: "text-brand-ink underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        xs: "h-7 gap-1 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3.5 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-9 px-0",
        "icon-xs": "size-7 px-0 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 px-0 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-11 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  render,
  nativeButton,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      render={render}
      // Base UI defaults nativeButton to true, which strips button semantics from the anchor that
      // `render={<Link/>}` actually produces. Explicit callers can still opt back in.
      nativeButton={nativeButton ?? render === undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
