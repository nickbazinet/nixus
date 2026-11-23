import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CreditCard, Plus, Sparkles, TrendingUp, Wallet } from "lucide-react";
import { Button, Money, SlideOver } from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricTile } from "@/components/shared/MetricTile";
import { ExpenseList } from "@/components/expenses/ExpenseList";
import { AddExpenseForm } from "@/components/expenses/AddExpenseForm";
import { useBudgetGroups } from "@/hooks/useBudget";
import { useExpensesByMonth } from "@/hooks/useExpenses";
import { useIncomeEntriesByMonth, useIncomeTotal } from "@/hooks/useIncome";
import { usePeriod } from "@/hooks/usePeriod";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";

export const Route = createFileRoute("/spending/transactions")({
  component: TransactionsPage,
});

// Scoped to the global period rather than an arbitrary date range: `get_expenses` takes a year and a
// month, so a month is the widest window the data layer can answer honestly. Because the whole month
// arrives at once, the search and sort inside ExpenseList are complete rather than a partial view of
// a paged result — there is no "showing 9 of 31" to misrepresent.
function TransactionsPage() {
  const { t, i18n } = useTranslation();
  const maskProps = useMaskProps();
  const { year, month, label } = usePeriod();
  const { data: expenses } = useExpensesByMonth(year, month);
  const { data: incomeEntries } = useIncomeEntriesByMonth(year, month);
  const { data: incomeTotal } = useIncomeTotal(year, month);
  const { data: groups } = useBudgetGroups();
  const hasGroups = (groups ?? []).length > 0;
  const [showExpenseForm, setShowExpenseForm] = useState(false);

  const monthExpenses = expenses ?? [];
  const deposits = incomeEntries ?? [];
  const moneyInCents = incomeTotal?.total_cents ?? 0;
  const moneyOutCents = monthExpenses.reduce((sum, expense) => sum + expense.amount_cents, 0);
  const netCents = moneyInCents - moneyOutCents;

  return (
    <div>
      <PageHeader
        title={t("nav.transactions")}
        subtitle={t("transactions.subtitle", { period: label })}
      />

      <div className="flex flex-col gap-grid-gap">
        {!hasGroups && (
          <p className="text-caption text-ink-dim" data-testid="add-transactions-hint">
            {t("budget.createGroupFirst")}
          </p>
        )}

        <div className="grid gap-grid-gap md:grid-cols-3">
          <MetricTile
            icon={Wallet}
            label={t("transactions.v2.moneyIn")}
            value={<Money cents={moneyInCents} locale={i18n.language} {...maskProps} />}
            caption={t("transactions.v2.depositCount", { count: deposits.length })}
            data-testid="transactions-money-in"
          />
          <MetricTile
            icon={CreditCard}
            label={t("transactions.v2.moneyOut")}
            value={<Money cents={moneyOutCents} locale={i18n.language} {...maskProps} />}
            caption={t("transactions.v2.purchaseCount", { count: monthExpenses.length })}
            data-testid="transactions-money-out"
          />
          {/* The featured tile: everything else on the surface is a line item, and this is the one
            * figure that says whether the month came out ahead. */}
          <MetricTile
            featured
            icon={TrendingUp}
            label={t("transactions.v2.net")}
            value={
              <Money
                cents={netCents}
                locale={i18n.language}
                sign="always"
                className={netCents >= 0 ? "text-good-ink" : undefined}
                {...maskProps}
              />
            }
            caption={t("transactions.v2.netCaption")}
            data-testid="transactions-net"
          />
        </div>

        <ExpenseList
          expenses={monthExpenses}
          showCategory
          title={t("transactions.v2.cardTitle", { period: label })}
          scopeLabel={label}
          actions={
            <div className="flex items-center gap-2.5">
              {hasGroups && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowExpenseForm(true)}
                  data-testid="transactions-add-expense"
                >
                  <Plus aria-hidden="true" />
                  {t("common.add")}
                </Button>
              )}
              <Button size="sm" render={<Link to="/import" />}>
                <Sparkles aria-hidden="true" />
                {t("dashboard.importStatement")}
              </Button>
            </div>
          }
          onAddExpense={hasGroups ? () => setShowExpenseForm(true) : undefined}
        />
      </div>

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
