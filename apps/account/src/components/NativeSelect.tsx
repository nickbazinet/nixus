import type { ComponentProps } from "react";
import { cn, Label } from "@nixus/shared";

/**
 * A native `<select>`, not the shared Base UI `Select`.
 *
 * The country list is ~250 entries and the page must work before hydration: a
 * native control gives platform search-as-you-type, a usable list on a phone, and
 * a value that submits with no JavaScript. It carries the shared token classes, so
 * it is the same surface as the rest of the design system.
 */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "flex h-8 min-h-target-min w-full items-center rounded-sm border border-line-strong bg-card px-2.5 py-1 text-body text-ink transition-colors disabled:cursor-not-allowed disabled:border-line disabled:text-ink-disabled aria-invalid:border-over",
        "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? (
        <p id={`${htmlFor}-hint`} className="text-caption text-ink-dim">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
