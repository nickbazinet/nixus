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
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@nixus/shared";
import { Input } from "@nixus/shared";
import { Label } from "@nixus/shared";
import { DatePicker } from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { OptionalAccountSelect } from "@/components/shared/OptionalAccountSelect";
import { useAllBudgetCategories, useCreateExpense } from "@/hooks/useExpenses";
import { useBudgetGroups } from "@/hooks/useBudget";


interface AddExpenseFormProps {
  defaultCategoryId?: number;
  onClose: () => void;
}

interface ExpenseFormData {
  merchant: string;
  amount_cents: number;
  budget_category_id: string;
  account_id: string;
  date: string;
}


export function AddExpenseForm({ defaultCategoryId, onClose }: AddExpenseFormProps) {
  const { t } = useTranslation();
  const { data: categories = [] } = useAllBudgetCategories();
  const { data: groups = [] } = useBudgetGroups();
  const createExpense = useCreateExpense();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<ExpenseFormData>({
    defaultValues: {
      merchant: "",
      amount_cents: 0,
      budget_category_id: defaultCategoryId ? String(defaultCategoryId) : "",
      account_id: "",
      date: format(new Date(), "yyyy-MM-dd"),
    },
    mode: "onSubmit",
  });

  const onSubmit = (data: ExpenseFormData) => {
    createExpense.mutate(
      {
        merchant: data.merchant,
        amount_cents: data.amount_cents,
        budget_category_id: Number(data.budget_category_id),
        date: data.date,
        account_id: data.account_id ? Number(data.account_id) : null,
      },
      {
        onSuccess: () => {
          toast.success(`Expense "${data.merchant}" saved`);
          onClose();
        },
        onError: () => {
          toast.error("Failed to save expense");
        },
      }
    );
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-3 p-4 rounded-xl ring-1 ring-foreground/10 bg-card"
      data-testid="add-expense-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="expense-merchant">{t("expenses.merchant")}</Label>
        <Input
          id="expense-merchant"
          placeholder={t("expenses.merchantPlaceholder")}
          autoFocus
          aria-invalid={!!errors.merchant}
          {...register("merchant", { required: t("expenses.merchantRequired") })}
        />
        {errors.merchant && (
          <p className="text-xs text-destructive">{errors.merchant.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="expense-amount">{t("common.amount")}</Label>
        <Controller
          name="amount_cents"
          control={control}
          rules={{
            validate: (v) => v > 0 || t("expenses.amountRequired"),
          }}
          render={({ field }) => (
            <MoneyInput
              id="expense-amount"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              aria-invalid={!!errors.amount_cents}
            />
          )}
        />
        {errors.amount_cents && (
          <p className="text-xs text-destructive">
            {errors.amount_cents.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="expense-category">{t("common.category")}</Label>
        <Controller
          name="budget_category_id"
          control={control}
          rules={{ required: t("expenses.categoryRequired") }}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} items={categories.map((cat) => ({ value: String(cat.id), label: cat.name }))}>
              <SelectTrigger id="expense-category" aria-invalid={!!errors.budget_category_id}>
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
          <p className="text-xs text-destructive">
            {errors.budget_category_id.message}
          </p>
        )}
      </div>

      <Controller
        name="account_id"
        control={control}
        render={({ field }) => (
          <OptionalAccountSelect
            id="expense-account"
            value={field.value}
            onChange={field.onChange}
            labelKey="expenses.accountOptional"
            helpKey="expenses.accountLinkHelp"
          />
        )}
      />

      <div className="space-y-1.5">
        <Label htmlFor="expense-date">{t("common.date")}</Label>
        <Controller
          name="date"
          control={control}
          rules={{ required: t("expenses.dateRequired") }}
          render={({ field }) => (
            <DatePicker
              id="expense-date"
              value={field.value}
              onChange={field.onChange}
              aria-invalid={!!errors.date}
            />
          )}
        />
        {errors.date && (
          <p className="text-xs text-destructive">{errors.date.message}</p>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm">
          {t("expenses.saveExpense")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
