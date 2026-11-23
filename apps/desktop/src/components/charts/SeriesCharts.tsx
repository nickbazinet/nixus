import { useId, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Money } from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import {
  BAR_FILL,
  BAR_FILL_OPACITY_COMPLETE,
  CHART_AXIS_TICK,
  CHART_GRID_STROKE,
  insightsLocale,
  makeAxisTickFormatter,
  rampColor,
  SERIES_COLOR,
} from "@/components/spending-trends/insights-chart";
import { ChartTableEquivalent } from "./ChartTableEquivalent";

/**
 * Series-agnostic chart primitives, generalized from the three bespoke charts
 * (`NetWorthTrendChart`, `SpendingTrendChart`, `ProjectionChart`): the same axis, tooltip,
 * masking and table-equivalent conventions, but driven by any number of named series over any
 * labelled rows instead of one domain's fixed shape. Every value is in cents.
 */
export interface ChartSeries {
  key: string;
  label: string;
}

export interface ChartRow {
  key: string;
  label: string;
  values: number[];
}

export interface SeriesChartProps {
  rows: ChartRow[];
  series: ChartSeries[];
  /** Header of the label column in the screen-reader table. */
  dimensionLabel: string;
  caption: string;
  /** Rotates the rank-ordered ramp. Undefined keeps the default palette. */
  accent?: number;
  "data-testid"?: string;
}

type Point = Record<string, string | number> & { label: string };

function toPoints(rows: ChartRow[], series: ChartSeries[]): Point[] {
  return rows.map((row) => {
    const point: Point = { label: row.label };
    series.forEach((s, index) => {
      point[s.key] = row.values[index] ?? 0;
    });
    return point;
  });
}

function maxAbs(rows: ChartRow[]): number {
  return rows.reduce(
    (max, row) => row.values.reduce((inner, value) => Math.max(inner, Math.abs(value)), max),
    0
  );
}

function SeriesTooltip({
  active,
  payload,
  label,
  series,
  locale,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown }>;
  label?: unknown;
  series: ChartSeries[];
  locale: string;
}) {
  const { maskProps } = useValuesHidden();
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2 text-caption text-ink shadow-float">
      <p className="text-label text-ink">{String(label ?? "")}</p>
      {payload.map((entry) => {
        const name = series.find((s) => s.key === entry.dataKey)?.label ?? String(entry.dataKey);
        return (
          <p key={String(entry.dataKey)} className="mt-0.5 text-ink-dim">
            {name}{" "}
            <Money cents={Number(entry.value ?? 0)} locale={locale} className="text-ink" {...maskProps} />
          </p>
        );
      })}
    </div>
  );
}

function useChartScale(rows: ChartRow[], series: ChartSeries[]) {
  const { i18n } = useTranslation();
  const { hidden } = useValuesHidden();
  const locale = insightsLocale(i18n.language);
  return {
    locale,
    points: toPoints(rows, series),
    formatTick: makeAxisTickFormatter(maxAbs(rows), locale, hidden),
  };
}

function ChartFrame({ props, children }: { props: SeriesChartProps; children: ReactElement }) {
  return (
    <div>
      {/* The plot is hidden from assistive tech; the table below carries the same numbers. */}
      <div className="h-56" aria-hidden="true" data-testid={props["data-testid"]}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
      <ChartTableEquivalent
        rows={props.rows}
        series={props.series}
        dimensionLabel={props.dimensionLabel}
        caption={props.caption}
      />
    </div>
  );
}

const AXIS_TICK = CHART_AXIS_TICK;

function axes(formatTick: (cents: number) => string) {
  return [
    <CartesianGrid key="grid" stroke={CHART_GRID_STROKE} vertical={false} />,
    <XAxis
      key="x"
      dataKey="label"
      tick={AXIS_TICK}
      tickLine={false}
      axisLine={false}
      minTickGap={16}
      interval="preserveStartEnd"
    />,
    <YAxis key="y" tickFormatter={formatTick} tick={AXIS_TICK} tickLine={false} axisLine={false} width={72} />,
  ];
}

