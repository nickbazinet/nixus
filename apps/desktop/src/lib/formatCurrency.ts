const localeMap: Record<string, string> = {
  en: "en-CA",
  fr: "fr-CA",
};

/**
 * Format integer cents to a display string like "$1,234.56"
 */
export function formatCurrency(cents: number, locale = "en"): string {
  const dollars = cents / 100;
  return dollars.toLocaleString(localeMap[locale] ?? "en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

