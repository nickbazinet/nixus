import { useState } from "react";
import { useForm } from "react-hook-form";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FolderPlus, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { usePeriod } from "@/hooks/usePeriod";
import { BudgetSummaryStrip } from "@/components/budget/BudgetSummaryStrip";
import { AddExpenseForm } from "@/components/expenses/AddExpenseForm";
import {
  Button,
  EmptyState,
  Input,
  Label,
  SlideOver,
} from "@nixus/shared";
import { BudgetGroupCard } from "@/components/budget/BudgetGroupCard";
import { useBudgetGroups, useCreateBudgetGroup, useBudgetStatus } from "@/hooks/useBudget";
import { useBudgetSummary } from "@/hooks/useDashboard";
import { useExpensesByMonth, groupExpensesByCategory } from "@/hooks/useExpenses";
import { useApplyRecurringExpenses } from "@/hooks/useRecurringExpenses";
import type { BudgetCategoryStatus } from "@/lib/types";

export const Route = createFileRoute("/spending/budget")({
  component: BudgetPage,
});

interface GroupFormData {
  name: string;
}

function BudgetPage() {
  const { t } = useTranslation();
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseCategoryId, setExpenseCategoryId] = useState<number | undefined>(undefined);
  const { data: groups = [] } = useBudgetGroups();
  const createGroup = useCreateBudgetGroup();

  const { year: selectedYear, month: selectedMonth } = usePeriod();
  const { data: statusList = [] } = useBudgetStatus(selectedYear, selectedMonth);
  const { data: monthExpenses = [] } = useExpensesByMonth(selectedYear, selectedMonth);
  const expensesByCategory = groupExpensesByCategory(monthExpenses);
  const budgetSummary = useBudgetSummary(selectedYear, selectedMonth);
  const summary = budgetSummary.data;
  const applyRecurring = useApplyRecurringExpenses();


  const openExpenseForm = (categoryId?: number) => {
    setExpenseCategoryId(categoryId);
    setShowExpenseForm(true);
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
    mode: "onBlur",
  });

  const onSubmitGroup = (data: GroupFormData) => {
    createGroup.mutate(data.name, {
      onSuccess: () => {
        toast.success(t("budget.groupCreated", { name: data.name }));
        reset();
        setShowGroupForm(false);
      },
      onError: () => {
        toast.error(t("budget.groupCreateFailed"));
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
              aria-disabled={applyRecurring.isPending}
              data-testid="apply-recurring-button"
            >
              {t("recurring.applyRecurring")}
            </Button>
            <Button
              onClick={() => setShowGroupForm(true)}
              data-testid="add-group-button"
              variant="outline"
            >
              <Plus aria-hidden="true" />
              {t("budget.addGroup")}
            </Button>
          </div>
        }
      />

      <BudgetSummaryStrip
        totalTargetCents={summary?.total_target_cents ?? 0}
        totalSpentCents={summary?.total_spent_cents ?? 0}
        remainingCents={summary?.remaining_cents ?? 0}
        onAddExpense={() => openExpenseForm()}
      />

      {groups.length === 0 && !showGroupForm && (
        <EmptyState
          icon={<FolderPlus />}
          title={t("budget.noGroupsTitle")}
          description={t("budget.noGroupsDescription")}
          action={
            <Button size="sm" onClick={() => setShowGroupForm(true)}>
              <Plus aria-hidden="true" />
              {t("budget.addGroup")}
            </Button>
          }
          data-testid="budget-empty-state"
        />
      )}

      <div className="space-y-4">
        {groups.map((group) => (
          <BudgetGroupCard
            key={group.id}
            group={group}
            statusByCategory={statusByCategory}
            expensesByCategory={expensesByCategory}
            onAddExpense={openExpenseForm}
          />
        ))}
      </div>

      <SlideOver
        open={showExpenseForm}
        onClose={() => setShowExpenseForm(false)}
        title={t("budget.addExpense")}
        description={t("expenses.addExpenseDescription")}
        data-testid="expense-slide-over"
      >
        <AddExpenseForm
          defaultCategoryId={expenseCategoryId}
          onClose={() => setShowExpenseForm(false)}
        />
      </SlideOver>

      <SlideOver
        open={showGroupForm}
        onClose={() => {
          reset();
          setShowGroupForm(false);
        }}
        title={t("budget.addBudgetGroup")}
        description={t("budget.addBudgetGroupDescription")}
        data-testid="group-slide-over"
      >
        <form
          onSubmit={handleSubmit(onSubmitGroup)}
          className="space-y-3"
          data-testid="add-group-form"
        >
          <div className="space-y-1.5">
            <Label htmlFor="group-name" required>
              {t("budget.groupName")}
            </Label>
            <Input
              id="group-name"
              placeholder={t("budget.groupNamePlaceholder")}
              autoFocus
              aria-required="true"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "group-name-error" : undefined}
              {...register("name", { required: t("budget.groupNameRequired") })}
            />
            {errors.name && (
              <p id="group-name-error" className="text-caption text-over">
                {errors.name.message}
              </p>
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
