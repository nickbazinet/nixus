// The ISO date is split into parts instead of handed to `new Date(iso)`: the string form is parsed
// as UTC, which renders the previous day for anyone west of Greenwich.
function localDateFromIso(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day));
}

export function formatServiceEntryShortDate(
  isoDate: string,
  locale: string
): string {
  return localDateFromIso(isoDate).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
  });
}

export function formatServiceEntryFullDate(
  isoDate: string,
  locale: string
): string {
  return localDateFromIso(isoDate).toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
