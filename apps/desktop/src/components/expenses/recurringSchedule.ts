import { addDays, getDaysInMonth, isValid, parse, startOfDay } from "date-fns";
import type { RecurrenceFrequency } from "@/lib/types";

/** Days between occurrences for the week-based cadences. Monthly has none — it walks the calendar. */
const INTERVAL_DAYS: Partial<Record<RecurrenceFrequency, number>> = {
  weekly: 7,
  biweekly: 14,
  every_four_weeks: 28,
};

interface Schedule {
  frequency: RecurrenceFrequency;
  day_of_month: number;
  start_date: string | null;
}

function parseIso(date: string): Date | null {
  const parsed = parse(date, "yyyy-MM-dd", new Date());
  return isValid(parsed) ? startOfDay(parsed) : null;
}

/** `day_of_month` clamped to a short month, the way the backend caps day 31 in February. */
function monthlyDate(dayOfMonth: number, year: number, monthIndex: number): Date {
  const first = new Date(year, monthIndex, 1);
  return new Date(year, monthIndex, Math.min(dayOfMonth, getDaysInMonth(first)));
}

/**
 * The next date a schedule falls due, on or after `from`. Mirrors the Rust recurrence rules a
 * template is actually applied by: a monthly schedule walks the calendar with `day_of_month`
 * capped to the month's length, and a week-based one steps from `start_date` — which is why a
 * week-based template with no start date has no answerable next date rather than a guessed one.
 */
export function nextOccurrence(schedule: Schedule, from: Date = new Date()): Date | null {
  const floor = startOfDay(from);
  const start = schedule.start_date ? parseIso(schedule.start_date) : null;
  const interval = INTERVAL_DAYS[schedule.frequency];

  if (interval === undefined) {
    const earliest = start && start > floor ? start : floor;
    const candidate = monthlyDate(
      schedule.day_of_month,
      earliest.getFullYear(),
      earliest.getMonth()
    );
    if (candidate >= earliest) return candidate;
    return monthlyDate(
      schedule.day_of_month,
      earliest.getFullYear(),
      earliest.getMonth() + 1
    );
  }

  if (!start) return null;
  if (start >= floor) return start;
  const steps = Math.ceil((floor.getTime() - start.getTime()) / (interval * 86_400_000));
  return addDays(start, steps * interval);
}

/** `Dec 3` — the "next" column and the upcoming list. */
export function formatNextDate(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

/** `December 4` — the sentence form, for the next-expected callout. */
export function formatLongDate(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, { month: "long", day: "numeric" });
}
