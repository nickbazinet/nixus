import { useState } from "react";
import { useForm } from "react-hook-form";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { BudgetSummaryStrip } from "@/components/budget/BudgetSummaryStrip";
import { AddExpenseForm } from "@/components/expenses/AddExpenseForm";
import { Button } from "@nixus/shared";
import { Input } from "@nixus/shared";
import { Label } from "@nixus/shared";
import { SlideOver } from "@nixus/shared";
import { BudgetGroupCard } from "@/components/budget/BudgetGroupCard";
import { useBudgetGroups, useCreateBudgetGroup, useBudgetStatus } from "@/hooks/useBudget";
import { useBudgetSummary } from "@/hooks/useDashboard";
import { useExpensesByMonth, groupExpensesByCategory } from "@/hooks/useExpenses";
import { useApplyRecurringExpenses } from "@/hooks/useRecurringExpenses";
import type { BudgetCategoryStatus } from "@/lib/types";

export const Route = createFileRoute("/budget")({
  component: BudgetPage,
});

interface GroupFormData {
  name: string;
}

function BudgetPage() {
  const { t } = useTranslation();
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const { data: groups = [] } = useBudgetGroups();
  const createGroup = useCreateBudgetGroup();

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const { data: statusList = [] } = useBudgetStatus(selectedYear, selectedMonth);
  const { data: monthExpenses = [] } = useExpensesByMonth(selectedYear, selectedMonth);
  const expensesByCategory = groupExpensesByCategory(monthExpenses);
  const budgetSummary = useBudgetSummary(selectedYear, selectedMonth);
  const summary = budgetSummary.data;
  const applyRecurring = useApplyRecurringExpenses();

  const handleMonthChange = (year: number, month: number) => {
    setSelectedYear(year);
    setSelectedMonth(month);
  };

  const statusByCategory = new Map<number, BudgetCategoryStatus>();
  for (const s of statusList) {
    statusByCategory.set(s.id, s);
  }

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<GroupFormData>({
    defaultValues: { name: "" },
    mode: "onSubmit",
  });

  const onSubmitGroup = (data: GroupFormData) => {
    createGroup.mutate(data.name, {
      onSuccess: () => {
        toast.success(`Group "${data.name}" created`);
        reset();
        setShowGroupForm(false);
      },
      onError: () => {
        toast.error("Failed to create group");
      },
    });
  };

  return (
    <div>
      <PageHeader
        title={t("nav.budget")}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                applyRecurring.mutate(
                  { year: selectedYear, month: selectedMonth },
                  {
                    onSuccess: (created) => {
                      if (created.length > 0) {
                        toast.success(
                          t("recurring.appliedExpenses", { count: created.length })
                        );
                      } else {
                        toast.success(t("recurring.allAlreadyApplied"));
                      }
                    },
                    onError: () => {
                      toast.error(t("recurring.applyFailed"));
                    },
                  }
                )
              }
              disabled={applyRecurring.isPending}
              data-testid="apply-recurring-button"
            >
              {t("recurring.applyRecurring")}
            </Button>
            <Button
              onClick={() => setShowGroupForm(true)}
              data-testid="add-group-button"
              variant="outline"
            >
              <Plus className="size-4 mr-1" />
              {t("budget.addGroup")}
            </Button>
          </div>
        }
      />

      <BudgetSummaryStrip
        selectedYear={selectedYear}
        selectedMonth={selectedMonth}
        onMonthChange={handleMonthChange}
        totalTargetCents={summary?.total_target_cents ?? 0}
        totalSpentCents={summary?.total_spent_cents ?? 0}
        remainingCents={summary?.remaining_cents ?? 0}
        onAddExpense={() => setShowExpenseForm(true)}
      />

      {groups.length === 0 && !showGroupForm && (
        <p className="text-muted-foreground">
          {t("budget.noGroups")}
        </p>
      )}

      <div className="space-y-4">
        {groups.map((group) => (
          <BudgetGroupCard key={group.id} group={group} statusByCategory={statusByCategory} expensesByCategory={expensesByCategory} />
        ))}
      </div>

      {/* Add Expense Slide-Over */}
      <SlideOver
        open={showExpenseForm}
        onClose={() => setShowExpenseForm(false)}
        title={t("budget.addExpense")}
        data-testid="expense-slide-over"
      >
        <AddExpenseForm onClose={() => setShowExpenseForm(false)} />
      </SlideOver>

      {/* Add Group Slide-Over */}
      <SlideOver
        open={showGroupForm}
        onClose={() => {
          reset();
          setShowGroupForm(false);
        }}
        title={t("budget.addBudgetGroup")}
        data-testid="group-slide-over"
      >
        <form
          onSubmit={handleSubmit(onSubmitGroup)}
          className="space-y-3"
          data-testid="add-group-form"
        >
          <div className="space-y-1.5">
            <Label htmlFor="group-name">{t("budget.groupName")}</Label>
            <Input
              id="group-name"
              placeholder={t("budget.groupNamePlaceholder")}
              autoFocus
              aria-invalid={!!errors.name}
              {...register("name", { required: t("budget.groupNameRequired") })}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name.message}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              {t("budget.saveGroup")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                reset();
                setShowGroupForm(false);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      </SlideOver>
    </div>
  );
}
