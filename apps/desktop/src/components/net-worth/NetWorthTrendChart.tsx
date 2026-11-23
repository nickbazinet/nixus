import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Money, Skeleton } from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import type { NetWorthSnapshot } from "@/lib/types";

interface NetWorthTrendChartProps {
  data: NetWorthSnapshot[];
  isLoading?: boolean;
}

const MASKED_TICK = "\u2022\u2022\u2022";

/** The violet the charte paints a trend line in, with a lavender wash fading under it. */
const LINE_COLOR = "var(--chart-4)";
const GRADIENT_ID = "nx-net-worth-area";

/**
 * Rounds a padded axis bound out to a readable step, so the ticks read `$450K / $480K / …` rather
 * than landing on whatever the first and last snapshot happen to be.
 */
function niceBound(value: number, direction: "floor" | "ceil"): number {
  if (value === 0) return 0;
  const step = 10 ** Math.max(0, Math.floor(Math.log10(Math.abs(value))) - 1);
  return direction === "floor"
    ? Math.floor(value / step) * step
    : Math.ceil(value / step) * step;
}

function parseSnapshotDate(dateStr: string): Date | null {
  const parsed = new Date(`${dateStr}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Snapshots are discrete events, so ticks are day-granular and never a bare month plus year — `Dec
 * 25` reads as a date. When the series crosses a calendar boundary the year is added as `'25`, so
 * one format still covers every tick on the axis.
 */
function formatEventDate(
  dateStr: string,
  locale: string,
  withYear: boolean
): string {
  const parsed = parseSnapshotDate(dateStr);
  if (!parsed) return dateStr;
  const dayAndMonth = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
  }).format(parsed);
  if (!withYear) return dayAndMonth;
  return `${dayAndMonth} '${String(parsed.getFullYear()).slice(-2)}`;
}

export function NetWorthTrendChart({
  data,
  isLoading,
}: NetWorthTrendChartProps) {
  const { t, i18n } = useTranslation();
  const { hidden, maskProps } = useValuesHidden();
  const locale = i18n.language;

  const spansYears = useMemo(() => {
    const years = new Set(
      data
        .map(
          (snapshot) => parseSnapshotDate(snapshot.snapshot_date)?.getFullYear()
        )
        .filter((year): year is number => year !== undefined)
    );
    return years.size > 1;
  }, [data]);

  // One format for the whole axis, rounded — never a mix of `$0.0 / $850.0 / $1.7K`. Evenly spaced
  // ticks over a single domain land on one unit, and pinning both fraction-digit bounds to zero is
  // what stops recharts asking for a decimal on some ticks and not others.
  const formatAxisTick = useMemo(() => {
    const formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: "CAD",
      currencyDisplay: "narrowSymbol",
      notation: "compact",
      compactDisplay: "short",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    return (cents: number) =>
      hidden ? MASKED_TICK : formatter.format(cents / 100);
  }, [locale, hidden]);

  if (isLoading) {
    return <Skeleton rows={8} data-testid="chart-skeleton" />;
  }

  if (data.length === 0) return null;

  const firstSnapshot = data[0];

  // A chart with one point never renders as a trend line: a single datum joined to nothing is the
  // interpolation this surface is not allowed to imply.
  if (data.length === 1 && firstSnapshot) {
    return (
      <div>
        <div
          className="flex h-64 flex-col items-center justify-center gap-2"
          data-testid="trend-chart"
        >
          <span className="money text-stat text-ink">
            <Money
              cents={firstSnapshot.total_cents}
              locale={locale}
              {...maskProps}
            />
          </span>
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full"
            style={{ backgroundColor: LINE_COLOR }}
          />
          <span className="text-caption text-ink-dim">
            {formatEventDate(firstSnapshot.snapshot_date, locale, true)}
          </span>
        </div>
        <p className="mt-3 text-caption text-ink-dim">
          {t("netWorth.trend.oneSnapshotOnly")}
        </p>
      </div>
    );
  }

  const chartData = data.map((snapshot) => ({
    label: formatEventDate(snapshot.snapshot_date, locale, spansYears),
    fullDate: formatEventDate(snapshot.snapshot_date, locale, true),
    value: snapshot.total_cents,
  }));

  return (
    <div>
      <div className="h-72" data-testid="trend-chart">
        <ResponsiveContainer width="100%" height="100%">
          {/* `linear` rather than `monotone`: a smoothed curve invents movement between two
           * balance-change events. The dots are the events; the segments only join them. */}
          <AreaChart
            data={chartData}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <defs>
              <linearGradient id={GRADIENT_ID} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={LINE_COLOR} stopOpacity={0.28} />
                <stop offset="100%" stopColor={LINE_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ className: "text-caption fill-ink-faint" }}
              tickLine={false}
              axisLine={false}
              minTickGap={16}
              interval="preserveStartEnd"
            />
            <YAxis
              tickFormatter={formatAxisTick}
              tick={{ className: "text-caption fill-ink-faint" }}
              tickLine={false}
              axisLine={false}
              width={68}
              // Net worth never starts at zero in practice, and a zero baseline flattens a year of
              // real movement into a straight line. The window is padded either side of the data so
              // the shape is readable without the first point sitting on the axis.
              domain={[
                (min: number) => niceBound(min - Math.abs(min) * 0.05, "floor"),
                (max: number) => niceBound(max + Math.abs(max) * 0.03, "ceil"),
              ]}
            />
            <Tooltip
              formatter={(value) => [
                formatAxisTick(value as number),
                t("netWorth.trend.seriesLabel"),
              ]}
              labelFormatter={(_label, payload) =>
                payload?.[0]?.payload?.fullDate ?? ""
              }
              contentStyle={{
                background: "var(--card)",
                border: "1px solid var(--line-strong)",
                borderRadius: "var(--radius-lg)",
                color: "var(--ink)",
              }}
            />
            <Area
              type="linear"
              dataKey="value"
              stroke={LINE_COLOR}
              strokeWidth={2.5}
              fill={`url(#${GRADIENT_ID})`}
              // Only the latest snapshot carries a dot: it is the figure the hero above states,
              // and a dot on every event turns the line into a dotted ruler.
              dot={(props) => {
                const { cx, cy, index, key } = props as unknown as {
                  cx: number;
                  cy: number;
                  index: number;
                  key: string;
                };
                if (index !== chartData.length - 1) return <g key={key} />;
                return (
                  <circle
                    key={key}
                    cx={cx}
                    cy={cy}
                    r={4.5}
                    fill={LINE_COLOR}
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                );
              }}
              activeDot={{
                r: 5,
                fill: LINE_COLOR,
                stroke: "var(--card)",
                strokeWidth: 2,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <p className="mt-3 text-caption text-ink-dim">
        {t("netWorth.trend.eventPointsNote")}
      </p>

      {/* The chart's table equivalent — recharts renders an SVG a screen reader cannot read. */}
      <div className="sr-only">
        <table>
          <caption>{t("netWorth.trend.tableCaption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("netWorth.trend.colDate")}</th>
              <th scope="col">{t("netWorth.trend.colTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((snapshot) => (
              <tr key={snapshot.id}>
                <td>{formatEventDate(snapshot.snapshot_date, locale, true)}</td>
                <td>
                  <Money
                    cents={snapshot.total_cents}
                    locale={locale}
                    {...maskProps}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
