const localeMap: Record<string, string> = {
  en: "en-CA",
  fr: "fr-CA",
};

/** The regional locale every amount is formatted in, so "$" always means CAD and USD reads "US$". */
export function currencyLocale(language: string): string {
  return localeMap[language] ?? "en-CA";
}

/**
 * Format integer cents to a display string like "$1,234.56"
 */
export function formatCurrency(cents: number, locale = "en"): string {
  const dollars = cents / 100;
  return dollars.toLocaleString(currencyLocale(locale), {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

