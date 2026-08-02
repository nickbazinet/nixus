import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A section eyebrow. `text-micro` is uppercase badge-and-eyebrow type only, so every heading that
 * uses it stays under roughly twenty characters.
 */
export function SettingsSection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-micro uppercase text-ink-faint">{heading}</h3>
      {children}
    </section>
  );
}

interface SettingRowProps {
  title: ReactNode;
  description?: ReactNode;
  /** The switch, segmented control, button, or input. Omitted for a statement-only row. */
  control?: ReactNode;
  /** Set when `title` is a plain label for `control` and needs to point at it. */
  htmlFor?: string;
  className?: string;
  "data-testid"?: string;
}

// Rows are hairline-separated inside one <Card flush>: the card owns the elevation recipe and the
// row owns nothing but its own bottom rule.
export function SettingRow({
  title,
  description,
  control,
  htmlFor,
  className,
  "data-testid": testId,
}: SettingRowProps) {
  const Title = htmlFor === undefined ? "span" : "label";
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex items-center gap-4 px-card-pad py-3.5 not-last:border-b not-last:border-line",
        className
      )}
    >
      <span className="min-w-0 flex-1">
        <Title
          htmlFor={htmlFor}
          className="block text-label text-ink"
        >
          {title}
        </Title>
        {description !== undefined && (
          <span className="mt-0.5 block text-caption text-ink-dim">{description}</span>
        )}
      </span>
      {control !== undefined && <span className="shrink-0">{control}</span>}
    </div>
  );
}

interface SegmentedControlOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Shown adjacent to a disabled option so it is never a dead control with no explanation. */
  disabledReason?: string;
}

interface SegmentedControlProps {
  name: string;
  label: string;
  value: string;
  options: SegmentedControlOption[];
  onChange: (value: string) => void;
}

// Native radios inside the labels, so arrow-key movement, grouping, and the checked state are the
// platform's rather than re-implemented. `focusRing` cannot be applied to the input itself — it is
// visually hidden — so the ring is drawn on the visible segment through `peer-focus-visible`, with
// the same width, colour token, and offset the exported helper uses.
export function SegmentedControl({
  name,
  label,
  value,
  options,
  onChange,
}: SegmentedControlProps) {
  return (
    <fieldset className="flex items-center gap-2">
      <legend className="sr-only">{label}</legend>
      <div className="inline-flex overflow-hidden rounded-md border border-line-strong">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className="not-last:border-r not-last:border-line-strong"
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                disabled={option.disabled}
                aria-disabled={option.disabled || undefined}
                onChange={() => onChange(option.value)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "flex min-h-target-min cursor-pointer items-center px-3 py-1.5 text-label transition-colors",
                  "peer-focus-visible:outline-2 peer-focus-visible:outline-focus-ring peer-focus-visible:-outline-offset-2",
                  selected ? "bg-brand-soft text-brand-ink" : "text-ink-dim hover:text-ink",
                  option.disabled && "cursor-not-allowed text-ink-disabled hover:text-ink-disabled"
                )}
              >
                {option.label}
              </span>
            </label>
          );
        })}
      </div>
      {options.find((option) => option.disabled && option.disabledReason) && (
        <span className="text-caption text-ink-dim">
          {options.find((option) => option.disabled && option.disabledReason)?.disabledReason}
        </span>
      )}
    </fieldset>
  );
}
