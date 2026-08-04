import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useForm, Controller } from "react-hook-form";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button, Card, CardContent, Input, Label, Money } from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { OnboardingStarterTemplate } from "@/components/onboarding/OnboardingStarterTemplate";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import {
  useCreateBudgetGroup,
  useCreateBudgetCategory,
  useBudgetGroups,
  useBudgetCategories,
} from "@/hooks/useBudget";
import { useSystemTemplates } from "@/hooks/useBudgetTemplates";
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
  const maskProps = useMaskProps();
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
    mode: "onBlur",
  });

  const nameId = `cat-name-${group.id}`;
  const targetId = `cat-target-${group.id}`;

  const onSubmitCategory = (data: CategoryFormData) => {
    createCategory.mutate(
      { group_id: group.id, name: data.name, target_cents: data.target_cents },
      {
        onSuccess: () => {
          toast.success(t("budget.categoryAdded", { name: data.name }));
          reset();
          setShowCatForm(false);
        },
        onError: () => toast.error(t("budget.categoryAddFailed")),
      }
    );
  };

  return (
    <div className="space-y-2">
      {categories.length === 0 && !showCatForm && (
        <p className="text-caption text-ink-dim">{t("onboarding.groupEmpty")}</p>
      )}
      {categories.map((cat) => (
        <div
          key={cat.id}
          className="flex items-center justify-between gap-3 rounded-sm bg-chrome px-2.5 py-1.5"
        >
          <span className="min-w-0 truncate text-label text-ink">{cat.name}</span>
          <Money
            cents={cat.target_cents}
            className="shrink-0 text-label text-ink-dim"
            {...maskProps}
          />
        </div>
      ))}
      {showCatForm ? (
        <form
          onSubmit={handleSubmit(onSubmitCategory)}
          className="space-y-2 rounded-md border border-line bg-page p-3"
        >
          <div className="space-y-1">
            <Label htmlFor={nameId} required>
              {t("budget.categoryName")}
            </Label>
            <Input
              id={nameId}
              placeholder={t("budget.categoryNamePlaceholder")}
              autoFocus
              required
              aria-required="true"
              aria-invalid={errors.name !== undefined || undefined}
              aria-describedby={errors.name ? `${nameId}-error` : undefined}
              {...register("name", { required: t("budget.nameRequired") })}
            />
            {errors.name && (
              <p id={`${nameId}-error`} className="text-caption text-over-ink" role="alert">
                {errors.name.message}
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor={targetId} required>
              {t("budget.monthlyTarget")}
            </Label>
            <Controller
              name="target_cents"
              control={control}
              rules={{ validate: (v) => v > 0 || t("budget.targetRequired") }}
              render={({ field }) => (
                <MoneyInput
                  id={targetId}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  aria-invalid={errors.target_cents !== undefined || undefined}
                />
              )}
            />
            {errors.target_cents && (
              <p
                id={`${targetId}-error`}
                className="text-caption text-over-ink"
                role="alert"
              >
                {errors.target_cents.message}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm">
              {t("budget.saveCategory")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                reset();
                setShowCatForm(false);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCatForm(true)}
          data-testid={`add-category-btn-${group.id}`}
        >
          <Plus className="size-3.5" aria-hidden="true" /> {t("budget.addCategory")}
        </Button>
      )}
    </div>
  );
}

export function OnboardingBudgetStep() {
  const { t } = useTranslation();
  const { data: groups = [] } = useBudgetGroups();
  const createGroup = useCreateBudgetGroup();
  const starterTemplates = useSystemTemplates();
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [showManualPath, setShowManualPath] = useState(false);

  const starterTemplateId = starterTemplates.data?.[0]?.id;
  // Hidden only while the starter choice is still unknown: once there is no template to
  // offer, or the user already has groups, the manual path is the whole step and must not
  // sit behind a click.
  const manualPathVisible =
    showManualPath ||
    groups.length > 0 ||
    (!starterTemplates.isPending && starterTemplateId === undefined);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<GroupFormData>({
    defaultValues: { name: "" },
    mode: "onBlur",
  });

  const onSubmitGroup = (data: GroupFormData) => {
    createGroup.mutate(data.name, {
      onSuccess: () => {
        toast.success(t("budget.groupCreated", { name: data.name }));
        reset();
        setShowGroupForm(false);
      },
      onError: () => toast.error(t("budget.groupCreateFailed")),
    });
  };

  return (
    <div className="space-y-4" data-testid="onboarding-budget-step">
      <div>
        <h2 className="text-h2 text-ink">{t("onboarding.budgetTitle")}</h2>
        <p className="mt-1 text-caption text-ink-dim">
          {t("onboarding.budgetDescription")}
        </p>
        <p className="mt-1 text-caption text-ink-faint">{t("onboarding.editableLater")}</p>
      </div>

      {starterTemplateId !== undefined && (
        <OnboardingStarterTemplate templateId={starterTemplateId} />
      )}

      {!manualPathVisible && (
        <div data-testid="onboarding-budget-scratch-choice">
          <Button
            variant="outline"
            onClick={() => setShowManualPath(true)}
            data-testid="onboarding-start-from-scratch"
          >
            {t("onboarding.starterTemplateScratchAction")}
          </Button>
          <p className="mt-1 text-caption text-ink-faint">
            {t("onboarding.starterTemplateScratchHint")}
          </p>
        </div>
      )}

      {manualPathVisible && (
        <>
          {groups.map((group) => (
            <Card key={group.id}>
              <CardContent>
                <h3 className="mb-2 text-h3 text-ink">{group.name}</h3>
                <GroupCategoryList group={group} />
              </CardContent>
            </Card>
          ))}

          {showGroupForm ? (
            <Card>
              <CardContent>
                <form onSubmit={handleSubmit(onSubmitGroup)} className="space-y-2">
                  <div className="space-y-1">
                    <Label htmlFor="onboarding-group-name" required>
                      {t("budget.groupName")}
                    </Label>
                    <Input
                      id="onboarding-group-name"
                      placeholder={t("budget.groupNamePlaceholder")}
                      autoFocus
                      required
                      aria-required="true"
                      aria-invalid={errors.name !== undefined || undefined}
                      aria-describedby={
                        errors.name ? "onboarding-group-name-error" : undefined
                      }
                      {...register("name", { required: t("budget.groupNameRequired") })}
                    />
                    {errors.name && (
                      <p
                        id="onboarding-group-name-error"
                        className="text-caption text-over-ink"
                        role="alert"
                      >
                        {errors.name.message}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm">
                      {t("budget.saveGroup")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        reset();
                        setShowGroupForm(false);
                      }}
                    >
                      {t("common.cancel")}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          ) : (
            <Button
              variant="outline"
              onClick={() => setShowGroupForm(true)}
              data-testid="add-group-button"
            >
              <Plus className="size-4" aria-hidden="true" /> {t("budget.addGroup")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
