import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "react-i18next";
import { ChartNoAxesColumnIcon } from "lucide-react";
import {
  Badge,
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
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import {
  BAR_FILL,
  BAR_FILL_OPACITY_COMPLETE,
  CHART_AXIS_TICK,
  CHART_GRID_STROKE,
  insightsLocale,
  makeAxisTickFormatter,
} from "./insights-chart";
import {
  averageBasisCaption,
  monthlySpendView,
  type MonthlySpendPoint,
} from "./monthly-spend";
import type { MonthlySpendTotal } from "@/lib/types";

interface SpendingTrendChartProps {
  data: MonthlySpendTotal[];
  isLoading?: boolean;
  /** i18n key for the average figure's label. Defaults to spendingTrends.avgMonthlySpend. */
  titleKey?: string;
}

/** Gridline count the loading placeholder stands in for. */
const CHART_SKELETON_ROWS = 8;

/**
 * "Spending, last N months": one bar per month, the running month solid brand so a part-month bar
 * never reads as a finished one. The monthly average sits under the plot as the reference the bars
 * are judged against.
 */
export function SpendingTrendChart({
  data,
  isLoading,
  titleKey = "spendingTrends.avgMonthlySpend",
}: SpendingTrendChartProps) {
  const { t, i18n } = useTranslation();
  const { hidden, maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);

  const view = useMemo(() => monthlySpendView(data, locale), [data, locale]);

  if (isLoading) {
    return (
      <Card>
        <CardContent>
          <Skeleton
            rows={CHART_SKELETON_ROWS}
            className="h-64 justify-between"
            data-testid="spending-trend-chart-skeleton"
          />
        </CardContent>
      </Card>
    );
  }

  const { points, partial, avgCents, maxCents } = view;
  const formatTick = makeAxisTickFormatter(maxCents, locale, hidden);
  const basis = averageBasisCaption(view);

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={ChartNoAxesColumnIcon}>
          {t("insights.v2.spendingLastMonths", { months: points.length })}
        </CardTitle>
        {partial && (
          <CardAction>
            <Badge variant="brand">
              {t("insights.v2.monthIsPartial", { month: partial.monthName })}
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {/* The plot is hidden from assistive tech; the table below carries the same numbers, so a
         * screen reader gets rows rather than an unlabelled SVG. */}
        <div
          className="h-64"
          data-testid="spending-trend-chart"
          aria-hidden="true"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points} barCategoryGap="22%">
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
                cursor={{ fill: "var(--hover)" }}
                content={
                  <MonthTooltip
                    locale={locale}
                    masked={hidden}
                    maskedLabel={maskProps.maskedLabel}
                    totalLabel={t("insights.chartColSpent")}
                    partialLabel={t("insights.monthInProgress")}
                  />
                }
              />
              <Bar
                dataKey="cents"
                isAnimationActive={false}
                shape={renderMonthBar}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p
          className="mt-4 text-caption text-ink-dim"
          data-testid="spending-trend-avg"
        >
          <span className="text-ink">{t(titleKey)}</span>{" "}
          <Money
            cents={avgCents}
            locale={locale}
            className="font-bold text-ink"
            {...maskProps}
          />{" "}
          {t(basis.key, basis.args)}
        </p>
        <MonthTableEquivalent
          points={points}
          locale={locale}
          maskProps={maskProps}
          caption={t("insights.chartTableCaption")}
          monthHead={t("insights.chartColMonth")}
          spentHead={t("insights.chartColSpent")}
          partialLabel={t("insights.monthInProgress")}
        />
      </CardContent>
    </Card>
  );
}

/**
 * Per-bar fill. Recharts 3 deprecates `<Cell>` in favour of `shape`, so the current-period override
 * lives here — the one legitimate use of brand inside a chart.
 */
function renderMonthBar(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: { isCurrent?: boolean };
}) {
  const isCurrent = props.payload?.isCurrent === true;
  return (
    <Rectangle
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      radius={[6, 6, 0, 0]}
      fill={BAR_FILL}
      fillOpacity={isCurrent ? 1 : BAR_FILL_OPACITY_COMPLETE}
    />
  );
}

function MonthTooltip({
  active,
  payload,
  locale,
  masked,
  maskedLabel,
  totalLabel,
  partialLabel,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: MonthlySpendPoint }>;
  locale: string;
  masked: boolean;
  maskedLabel: string;
  totalLabel: string;
  partialLabel: string;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2 text-caption text-ink shadow-float">
      <p className="text-label text-ink">{point.label}</p>
      <p className="mt-0.5 text-ink-dim">
        {totalLabel}{" "}
        <Money
          cents={point.cents}
          locale={locale}
          masked={masked}
          maskedLabel={maskedLabel}
          className="text-ink"
        />
      </p>
      {point.isCurrent ? (
        <p className="mt-0.5 text-ink-dim">{partialLabel}</p>
      ) : null}
    </div>
  );
}

/** The chart's table equivalent. Visually hidden, fully in the accessible tree. */
function MonthTableEquivalent({
  points,
  locale,
  maskProps,
  caption,
  monthHead,
  spentHead,
  partialLabel,
}: {
  points: readonly MonthlySpendPoint[];
  locale: string;
  maskProps: { masked: boolean; maskedLabel: string };
  caption: string;
  monthHead: string;
  spentHead: string;
  partialLabel: string;
}) {
  return (
    <div className="sr-only">
      <Table>
        <caption>{caption}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{monthHead}</TableHead>
            <TableHead numeric>{spentHead}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {points.map((point) => (
            <TableRow key={point.monthKey}>
              <TableCell>
                {point.label}
                {point.isCurrent ? ` \u2014 ${partialLabel}` : ""}
              </TableCell>
              <TableCell numeric>
                <Money cents={point.cents} locale={locale} {...maskProps} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
