import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@nixus/shared";
import { useFormatCurrency, useFormatAxisValue } from "@/hooks/useFormatCurrency";
import type { ProjectionPoint } from "@/lib/projection";

interface ProjectionChartProps {
  data: ProjectionPoint[];
  isLoading?: boolean;
}

interface ChartPoint {
  label: string;
  totalCents: number;
  gainCents: number;
  investmentGainCents: number;
}

/**
 * Y-axis for projected gain from today. Anchors at $0 so compound growth reads
 * as upward momentum (hockey-stick shape on longer horizons) without distorting data.
 */
function computeGainYAxisDomain(
  gains: number[],
  startCents: number,
): [number, number] {
  if (gains.length === 0) return [0, 1];

  const min = Math.min(...gains);
  const max = Math.max(...gains);
  let range = max - min;

  if (range === 0) {
    const headroom = Math.max(Math.abs(startCents) * 0.002, 10_000);
    if (min >= 0) return [0, headroom];
    return [min - headroom * 0.06, max + headroom * 0.06];
  }

  const padding = range * 0.06;

  if (min >= 0) {
    return [0, max + padding];
  }

  return [min - padding, max + padding];
}

function ProjectionTooltip({
  active,
  payload,
  label,
  formatCurrency,
  projectedNetWorthLabel,
  gainFromTodayLabel,
  gainFromExistingInvestmentsLabel,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: ChartPoint }>;
  label?: string | number;
  formatCurrency: (cents: number) => string;
  projectedNetWorthLabel: string;
  gainFromTodayLabel: string;
  gainFromExistingInvestmentsLabel: string;
}) {
  if (!active || !payload?.length) return null;

  const point = payload[0].payload as ChartPoint;

  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-sm shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      <p>
        {projectedNetWorthLabel}: {formatCurrency(point.totalCents)}
      </p>
      <p className="text-muted-foreground">
        {gainFromTodayLabel}: {formatCurrency(point.gainCents)}
      </p>
      <p className="text-muted-foreground">
        {gainFromExistingInvestmentsLabel}:{" "}
        {formatCurrency(point.investmentGainCents)}
      </p>
    </div>
  );
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

  const startCents = data[0]?.total_cents ?? 0;
  const chartData: ChartPoint[] = data.map((p) => ({
    label: p.label,
    totalCents: p.total_cents,
    gainCents: p.total_cents - startCents,
    investmentGainCents: p.investment_gain_cents,
  }));

  const yDomain: [number, number] =
    chartData.length > 0
      ? computeGainYAxisDomain(
          chartData.map((d) => d.gainCents),
          startCents,
        )
      : [0, 1];

  const tickInterval =
    data.length > 60
      ? Math.floor(data.length / 12) - 1
      : data.length > 24
        ? Math.floor(data.length / 6) - 1
        : 0;

  return (
    <Card className="shadow-sm rounded-lg">
      <CardContent className="p-6">
        <p className="mb-3 text-sm text-muted-foreground">
          {t("projection.growthFromToday")}
        </p>
        <div className="h-64" data-testid="projection-chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="projectionGainGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                interval={tickInterval}
              />
              <YAxis
                domain={yDomain}
                tickCount={5}
                tickFormatter={formatAxisValue}
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                width={70}
              />
              <Tooltip
                content={
                  <ProjectionTooltip
                    formatCurrency={formatCurrency}
                    projectedNetWorthLabel={t("projection.projectedNetWorth")}
                    gainFromTodayLabel={t("projection.gainFromToday")}
                    gainFromExistingInvestmentsLabel={t(
                      "projection.gainFromExistingInvestments",
                    )}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="gainCents"
                stroke="var(--chart-2)"
                strokeWidth={2}
                fill="url(#projectionGainGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
