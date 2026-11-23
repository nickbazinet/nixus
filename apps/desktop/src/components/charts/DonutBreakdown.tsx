import { useTranslation } from "react-i18next";
import { Pie, PieChart, ResponsiveContainer } from "recharts";
import { Money } from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { cn } from "@/lib/utils";
import {
  SEGMENT_DIVIDER,
  insightsLocale,
  rampColor,
} from "@/components/spending-trends/insights-chart";

export interface DonutItem {
  key: string | number;
  label: string;
  cents: number;
}

interface DonutBreakdownProps {
  items: DonutItem[];
  /** Word under the centre total: "spent", "in", "to place". */
  centerLabel: string;
  /** Accessible name for the list of shares, e.g. "Spending by category, November 2026". */
  listLabel: string;
  /** Show each slice's share of the whole beside its amount. */
  showPercent?: boolean;
  /** Rows past this are folded into the last legend line's total — the chart keeps every slice. */
  maxLegendItems?: number;
  className?: string;
  "data-testid"?: string;
}

/** A square legend marker, the charte's chart key. */
export function LegendDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2.5 shrink-0 rounded-[3px]", className)}
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * "Where it went": a donut of shares with the whole in its centre and a legend of label, amount
 * and share beneath. Slices are coloured by RANK (largest first) with a card-coloured gap between
 * them, per the chart ramp rules. The legend is real text, so the donut itself is decorative.
 */
export function DonutBreakdown({
  items,
  centerLabel,
  listLabel,
  showPercent = true,
  maxLegendItems,
  className,
  "data-testid": testId,
}: DonutBreakdownProps) {
  const { i18n, t } = useTranslation();
  const { hidden, maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);

  const slices = items
    .filter((item) => item.cents > 0)
    .sort((a, b) => b.cents - a.cents)
    .map((item, rank) => ({ ...item, fill: rampColor(rank) }));
  const total = slices.reduce((sum, slice) => sum + slice.cents, 0);
  const legend =
    maxLegendItems !== undefined && slices.length > maxLegendItems
      ? slices.slice(0, maxLegendItems)
      : slices;

  const centre = hidden
    ? t("common.amountHidden")
    : new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "CAD",
        currencyDisplay: "narrowSymbol",
        maximumFractionDigits: 0,
      }).format(total / 100);

  return (
    <div className={cn("flex flex-col gap-6", className)} data-testid={testId}>
      <div className="relative mx-auto aspect-square w-full max-w-[220px]" aria-hidden="true">
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
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="money font-display text-h1 font-bold text-ink">{centre}</span>
          <span className="text-caption text-ink-dim">{centerLabel}</span>
        </div>
      </div>

      <ul className="space-y-2.5" aria-label={listLabel}>
        {legend.map((slice) => (
          <li key={slice.key} className="flex items-center gap-3 text-body">
            <LegendDot color={slice.fill} />
            <span className="min-w-0 flex-1 truncate text-ink">{slice.label}</span>
            <Money
              cents={slice.cents}
              locale={locale}
              className="font-bold text-ink"
              {...maskProps}
            />
            {showPercent && (
              <span className="money w-10 text-right text-caption text-ink-dim">
                {total > 0 ? `${Math.round((slice.cents / total) * 100)}%` : "—"}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
