import { useTranslation } from "react-i18next";
import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Money } from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import {
  SEGMENT_DIVIDER,
  insightsLocale,
  rampColor,
} from "@/components/spending-trends/insights-chart";
import { ChartTableEquivalent } from "./ChartTableEquivalent";
import type { SeriesChartProps } from "./SeriesCharts";

interface Slice {
  key: string;
  label: string;
  cents: number;
  fill: string;
}

/**
 * Shares of a whole: one slice per row, sized by the first series. Only positive values can be a
 * share, so a zero or negative row (an overdrawn account) is left to the table equivalent rather
 * than drawn as a slice it cannot be.
 */
export function PieShareChart(props: SeriesChartProps) {
  const { i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);

  // Rank-ordered fill, largest first, so adjacent slices alternate luminance (see CHART_RAMP).
  const slices: Slice[] = props.rows
    .filter((row) => (row.values[0] ?? 0) > 0)
    .sort((a, b) => (b.values[0] ?? 0) - (a.values[0] ?? 0))
    .map((row, rank) => ({
      key: row.key,
      label: row.label,
      cents: row.values[0] ?? 0,
      fill: rampColor(rank, props.accent),
    }));
  const total = slices.reduce((sum, slice) => sum + slice.cents, 0);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="h-48 sm:w-1/2" aria-hidden="true" data-testid={props["data-testid"]}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="cents"
                nameKey="label"
                innerRadius="55%"
                outerRadius="90%"
                stroke={SEGMENT_DIVIDER}
                strokeWidth={1}
                isAnimationActive={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  const slice = payload?.[0]?.payload as Slice | undefined;
                  if (!active || !slice) return null;
                  return (
                    <div className="rounded-lg border border-line bg-card px-3 py-2 text-caption text-ink shadow-float">
                      <p className="text-label text-ink">{slice.label}</p>
                      <Money cents={slice.cents} locale={locale} {...maskProps} />
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="space-y-1 text-caption sm:w-1/2" aria-hidden="true">
          {slices.map((slice) => (
            <li key={slice.key} className="flex items-center gap-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.fill }} />
              <span className="min-w-0 flex-1 truncate text-ink-dim">{slice.label}</span>
              <span className="money text-ink">
                {total > 0 ? `${Math.round((slice.cents / total) * 100)}%` : "—"}
              </span>
            </li>
          ))}
        </ul>
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
