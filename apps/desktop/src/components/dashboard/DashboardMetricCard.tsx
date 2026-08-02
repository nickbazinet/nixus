import type { ReactNode } from "react";
import { useNavigate, type LinkProps } from "@tanstack/react-router";
import { ArrowDown, ArrowRight, ArrowUp } from "lucide-react";
import { Card, CardContent, Skeleton, Stat, SubStat } from "@nixus/shared";
import { cn } from "@/lib/utils";

interface TrendInfo {
  direction: "up" | "down" | "flat";
  percentage: string;
  description?: string;
}

interface DashboardMetricCardProps {
  title: string;
  /** Pass a `<Money>` node for currency; a plain string only for counts and non-money figures. */
  value: ReactNode;
  /** The figure spoken in the card's accessible name. Required when `value` is not a string. */
  valueLabel?: string;
  trend?: TrendInfo;
  /** `hero` is the surface's one `text-display` figure. Every other card is `secondary`. */
  variant: "hero" | "secondary";
  /** Route-typed, not `string`: a plain string let the pre-migration `/budget` path compile. */
  href?: LinkProps["to"];
  progressBar?: ReactNode;
  isLoading?: boolean;
}

const trendIcon = {
  up: ArrowUp,
  down: ArrowDown,
  flat: ArrowRight,
} as const;

// A rising figure is `good` and a falling one is `over`. The glyph carries the direction as well as
// the hue, so the trend still reads without colour.
const trendColor = {
  up: "text-good-ink",
  down: "text-over-ink",
  flat: "text-ink-dim",
} as const;

function TrendIndicator({ trend }: { trend: TrendInfo }) {
  const Icon = trendIcon[trend.direction];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-caption",
        trendColor[trend.direction],
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="money">{trend.percentage}</span>
      {trend.description && <span className="text-ink-dim">{trend.description}</span>}
    </span>
  );
}

function SkeletonCard() {
  return (
    <Card data-testid="metric-card-skeleton">
      <CardContent>
        {/* Three rows: label, figure, trend — the real card's own row count. */}
        <Skeleton rows={3} />
      </CardContent>
    </Card>
  );
}

export function DashboardMetricCard({
  title,
  value,
  valueLabel,
  trend,
  variant,
  href,
  progressBar,
  isLoading,
}: DashboardMetricCardProps) {
  const navigate = useNavigate();

  if (isLoading) {
    return <SkeletonCard />;
  }

  const Figure = variant === "hero" ? Stat : SubStat;

  const trendLabel = trend ? `, ${trend.direction} ${trend.percentage}` : "";
  const spokenValue = valueLabel ?? (typeof value === "string" ? value : "");
  const accessibleName = `${title}: ${spokenValue}${trendLabel}`;

  return (
    <Card
      interactive={Boolean(href)}
      role={href ? "link" : undefined}
      tabIndex={href ? 0 : undefined}
      aria-label={href ? accessibleName : undefined}
      onClick={href ? () => navigate({ to: href }) : undefined}
      onKeyDown={
        href
          ? (event) => {
              // Click and Enter must open the same thing; the shipped card was mouse-only.
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                navigate({ to: href });
              }
            }
          : undefined
      }
      data-testid="metric-card"
    >
      <CardContent className="flex flex-col gap-2">
        <Figure
          label={title}
          value={value}
          aria-hidden={href ? true : undefined}
          data-testid="metric-value"
        />
        {trend && <TrendIndicator trend={trend} />}
        {progressBar}
      </CardContent>
    </Card>
  );
}
