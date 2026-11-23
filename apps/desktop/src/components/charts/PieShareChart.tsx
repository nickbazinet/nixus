import { useTranslation } from "react-i18next";
import { Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Money } from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { LegendDot } from "@/components/charts/DonutBreakdown";
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
 * Shares of a whole, as the charte's donut: the total sits in the hole, the slices ring it, and
 * the legend under it says what each one is worth. Only positive values can be a share, so a zero
 * or negative row (an overdrawn account) is left to the table equivalent rather than drawn as a
 * slice it cannot be.
 */
export function PieShareChart(props: SeriesChartProps) {
  const { t, i18n } = useTranslation();
  const { hidden, maskProps } = useValuesHidden();
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

  // Whole dollars in the centre: the hole is 100px across and the exact cents are a row below.
  const centre = hidden
    ? t("common.amountHidden")
    : new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "CAD",
        currencyDisplay: "narrowSymbol",
        maximumFractionDigits: 0,
      }).format(total / 100);

  return (
    <div>
      <div className="flex flex-col gap-6">
        <div
          className="relative mx-auto aspect-square w-full max-w-[220px]"
          aria-hidden="true"
          data-testid={props["data-testid"]}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="cents"
                nameKey="label"
                innerRadius="68%"
                outerRadius="100%"
                startAngle={90}
                endAngle={-270}
                stroke={SEGMENT_DIVIDER}
                strokeWidth={3}
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
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="money font-display text-h1 font-bold text-ink">{centre}</span>
            <span className="text-caption text-ink-dim">
              {props.series[0]?.label ?? props.dimensionLabel}
            </span>
          </div>
        </div>

        <ul className="space-y-2.5" aria-hidden="true">
          {slices.map((slice) => (
            <li key={slice.key} className="flex items-center gap-3 text-body">
              <LegendDot color={slice.fill} />
              <span className="min-w-0 flex-1 truncate text-ink">{slice.label}</span>
              <Money
                cents={slice.cents}
                locale={locale}
                className="font-bold text-ink"
                {...maskProps}
              />
              <span className="money w-10 text-right text-caption text-ink-dim">
                {total > 0 ? `${Math.round((slice.cents / total) * 100)}%` : "\u2014"}
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
