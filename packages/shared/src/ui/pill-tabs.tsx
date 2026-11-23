import { cn } from "../lib/cn";
import { focusRing } from "./focus";

interface PillTabsProps<T extends string> {
  options: readonly T[];
  labels?: Partial<Record<T, string>>;
  value: T;
  onChange: (value: T) => void;
  "data-testid"?: string;
}

// A single-select filter control, not navigation. `aria-pressed` is what tells a screen reader which
// pill is the current one — without it the selected state is carried by the brand fill alone.
export function PillTabs<T extends string>({
  options,
  labels,
  value,
  onChange,
  "data-testid": testId,
}: PillTabsProps<T>) {
  return (
    <div
      className="inline-flex gap-1 rounded-full bg-track p-1"
      data-slot="pill-tabs"
      data-testid={testId}
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "inline-flex min-h-target-min items-center rounded-full px-3.5 py-1 text-label transition-colors",
            value === option
              ? "bg-card text-brand-ink shadow-[0_1px_3px_rgba(18,18,42,0.12)]"
              : "text-ink-dim hover:text-ink",
            focusRing
          )}
          data-testid={testId ? `${testId}-${option}` : undefined}
        >
          {labels?.[option] ?? option}
        </button>
      ))}
    </div>
  );
}
