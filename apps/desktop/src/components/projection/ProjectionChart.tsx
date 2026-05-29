import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@nkbaz/shared";
import { useFormatCurrency, useFormatAxisValue } from "@/hooks/useFormatCurrency";
import type { ProjectionPoint } from "@/lib/projection";

interface ProjectionChartProps {
  data: ProjectionPoint[];
  isLoading?: boolean;
}

export function ProjectionChart({ data, isLoading }: ProjectionChartProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const formatAxisValue = useFormatAxisValue();

  if (isLoading) {
    return (
      <Card className="shadow-sm rounded-lg">
        <CardContent className="p-6">
          <div
            className="h-64 bg-muted animate-pulse rounded"
            data-testid="projection-chart-skeleton"
          />
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map((p) => ({
    label: p.label,
    value: p.total_cents,
  }));

  const tickInterval =
    data.length > 60
      ? Math.floor(data.length / 12) - 1
      : data.length > 24
        ? Math.floor(data.length / 6) - 1
        : 0;

  return (
    <Card className="shadow-sm rounded-lg">
      <CardContent className="p-6">
        <div className="h-64" data-testid="projection-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                interval={tickInterval}
              />
              <YAxis
                tickFormatter={formatAxisValue}
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={70}
              />
              <Tooltip
                formatter={(value) => [
                  formatCurrency(value as number),
                  t("projection.projectedNetWorth"),
                ]}
                labelStyle={{ fontWeight: 500 }}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--chart-2)"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
