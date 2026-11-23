import { useMemo } from "react";
import { useTranslation } from "react-i18next";
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
import {
  Money,
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
  currentMonthKey,
  formatMonthKey,
  insightsLocale,
  makeAxisTickFormatter,
} from "@/components/spending-trends/insights-chart";
import { monthlyIncomeByMonthKey } from "@/components/spending-trends/monthly-spend";
import type { IncomeEntry } from "@/lib/types";

interface IncomeByMonthChartProps {
  /** Every income entry on record; only the selected year's months are read. */
  entries: readonly IncomeEntry[];
  year: number;
}

interface IncomePoint {
  monthKey: string;
  label: string;
  cents: number;
  isCurrent: boolean;
}

/**
 * "Income by month": one bar per month of the selected year, the running month solid brand so a
 * part-month bar never reads as a finished one. Summed from the entries themselves — the backend
 * carries no monthly income total — and months that have not happened yet are left out rather
 * than drawn at zero.
 */
export function IncomeByMonthChart({ entries, year }: IncomeByMonthChartProps) {
  const { t, i18n } = useTranslation();
  const { hidden, maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);

  const { points, maxCents } = useMemo(() => {
    const thisMonth = currentMonthKey();
    const byMonth = monthlyIncomeByMonthKey(entries, year);
    const rows: IncomePoint[] = [];
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const monthKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
      if (monthKey > thisMonth) break;
      rows.push({
        monthKey,
        label: formatMonthKey(monthKey, locale),
        cents: byMonth.get(monthKey) ?? 0,
        isCurrent: monthKey === thisMonth,
      });
    }
    return {
      points: rows,
      maxCents: rows.reduce((max, row) => Math.max(max, row.cents), 0),
    };
  }, [entries, year, locale]);

  const formatTick = makeAxisTickFormatter(maxCents, locale, hidden);

  return (
    <>
      {/* The plot is hidden from assistive tech; the table below carries the same numbers, so a
       * screen reader gets rows rather than an unlabelled SVG. */}
      <div className="h-72" data-testid="income-by-month-chart" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} barCategoryGap="22%">
            <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
            <XAxis
              dataKey="label"
              tick={CHART_AXIS_TICK}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={4}
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
                <IncomeTooltip
                  locale={locale}
                  masked={hidden}
                  maskedLabel={maskProps.maskedLabel}
                  totalLabel={t("income.moneyInLabel")}
                  partialLabel={t("insights.monthInProgress")}
                />
              }
            />
            <Bar dataKey="cents" isAnimationActive={false} shape={renderMonthBar} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="sr-only">
        <Table>
          <caption>{t("income.v2.byMonthTableCaption", { year })}</caption>
          <TableHeader>
            <TableRow>
              <TableHead>{t("insights.chartColMonth")}</TableHead>
              <TableHead numeric>{t("income.moneyInLabel")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {points.map((point) => (
              <TableRow key={point.monthKey}>
                <TableCell>
                  {point.label}
                  {point.isCurrent ? ` \u2014 ${t("insights.monthInProgress")}` : ""}
                </TableCell>
                <TableCell numeric>
                  <Money cents={point.cents} locale={locale} {...maskProps} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
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

function IncomeTooltip({
  active,
  payload,
  locale,
  masked,
  maskedLabel,
  totalLabel,
  partialLabel,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload: IncomePoint }>;
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
      {point.isCurrent ? <p className="mt-0.5 text-ink-dim">{partialLabel}</p> : null}
    </div>
  );
}
