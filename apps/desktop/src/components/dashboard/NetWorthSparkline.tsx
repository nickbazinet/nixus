import { LineChart, Line, ResponsiveContainer } from "recharts";
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

// `Dec '25`, never `Dec 25` — the latter parses as a date.
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

  const first = snapshots[0].total_cents;
  const last = snapshots[snapshots.length - 1].total_cents;
  const trendingUp = last >= first;

  const data = snapshots.map((s) => ({ value: s.total_cents }));

  return (
    <div data-testid="net-worth-sparkline">
      <div className="h-12 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <Line
              type="monotone"
              dataKey="value"
              // A rising net worth is `good`, a falling one is `over`. Never brand: brand means
              // brand and action, not "on track". Read as CSS variables so both themes follow.
              stroke={trendingUp ? "var(--good)" : "var(--over)"}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
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
