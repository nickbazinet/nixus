import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useForm, Controller } from "react-hook-form";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectGroupLabel,
} from "@nixus/shared";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@nixus/shared";
import { Input } from "@nixus/shared";
import { Label } from "@nixus/shared";
import { DatePicker } from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nixus/shared";
import { useUpdateExpense, useDeleteExpense, useAllBudgetCategories } from "@/hooks/useExpenses";
import { useBudgetGroups } from "@/hooks/useBudget";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import type { Expense } from "@/lib/types";

interface ExpenseListProps {
  expenses: Expense[];
}

interface EditFormData {
  merchant: string;
  amount_cents: number;
  budget_category_id: string;
  date: string;
}

function formatShortDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  const date = new Date(Number(isoDate.slice(0, 4)), Number(month) - 1, Number(day));
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function EditExpenseForm({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: categories = [] } = useAllBudgetCategories();
  const { data: groups = [] } = useBudgetGroups();
  const updateExpense = useUpdateExpense();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<EditFormData>({
    defaultValues: {
      merchant: expense.merchant,
      amount_cents: expense.amount_cents,
      budget_category_id: String(expense.budget_category_id),
      date: expense.date,
    },
    mode: "onSubmit",
  });

  const onSubmit = (data: EditFormData) => {
    updateExpense.mutate(
      {
        id: expense.id,
        merchant: data.merchant,
        amount_cents: data.amount_cents,
        budget_category_id: Number(data.budget_category_id),
        date: data.date,
      },
      {
        onSuccess: () => {
          toast.success("Expense updated");
          onClose();
        },
        onError: () => {
          toast.error("Failed to update expense");
        },
      }
    );
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-3 p-3 rounded-lg ring-1 ring-foreground/10 bg-card"
      data-testid="edit-expense-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="edit-merchant">{t("expenses.merchant")}</Label>
        <Input
          id="edit-merchant"
          autoFocus
          aria-invalid={!!errors.merchant}
          {...register("merchant", { required: t("expenses.merchantRequired") })}
        />
        {errors.merchant && (
          <p className="text-xs text-destructive">{errors.merchant.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-amount">{t("common.amount")}</Label>
        <Controller
          name="amount_cents"
          control={control}
          rules={{ validate: (v) => v > 0 || t("expenses.amountRequired") }}
          render={({ field }) => (
            <MoneyInput
              id="edit-amount"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              aria-invalid={!!errors.amount_cents}
            />
          )}
        />
        {errors.amount_cents && (
          <p className="text-xs text-destructive">{errors.amount_cents.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-category">{t("common.category")}</Label>
        <Controller
          name="budget_category_id"
          control={control}
          rules={{ required: t("expenses.categoryRequired") }}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} items={categories.map((cat) => ({ value: String(cat.id), label: cat.name }))}>
              <SelectTrigger id="edit-category" aria-invalid={!!errors.budget_category_id}>
                <SelectValue placeholder={t("expenses.selectCategory")} />
              </SelectTrigger>
              <SelectContent>
                {groups.map((group) => {
                  const groupCats = categories.filter(
                    (c) => c.group_id === group.id
                  );
                  if (groupCats.length === 0) return null;
                  return (
                    <SelectGroup key={group.id}>
                      <SelectGroupLabel>{group.name}</SelectGroupLabel>
                      {groupCats.map((cat) => (
                        <SelectItem key={cat.id} value={String(cat.id)}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  );
                })}
              </SelectContent>
            </Select>
          )}
        />
        {errors.budget_category_id && (
          <p className="text-xs text-destructive">{errors.budget_category_id.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-date">{t("common.date")}</Label>
        <Controller
          name="date"
          control={control}
          rules={{ required: t("expenses.dateRequired") }}
          render={({ field }) => (
            <DatePicker
              id="edit-date"
              value={field.value}
              onChange={field.onChange}
              aria-invalid={!!errors.date}
            />
          )}
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm">{t("common.save")}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}

export function ExpenseList({ expenses }: ExpenseListProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const deleteExpense = useDeleteExpense();

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteExpense.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast.success("Expense deleted");
        setDeleteTarget(null);
      },
      onError: () => {
        toast.error("Failed to delete expense");
        setDeleteTarget(null);
      },
    });
  };

  if (expenses.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2 px-2" data-testid="no-expenses-message">
        {t("expenses.noExpensesThisMonth")}
      </p>
    );
  }

  return (
    <>
      <div className="space-y-0.5" data-testid="expense-list">
        {expenses.map((expense) =>
          editingId === expense.id ? (
            <EditExpenseForm
              key={expense.id}
              expense={expense}
              onClose={() => setEditingId(null)}
            />
          ) : (
            <div
              key={expense.id}
              className="group flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-accent text-sm"
              data-testid="expense-row"
            >
              <div className="flex items-center gap-3">
                <span data-testid="expense-merchant">{expense.merchant}</span>
                <span className="text-muted-foreground" data-testid="expense-date">
                  {formatShortDate(expense.date)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className="font-mono text-right" data-testid="expense-amount">
                  {formatCurrency(expense.amount_cents)}
                </span>
                <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setEditingId(expense.id)}
                    data-testid="edit-expense-button"
                    aria-label={t("expenses.editExpense")}
                  >
                    <Pencil className="size-3.5 text-muted-foreground" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDeleteTarget(expense)}
                    data-testid="delete-expense-button"
                    aria-label={t("expenses.deleteExpense_action")}
                  >
                    <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          )
        )}
      </div>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent data-testid="delete-expense-dialog">
          <DialogHeader>
            <DialogTitle>{t("expenses.deleteExpense")}</DialogTitle>
            <DialogDescription>
              {t("budget.confirmDelete")} {deleteTarget?.merchant} ({deleteTarget ? formatCurrency(deleteTarget.amount_cents) : ""})? {t("budget.cannotBeUndone")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              data-testid="confirm-delete-expense-button"
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
