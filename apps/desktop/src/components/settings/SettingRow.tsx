import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Card, IconChip } from "@nixus/shared";
import { cn } from "@/lib/utils";

interface SettingsSectionProps {
  /** The group's name, rendered as the card's own title — "Appearance", "Backup". */
  heading: string;
  /** The charte's gradient line icon on a soft tile, ahead of the title. */
  icon: LucideIcon;
  /** One line under the title, for a group whose name does not say enough on its own. */
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/**
 * One group of settings as a card: an icon-chip header carrying the group's name, then
 * hairline-separated `SettingRow`s that own the card's full width.
 *
 * The header is assembled here rather than through `CardTitle` for one reason: the group's name is
 * a real `<h2>` under the surface's `<h1>`, and `CardTitle` wraps its children in a `<span>`, which
 * is phrasing content and cannot legally hold a heading. The classes are `CardTitle`'s own.
 */
export function SettingsSection({
  heading,
  icon,
  description,
  children,
  className,
  "data-testid": testId,
}: SettingsSectionProps) {
  return (
    <Card flush className={className} data-testid={testId}>
      <div className="flex items-start gap-3 border-b border-line px-card-pad py-4">
        <IconChip icon={icon} />
        <span className="min-w-0 flex-1">
          <h2 className="font-display text-h1 text-ink">{heading}</h2>
          {description !== undefined && (
            <span className="mt-1 block text-caption text-ink-dim">{description}</span>
          )}
        </span>
      </div>
      {children}
    </Card>
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

// Rows are hairline-separated inside one `SettingsSection` (a `Card flush`): the card owns the
// elevation recipe and the row owns nothing but its own bottom rule.
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
        <Title htmlFor={htmlFor} className="block text-label text-ink">
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
//
// The geometry is `PillTabs`': a soft track with a raised white pill on the selected segment.
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
      <div className="inline-flex gap-0.5 rounded-full bg-track p-1">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label key={option.value}>
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
                  "flex min-h-target-min cursor-pointer items-center rounded-full px-3.5 py-1 text-label transition-colors",
                  "peer-focus-visible:outline-2 peer-focus-visible:outline-focus-ring peer-focus-visible:outline-offset-2",
                  selected
                    ? "bg-card text-brand-ink shadow-[0_1px_3px_rgba(18,18,42,0.12)]"
                    : "text-ink-dim hover:text-ink",
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
