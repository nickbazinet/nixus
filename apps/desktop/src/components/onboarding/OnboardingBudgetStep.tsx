import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useForm, Controller } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@nixus/shared";
import { Input } from "@nixus/shared";
import { Label } from "@nixus/shared";
import { Card, CardContent } from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { useCreateBudgetGroup, useCreateBudgetCategory, useBudgetGroups, useBudgetCategories } from "@/hooks/useBudget";
import { Plus } from "lucide-react";
import type { BudgetGroup } from "@/lib/types";

interface GroupFormData {
  name: string;
}

interface CategoryFormData {
  name: string;
  target_cents: number;
}

function GroupCategoryList({ group }: { group: BudgetGroup }) {
  const { t } = useTranslation();
  const { data: categories = [] } = useBudgetCategories(group.id);
  const createCategory = useCreateBudgetCategory();
  const [showCatForm, setShowCatForm] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<CategoryFormData>({
    defaultValues: { name: "", target_cents: 0 },
    mode: "onSubmit",
  });

  const onSubmitCategory = (data: CategoryFormData) => {
    createCategory.mutate(
      { group_id: group.id, name: data.name, target_cents: data.target_cents },
      {
        onSuccess: () => {
          toast.success(`Category "${data.name}" added`);
          reset();
          setShowCatForm(false);
        },
        onError: () => toast.error("Failed to add category"),
      }
    );
  };

  return (
    <div className="space-y-2">
      {categories.map((cat) => (
        <div key={cat.id} className="flex items-center justify-between text-sm px-2 py-1 rounded bg-muted/30">
          <span>{cat.name}</span>
          <span className="font-mono text-muted-foreground">
            ${(cat.target_cents / 100).toFixed(2)}
          </span>
        </div>
      ))}
      {showCatForm ? (
        <form onSubmit={handleSubmit(onSubmitCategory)} className="space-y-2 p-3 rounded-lg ring-1 ring-foreground/10">
          <div className="space-y-1">
            <Label htmlFor={`cat-name-${group.id}`}>{t("budget.categoryName")}</Label>
            <Input
              id={`cat-name-${group.id}`}
              placeholder={t("budget.categoryNamePlaceholder")}
              autoFocus
              aria-invalid={!!errors.name}
              {...register("name", { required: t("budget.nameRequired") })}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor={`cat-target-${group.id}`}>{t("budget.monthlyTarget")}</Label>
            <Controller
              name="target_cents"
              control={control}
              rules={{ validate: (v) => v > 0 || t("budget.targetRequired") }}
              render={({ field }) => (
                <MoneyInput
                  id={`cat-target-${group.id}`}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  aria-invalid={!!errors.target_cents}
                />
              )}
            />
            {errors.target_cents && <p className="text-xs text-destructive">{errors.target_cents.message}</p>}
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm">{t("budget.saveCategory")}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { reset(); setShowCatForm(false); }}>{t("common.cancel")}</Button>
          </div>
        </form>
      ) : (
        <Button variant="ghost" size="sm" onClick={() => setShowCatForm(true)} data-testid={`add-category-btn-${group.id}`}>
          <Plus className="size-4 mr-1" /> {t("budget.addCategory")}
        </Button>
      )}
    </div>
  );
}

export function OnboardingBudgetStep() {
  const { t } = useTranslation();
  const { data: groups = [] } = useBudgetGroups();
  const createGroup = useCreateBudgetGroup();
  const [showGroupForm, setShowGroupForm] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<GroupFormData>({
    defaultValues: { name: "" },
    mode: "onSubmit",
  });

  const onSubmitGroup = (data: GroupFormData) => {
    createGroup.mutate(data.name, {
      onSuccess: () => {
        toast.success(`Group "${data.name}" created`);
        reset();
        setShowGroupForm(false);
      },
      onError: () => toast.error("Failed to create group"),
    });
  };

  return (
    <div data-testid="onboarding-budget-step">
      <h2 className="text-lg font-medium mb-2">{t("onboarding.budgetTitle")}</h2>
      <p className="text-sm text-muted-foreground mb-4">
        {t("onboarding.budgetDescription")}
      </p>

      <div className="space-y-4">
        {groups.map((group) => (
          <Card key={group.id}>
            <CardContent className="p-4">
              <h3 className="font-medium mb-2">{group.name}</h3>
              <GroupCategoryList group={group} />
            </CardContent>
          </Card>
        ))}
      </div>

      {showGroupForm ? (
        <form onSubmit={handleSubmit(onSubmitGroup)} className="mt-4 space-y-2 p-4 rounded-xl ring-1 ring-foreground/10 bg-card">
          <div className="space-y-1.5">
            <Label htmlFor="onboarding-group-name">{t("budget.groupName")}</Label>
            <Input
              id="onboarding-group-name"
              placeholder={t("budget.groupNamePlaceholder")}
              autoFocus
              aria-invalid={!!errors.name}
              {...register("name", { required: t("budget.groupNameRequired") })}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm">{t("budget.saveGroup")}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => { reset(); setShowGroupForm(false); }}>{t("common.cancel")}</Button>
          </div>
        </form>
      ) : (
        <Button
          variant="ghost"
          className="mt-4"
          onClick={() => setShowGroupForm(true)}
          data-testid="add-group-button"
        >
          <Plus className="size-4 mr-1" /> {t("budget.addGroup")}
        </Button>
      )}
    </div>
  );
}
