import { cn } from "../lib/cn";

interface PillTabsProps<T extends string> {
  options: readonly T[];
  labels?: Partial<Record<T, string>>;
  value: T;
  onChange: (value: T) => void;
  "data-testid"?: string;
}

export function PillTabs<T extends string>({
  options,
  labels,
  value,
  onChange,
  "data-testid": testId,
}: PillTabsProps<T>) {
  return (
    <div className="flex gap-1" data-testid={testId}>
      {options.map((option) => (
        <button
          key={option}
          onClick={() => onChange(option)}
          className={cn(
            "px-3 py-1 text-sm rounded-md font-medium transition-colors",
            value === option
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted"
          )}
          data-testid={testId ? `${testId}-${option}` : undefined}
        >
          {labels?.[option] ?? option}
        </button>
      ))}
    </div>
  );
}
