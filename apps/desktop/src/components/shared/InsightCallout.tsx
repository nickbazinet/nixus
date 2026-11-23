import { useId, useState, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { Button, Card, Eyebrow, IconChip } from "@nixus/shared";
import { cn } from "@/lib/utils";

interface InsightCalloutProps {
  icon: LucideIcon;
  /** The kicker: "SUGGESTED NEXT STEP", "HEADS UP", "INSIGHT". */
  eyebrow: string;
  /** Optional headline under the kicker, in Poppins. */
  title?: ReactNode;
  children?: ReactNode;
  /** Buttons along the bottom — one primary, at most one secondary. */
  actions?: ReactNode;
  /** `row` lays icon, text and actions on one line for a short, single-sentence callout. */
  layout?: "stacked" | "row";
  /**
   * Makes the callout collapsible: the kicker and headline stay, the body and actions fold away.
   * Stacked layout only. Open by default, so nothing is hidden until the user chooses to.
   */
  collapsible?: { collapseLabel: string; expandLabel: string };
  className?: string;
  "data-testid"?: string;
}

/**
 * The glass-blue ("couleur du verre") callout: the one place a surface speaks to the user — a
 * suggested next step, an insight, a heads-up. At most one or two per surface, or it stops being
 * the thing worth reading.
 */
export function InsightCallout({
  icon,
  eyebrow,
  title,
  children,
  actions,
  layout = "stacked",
  collapsible,
  className,
  "data-testid": testId,
}: InsightCalloutProps) {
  const [open, setOpen] = useState(true);
  const bodyId = useId();
  const showBody = !collapsible || open;

  if (layout === "row") {
    return (
      <Card tone="glass" className={cn("px-card-pad", className)} data-testid={testId}>
        <div className="flex flex-wrap items-center gap-4">
          <IconChip icon={icon} tone="card" size="lg" />
          <div className="min-w-0 flex-1">
            <Eyebrow>{eyebrow}</Eyebrow>
            {title && <p className="mt-1.5 font-display text-h1 text-ink">{title}</p>}
            {children && <div className="mt-1.5 text-body text-ink">{children}</div>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-3">{actions}</div>}
        </div>
      </Card>
    );
  }

  return (
    <Card tone="glass" className={cn("gap-0 px-card-pad", className)} data-testid={testId}>
      <div className="flex items-center gap-4">
        <IconChip icon={icon} tone="card" />
        <Eyebrow>{eyebrow}</Eyebrow>
        {collapsible && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={open ? collapsible.collapseLabel : collapsible.expandLabel}
            data-testid={testId ? `${testId}-toggle` : undefined}
          >
            <ChevronDown
              className={cn("transition-transform", open && "rotate-180")}
              aria-hidden="true"
            />
          </Button>
        )}
      </div>
      {title && <p className="mt-4 font-display text-h1 text-ink">{title}</p>}
      <div id={bodyId}>
        {showBody && children && (
          <div className={cn("max-w-3xl text-body text-ink", title ? "mt-2" : "mt-4")}>
            {children}
          </div>
        )}
        {showBody && actions && <div className="mt-5 flex flex-wrap gap-3">{actions}</div>}
      </div>
    </Card>
  );
}
