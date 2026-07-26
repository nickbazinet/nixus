import { useTranslation } from "react-i18next";
import { useLatestExpense } from "@/hooks/useExpenses";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";

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
  const formatCurrency = useFormatCurrency();
  const { data, isPending } = useLatestExpense();

  if (isPending) {
    return (
      <div
        className="mb-3 h-4 w-48 bg-muted animate-pulse rounded"
        data-testid="last-expense-line"
      />
    );
  }

  if (!data) {
    return (
      <p className="text-sm text-muted-foreground mb-3" data-testid="last-expense-line">
        {t("dashboard.noExpensesYet")}
      </p>
    );
  }

  const date = formatExpenseDate(data.date, i18n.language);
  const amount = formatCurrency(data.amount_cents);

  return (
    <p className="text-sm text-muted-foreground mb-3" data-testid="last-expense-line">
      {t("dashboard.lastExpense", { date, merchant: data.merchant, amount })}
    </p>
  );
}
