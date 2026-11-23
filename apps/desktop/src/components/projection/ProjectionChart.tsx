import { useId, useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "react-i18next";
import { TrendingUpIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Money,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import {
  CHART_AXIS_TICK,
  CHART_GRID_STROKE,
  SERIES_COLOR,
  formatMonthTick,
  insightsLocale,
  makeAxisTickFormatter,
  niceAxisScale,
} from "@/components/spending-trends/insights-chart";
import { projectionEndYear } from "./milestones";
import type { ProjectionPoint } from "@/lib/projection";

interface ProjectionChartProps {
  data: ProjectionPoint[];
  isLoading?: boolean;
}

interface ChartPoint {
  monthOffset: number;
  label: string;
  totalCents: number;
  gainCents: number;
  investmentGainCents: number;
}

const CHART_SKELETON_ROWS = 8;

/**
 * Y-axis for a net-worth line. Not anchored at $0: today's balances are the floor the user already
 * stands on, and a 0-anchored axis flattens a decade of compounding into a straight shallow line.
 * The figures beside the chart carry the absolute scale.
 */
function projectionScale(totals: number[]) {
  if (totals.length === 0) return niceAxisScale(0, 1);
  return niceAxisScale(Math.min(...totals), Math.max(...totals));
}

/**
 * "Net worth to 2046": one violet line with a lavender fade under it and a dot on the last point.
 * `monotone`, because the series is itself a smooth compounding curve rather than recorded
 * observations joined up.
 */
export function ProjectionChart({ data, isLoading }: ProjectionChartProps) {
  const { t, i18n } = useTranslation();
  const { hidden, maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);
  const gradientId = `${useId().replace(/:/g, "")}-projection`;

  const view = useMemo(() => {
    const startCents = data[0]?.total_cents ?? 0;
    const now = new Date();
    // The projection's own label is "Aug 2026"; the axis needs `Dec '25`, because a bare `Dec 25`
    // reads as a date. Rebuilt from the month offset rather than re-parsing that string.
    const points: ChartPoint[] = data.map((point) => ({
      monthOffset: point.month,
      label: formatMonthTick(
        now.getFullYear(),
        now.getMonth() + point.month,
        locale,
      ),
      totalCents: point.total_cents,
      gainCents: point.total_cents - startCents,
      investmentGainCents: point.investment_gain_cents,
    }));

    const maxTotal = points.reduce(
      (max, point) => Math.max(max, Math.abs(point.totalCents)),
      0,
    );

    return { points, maxTotal, endYear: projectionEndYear(data, now) };
  }, [data, locale]);

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <Skeleton
            rows={CHART_SKELETON_ROWS}
            className="h-64 justify-between"
            data-testid="projection-chart-skeleton"
          />
        </CardContent>
      </Card>
    );
  }

  const { points, maxTotal, endYear } = view;
  const scale = projectionScale(points.map((point) => point.totalCents));
  const formatTick = makeAxisTickFormatter(maxTotal, locale, hidden);
  const last = points[points.length - 1];

  // About seven labels across the axis at any horizon, so month labels never run together.
  const tickInterval = Math.max(0, Math.ceil(points.length / 7) - 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={TrendingUpIcon}>
          {t("insights.v2.netWorthToYear", { year: endYear })}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-96" data-testid="projection-chart" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={points}
              margin={{ top: 8, right: 28, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={SERIES_COLOR.projected}
                    stopOpacity={0.32}
                  />
                  <stop
                    offset="95%"
                    stopColor={SERIES_COLOR.projected}
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
              <XAxis
                dataKey="label"
                tick={CHART_AXIS_TICK}
                tickLine={false}
                axisLine={false}
                interval={tickInterval}
              />
              <YAxis
                domain={scale.domain}
                ticks={scale.ticks}
                tickFormatter={formatTick}
                tick={CHART_AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={72}
              />
              <Tooltip
                content={
                  <ProjectionTooltip
                    locale={locale}
                    masked={hidden}
                    maskedLabel={maskProps.maskedLabel}
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
                dataKey="totalCents"
                stroke={SERIES_COLOR.projected}
                strokeWidth={2.5}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                isAnimationActive={false}
              />
              {last && (
                <ReferenceDot
                  x={last.label}
                  y={last.totalCents}
                  r={4.5}
                  fill={SERIES_COLOR.projected}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-4 text-caption text-ink-dim">
          {t("projection.growthFromToday")}
        </p>
        <ProjectionTableEquivalent
          points={points}
          locale={locale}
          maskProps={maskProps}
          caption={t("projection.chartTableCaption")}
          monthHead={t("insights.chartColMonth")}
          totalHead={t("projection.projectedNetWorth")}
          gainHead={t("projection.gainFromToday")}
        />
      </CardContent>
    </Card>
  );
}

function ProjectionTooltip({
  active,
  payload,
  locale,
  masked,
  maskedLabel,
  projectedNetWorthLabel,
  gainFromTodayLabel,
  gainFromExistingInvestmentsLabel,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: ChartPoint }>;
  locale: string;
  masked: boolean;
  maskedLabel: string;
  projectedNetWorthLabel: string;
  gainFromTodayLabel: string;
  gainFromExistingInvestmentsLabel: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  const rows = [
    { label: projectedNetWorthLabel, cents: point.totalCents, strong: true },
    { label: gainFromTodayLabel, cents: point.gainCents, strong: false },
    {
      label: gainFromExistingInvestmentsLabel,
      cents: point.investmentGainCents,
      strong: false,
    },
  ];

  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2 text-caption shadow-float">
      <p className="text-label text-ink">{point.label}</p>
      {rows.map((row) => (
        <p key={row.label} className="mt-0.5 text-ink-dim">
          {row.label}{" "}
          <Money
            cents={row.cents}
            locale={locale}
            masked={masked}
            maskedLabel={maskedLabel}
            className={row.strong ? "text-ink" : undefined}
          />
        </p>
      ))}
    </div>
  );
}

/** The chart's table equivalent. Visually hidden, fully in the accessible tree. */
function ProjectionTableEquivalent({
  points,
  locale,
  maskProps,
  caption,
  monthHead,
  totalHead,
  gainHead,
}: {
  points: readonly ChartPoint[];
  locale: string;
  maskProps: { masked: boolean; maskedLabel: string };
  caption: string;
  monthHead: string;
  totalHead: string;
  gainHead: string;
}) {
  return (
    <div className="sr-only">
      <Table>
        <caption>{caption}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{monthHead}</TableHead>
            <TableHead numeric>{totalHead}</TableHead>
            <TableHead numeric>{gainHead}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {points.map((point) => (
            <TableRow key={point.monthOffset}>
              <TableCell>{point.label}</TableCell>
              <TableCell numeric>
                <Money
                  cents={point.totalCents}
                  locale={locale}
                  {...maskProps}
                />
              </TableCell>
              <TableCell numeric>
                <Money
                  cents={point.gainCents}
                  locale={locale}
                  sign="always"
                  {...maskProps}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
