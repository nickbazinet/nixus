import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@nixus/shared";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import type { NetWorthBreakdownCategory } from "@/lib/types";

interface NetWorthBreakdownBarProps {
  breakdown: NetWorthBreakdownCategory[];
  isLoading?: boolean;
  titleKey?: string;
}

export function NetWorthBreakdownBar({
  breakdown,
  isLoading,
  titleKey = "netWorth.breakdown",
}: NetWorthBreakdownBarProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (isLoading) {
    return (
      <Card className="shadow-sm rounded-lg">
        <CardContent className="p-6">
          <div className="h-6 bg-muted animate-pulse rounded mb-4" />
          <div className="grid grid-cols-2 gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-4 bg-muted animate-pulse rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (breakdown.length === 0) return null;

  return (
    <Card className="shadow-sm rounded-lg" data-testid="breakdown-bar-card">
      <CardContent className="p-6">
        <p className="text-sm font-medium text-muted-foreground mb-3">
          {t(titleKey)}
        </p>

        <TooltipProvider delay={0}>
          {/* Stacked horizontal bar */}
          <div
            className="flex h-6 rounded-full overflow-hidden"
            data-testid="breakdown-bar"
          >
            {breakdown.map((cat, i) => (
              <Tooltip key={cat.name}>
                <TooltipTrigger
                  render={
                    <div
                      className="relative block h-full min-w-0 transition-opacity"
                      style={{
                        width: `${cat.percentage}%`,
                        backgroundColor: cat.color,
                        opacity:
                          hoveredIndex !== null && hoveredIndex !== i
                            ? 0.5
                            : 1,
                      }}
                      aria-label={`${cat.name}: ${formatCurrency(cat.cents)}, ${cat.percentage.toFixed(1)}%`}
                      onMouseEnter={() => setHoveredIndex(i)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      data-testid="breakdown-segment"
                    />
                  }
                />
                <TooltipContent
                  side="top"
                  data-testid="breakdown-tooltip"
                >
                  {cat.name}: {formatCurrency(cat.cents)} (
                  {cat.percentage.toFixed(1)}%)
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>

        {/* Legend grid */}
        <div
          className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-4"
          data-testid="breakdown-legend"
        >
          {breakdown.map((cat) => (
            <div key={cat.name} className="flex items-center gap-2" data-testid="legend-item">
              <div
                className="size-3 rounded-full shrink-0"
                style={{ backgroundColor: cat.color }}
              />
              <span className="text-sm truncate">{cat.name}</span>
              <span className="font-mono text-sm ml-auto">
                {formatCurrency(cat.cents)}
              </span>
              <span className="text-xs text-muted-foreground w-10 text-right">
                {cat.percentage.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
