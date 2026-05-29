import { useForm, Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@nixus/shared";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@nixus/shared";
import { Label } from "@nixus/shared";
import { DatePicker } from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { useIncomeSources, useCreateIncomeEntry } from "@/hooks/useIncome";

interface AddIncomeEntryFormProps {
  onClose: () => void;
}

interface EntryFormData {
  source_id: string;
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
      amount_cents: 0,
      date: format(new Date(), "yyyy-MM-dd"),
    },
    mode: "onSubmit",
  });

  const onSubmit = (data: EntryFormData) => {
    createEntry.mutate(
      {
        source_id: Number(data.source_id),
        amount_cents: data.amount_cents,
        date: data.date,
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
      className="space-y-3 p-4 rounded-xl ring-1 ring-foreground/10 bg-card"
    >
      <div className="space-y-1.5">
        <Label htmlFor="income-source">{t("common.source")}</Label>
        <Controller
          name="source_id"
          control={control}
          rules={{ required: t("income.sourceRequired") }}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} items={sources.map((s) => ({ value: String(s.id), label: s.name }))}>
              <SelectTrigger id="income-source" aria-invalid={!!errors.source_id}>
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
          <p className="text-xs text-destructive">{errors.source_id.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="income-amount">{t("common.amount")}</Label>
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
        <Label htmlFor="income-date">{t("common.date")}</Label>
        <Controller
          name="date"
          control={control}
          rules={{ required: t("validation.dateRequired") }}
          render={({ field }) => (
            <DatePicker
              id="income-date"
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
          {t("income.saveEntry")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
