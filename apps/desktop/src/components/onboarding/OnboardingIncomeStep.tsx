import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useForm, Controller } from "react-hook-form";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@nkbaz/shared";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@nkbaz/shared";
import { Input } from "@nkbaz/shared";
import { Label } from "@nkbaz/shared";
import { Card, CardContent } from "@nkbaz/shared";
import { useIncomeSources, useCreateIncomeSource } from "@/hooks/useIncome";

const INCOME_TYPE_OPTIONS = [
  { value: "employment", labelKey: "income.typeEmployment" },
  { value: "freelance", labelKey: "income.typeFreelance" },
  { value: "investment", labelKey: "income.typeInvestment" },
  { value: "other", labelKey: "income.typeOther" },
];

const TYPE_LABEL_KEYS: Record<string, string> = {
  employment: "income.typeEmployment",
  freelance: "income.typeFreelance",
  investment: "income.typeInvestment",
  other: "income.typeOther",
};

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
    mode: "onSubmit",
  });

  const onSubmit = (data: IncomeSourceFormData) => {
    createSource.mutate(
      { name: data.name, income_type: data.income_type },
      {
        onSuccess: () => {
          toast.success(`Income source "${data.name}" added`);
          reset();
          setShowForm(false);
        },
        onError: () => toast.error("Failed to add income source"),
      },
    );
  };

  const incomeTypeItems = INCOME_TYPE_OPTIONS.map((opt) => ({ value: opt.value, label: t(opt.labelKey) }));

  return (
    <div>
      <h2 className="text-lg font-medium mb-2">{t("onboarding.incomeTitle")}</h2>
      <p className="text-sm text-muted-foreground mb-4">
        {t("onboarding.incomeDescription")}
      </p>

      {sources.length > 0 && (
        <div className="space-y-2 mb-4">
          {sources.map((source) => (
            <Card key={source.id}>
              <CardContent className="p-3 flex items-center justify-between">
                <span className="font-medium text-sm">{source.name}</span>
                <span className="text-xs text-muted-foreground">
                  {TYPE_LABEL_KEYS[source.income_type] ? t(TYPE_LABEL_KEYS[source.income_type]) : source.income_type}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showForm ? (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-3 p-4 rounded-xl ring-1 ring-foreground/10 bg-card"
        >
          <div className="space-y-1.5">
            <Label htmlFor="onboarding-source-name">{t("common.name")}</Label>
            <Input
              id="onboarding-source-name"
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
            <Label htmlFor="onboarding-source-type">{t("common.type")}</Label>
            <Controller
              name="income_type"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange} items={incomeTypeItems}>
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
              variant="ghost"
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
      ) : (
        <Button variant="ghost" onClick={() => setShowForm(true)}>
          <Plus className="size-4 mr-1" /> {t("income.addSource")}
        </Button>
      )}
    </div>
  );
}
