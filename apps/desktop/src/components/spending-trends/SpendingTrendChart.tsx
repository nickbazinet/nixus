import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@nkbaz/shared";
import { useFormatCurrency, useFormatAxisValue } from "@/hooks/useFormatCurrency";
import type { MonthlySpendTotal } from "@/lib/types";

interface SpendingTrendChartProps {
  data: MonthlySpendTotal[];
  isLoading?: boolean;
  /** Override divisor for average (e.g. YTD months elapsed). Defaults to data.length. */
  monthCount?: number;
  /** i18n key for the chart title. Defaults to spendingTrends.avgMonthlySpend. */
  titleKey?: string;
}

function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split("-");
  const d = new Date(Number(year), Number(month) - 1);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function SpendingTrendChart({
  data,
  isLoading,
  monthCount,
  titleKey = "spendingTrends.avgMonthlySpend",
}: SpendingTrendChartProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const formatAxisValue = useFormatAxisValue();

  if (isLoading) {
    return (
      <Card className="shadow-sm rounded-lg">
        <CardContent className="p-6">
          <div className="h-64 bg-muted animate-pulse rounded" />
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map((d) => ({
    month: formatMonth(d.month),
    value: d.total_cents,
  }));

  const divisor = Math.max(monthCount ?? data.length, 1);
  const avgCents =
    data.length > 0
      ? Math.round(data.reduce((sum, d) => sum + d.total_cents, 0) / divisor)
      : 0;

  return (
    <Card className="shadow-sm rounded-lg">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium text-muted-foreground">
          {t(titleKey)}
        </CardTitle>
        <p
          className="text-[32px] font-semibold font-mono leading-tight"
          data-testid="spending-trend-avg"
        >
          {formatCurrency(avgCents)}
        </p>
      </CardHeader>
      <CardContent className="p-6 pt-0">
        <div className="h-64" data-testid="spending-trend-chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="month"
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
                formatter={(value) => [formatCurrency(value as number), "Total Spend"]}
                labelStyle={{ fontWeight: 500 }}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill="url(#spendGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
