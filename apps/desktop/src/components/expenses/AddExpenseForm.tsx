import { useTranslation } from "react-i18next";
import { useForm, Controller } from "react-hook-form";
import {
  Button,
  DatePicker,
  Input,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nixus/shared";
import { format } from "date-fns";
import { toast } from "sonner";
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
    // Each field reports its own problem as the user leaves it. On submit-only validation, five
    // fields get filled before the first error is ever shown.
    mode: "onBlur",
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
          toast.success(t("expenses.expenseSaved", { merchant: data.merchant }));
          onClose();
        },
        onError: () => {
          toast.error(t("expenses.expenseSaveFailed"));
        },
      }
    );
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-3"
      data-testid="add-expense-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="expense-merchant" required>
          {t("expenses.merchant")}
        </Label>
        <Input
          id="expense-merchant"
          placeholder={t("expenses.merchantPlaceholder")}
          autoFocus
          aria-required="true"
          aria-invalid={!!errors.merchant}
          aria-describedby={errors.merchant ? "expense-merchant-error" : undefined}
          {...register("merchant", { required: t("expenses.merchantRequired") })}
        />
        {errors.merchant && (
          <p id="expense-merchant-error" className="text-caption text-over">
            {errors.merchant.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="expense-amount" required>
          {t("common.amount")}
        </Label>
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
              aria-required
              aria-invalid={!!errors.amount_cents}
              aria-describedby={errors.amount_cents ? "expense-amount-error" : undefined}
            />
          )}
        />
        {errors.amount_cents && (
          <p id="expense-amount-error" className="text-caption text-over">
            {errors.amount_cents.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="expense-category" required>
          {t("common.category")}
        </Label>
        <Controller
          name="budget_category_id"
          control={control}
          rules={{ required: t("expenses.categoryRequired") }}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} items={categories.map((cat) => ({ value: String(cat.id), label: cat.name }))}>
              <SelectTrigger
                id="expense-category"
                aria-required="true"
                aria-invalid={!!errors.budget_category_id}
                aria-describedby={
                  errors.budget_category_id ? "expense-category-error" : undefined
                }
              >
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
          <p id="expense-category-error" className="text-caption text-over">
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
        <Label htmlFor="expense-date" required>
          {t("common.date")}
        </Label>
        <Controller
          name="date"
          control={control}
          rules={{ required: t("expenses.dateRequired") }}
          render={({ field }) => (
            <DatePicker
              id="expense-date"
              value={field.value}
              onChange={field.onChange}
              aria-required="true"
              aria-invalid={!!errors.date}
              aria-describedby={errors.date ? "expense-date-error" : undefined}
            />
          )}
        />
        {errors.date && (
          <p id="expense-date-error" className="text-caption text-over">
            {errors.date.message}
          </p>
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