/**
 * A series' colour. A widget the user gave an accent keeps it; otherwise a lone line or area takes
 * the charte's violet trend colour, and several series walk the rank ramp from the start.
 */
function seriesColor(index: number, count: number, accent: number | undefined): string {
  if (accent !== undefined) return rampColor(index, accent);
  return count === 1 ? SERIES_COLOR.projected : rampColor(index);
}

/** `linear`, never smoothed: a curve would invent movement between two recorded points. */
export function LineSeriesChart(props: SeriesChartProps) {
  const { points, formatTick, locale } = useChartScale(props.rows, props.series);
  const lastLabel = points[points.length - 1]?.label;
  return (
    <ChartFrame props={props}>
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          {axes(formatTick)}
          <Tooltip content={<SeriesTooltip series={props.series} locale={locale} />} />
          {props.series.map((s, index) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={s.key}
              stroke={seriesColor(index, props.series.length, props.accent)}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, fill: seriesColor(index, props.series.length, props.accent), stroke: "var(--card)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
          {/* A dot on the last point only: it marks where the series stops, and a dot per point
            * turns a trend into a scatter plot. */}
          {lastLabel !== undefined &&
            props.series.map((s, index) => (
              <ReferenceDot
                key={`last-${s.key}`}
                x={lastLabel}
                y={Number(points[points.length - 1][s.key] ?? 0)}
                r={4}
                fill={seriesColor(index, props.series.length, props.accent)}
                stroke="var(--card)"
                strokeWidth={2}
              />
            ))}
        </LineChart>
    </ChartFrame>
  );
}

export function BarSeriesChart(props: SeriesChartProps) {
  const { points, formatTick, locale } = useChartScale(props.rows, props.series);
  const single = props.series.length === 1;
  return (
    <ChartFrame props={props}>
        <BarChart data={points} barCategoryGap="22%">
          {axes(formatTick)}
          <Tooltip
            cursor={{ fill: "var(--hover)" }}
            content={<SeriesTooltip series={props.series} locale={locale} />}
          />
          {props.series.map((s, index) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              // One series is the surface's own measure and takes the soft brand fill; several
              // series have to be told apart, which is what the rank ramp is for.
              fill={single ? BAR_FILL : seriesColor(index, props.series.length, props.accent)}
              fillOpacity={single ? BAR_FILL_OPACITY_COMPLETE : 1}
              radius={[6, 6, 0, 0]}
              maxBarSize={64}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
    </ChartFrame>
  );
}

export function AreaSeriesChart(props: SeriesChartProps) {
  const { points, formatTick, locale } = useChartScale(props.rows, props.series);
  // Per-instance, so two area charts on one surface never resolve each other's gradient.
  const gradientPrefix = useId().replace(/:/g, "");
  const lastLabel = points[points.length - 1]?.label;
  return (
    <ChartFrame props={props}>
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            {props.series.map((s, index) => (
              <linearGradient key={s.key} id={`${gradientPrefix}-${index}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={seriesColor(index, props.series.length, props.accent)} stopOpacity={0.32} />
                <stop offset="95%" stopColor={seriesColor(index, props.series.length, props.accent)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          {axes(formatTick)}
          <Tooltip content={<SeriesTooltip series={props.series} locale={locale} />} />
          {props.series.map((s, index) => (
            <Area
              key={s.key}
              type="linear"
              dataKey={s.key}
              stroke={seriesColor(index, props.series.length, props.accent)}
              strokeWidth={2.5}
              fill={`url(#${gradientPrefix}-${index})`}
              dot={false}
              activeDot={{ r: 4, fill: seriesColor(index, props.series.length, props.accent), stroke: "var(--card)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
          {lastLabel !== undefined &&
            props.series.map((s, index) => (
              <ReferenceDot
                key={`last-${s.key}`}
                x={lastLabel}
                y={Number(points[points.length - 1][s.key] ?? 0)}
                r={4}
                fill={seriesColor(index, props.series.length, props.accent)}
                stroke="var(--card)"
                strokeWidth={2}
              />
            ))}
        </AreaChart>
    </ChartFrame>
  );
}
