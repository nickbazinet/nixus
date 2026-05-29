import { useForm, Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@nkbaz/shared";
import { toast } from "sonner";
import { Button } from "@nkbaz/shared";
import { Input } from "@nkbaz/shared";
import { Label } from "@nkbaz/shared";
import { useCreateIncomeSource } from "@/hooks/useIncome";

const INCOME_TYPE_VALUES = [
  { value: "employment", key: "income.typeEmployment" },
  { value: "freelance", key: "income.typeFreelance" },
  { value: "investment", key: "income.typeInvestment" },
  { value: "other", key: "income.typeOther" },
];

interface IncomeSourceFormData {
  name: string;
  income_type: string;
}

interface AddIncomeSourceFormProps {
  onClose: () => void;
}

export function AddIncomeSourceForm({ onClose }: AddIncomeSourceFormProps) {
  const { t } = useTranslation();
  const createSource = useCreateIncomeSource();
  const INCOME_TYPE_OPTIONS = INCOME_TYPE_VALUES.map((o) => ({ value: o.value, label: t(o.key) }));

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<IncomeSourceFormData>({
    defaultValues: {
      name: "",
      income_type: "employment",
    },
    mode: "onSubmit",
  });

  const onSubmit = (data: IncomeSourceFormData) => {
    createSource.mutate(
      { name: data.name, income_type: data.income_type },
      {
        onSuccess: () => {
          toast.success(t("toast.saveSuccess"));
          onClose();
        },
        onError: () => {
          toast.error(t("toast.saveFailed"));
        },
      },
    );
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
      className="space-y-3 p-4 rounded-xl ring-1 ring-foreground/10 bg-card"
    >
      <div className="space-y-1.5">
        <Label htmlFor="source-name">{t("common.name")}</Label>
        <Input
          id="source-name"
          placeholder={t("income.sourceNamePlaceholder")}
          autoFocus
          aria-invalid={!!errors.name}
          {...register("name", { required: t("income.sourceNameRequired") })}
        />
        {errors.name && (
          <p className="text-xs text-destructive">{errors.name.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="source-type">{t("common.type")}</Label>
        <Controller
          name="income_type"
          control={control}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} items={INCOME_TYPE_OPTIONS}>
              <SelectTrigger id="source-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INCOME_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm">
          {t("income.saveSource")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
