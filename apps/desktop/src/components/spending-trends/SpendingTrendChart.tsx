import { useMemo } from "react";
import {
  Bar,
  BarChart,
  Rectangle,
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
  currentMonthKey,
  formatMonthKey,
  formatMonthName,
  insightsLocale,
  makeAxisTickFormatter,
} from "./insights-chart";
import type { MonthlySpendTotal } from "@/lib/types";

interface SpendingTrendChartProps {
  data: MonthlySpendTotal[];
  isLoading?: boolean;
  /** i18n key for the figure's label. Defaults to spendingTrends.avgMonthlySpend. */
  titleKey?: string;
}

interface ChartPoint {
  monthKey: string;
  label: string;
  cents: number;
  isCurrent: boolean;
}

/** Gridline count the loading placeholder stands in for. */
const CHART_SKELETON_ROWS = 8;

export function SpendingTrendChart({
  data,
  isLoading,
  titleKey = "spendingTrends.avgMonthlySpend",
}: SpendingTrendChartProps) {
  const { t, i18n } = useTranslation();
  const { hidden, maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);

  const view = useMemo(() => {
    const thisMonth = currentMonthKey();

    // A year window returns all twelve months, so months that have not happened yet arrive at zero.
    // Dropped rather than drawn — an empty November bar in August claims knowledge Nixus lacks.
    const points: ChartPoint[] = data
      .filter((row) => row.month <= thisMonth)
      .map((row) => ({
        monthKey: row.month,
        label: formatMonthKey(row.month, locale),
        cents: row.total_cents,
        isCurrent: row.month === thisMonth,
      }));

    // The average counts COMPLETED months only. Folding a part-month into a monthly average drags
    // it below anything the user would recognise as her own number.
    const completed = points.filter((point) => !point.isCurrent);
    const partial = points.find((point) => point.isCurrent);
    const total = completed.reduce((sum, point) => sum + point.cents, 0);
    const avgCents =
      completed.length > 0 ? Math.round(total / completed.length) : 0;
    const maxCents = points.reduce(
      (max, point) => Math.max(max, point.cents),
      0,
    );

    return { points, completed, partial, avgCents, maxCents };
  }, [data, locale]);

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

  const { points, completed, partial, avgCents, maxCents } = view;
  const formatTick = makeAxisTickFormatter(maxCents, locale, hidden);

  const caption =
    completed.length === 0
      ? t("insights.avgNoCompletedMonths")
      : partial
        ? t("insights.avgCompletedMonthsPartial", {
            months: completed.length,
            first: formatMonthName(completed[0].monthKey, locale),
            last: formatMonthName(
              completed[completed.length - 1].monthKey,
              locale,
            ),
            current: formatMonthName(partial.monthKey, locale),
          })
        : t("insights.avgCompletedMonths", {
            months: completed.length,
            first: formatMonthName(completed[0].monthKey, locale),
            last: formatMonthName(
              completed[completed.length - 1].monthKey,
              locale,
            ),
          });

  return (
    <Card>
      <CardHeader>
        <Stat
          label={t(titleKey)}
          value={formatMoney({ cents: avgCents, locale })}
          caption={caption}
          {...maskProps}
          data-testid="spending-trend-avg"
        />
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
            <BarChart data={points} barCategoryGap="18%">
              <XAxis
                dataKey="label"
                tick={{ fontSize: 13, fill: "var(--ink-faint)" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={formatTick}
                tick={{ fontSize: 13, fill: "var(--ink-faint)" }}
                tickLine={false}
                axisLine={false}
                width={78}
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
        {partial ? (
          <p className="mt-3 text-caption text-ink-dim">
            {t("insights.currentBarNote", {
              month: formatMonthName(partial.monthKey, locale),
            })}
          </p>
        ) : null}
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
  return (
    <Rectangle
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      radius={[4, 4, 2, 2]}
      fill={props.payload?.isCurrent ? "var(--brand)" : "var(--chart-1)"}
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
  payload?: ReadonlyArray<{ payload: ChartPoint }>;
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
  points: readonly ChartPoint[];
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
