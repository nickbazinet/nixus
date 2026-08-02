import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useForm, Controller } from "react-hook-form";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Plus, Trash2, TriangleAlert } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Money,
} from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { InlineEditText } from "@/components/shared/InlineEdit";
import {
  useBudgetCategories,
  useCreateBudgetCategory,
  useUpdateBudgetGroup,
  useUpdateBudgetCategory,
  useDeleteBudgetCategory,
  useDeleteBudgetGroup,
} from "@/hooks/useBudget";
import { BudgetCategoryRow } from "@/components/budget/BudgetCategoryRow";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import type { BudgetGroup, BudgetCategory, BudgetCategoryStatus, Expense } from "@/lib/types";

interface CategoryFormData {
  name: string;
  target_cents: number;
}

interface BudgetGroupCardProps {
  group: BudgetGroup;
  statusByCategory?: Map<number, BudgetCategoryStatus>;
  expensesByCategory?: Record<number, Expense[]>;
  onAddExpense?: (categoryId: number) => void;
}

export function BudgetGroupCard({
  group,
  statusByCategory,
  expensesByCategory,
  onAddExpense,
}: BudgetGroupCardProps) {
  const { t, i18n } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const maskProps = useMaskProps();
  const [collapsed, setCollapsed] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BudgetCategory | null>(null);
  const [showDeleteGroupDialog, setShowDeleteGroupDialog] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  const { data: categories = [] } = useBudgetCategories(group.id);
  const createCategory = useCreateBudgetCategory();
  const updateGroup = useUpdateBudgetGroup();
  const updateCategory = useUpdateBudgetCategory();
  const deleteCategory = useDeleteBudgetCategory();
  const deleteGroup = useDeleteBudgetGroup();

  const archivedStatuses = useMemo(() => {
    if (!statusByCategory) return [];
    const activeIds = new Set(categories.map((cat) => cat.id));
    return Array.from(statusByCategory.values()).filter(
      (status) =>
        status.group_id === group.id &&
        status.is_deleted &&
        !activeIds.has(status.id)
    );
  }, [statusByCategory, categories, group.id]);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<CategoryFormData>({
    defaultValues: { name: "", target_cents: 0 },
    // On blur, not on submit: a user should learn a field is wrong when they leave it, not after
    // filling the whole form and pressing Save.
    mode: "onBlur",
  });

  const nameFieldId = `cat-name-${group.id}`;
  const targetFieldId = `cat-target-${group.id}`;

  const onSubmit = (data: CategoryFormData) => {
    createCategory.mutate(
      {
        group_id: group.id,
        name: data.name,
        target_cents: data.target_cents,
      },
      {
        onSuccess: () => {
          toast.success(t("budget.categoryAdded", { name: data.name }));
          reset();
          setShowForm(false);
        },
        onError: () => {
          toast.error(t("budget.categoryAddFailed"));
        },
      }
    );
  };

  const handleUpdateGroupName = (name: string) => {
    updateGroup.mutate(
      { id: group.id, name },
      {
        onError: () => {
          toast.error(t("budget.groupRenameFailed"));
        },
      }
    );
  };

  const handleUpdateCategoryName = (cat: BudgetCategory, name: string) => {
    updateCategory.mutate(
      { id: cat.id, group_id: cat.group_id, name },
      {
        onError: () => {
          toast.error(t("budget.categoryRenameFailed"));
        },
      }
    );
  };

  const handleUpdateCategoryTarget = (cat: BudgetCategory, target_cents: number) => {
    updateCategory.mutate(
      { id: cat.id, group_id: cat.group_id, target_cents },
      {
        onSuccess: (updated) => {
          toast.success(
            t("budget.targetUpdated", { amount: formatCurrency(updated.target_cents) })
          );
        },
        onError: () => {
          toast.error(t("budget.targetUpdateFailed"));
        },
      }
    );
  };

  const handleDeleteCategory = () => {
    if (!deleteTarget) return;
    deleteCategory.mutate(
      { id: deleteTarget.id, group_id: deleteTarget.group_id },
      {
        onSuccess: () => {
          toast.success(t("budget.categoryDeleted"));
          setDeleteTarget(null);
        },
        onError: (err) => {
          const error = err as { message?: string };
          toast.error(error.message ?? t("budget.categoryDeleteFailed"));
        },
      }
    );
  };

  const handleDeleteGroup = () => {
    setGroupError(null);
    if (categories.length > 0) {
      deleteGroup.mutate(group.id, {
        onError: (err) => {
          const error = err as { message?: string };
          setGroupError(error.message ?? t("budget.removeAllCategoriesFirst"));
        },
      });
      return;
    }
    setShowDeleteGroupDialog(true);
  };

  const confirmDeleteGroup = () => {
    deleteGroup.mutate(group.id, {
      onSuccess: () => {
        toast.success(t("budget.groupDeleted"));
        setShowDeleteGroupDialog(false);
      },
      onError: () => {
        toast.error(t("budget.groupDeleteFailed"));
        setShowDeleteGroupDialog(false);
      },
    });
  };

  const groupTargetCents = categories.reduce((sum, cat) => sum + cat.target_cents, 0);

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => setCollapsed(!collapsed)}
                aria-label={collapsed ? t("budget.expandGroup") : t("budget.collapseGroup")}
                aria-expanded={!collapsed}
                data-testid="toggle-group-button"
              >
                {collapsed ? (
                  <ChevronRight className="text-ink-dim" aria-hidden="true" />
                ) : (
                  <ChevronDown className="text-ink-dim" aria-hidden="true" />
                )}
              </Button>
              <h2 className="flex min-w-0 items-center gap-2 text-h2 text-ink">
                <InlineEditText
                  value={group.name}
                  onSave={handleUpdateGroupName}
                  data-testid="group-name"
                />
                {categories.length > 0 && (
                  <span className="text-caption text-ink-dim" data-testid="group-total">
                    <Money cents={groupTargetCents} locale={i18n.language} {...maskProps} />
                  </span>
                )}
              </h2>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleDeleteGroup}
              className="text-ink-faint hover:text-over"
              data-testid="delete-group-button"
              aria-label={t("budget.deleteGroup")}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
          {groupError && (
            <Alert
              variant="over"
              icon={<TriangleAlert />}
              className="mt-2"
              data-testid="group-error"
            >
              <AlertDescription>{groupError}</AlertDescription>
            </Alert>
          )}
        </CardHeader>
        {!collapsed && (
        <CardContent className="space-y-3">
          {(categories.length > 0 || archivedStatuses.length > 0) && (
            <div>
              {categories.map((cat, index) => {
                const status: BudgetCategoryStatus = statusByCategory?.get(cat.id) ?? {
                  id: cat.id,
                  group_id: cat.group_id,
                  name: cat.name,
                  target_cents: cat.target_cents,
                  spent_cents: 0,
                  is_deleted: false,
                };
                return (
                  <BudgetCategoryRow
                    key={cat.id}
                    category={status}
                    expenses={expensesByCategory?.[cat.id]}
                    striped={index % 2 === 0}
                    onRename={(name) => handleUpdateCategoryName(cat, name)}
                    onUpdateTarget={(cents) => handleUpdateCategoryTarget(cat, cents)}
                    onDelete={() => setDeleteTarget(cat)}
                    onAddExpense={onAddExpense ? () => onAddExpense(cat.id) : undefined}
                  />
                );
              })}
              {archivedStatuses.map((status) => (
                <div key={status.id} data-testid="archived-budget-category-row">
                  <BudgetCategoryRow
                    category={status}
                    expenses={expensesByCategory?.[status.id]}
                    archived
                  />
                </div>
              ))}
            </div>
          )}

          {showForm ? (
            <form
              onSubmit={handleSubmit(onSubmit)}
              className="space-y-3 border-t border-line pt-3"
            >
              <div className="space-y-1.5">
                <Label htmlFor={nameFieldId} required>
                  {t("budget.categoryName")}
                </Label>
                <Input
                  id={nameFieldId}
                  placeholder={t("budget.categoryNamePlaceholder")}
                  aria-required="true"
                  aria-invalid={!!errors.name}
                  aria-describedby={errors.name ? `${nameFieldId}-error` : undefined}
                  {...register("name", { required: t("budget.nameRequired") })}
                />
                {errors.name && (
                  <p id={`${nameFieldId}-error`} className="text-caption text-over">
                    {errors.name.message}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={targetFieldId} required>
                  {t("budget.monthlyTarget")}
                </Label>
                <Controller
                  name="target_cents"
                  control={control}
                  rules={{
                    validate: (v) => v > 0 || t("budget.targetRequired"),
                  }}
                  render={({ field }) => (
                    <MoneyInput
                      id={targetFieldId}
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      aria-invalid={!!errors.target_cents}
                      aria-required
                      aria-describedby={
                        errors.target_cents ? `${targetFieldId}-error` : undefined
                      }
                    />
                  )}
                />
                {errors.target_cents && (
                  <p id={`${targetFieldId}-error`} className="text-caption text-over">
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowForm(true)}
              className="w-full justify-start text-ink-dim"
              data-testid="add-category-button"
            >
              <Plus aria-hidden="true" />
              {t("budget.addCategory")}
            </Button>
          )}
        </CardContent>)}
      </Card>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent data-testid="delete-category-dialog">
          <DialogHeader>
            <DialogTitle>{t("budget.deleteCategory")}</DialogTitle>
            {/* States what happens to the expenses filed under it, because the backend soft-deletes
              * the category and leaves them attached — a silent orphaning is what this copy prevents. */}
            <DialogDescription>
              {t("budget.deleteCategoryExplain", { name: deleteTarget?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteCategory}
              data-testid="confirm-delete-button"
            >
              {t("budget.archiveCategoryAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteGroupDialog} onOpenChange={setShowDeleteGroupDialog}>
        <DialogContent data-testid="delete-group-dialog">
          <DialogHeader>
            <DialogTitle>{t("budget.deleteGroupTitle")}</DialogTitle>
            <DialogDescription>
              {t("budget.deleteGroupExplain", { name: group.name })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteGroupDialog(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeleteGroup}
              data-testid="confirm-delete-group-button"
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
