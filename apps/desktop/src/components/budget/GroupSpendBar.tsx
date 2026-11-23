import { useTranslation } from "react-i18next";
import { Money } from "@nixus/shared";
import { LegendDot } from "@/components/charts/DonutBreakdown";
import {
  SEGMENT_DIVIDER,
  insightsLocale,
  rampColor,
} from "@/components/spending-trends/insights-chart";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";

export interface GroupSpendItem {
  key: number;
  label: string;
  cents: number;
  /** The group's spend rank across the budget — the same rank its card's bar is coloured by. */
  rank: number;
}

interface GroupSpendBarProps {
  items: GroupSpendItem[];
  /** Accessible name for the legend, e.g. "Spending by group, November 2026". */
  listLabel: string;
  "data-testid"?: string;
}

/**
 * "Where it went, by group": one stacked bar of the month's spending split by the user's own budget
 * groups, with a two-column legend beneath. Each segment wears its group's rank colour, so the bar
 * and the group cards below it agree. The legend is real text; the bar itself is decorative.
 */
export function GroupSpendBar({ items, listLabel, "data-testid": testId }: GroupSpendBarProps) {
  const { i18n } = useTranslation();
  const maskProps = useMaskProps();
  const locale = insightsLocale(i18n.language);

  const segments = [...items].sort((a, b) => b.cents - a.cents);
  const total = segments.reduce((sum, item) => sum + item.cents, 0);

  return (
    <div className="flex flex-col gap-5" data-testid={testId}>
      <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-track" aria-hidden="true">
        {segments.map((item, index) => (
          <span
            key={item.key}
            data-chart-segment=""
            className="h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${total > 0 ? (item.cents / total) * 100 : 0}%`,
              backgroundColor: rampColor(item.rank),
              // The card-coloured gap between segments: what keeps two neighbouring ramp steps
              // distinguishable when their hues sit close.
              borderLeft: index > 0 ? `2px solid ${SEGMENT_DIVIDER}` : undefined,
            }}
          />
        ))}
      </div>

      <ul className="grid gap-x-10 gap-y-2.5 sm:grid-cols-2" aria-label={listLabel}>
        {segments.map((item) => (
          <li key={item.key} className="flex items-center gap-3 text-body">
            <LegendDot color={rampColor(item.rank)} />
            <span className="min-w-0 flex-1 truncate text-ink">{item.label}</span>
            <Money cents={item.cents} locale={locale} className="font-bold text-ink" {...maskProps} />
          </li>
        ))}
      </ul>
    </div>
  );
}
