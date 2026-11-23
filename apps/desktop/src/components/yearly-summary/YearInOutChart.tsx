import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartNoAxesColumnIcon } from "lucide-react";
import {
  Card,
  CardAction,
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
import { LegendDot } from "@/components/charts/DonutBreakdown";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import {
  CHART_AXIS_TICK,
  CHART_GRID_STROKE,
  SERIES_COLOR,
  insightsLocale,
  makeAxisTickFormatter,
} from "@/components/spending-trends/insights-chart";
import {
  averageBasisCaption,
  monthlyIncomeByMonthKey,
  monthlySpendView,
} from "@/components/spending-trends/monthly-spend";
import type { IncomeEntry, MonthlySpendTotal } from "@/lib/types";

interface YearInOutChartProps {
  monthlyTotals: MonthlySpendTotal[];
  /** Every income entry on record; only the selected year's months are read. */
  incomeEntries: readonly IncomeEntry[];
  year: number;
  isLoading?: boolean;
  /** i18n key for the average figure's label — "Year to date" or plain. */
  titleKey: string;
}

interface InOutPoint {
  monthKey: string;
  label: string;
  monthName: string;
  spentCents: number;
  /** Undefined when no income was recorded that month, so the line breaks instead of dropping to 0. */
  inCents?: number;
}

const CHART_SKELETON_ROWS = 8;

/**
 * "In and out, month by month": spending as a filled pink line and money in as a bare teal one, so
 * the gap between them IS the year's saving. Money in is summed from the income entries themselves
 * — the yearly payload carries only a year total — and the line is simply absent for a year with no
 * entries rather than drawn flat at zero.
 */
export function YearInOutChart({
  monthlyTotals,
  incomeEntries,
  year,
  isLoading,
  titleKey,
}: YearInOutChartProps) {
  const { t, i18n } = useTranslation();
  const { hidden, maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);
  const gradientId = `${useId().replace(/:/g, "")}-spent`;

  const { view, points, hasIncome, maxCents } = useMemo(() => {
    const spendView = monthlySpendView(monthlyTotals, locale);
    const incomeByMonth = monthlyIncomeByMonthKey(incomeEntries, year);

    const rows: InOutPoint[] = spendView.points.map((point) => ({
      monthKey: point.monthKey,
      label: point.label,
      monthName: point.monthName,
      spentCents: point.cents,
      inCents: incomeByMonth.get(point.monthKey),
    }));

    const income = rows.some((row) => row.inCents !== undefined);
    return {
      view: spendView,
      points: rows,
      hasIncome: income,
      maxCents: rows.reduce(
        (max, row) => Math.max(max, row.spentCents, row.inCents ?? 0),
        0,
      ),
    };
  }, [monthlyTotals, incomeEntries, year, locale]);

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <Skeleton
            rows={CHART_SKELETON_ROWS}
            className="h-64 justify-between"
            data-testid="year-in-out-chart-skeleton"
          />
        </CardContent>
      </Card>
    );
  }

  const formatTick = makeAxisTickFormatter(maxCents, locale, hidden);
  const basis = averageBasisCaption(view);
  const last = points[points.length - 1];
  const spentLabel = t("insights.chartColSpent");
  const inLabel = t("insights.v2.moneyIn");

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={ChartNoAxesColumnIcon}>
          {t("insights.v2.inAndOutTitle")}
        </CardTitle>
        <CardAction>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-ink-dim">
            {hasIncome && (
              <span className="flex items-center gap-2">
                <LegendDot color={SERIES_COLOR.in} />
                {inLabel}
              </span>
            )}
            <span className="flex items-center gap-2">
              <LegendDot color={SERIES_COLOR.out} />
              {spentLabel}
            </span>
          </p>
        </CardAction>
      </CardHeader>
      <CardContent>
        {/* The plot is hidden from assistive tech; the table below carries the same numbers. */}
        <div className="h-72" data-testid="spending-trend-chart" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={points}
              margin={{ top: 8, right: 28, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor={SERIES_COLOR.out}
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor={SERIES_COLOR.out}
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
                interval={0}
                minTickGap={0}
              />
              <YAxis
                tickFormatter={formatTick}
                tick={CHART_AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={66}
              />
              <Tooltip
                content={
                  <InOutTooltip
                    locale={locale}
                    masked={hidden}
                    maskedLabel={maskProps.maskedLabel}
                    inLabel={inLabel}
                    spentLabel={spentLabel}
                  />
                }
              />
              <Area
                type="linear"
                dataKey="spentCents"
                stroke={SERIES_COLOR.out}
                strokeWidth={2.5}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                isAnimationActive={false}
              />
              {hasIncome && (
                <Line
                  type="linear"
                  dataKey="inCents"
                  stroke={SERIES_COLOR.in}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
                  connectNulls
                  isAnimationActive={false}
                />
              )}
              {last && (
                <ReferenceDot
                  x={last.label}
                  y={last.spentCents}
                  r={4.5}
                  fill={SERIES_COLOR.out}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              )}
              {last?.inCents !== undefined && (
                <ReferenceDot
                  x={last.label}
                  y={last.inCents}
                  r={4.5}
                  fill={SERIES_COLOR.in}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p
          className="mt-4 text-caption text-ink-dim"
          data-testid="spending-trend-avg"
        >
          <span className="text-ink">{t(titleKey)}</span>{" "}
          <Money
            cents={view.avgCents}
            locale={locale}
            className="font-bold text-ink"
            {...maskProps}
          />{" "}
          {t(basis.key, basis.args)}
        </p>
        <div className="sr-only">
          <Table>
            <caption>{t("insights.v2.inAndOutTableCaption", { year })}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>{t("insights.chartColMonth")}</TableHead>
                {hasIncome && <TableHead numeric>{inLabel}</TableHead>}
                <TableHead numeric>{spentLabel}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {points.map((point) => (
                <TableRow key={point.monthKey}>
                  <TableCell>{point.label}</TableCell>
                  {hasIncome && (
                    <TableCell numeric>
                      {point.inCents === undefined ? (
                        "\u2014"
                      ) : (
                        <Money
                          cents={point.inCents}
                          locale={locale}
                          {...maskProps}
                        />
                      )}
                    </TableCell>
                  )}
                  <TableCell numeric>
                    <Money
                      cents={point.spentCents}
                      locale={locale}
                      {...maskProps}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function InOutTooltip({
  active,
  payload,
  locale,
  masked,
  maskedLabel,
  inLabel,
  spentLabel,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: InOutPoint }>;
  locale: string;
  masked: boolean;
  maskedLabel: string;
  inLabel: string;
  spentLabel: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2 text-caption text-ink shadow-float">
      <p className="text-label text-ink">{point.label}</p>
      {point.inCents !== undefined && (
        <p className="mt-0.5 text-ink-dim">
          {inLabel}{" "}
          <Money
            cents={point.inCents}
            locale={locale}
            masked={masked}
            maskedLabel={maskedLabel}
            className="text-ink"
          />
        </p>
      )}
      <p className="mt-0.5 text-ink-dim">
        {spentLabel}{" "}
        <Money
          cents={point.spentCents}
          locale={locale}
          masked={masked}
          maskedLabel={maskedLabel}
          className="text-ink"
        />
      </p>
    </div>
  );
}
