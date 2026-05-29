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
} from "@nkbaz/shared";
import { toast } from "sonner";
import { Button } from "@nkbaz/shared";
import { Input } from "@nkbaz/shared";
import { Label } from "@nkbaz/shared";
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
    mode: "onSubmit",
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
      className="space-y-3 p-4 rounded-xl ring-1 ring-foreground/10 bg-card"
      data-testid="add-recurring-template-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="recurring-merchant">{t("expenses.merchant")}</Label>
        <Input
          id="recurring-merchant"
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
        <Label htmlFor="recurring-amount">{t("common.amount")}</Label>
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
        <Label htmlFor="recurring-category">{t("common.category")}</Label>
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
              <SelectTrigger id="recurring-category" aria-invalid={!!errors.budget_category_id}>
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
          <p className="text-xs text-destructive">
            {errors.budget_category_id.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="recurring-day">{t("recurring.dayOfMonth")}</Label>
        <Input
          id="recurring-day"
          type="number"
          min={1}
          max={31}
          aria-invalid={!!errors.day_of_month}
          {...register("day_of_month", {
            required: t("recurring.dayRequired"),
            min: { value: 1, message: t("recurring.dayRange") },
            max: { value: 31, message: t("recurring.dayRange") },
            valueAsNumber: true,
          })}
        />
        <p className="text-xs text-muted-foreground">{t("recurring.dayHint")}</p>
        {errors.day_of_month && (
          <p className="text-xs text-destructive">{errors.day_of_month.message}</p>
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
