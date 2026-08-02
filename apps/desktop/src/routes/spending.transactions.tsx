import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { SlideOver } from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { ExpenseList } from "@/components/expenses/ExpenseList";
import { AddExpenseForm } from "@/components/expenses/AddExpenseForm";
import { useExpensesByMonth } from "@/hooks/useExpenses";
import { usePeriod } from "@/hooks/usePeriod";

export const Route = createFileRoute("/spending/transactions")({
  component: TransactionsPage,
});

// Scoped to the global period rather than an arbitrary date range: `get_expenses` takes a year and a
// month, so a month is the widest window the data layer can answer honestly. Because the whole month
// arrives at once, the search and sort inside ExpenseList are complete rather than a partial view of
// a paged result — there is no "showing 9 of 31" to misrepresent.
function TransactionsPage() {
  const { t } = useTranslation();
  const { year, month, label } = usePeriod();
  const { data: expenses = [] } = useExpensesByMonth(year, month);
  const [showExpenseForm, setShowExpenseForm] = useState(false);

  return (
    <div>
      <PageHeader
        title={t("nav.transactions")}
        subtitle={t("transactions.subtitle", { period: label })}
      />

      <ExpenseList
        expenses={expenses}
        showCategory
        onAddExpense={() => setShowExpenseForm(true)}
      />

      <SlideOver
        open={showExpenseForm}
        onClose={() => setShowExpenseForm(false)}
        title={t("budget.addExpense")}
        description={t("expenses.addExpenseDescription")}
        data-testid="expense-slide-over"
      >
        <AddExpenseForm onClose={() => setShowExpenseForm(false)} />
      </SlideOver>
    </div>
  );
}
