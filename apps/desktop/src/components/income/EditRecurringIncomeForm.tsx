import { useTranslation } from "react-i18next";
import { useForm, Controller, FormProvider } from "react-hook-form";
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@nixus/shared";
import { toast } from "sonner";
import { RecurrenceFields } from "@/components/shared/RecurrenceFields";
import { todayIso } from "@/lib/recurrence";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { OptionalAccountSelect } from "@/components/shared/OptionalAccountSelect";
import { useIncomeSources } from "@/hooks/useIncome";
import { useUpdateRecurringIncomeTemplate } from "@/hooks/useRecurringIncome";
import type { RecurringIncomeTemplate, RecurrenceFrequency } from "@/lib/types";

interface EditRecurringIncomeFormProps {
  template: RecurringIncomeTemplate;
  onClose: () => void;
}

interface RecurringIncomeFormData {
  source_id: string;
  account_id: string;
  amount_cents: number;
  day_of_month: number;
  frequency: RecurrenceFrequency;
  start_date: string;
  is_active: boolean;
}

export function EditRecurringIncomeForm({
  template,
  onClose,
}: EditRecurringIncomeFormProps) {
  const { t } = useTranslation();
  const { data: sources = [] } = useIncomeSources();
  const updateTemplate = useUpdateRecurringIncomeTemplate();

  const methods = useForm<RecurringIncomeFormData>({
    defaultValues: {
      source_id: String(template.source_id),
      account_id: template.account_id === null ? "" : String(template.account_id),
      amount_cents: template.amount_cents,
      day_of_month: template.day_of_month,
      frequency: template.frequency,
      start_date: template.start_date ?? todayIso(),
      is_active: template.is_active,
    },
    mode: "onBlur",
  });
  const {
    handleSubmit,
    control,
    formState: { errors },
  } = methods;

  const onSubmit = (data: RecurringIncomeFormData) => {
    updateTemplate.mutate(
      {
        id: template.id,
        source_id: Number(data.source_id),
        amount_cents: data.amount_cents,
        day_of_month: Number(data.day_of_month),
        frequency: data.frequency,
        start_date: data.frequency === "monthly" ? null : data.start_date,
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
    <FormProvider {...methods}>
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

        <RecurrenceFields idPrefix="edit-recurring-income" />

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
    </FormProvider>
  );
}
