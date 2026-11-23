/**
 * How much of the selected month is left. Only the month in progress has a "left", so a past or
 * future period answers `null` rather than a figure the calendar cannot support — pacing a closed
 * month by the days remaining in it would be arithmetic about nothing.
 */
export function daysLeftInMonth(
  year: number,
  month: number,
  now: Date = new Date(),
): number | null {
  if (now.getFullYear() !== year || now.getMonth() + 1 !== month) return null;
  // Day 0 of the next month is the last day of this one.
  const daysInMonth = new Date(year, month, 0).getDate();
  return Math.max(daysInMonth - now.getDate(), 0);
}

/** The month on its own ("November"), for the pacing sentence. */
export function monthName(year: number, month: number, locale: string): string {
  return new Date(year, month - 1).toLocaleDateString(locale, { month: "long" });
}
