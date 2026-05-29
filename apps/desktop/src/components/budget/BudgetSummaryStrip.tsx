import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@nixus/shared";
import { MonthNavigator } from "./MonthNavigator";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";

interface BudgetSummaryStripProps {
  selectedYear: number;
  selectedMonth: number;
  onMonthChange: (year: number, month: number) => void;
  totalTargetCents: number;
  totalSpentCents: number;
  remainingCents: number;
  onAddExpense: () => void;
}

export function BudgetSummaryStrip({
  selectedYear,
  selectedMonth,
  onMonthChange,
  totalTargetCents,
  totalSpentCents,
  remainingCents,
  onAddExpense,
}: BudgetSummaryStripProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const utilization =
    totalTargetCents > 0 ? (totalSpentCents / totalTargetCents) * 100 : 0;

  return (
    <div
      className="rounded-xl ring-1 ring-foreground/10 bg-card p-4 mb-4"
      data-testid="budget-summary-strip"
    >
      <div className="flex items-center justify-between mb-3">
        <MonthNavigator
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          onChange={onMonthChange}
        />
        <div className="flex items-center gap-5 text-sm">
          <div>
            <span className="text-muted-foreground">{t("budget.budget")} </span>
            <span className="font-mono font-semibold">
              {formatCurrency(totalTargetCents)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">{t("budget.spent")} </span>
            <span className="font-mono font-semibold">
              {formatCurrency(totalSpentCents)}
            </span>
          </div>
          <div>
            <span className={remainingCents >= 0 ? "text-positive" : "text-destructive"}>
              {t("budget.remaining")}{" "}
            </span>
            <span
              className={`font-mono font-semibold ${
                remainingCents >= 0 ? "text-positive" : "text-destructive"
              }`}
            >
              {formatCurrency(remainingCents)}
            </span>
          </div>
          <Button size="sm" onClick={onAddExpense} data-testid="add-expense-button">
            <Plus className="size-4 mr-1" />
            {t("budget.addExpense")}
          </Button>
        </div>
      </div>
      {totalTargetCents > 0 && (
        <div
          className="h-2 w-full rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={totalSpentCents}
          aria-valuemin={0}
          aria-valuemax={totalTargetCents}
          data-testid="budget-overall-progress"
        >
          <div
            className={`h-full rounded-full transition-all ${
              utilization > 100
                ? "bg-rose-500"
                : utilization >= 75
                  ? "bg-amber-500"
                  : "bg-primary"
            }`}
            style={{ width: `${Math.min(utilization, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
