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
} from "@nixus/shared";
import { toast } from "sonner";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { OptionalAccountSelect } from "@/components/shared/OptionalAccountSelect";
import { useIncomeSources } from "@/hooks/useIncome";
import { useCreateRecurringIncomeTemplate } from "@/hooks/useRecurringIncome";

interface AddRecurringIncomeFormProps {
  onClose: () => void;
}

interface RecurringIncomeFormData {
  source_id: string;
  account_id: string;
  amount_cents: number;
  day_of_month: number;
}

export function AddRecurringIncomeForm({ onClose }: AddRecurringIncomeFormProps) {
  const { t } = useTranslation();
  const { data: sources = [] } = useIncomeSources();
  const createTemplate = useCreateRecurringIncomeTemplate();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<RecurringIncomeFormData>({
    defaultValues: {
      source_id: "",
      account_id: "",
      amount_cents: 0,
      day_of_month: 1,
    },
    mode: "onBlur",
  });

  const onSubmit = (data: RecurringIncomeFormData) => {
    createTemplate.mutate(
      {
        source_id: Number(data.source_id),
        amount_cents: data.amount_cents,
        day_of_month: Number(data.day_of_month),
        account_id: data.account_id ? Number(data.account_id) : null,
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

  if (sources.length === 0) {
    return (
      <p className="text-body text-ink-dim" data-testid="recurring-income-no-sources">
        {t("recurring.incomeNeedsSource")}
      </p>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-3"
      data-testid="add-recurring-income-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="recurring-income-source" required>
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
                id="recurring-income-source"
                aria-required="true"
                aria-invalid={!!errors.source_id}
                aria-describedby={
                  errors.source_id ? "recurring-income-source-error" : undefined
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
          <p id="recurring-income-source-error" className="text-caption text-over">
            {errors.source_id.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="recurring-income-amount" required>
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
              id="recurring-income-amount"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              aria-required
              aria-invalid={!!errors.amount_cents}
              aria-describedby={
                errors.amount_cents ? "recurring-income-amount-error" : undefined
              }
            />
          )}
        />
        {errors.amount_cents && (
          <p id="recurring-income-amount-error" className="text-caption text-over">
            {errors.amount_cents.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="recurring-income-day" required>
          {t("recurring.dayOfMonth")}
        </Label>
        <Input
          id="recurring-income-day"
          type="number"
          min={1}
          max={31}
          aria-required="true"
          aria-invalid={!!errors.day_of_month}
          aria-describedby={
            errors.day_of_month
              ? "recurring-income-day-hint recurring-income-day-error"
              : "recurring-income-day-hint"
          }
          {...register("day_of_month", {
            required: t("recurring.dayRequired"),
            min: { value: 1, message: t("recurring.dayRange") },
            max: { value: 31, message: t("recurring.dayRange") },
            valueAsNumber: true,
          })}
        />
        <p id="recurring-income-day-hint" className="text-caption text-ink-dim">
          {t("recurring.dayHint")}
        </p>
        {errors.day_of_month && (
          <p id="recurring-income-day-error" className="text-caption text-over">
            {errors.day_of_month.message}
          </p>
        )}
      </div>

      <Controller
        name="account_id"
        control={control}
        render={({ field }) => (
          <OptionalAccountSelect
            id="recurring-income-account"
            value={field.value}
            onChange={field.onChange}
            labelKey="income.accountOptional"
            helpKey="recurring.incomeAccountHelp"
          />
        )}
      />

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
