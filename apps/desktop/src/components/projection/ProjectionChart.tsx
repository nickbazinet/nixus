import { useMemo } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  Money,
  Skeleton,
  Stat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  formatMoney,
} from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import {
  formatMonthTick,
  insightsLocale,
  makeAxisTickFormatter,
} from "@/components/spending-trends/insights-chart";
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
 * Y-axis for projected gain from today. Anchors at $0 so compound growth reads as upward momentum
 * on longer horizons without distorting the data.
 */
function computeGainYAxisDomain(
  gains: number[],
  startCents: number,
): [number, number] {
  if (gains.length === 0) return [0, 1];

  const min = Math.min(...gains);
  const max = Math.max(...gains);
  const range = max - min;

  if (range === 0) {
    const headroom = Math.max(Math.abs(startCents) * 0.002, 10_000);
    if (min >= 0) return [0, headroom];
    return [min - headroom * 0.06, max + headroom * 0.06];
  }

  const padding = range * 0.06;
  if (min >= 0) return [0, max + padding];
  return [min - padding, max + padding];
}

export function ProjectionChart({ data, isLoading }: ProjectionChartProps) {
  const { t, i18n } = useTranslation();
  const { hidden, maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);

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

    const endCents = points[points.length - 1]?.totalCents ?? startCents;
    const maxGain = points.reduce(
      (max, point) => Math.max(max, Math.abs(point.gainCents)),
      0,
    );

    return { points, startCents, endCents, maxGain };
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

  const { points, endCents, maxGain } = view;
  const yDomain = computeGainYAxisDomain(
    points.map((point) => point.gainCents),
    view.startCents,
  );
  const formatTick = makeAxisTickFormatter(maxGain, locale, hidden);

  const tickInterval =
    points.length > 60
      ? Math.floor(points.length / 12) - 1
      : points.length > 24
        ? Math.floor(points.length / 6) - 1
        : 0;

  return (
    <Card>
      <CardHeader>
        <Stat
          label={t("projection.projectedNetWorth")}
          value={formatMoney({ cents: endCents, locale })}
          caption={t("projection.assumptionCaption")}
          {...maskProps}
          data-testid="projection-end-total"
        />
      </CardHeader>
      <CardContent>
        <p className="text-caption text-ink-dim">
          {t("projection.growthFromToday")}
        </p>
        <div
          className="mt-2 h-64"
          data-testid="projection-chart"
          aria-hidden="true"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points}>
              <defs>
                <linearGradient
                  id="projectionGainGradient"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop
                    offset="5%"
                    stopColor="var(--chart-1)"
                    stopOpacity={0.32}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--chart-1)"
                    stopOpacity={0}
                  />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 13, fill: "var(--ink-faint)" }}
                tickLine={false}
                axisLine={false}
                interval={tickInterval}
              />
              <YAxis
                domain={yDomain}
                tickCount={5}
                tickFormatter={formatTick}
                tick={{ fontSize: 13, fill: "var(--ink-faint)" }}
                tickLine={false}
                axisLine={false}
                width={78}
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
                dataKey="gainCents"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill="url(#projectionGainGradient)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
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
