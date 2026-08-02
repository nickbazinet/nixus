import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useForm, Controller } from "react-hook-form";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nixus/shared";
import { useIncomeSources, useCreateIncomeSource } from "@/hooks/useIncome";

const INCOME_TYPE_OPTIONS = [
  { value: "employment", labelKey: "income.typeEmployment" },
  { value: "freelance", labelKey: "income.typeFreelance" },
  { value: "investment", labelKey: "income.typeInvestment" },
  { value: "other", labelKey: "income.typeOther" },
];

interface IncomeSourceFormData {
  name: string;
  income_type: string;
}

export function OnboardingIncomeStep() {
  const { t } = useTranslation();
  const { data: sources = [] } = useIncomeSources();
  const createSource = useCreateIncomeSource();
  const [showForm, setShowForm] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<IncomeSourceFormData>({
    defaultValues: { name: "", income_type: "employment" },
    mode: "onBlur",
  });

  const onSubmit = (data: IncomeSourceFormData) => {
    createSource.mutate(
      { name: data.name, income_type: data.income_type },
      {
        onSuccess: () => {
          toast.success(data.name);
          reset();
          setShowForm(false);
        },
        onError: () => toast.error(t("toast.saveFailed")),
      }
    );
  };

  const incomeTypeItems = INCOME_TYPE_OPTIONS.map((opt) => ({
    value: opt.value,
    label: t(opt.labelKey),
  }));
  const typeLabel = (value: string) => {
    const match = INCOME_TYPE_OPTIONS.find((opt) => opt.value === value);
    return match ? t(match.labelKey) : value;
  };

  return (
    <div className="space-y-4" data-testid="onboarding-income-step">
      <div>
        <h2 className="text-h2 text-ink">{t("onboarding.incomeTitle")}</h2>
        <p className="mt-1 text-caption text-ink-dim">
          {t("onboarding.incomeDescription")}
        </p>
      </div>

      {sources.length === 0 ? (
        <p className="text-caption text-ink-dim">{t("onboarding.incomeEmpty")}</p>
      ) : (
        <Card flush>
          {sources.map((source) => (
            <div
              key={source.id}
              className="flex items-center justify-between gap-3 px-card-pad py-3 not-last:border-b not-last:border-line"
            >
              <span className="min-w-0 truncate text-label text-ink">{source.name}</span>
              <Badge variant="neutral">{typeLabel(source.income_type)}</Badge>
            </div>
          ))}
        </Card>
      )}

      {showForm ? (
        <Card>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="onboarding-source-name" required>
                  {t("common.name")}
                </Label>
                <Input
                  id="onboarding-source-name"
                  placeholder={t("income.sourceNamePlaceholder")}
                  autoFocus
                  required
                  aria-required="true"
                  aria-invalid={errors.name !== undefined || undefined}
                  aria-describedby={errors.name ? "onboarding-source-name-error" : undefined}
                  {...register("name", { required: t("income.sourceNameRequired") })}
                />
                {errors.name && (
                  <p
                    id="onboarding-source-name-error"
                    className="text-caption text-over-ink"
                    role="alert"
                  >
                    {errors.name.message}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="onboarding-source-type" required>
                  {t("common.type")}
                </Label>
                <Controller
                  name="income_type"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      items={incomeTypeItems}
                    >
                      <SelectTrigger id="onboarding-source-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {INCOME_TYPE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {t(opt.labelKey)}
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    reset();
                    setShowForm(false);
                  }}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" onClick={() => setShowForm(true)}>
          <Plus className="size-4" aria-hidden="true" /> {t("income.addSource")}
        </Button>
      )}
    </div>
  );
}
