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
  Switch,
} from "@nixus/shared";
import { toast } from "sonner";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { useAllBudgetCategories } from "@/hooks/useExpenses";
import { useBudgetGroups } from "@/hooks/useBudget";
import { useUpdateRecurringTemplate } from "@/hooks/useRecurringExpenses";
import type { RecurringExpenseTemplate } from "@/lib/types";

interface EditRecurringTemplateFormProps {
  template: RecurringExpenseTemplate;
  onClose: () => void;
}

interface RecurringTemplateFormData {
  merchant: string;
  amount_cents: number;
  budget_category_id: string;
  day_of_month: number;
  is_active: boolean;
}

export function EditRecurringTemplateForm({
  template,
  onClose,
}: EditRecurringTemplateFormProps) {
  const { t } = useTranslation();
  const { data: categories = [] } = useAllBudgetCategories();
  const { data: groups = [] } = useBudgetGroups();
  const updateTemplate = useUpdateRecurringTemplate();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<RecurringTemplateFormData>({
    defaultValues: {
      merchant: template.merchant,
      amount_cents: template.amount_cents,
      budget_category_id: String(template.budget_category_id),
      day_of_month: template.day_of_month,
      is_active: template.is_active,
    },
    mode: "onBlur",
  });

  const onSubmit = (data: RecurringTemplateFormData) => {
    updateTemplate.mutate(
      {
        id: template.id,
        merchant: data.merchant,
        amount_cents: data.amount_cents,
        budget_category_id: Number(data.budget_category_id),
        day_of_month: Number(data.day_of_month),
        is_active: data.is_active,
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
      data-testid="edit-recurring-template-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="edit-recurring-merchant" required>
          {t("expenses.merchant")}
        </Label>
        <Input
          id="edit-recurring-merchant"
          placeholder={t("expenses.merchantPlaceholder")}
          autoFocus
          aria-required="true"
          aria-invalid={!!errors.merchant}
          aria-describedby={errors.merchant ? "edit-recurring-merchant-error" : undefined}
          {...register("merchant", { required: t("expenses.merchantRequired") })}
        />
        {errors.merchant && (
          <p id="edit-recurring-merchant-error" className="text-caption text-over">
            {errors.merchant.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-recurring-amount" required>
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
              id="edit-recurring-amount"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              aria-required
              aria-invalid={!!errors.amount_cents}
              aria-describedby={
                errors.amount_cents ? "edit-recurring-amount-error" : undefined
              }
            />
          )}
        />
        {errors.amount_cents && (
          <p id="edit-recurring-amount-error" className="text-caption text-over">
            {errors.amount_cents.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-recurring-category" required>
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
              items={categories.map((cat) => ({
                value: String(cat.id),
                label: cat.name,
              }))}
            >
              <SelectTrigger
                id="edit-recurring-category"
                aria-required="true"
                aria-invalid={!!errors.budget_category_id}
                aria-describedby={
                  errors.budget_category_id ? "edit-recurring-category-error" : undefined
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
          <p id="edit-recurring-category-error" className="text-caption text-over">
            {errors.budget_category_id.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-recurring-day" required>
          {t("recurring.dayOfMonth")}
        </Label>
        <Input
          id="edit-recurring-day"
          type="number"
          min={1}
          max={31}
          aria-required="true"
          aria-invalid={!!errors.day_of_month}
          aria-describedby={
            errors.day_of_month
              ? "edit-recurring-day-hint edit-recurring-day-error"
              : "edit-recurring-day-hint"
          }
          {...register("day_of_month", {
            required: t("recurring.dayRequired"),
            min: { value: 1, message: t("recurring.dayRange") },
            max: { value: 31, message: t("recurring.dayRange") },
            valueAsNumber: true,
          })}
        />
        <p id="edit-recurring-day-hint" className="text-caption text-ink-dim">
          {t("recurring.dayHint")}
        </p>
        {errors.day_of_month && (
          <p id="edit-recurring-day-error" className="text-caption text-over">
            {errors.day_of_month.message}
          </p>
        )}
      </div>

      {/* The page told users to "toggle a template off" while no toggle existed anywhere. This is it. */}
      <div className="flex items-start justify-between gap-3 border-t border-line pt-3">
        <div className="min-w-0">
          <Label htmlFor="edit-recurring-active">{t("recurring.activeLabel")}</Label>
          <p id="edit-recurring-active-hint" className="mt-1 text-caption text-ink-dim">
            {t("recurring.activeHint")}
          </p>
        </div>
        <Controller
          name="is_active"
          control={control}
          render={({ field }) => (
            <Switch
              id="edit-recurring-active"
              checked={field.value}
              onCheckedChange={field.onChange}
              aria-describedby="edit-recurring-active-hint"
              data-testid="recurring-active-switch"
            />
          )}
        />
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
