import { useTranslation } from "react-i18next";
import { Skeleton, formatMoney } from "@nixus/shared";
import { useLatestExpense } from "@/hooks/useExpenses";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";

function formatExpenseDate(dateStr: string, locale: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function LastExpenseLine() {
  const { t, i18n } = useTranslation();
  const { hidden } = useValuesHidden();
  const { data, isPending } = useLatestExpense();

  if (isPending) {
    return (
      <Skeleton rows={1} className="mb-3 max-w-64" data-testid="last-expense-line" />
    );
  }

  if (!data) {
    return (
      <p className="mb-3 text-caption text-ink-dim" data-testid="last-expense-line">
        {t("dashboard.noExpensesYet")}
      </p>
    );
  }

  const date = formatExpenseDate(data.date, i18n.language);
  // The figure is interpolated into a sentence, so the mask is applied to the string and the
  // `money` utility gives the whole line tabular figures.
  const amount = hidden
    ? t("common.amountHidden")
    : formatMoney({ cents: data.amount_cents, locale: i18n.language });

  return (
    <p className="money mb-3 text-caption text-ink-dim" data-testid="last-expense-line">
      {t("dashboard.lastExpense", { date, merchant: data.merchant, amount })}
    </p>
  );
}
