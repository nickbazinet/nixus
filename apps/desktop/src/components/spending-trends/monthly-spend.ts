/**
 * The month-by-month spending view shared by Spending trends and Year summary. Both surfaces draw
 * the same series and quote the same average, so the "which months count" decision lives here once
 * rather than being re-derived beside each chart.
 */

import {
  currentMonthKey,
  formatMonthKey,
  formatMonthName,
  parseMonthKey,
} from "./insights-chart";
import type { MonthlySpendTotal } from "@/lib/types";

export interface MonthlySpendPoint {
  monthKey: string;
  /** `Dec '25` — the axis tick. */
  label: string;
  /** `December` — the sentence form. */
  monthName: string;
  cents: number;
  isCurrent: boolean;
}

export interface MonthlySpendView {
  points: MonthlySpendPoint[];
  /** Finished months only. The average is theirs; a part month would drag it below recognition. */
  completed: MonthlySpendPoint[];
  partial?: MonthlySpendPoint;
  avgCents: number;
  maxCents: number;
}

export function monthlySpendView(
  data: readonly MonthlySpendTotal[],
  locale: string,
): MonthlySpendView {
  const thisMonth = currentMonthKey();

  // A year window returns all twelve months, so months that have not happened yet arrive at zero.
  // Dropped rather than drawn — an empty November bar in August claims knowledge Nixus lacks.
  const points: MonthlySpendPoint[] = data
    .filter((row) => row.month <= thisMonth)
    .map((row) => ({
      monthKey: row.month,
      label: formatMonthKey(row.month, locale),
      monthName: formatMonthName(row.month, locale),
      cents: row.total_cents,
      isCurrent: row.month === thisMonth,
    }));

  const completed = points.filter((point) => !point.isCurrent);
  const partial = points.find((point) => point.isCurrent);
  const total = completed.reduce((sum, point) => sum + point.cents, 0);

  return {
    points,
    completed,
    partial,
    avgCents: completed.length > 0 ? Math.round(total / completed.length) : 0,
    maxCents: points.reduce((max, point) => Math.max(max, point.cents), 0),
  };
}

/** i18n key plus arguments for the "what this average is based on" sentence. */
export function averageBasisCaption(view: MonthlySpendView): {
  key: string;
  args: Record<string, string | number>;
} {
  const { completed, partial } = view;
  if (completed.length === 0) {
    return { key: "insights.avgNoCompletedMonths", args: {} };
  }

  const args = {
    months: completed.length,
    first: completed[0].monthName,
    last: completed[completed.length - 1].monthName,
  };

  return partial
    ? {
        key: "insights.avgCompletedMonthsPartial",
        args: { ...args, current: partial.monthName },
      }
    : { key: "insights.avgCompletedMonths", args };
}

export interface MonthWindowAverage {
  cents: number;
  months: number;
  first: string;
  last: string;
}

/**
 * Average of the last `months` FINISHED months — the "is this month unusual?" reference, which the
 * running month cannot be part of. Null when there are not that many finished months to average.
 */
export function trailingAverage(
  view: MonthlySpendView,
  months = 3,
): MonthWindowAverage | null {
  const window = view.completed.slice(-months);
  if (window.length < months) return null;

  const total = window.reduce((sum, point) => sum + point.cents, 0);
  return {
    cents: Math.round(total / window.length),
    months: window.length,
    first: window[0].monthName,
    last: window[window.length - 1].monthName,
  };
}

/** The finished month you spent the least in. Null when nothing has finished yet. */
export function lowestCompletedMonth(
  view: MonthlySpendView,
): MonthlySpendPoint | null {
  return view.completed.reduce<MonthlySpendPoint | null>(
    (best, point) =>
      best === null || point.cents < best.cents ? point : best,
    null,
  );
}

/**
 * Income per calendar month of one year, from the entries themselves. The yearly summary payload
 * carries only a year total, so a month-by-month "money in" line has to be summed here — and when
 * a year has no entries at all the caller must draw spending alone rather than a flat zero line.
 */
export function monthlyIncomeByMonthKey(
  entries: readonly { month: string; amount_cents: number }[],
  year: number,
): Map<string, number> {
  const prefix = `${year}-`;
  const byMonth = new Map<string, number>();

  for (const entry of entries) {
    if (!entry.month.startsWith(prefix) || !parseMonthKey(entry.month)) continue;
    byMonth.set(entry.month, (byMonth.get(entry.month) ?? 0) + entry.amount_cents);
  }

  return byMonth;
}
