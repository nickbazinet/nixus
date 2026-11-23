import type { ReactNode } from "react";
import { Link, type LinkProps } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { Card, IconChip, Skeleton, focusRing } from "@nixus/shared";
import { cn } from "@/lib/utils";

interface MetricTileProps {
  icon: LucideIcon;
  label: ReactNode;
  /** Pass a `<Money>` node for currency. */
  value: ReactNode;
  /** One line under the figure: "7 days left", "of $6,511.00 budgeted". */
  caption?: ReactNode;
  /**
   * The violet-outlined tile that answers the row's question. At most one per row — two featured
   * tiles means neither is the answer.
   */
  featured?: boolean;
  /** `hero` is the surface's one display-size figure; every other tile is `stat`. */
  size?: "stat" | "hero";
  /** Makes the whole tile one link to the surface behind the figure. */
  href?: LinkProps["to"];
  /** Spoken name for a linked tile, e.g. "Net worth, $543,773.89". */
  linkLabel?: string;
  /** Anything below the caption: a meter, a sparkline. */
  footer?: ReactNode;
  isLoading?: boolean;
  className?: string;
  "data-testid"?: string;
}

/**
 * The charte's KPI tile: a gradient line icon on a soft chip beside a short label, the figure in
 * Poppins below it, and one line of context. The building block of every summary row
 * ("Budgeted / Spent so far / Remaining").
 */
export function MetricTile({
  icon,
  label,
  value,
  caption,
  featured = false,
  size = "stat",
  href,
  linkLabel,
  footer,
  isLoading = false,
  className,
  "data-testid": testId,
}: MetricTileProps) {
  const body = isLoading ? (
    <Skeleton rows={3} />
  ) : (
    <>
      <div className="flex items-center gap-3">
        <IconChip icon={icon} size="sm" />
        <span className="text-label text-ink">{label}</span>
      </div>
      <div
        className={cn("money mt-4 text-ink", size === "hero" ? "text-display" : "text-stat")}
        data-slot="metric-value"
      >
        {value}
      </div>
      {caption && <div className="mt-2 text-caption text-ink-dim">{caption}</div>}
      {footer && <div className="mt-4">{footer}</div>}
    </>
  );

  return (
    <Card
      tone={featured ? "featured" : "default"}
      className={cn("gap-0 px-card-pad", className)}
      data-testid={testId}
      render={
        href && !isLoading ? (
          <Link
            to={href}
            aria-label={linkLabel}
            className={cn("no-underline transition-colors hover:border-line-strong", focusRing)}
          />
        ) : undefined
      }
    >
      {body}
    </Card>
  );
}
