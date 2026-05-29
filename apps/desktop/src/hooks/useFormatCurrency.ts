import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { formatCurrency as realFormatCurrency } from "@/lib/formatCurrency";

const MASKED = "$\u2022\u2022\u2022\u2022";
const MASKED_AXIS = "\u2022\u2022\u2022";

export function useFormatCurrency() {
  const { hidden } = useValuesHidden();
  const { i18n } = useTranslation();
  const locale = i18n.language;

  return useCallback(
    (cents: number) => (hidden ? MASKED : realFormatCurrency(cents, locale)),
    [hidden, locale],
  );
}

const axisLocaleMap: Record<string, string> = { en: "en-CA", fr: "fr-CA" };

export function useFormatAxisValue() {
  const { hidden } = useValuesHidden();
  const { i18n } = useTranslation();
  const locale = axisLocaleMap[i18n.language] ?? "en-CA";

  return useCallback(
    (cents: number) => {
      if (hidden) return MASKED_AXIS;
      const dollars = cents / 100;
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "CAD",
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(dollars);
    },
    [hidden, locale],
  );
}
