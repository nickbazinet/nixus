import { useForm, Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  Button,
  DatePicker,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nixus/shared";
import { format } from "date-fns";
import { toast } from "sonner";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { OptionalAccountSelect } from "@/components/shared/OptionalAccountSelect";
import { useIncomeSources, useCreateIncomeEntry } from "@/hooks/useIncome";

interface AddIncomeEntryFormProps {
  onClose: () => void;
}

interface EntryFormData {
  source_id: string;
  account_id: string;
  amount_cents: number;
  date: string;
}

export function AddIncomeEntryForm({ onClose }: AddIncomeEntryFormProps) {
  const { t } = useTranslation();
  const { data: sources = [] } = useIncomeSources();
  const createEntry = useCreateIncomeEntry();

  const {
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<EntryFormData>({
    defaultValues: {
      source_id: "",
      account_id: "",
      amount_cents: 0,
      date: format(new Date(), "yyyy-MM-dd"),
    },
    mode: "onBlur",
  });

  const onSubmit = (data: EntryFormData) => {
    createEntry.mutate(
      {
        source_id: Number(data.source_id),
        amount_cents: data.amount_cents,
        date: data.date,
        account_id: data.account_id ? Number(data.account_id) : null,
      },
      {
        onSuccess: () => {
          toast.success(t("toast.saveSuccess"));
          onClose();
        },
        onError: () => {
          toast.error(t("toast.saveFailed"));
        },
      }
    );
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-3"
      data-testid="add-income-entry-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="income-source" required>
          {t("common.source")}
        </Label>
        <Controller
          name="source_id"
          control={control}
          rules={{ required: t("income.sourceRequired") }}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} items={sources.map((s) => ({ value: String(s.id), label: s.name }))}>
              <SelectTrigger
                id="income-source"
                aria-required="true"
                aria-invalid={!!errors.source_id}
                aria-describedby={errors.source_id ? "income-source-error" : undefined}
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
          <p id="income-source-error" className="text-caption text-over">
            {errors.source_id.message}
          </p>
        )}
      </div>

      <Controller
        name="account_id"
        control={control}
        render={({ field }) => (
          <OptionalAccountSelect
            id="income-account"
            value={field.value}
            onChange={field.onChange}
            labelKey="income.accountOptional"
            helpKey="income.accountLinkHelp"
          />
        )}
      />

      <div className="space-y-1.5">
        <Label htmlFor="income-amount" required>
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
              id="income-amount"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              aria-required
              aria-invalid={!!errors.amount_cents}
              aria-describedby={errors.amount_cents ? "income-amount-error" : undefined}
            />
          )}
        />
        {errors.amount_cents && (
          <p id="income-amount-error" className="text-caption text-over">
            {errors.amount_cents.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="income-date" required>
          {t("common.date")}
        </Label>
        <Controller
          name="date"
          control={control}
          rules={{ required: t("validation.dateRequired") }}
          render={({ field }) => (
            <DatePicker
              id="income-date"
              value={field.value}
              onChange={field.onChange}
              aria-required="true"
              aria-invalid={!!errors.date}
              aria-describedby={errors.date ? "income-date-error" : undefined}
            />
          )}
        />
        {errors.date && (
          <p id="income-date-error" className="text-caption text-over">
            {errors.date.message}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm">
          {t("income.saveEntry")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
