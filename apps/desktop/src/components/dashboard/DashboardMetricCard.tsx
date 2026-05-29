import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Card, CardContent } from "@nixus/shared";
import { cn } from "@/lib/utils";

interface TrendInfo {
  direction: "up" | "down" | "flat";
  percentage: string;
  description?: string;
}

interface DashboardMetricCardProps {
  title: string;
  value: string;
  trend?: TrendInfo;
  variant: "hero" | "secondary";
  href?: string;
  progressBar?: ReactNode;
  isLoading?: boolean;
}

function TrendIndicator({ trend }: { trend: TrendInfo }) {
  const arrow = trend.direction === "up" ? "↑" : trend.direction === "down" ? "↓" : "→";
  const color =
    trend.direction === "up"
      ? "text-emerald-600"
      : trend.direction === "down"
        ? "text-rose-600"
        : "text-muted-foreground";

  return (
    <span className={cn("text-sm", color)}>
      {arrow} {trend.percentage}
      {trend.description && (
        <span className="text-muted-foreground ml-1">{trend.description}</span>
      )}
    </span>
  );
}

function SkeletonCard({ variant }: { variant: "hero" | "secondary" }) {
  const valueH = variant === "hero" ? "h-10" : "h-6";
  return (
    <Card className="shadow-sm rounded-lg" data-testid="metric-card-skeleton">
      <CardContent className="p-8">
        <div className="h-4 w-24 bg-muted animate-pulse rounded mb-3" />
        <div className={cn(valueH, "w-40 bg-muted animate-pulse rounded mb-2")} />
        <div className="h-4 w-20 bg-muted animate-pulse rounded" />
      </CardContent>
    </Card>
  );
}

export function DashboardMetricCard({
  title,
  value,
  trend,
  variant,
  href,
  progressBar,
  isLoading,
}: DashboardMetricCardProps) {
  const navigate = useNavigate();

  if (isLoading) {
    return <SkeletonCard variant={variant} />;
  }

  const isHero = variant === "hero";

  const trendLabel = trend
    ? `, ${trend.direction === "up" ? "up" : trend.direction === "down" ? "down" : "flat"} ${trend.percentage}`
    : "";

  return (
    <Card
      className={cn(
        "shadow-sm rounded-lg transition-shadow",
        href && "cursor-pointer hover:shadow-md"
      )}
      role={href ? "link" : undefined}
      aria-label={`${title}: ${value}${trendLabel}`}
      onClick={href ? () => navigate({ to: href }) : undefined}
      data-testid="metric-card"
    >
      <CardContent className="p-8">
        <p className="text-sm text-muted-foreground mb-1">{title}</p>
        <p
          className={cn(
            "font-mono font-semibold",
            isHero ? "text-[40px] leading-tight" : "text-2xl"
          )}
          data-testid="metric-value"
        >
          {value}
        </p>
        {trend && (
          <div className="mt-1">
            <TrendIndicator trend={trend} />
          </div>
        )}
        {progressBar && <div className="mt-3">{progressBar}</div>}
      </CardContent>
    </Card>
  );
}
