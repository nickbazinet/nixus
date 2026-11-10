import { format, parse } from "date-fns";
import type { TFunction } from "i18next";
import type { RecurrenceFrequency } from "@/lib/types";

export const RECURRENCE_FREQUENCIES = [
  "monthly",
  "weekly",
  "biweekly",
  "every_four_weeks",
] as const satisfies readonly RecurrenceFrequency[];

export const FREQUENCY_LABEL_KEYS: Record<RecurrenceFrequency, string> = {
  monthly: "recurring.frequencyMonthly",
  weekly: "recurring.frequencyWeekly",
  biweekly: "recurring.frequencyBiweekly",
  every_four_weeks: "recurring.frequencyEveryFourWeeks",
};

// Occurrences per year divided by 12: a weekly bill is not "four a month".
const OCCURRENCES_PER_YEAR: Record<RecurrenceFrequency, number> = {
  monthly: 12,
  weekly: 52,
  biweekly: 26,
  every_four_weeks: 13,
};

interface Schedule {
  frequency: RecurrenceFrequency;
  day_of_month: number;
  start_date: string | null;
}

export function todayIso(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/** What a template costs or brings in over an average month, in cents. */
export function monthlyEquivalentCents(template: Schedule & { amount_cents: number }): number {
  return Math.round((template.amount_cents * OCCURRENCES_PER_YEAR[template.frequency]) / 12);
}

/** "Day 15 of each month", "Every Thursday", "Every other Thursday", ... */
export function scheduleLabel(t: TFunction, schedule: Schedule, locale: string): string {
  if (schedule.frequency === "monthly" || !schedule.start_date) {
    return t("recurring.dayLabel", { day: schedule.day_of_month });
  }

  const start = parse(schedule.start_date, "yyyy-MM-dd", new Date());
  const weekday = isNaN(start.getTime())
    ? ""
    : new Intl.DateTimeFormat(locale, { weekday: "long" }).format(start);

  switch (schedule.frequency) {
    case "weekly":
      return t("recurring.everyWeekday", { weekday });
    case "biweekly":
      return t("recurring.everyOtherWeekday", { weekday });
    case "every_four_weeks":
      return t("recurring.everyFourWeeksOn", { weekday });
  }
}
