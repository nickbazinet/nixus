import { useTranslation } from "react-i18next";
import { useForm, Controller } from "react-hook-form";
import {
  Button,
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
import { toast } from "sonner";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { useAllBudgetCategories } from "@/hooks/useExpenses";
import { useBudgetGroups } from "@/hooks/useBudget";
import { useCreateRecurringTemplate } from "@/hooks/useRecurringExpenses";

interface AddRecurringTemplateFormProps {
  onClose: () => void;
}

interface RecurringTemplateFormData {
  merchant: string;
  amount_cents: number;
  budget_category_id: string;
  day_of_month: number;
}

export function AddRecurringTemplateForm({ onClose }: AddRecurringTemplateFormProps) {
  const { t } = useTranslation();
  const { data: categories = [] } = useAllBudgetCategories();
  const { data: groups = [] } = useBudgetGroups();
  const createTemplate = useCreateRecurringTemplate();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<RecurringTemplateFormData>({
    defaultValues: {
      merchant: "",
      amount_cents: 0,
      budget_category_id: "",
      day_of_month: 1,
    },
    mode: "onBlur",
  });

  const onSubmit = (data: RecurringTemplateFormData) => {
    createTemplate.mutate(
      {
        merchant: data.merchant,
        amount_cents: data.amount_cents,
        budget_category_id: Number(data.budget_category_id),
        day_of_month: Number(data.day_of_month),
      },
      {
        onSuccess: () => {
          toast.success(t("recurring.templateSaved"));
          onClose();
        },
        onError: () => {
          toast.error(t("recurring.templateSaveFailed"));
        },
      }
    );
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-3"
      data-testid="add-recurring-template-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="recurring-merchant" required>
          {t("expenses.merchant")}
        </Label>
        <Input
          id="recurring-merchant"
          placeholder={t("expenses.merchantPlaceholder")}
          autoFocus
          aria-required="true"
          aria-invalid={!!errors.merchant}
          aria-describedby={errors.merchant ? "recurring-merchant-error" : undefined}
          {...register("merchant", { required: t("expenses.merchantRequired") })}
        />
        {errors.merchant && (
          <p id="recurring-merchant-error" className="text-caption text-over">
            {errors.merchant.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="recurring-amount" required>
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
              id="recurring-amount"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              aria-required
              aria-invalid={!!errors.amount_cents}
              aria-describedby={errors.amount_cents ? "recurring-amount-error" : undefined}
            />
          )}
        />
        {errors.amount_cents && (
          <p id="recurring-amount-error" className="text-caption text-over">
            {errors.amount_cents.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="recurring-category" required>
          {t("common.category")}
        </Label>
        <Controller
          name="budget_category_id"
          control={control}
          rules={{ required: t("expenses.categoryRequired") }}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={field.onChange}
              items={categories.map((cat) => ({ value: String(cat.id), label: cat.name }))}
            >
              <SelectTrigger
                id="recurring-category"
                aria-required="true"
                aria-invalid={!!errors.budget_category_id}
                aria-describedby={
                  errors.budget_category_id ? "recurring-category-error" : undefined
                }
              >
                <SelectValue placeholder={t("expenses.selectCategory")} />
              </SelectTrigger>
              <SelectContent>
                {groups.map((group) => {
                  const groupCats = categories.filter((c) => c.group_id === group.id);
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
          <p id="recurring-category-error" className="text-caption text-over">
            {errors.budget_category_id.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="recurring-day" required>
          {t("recurring.dayOfMonth")}
        </Label>
        <Input
          id="recurring-day"
          type="number"
          min={1}
          max={31}
          aria-required="true"
          aria-invalid={!!errors.day_of_month}
          aria-describedby={
            errors.day_of_month ? "recurring-day-hint recurring-day-error" : "recurring-day-hint"
          }
          {...register("day_of_month", {
            required: t("recurring.dayRequired"),
            min: { value: 1, message: t("recurring.dayRange") },
            max: { value: 31, message: t("recurring.dayRange") },
            valueAsNumber: true,
          })}
        />
        <p id="recurring-day-hint" className="text-caption text-ink-dim">
          {t("recurring.dayHint")}
        </p>
        {errors.day_of_month && (
          <p id="recurring-day-error" className="text-caption text-over">
            {errors.day_of_month.message}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm">
          {t("recurring.saveTemplate")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
