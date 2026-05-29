import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent } from "@nkbaz/shared";
import { useFormatCurrency, useFormatAxisValue } from "@/hooks/useFormatCurrency";
import type { NetWorthSnapshot } from "@/lib/types";

interface NetWorthTrendChartProps {
  data: NetWorthSnapshot[];
  isLoading?: boolean;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function NetWorthTrendChart({
  data,
  isLoading,
}: NetWorthTrendChartProps) {
  const formatCurrency = useFormatCurrency();
  const formatAxisValue = useFormatAxisValue();
  if (isLoading) {
    return (
      <Card className="shadow-sm rounded-lg">
        <CardContent className="p-6">
          <div
            className="h-64 bg-muted animate-pulse rounded"
            data-testid="chart-skeleton"
          />
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map((s) => ({
    date: formatDate(s.snapshot_date),
    value: s.total_cents,
  }));

  return (
    <Card className="shadow-sm rounded-lg">
      <CardContent className="p-6">
        <div className="h-64" data-testid="trend-chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="tealGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tickFormatter={formatAxisValue}
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={70}
              />
              <Tooltip
                formatter={(value) => [formatCurrency(value as number), "Net Worth"]}
                labelStyle={{ fontWeight: 500 }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill="url(#tealGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
