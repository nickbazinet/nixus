import { useTranslation } from "react-i18next";
import { useForm, Controller } from "react-hook-form";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@nixus/shared";
import { toast } from "sonner";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { OptionalAccountSelect } from "@/components/shared/OptionalAccountSelect";
import { useIncomeSources } from "@/hooks/useIncome";
import { useUpdateRecurringIncomeTemplate } from "@/hooks/useRecurringIncome";
import type { RecurringIncomeTemplate } from "@/lib/types";

interface EditRecurringIncomeFormProps {
  template: RecurringIncomeTemplate;
  onClose: () => void;
}

interface RecurringIncomeFormData {
  source_id: string;
  account_id: string;
  amount_cents: number;
  day_of_month: number;
  is_active: boolean;
}

export function EditRecurringIncomeForm({
  template,
  onClose,
}: EditRecurringIncomeFormProps) {
  const { t } = useTranslation();
  const { data: sources = [] } = useIncomeSources();
  const updateTemplate = useUpdateRecurringIncomeTemplate();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<RecurringIncomeFormData>({
    defaultValues: {
      source_id: String(template.source_id),
      account_id: template.account_id === null ? "" : String(template.account_id),
      amount_cents: template.amount_cents,
      day_of_month: template.day_of_month,
      is_active: template.is_active,
    },
    mode: "onBlur",
  });

  const onSubmit = (data: RecurringIncomeFormData) => {
    updateTemplate.mutate(
      {
        id: template.id,
        source_id: Number(data.source_id),
        amount_cents: data.amount_cents,
        day_of_month: Number(data.day_of_month),
        account_id: data.account_id ? Number(data.account_id) : null,
        is_active: data.is_active,
      },
      {
        onSuccess: () => {
          toast.success(t("recurring.incomeSaved"));
          onClose();
        },
        onError: () => {
          toast.error(t("recurring.incomeSaveFailed"));
        },
      }
    );
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-3"
      data-testid="edit-recurring-income-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="edit-recurring-income-source" required>
          {t("common.source")}
        </Label>
        <Controller
          name="source_id"
          control={control}
          rules={{ required: t("income.sourceRequired") }}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={field.onChange}
              items={sources.map((s) => ({ value: String(s.id), label: s.name }))}
            >
              <SelectTrigger
                id="edit-recurring-income-source"
                aria-required="true"
                aria-invalid={!!errors.source_id}
                aria-describedby={
                  errors.source_id ? "edit-recurring-income-source-error" : undefined
                }
              >
                <SelectValue placeholder={t("income.selectSource")} />
              </SelectTrigger>
              <SelectContent>
                {sources.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.source_id && (
          <p id="edit-recurring-income-source-error" className="text-caption text-over">
            {errors.source_id.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-recurring-income-amount" required>
          {t("common.amount")}
        </Label>
        <Controller
          name="amount_cents"
          control={control}
          rules={{
            validate: (v) => v > 0 || t("validation.amountPositive"),
          }}
          render={({ field }) => (
            <MoneyInput
              id="edit-recurring-income-amount"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              aria-required
              aria-invalid={!!errors.amount_cents}
              aria-describedby={
                errors.amount_cents ? "edit-recurring-income-amount-error" : undefined
              }
            />
          )}
        />
        {errors.amount_cents && (
          <p id="edit-recurring-income-amount-error" className="text-caption text-over">
            {errors.amount_cents.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-recurring-income-day" required>
          {t("recurring.dayOfMonth")}
        </Label>
        <Input
          id="edit-recurring-income-day"
          type="number"
          min={1}
          max={31}
          aria-required="true"
          aria-invalid={!!errors.day_of_month}
          aria-describedby={
            errors.day_of_month
              ? "edit-recurring-income-day-hint edit-recurring-income-day-error"
              : "edit-recurring-income-day-hint"
          }
          {...register("day_of_month", {
            required: t("recurring.dayRequired"),
            min: { value: 1, message: t("recurring.dayRange") },
            max: { value: 31, message: t("recurring.dayRange") },
            valueAsNumber: true,
          })}
        />
        <p id="edit-recurring-income-day-hint" className="text-caption text-ink-dim">
          {t("recurring.dayHint")}
        </p>
        {errors.day_of_month && (
          <p id="edit-recurring-income-day-error" className="text-caption text-over">
            {errors.day_of_month.message}
          </p>
        )}
      </div>

      <Controller
        name="account_id"
        control={control}
        render={({ field }) => (
          <OptionalAccountSelect
            id="edit-recurring-income-account"
            value={field.value}
            onChange={field.onChange}
            labelKey="income.accountOptional"
            helpKey="recurring.incomeAccountHelp"
          />
        )}
      />

      <div className="flex items-start justify-between gap-3 border-t border-line pt-3">
        <div className="min-w-0">
          <Label htmlFor="edit-recurring-income-active">
            {t("recurring.incomeActiveLabel")}
          </Label>
          <p
            id="edit-recurring-income-active-hint"
            className="mt-1 text-caption text-ink-dim"
          >
            {t("recurring.incomeActiveHint")}
          </p>
        </div>
        <Controller
          name="is_active"
          control={control}
          render={({ field }) => (
            <Switch
              id="edit-recurring-income-active"
              checked={field.value}
              onCheckedChange={field.onChange}
              aria-describedby="edit-recurring-income-active-hint"
              data-testid="recurring-income-active-switch"
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
