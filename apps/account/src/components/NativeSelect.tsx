import type { ComponentProps, ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn, focusRing, Label } from "@nixus/shared";

/** The account form's control size, laid over the shared `Input`'s surface. */
export const TEXT_INPUT_CLASS = "mkt-tap h-10 rounded-lg px-3";

/** A read-only value drawn as a quiet, filled field. */
export const READ_ONLY_CLASS =
  "flex h-10 min-w-0 items-center rounded-lg border border-line bg-brand-soft/60 px-3 text-body text-ink-dim";

/**
 * A native `<select>`, not the shared Base UI `Select`.
 *
 * The country list is ~250 entries and the page must work before hydration: a
 * native control gives platform search-as-you-type, a usable list on a phone,
 * and a value that submits with no JavaScript. The shared `Select` is also
 * portal-based, so its popup cannot be server-rendered at all.
 *
 * So the control is native and the SURFACE matches the text inputs beside it:
 * the classes follow `packages/shared/src/ui/input.tsx` at the account form's
 * size, and the chevron is `select.tsx`'s trigger. `appearance-none` removes the
 * platform arrow so the one drawn here is the only one.
 */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="select-trigger"
        className={cn(
          "h-10 min-h-target-min w-full min-w-0 appearance-none rounded-lg border border-line-strong bg-card py-1 pr-9 pl-3 text-body text-ink transition-colors disabled:cursor-not-allowed disabled:border-line disabled:text-ink-disabled aria-disabled:cursor-not-allowed aria-disabled:border-line aria-disabled:text-ink-disabled aria-invalid:border-over",
          "mkt-tap",
          focusRing,
          className,
        )}
        {...props}
      />
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-dim"
      />
    </div>
  );
}

/**
 * One field group: label, control, then at most one message under it.
 *
 * A refusal replaces the hint rather than
 * stacking under it — two lines of guidance where one of them is now wrong is
 * worse than either alone.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  readonly label: string;
  readonly htmlFor: string;
  readonly hint?: string | null;
  readonly error?: string | null;
  readonly children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-[13px] font-semibold text-ink">
        {label}
      </Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-caption text-over-ink">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-caption text-ink-dim">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
