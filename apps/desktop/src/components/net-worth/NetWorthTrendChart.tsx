import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, Money, Skeleton } from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import type { NetWorthSnapshot } from "@/lib/types";

interface NetWorthTrendChartProps {
  data: NetWorthSnapshot[];
  isLoading?: boolean;
}

const MASKED_TICK = "\u2022\u2022\u2022";

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
    return (
      <Card>
        <CardContent>
          <Skeleton rows={8} data-testid="chart-skeleton" />
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) return null;

  const firstSnapshot = data[0];

  // A chart with one point never renders as a trend line: a single datum joined to nothing is the
  // interpolation this surface is not allowed to imply.
  if (data.length === 1 && firstSnapshot) {
    return (
      <Card>
        <CardContent>
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
              style={{ backgroundColor: "var(--chart-1)" }}
            />
            <span className="text-caption text-ink-dim">
              {formatEventDate(firstSnapshot.snapshot_date, locale, true)}
            </span>
          </div>
          <p className="mt-3 text-caption text-ink-dim">
            {t("netWorth.trend.oneSnapshotOnly")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const chartData = data.map((snapshot) => ({
    label: formatEventDate(snapshot.snapshot_date, locale, spansYears),
    fullDate: formatEventDate(snapshot.snapshot_date, locale, true),
    value: snapshot.total_cents,
  }));

  return (
    <Card>
      <CardContent>
        <div className="h-64" data-testid="trend-chart">
          <ResponsiveContainer width="100%" height="100%">
            {/* `linear` rather than `monotone`: a smoothed curve invents movement between two
             * balance-change events. The dots are the events; the segments only join them. */}
            <LineChart
              data={chartData}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                stroke="var(--line)"
                strokeDasharray="3 3"
                vertical={false}
              />
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
              <Line
                type="linear"
                dataKey="value"
                stroke="var(--chart-1)"
                strokeWidth={2}
                dot={{
                  r: 3,
                  fill: "var(--chart-1)",
                  stroke: "var(--card)",
                  strokeWidth: 1,
                }}
                activeDot={{
                  r: 5,
                  fill: "var(--chart-1)",
                  stroke: "var(--card)",
                  strokeWidth: 2,
                }}
              />
            </LineChart>
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
                  <td>
                    {formatEventDate(snapshot.snapshot_date, locale, true)}
                  </td>
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
      </CardContent>
    </Card>
  );
}
