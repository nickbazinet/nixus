import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { useTranslation } from "react-i18next";
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
import type { NetWorthSnapshotSummary } from "@/lib/types";

interface NetWorthSparklineProps {
  snapshots: NetWorthSnapshotSummary[];
}

/**
 * One id for every sparkline in the document. The gradient is identical wherever it is used, so a
 * per-instance id would only multiply identical `<defs>` — `url(#…)` resolving against the first
 * match is the correct outcome here, not an accident.
 */
const FILL_ID = "nx-sparkline-fill";

/** `Dec '25`, never `Dec 25` — the latter parses as a date. */
function formatSnapshotMonth(dateStr: string, locale: string): string {
  const [year, month] = dateStr.split("-").map(Number);
  const date = new Date(year, (month ?? 1) - 1);
  const monthName = date.toLocaleDateString(locale, { month: "short" });
  return `${monthName} '${String(year).slice(-2)}`;
}

export function NetWorthSparkline({ snapshots }: NetWorthSparklineProps) {
  const { t, i18n } = useTranslation();
  const { hidden } = useValuesHidden();

  if (snapshots.length < 2) return null;

  const data = snapshots.map((s) => ({ value: s.total_cents }));

  return (
    <div data-testid="net-worth-sparkline">
      {/* Violet line over a lavender wash that fades out, the charte's one line-chart recipe.
          Deliberately not good/over tinted: a trend is a shape, and painting it green or orange
          turns "here is the line" into a verdict the surrounding figures already deliver. */}
      <div className="h-11 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={FILL_ID} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-4)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--chart-4)" stopOpacity={0} />
              </linearGradient>
            </defs>
            {/* The scale is the series' own range, not zero-based: a sparkline exists to show the
                shape of the movement, and anchoring it to $0 flattens a year of growth into a
                straight line across the top of the box. */}
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--chart-4)"
              strokeWidth={2.5}
              fill={`url(#${FILL_ID})`}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Snapshots are discrete events, not a continuous series, so the table is the only place
          the real values are readable at all. */}
      <div className="sr-only">
        <Table>
          <caption>{t("dashboard.netWorthChartTableCaption")}</caption>
          <TableHeader>
            <TableRow>
              <TableHead>{t("dashboard.chartColDate")}</TableHead>
              <TableHead>{t("dashboard.chartColTotal")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshots.map((snapshot) => (
              <TableRow key={snapshot.snapshot_date}>
                <TableCell>
                  {formatSnapshotMonth(snapshot.snapshot_date, i18n.language)}
                </TableCell>
                <TableCell>
                  <Money
                    cents={snapshot.total_cents}
                    locale={i18n.language}
                    masked={hidden}
                    maskedLabel={t("common.amountHidden")}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
