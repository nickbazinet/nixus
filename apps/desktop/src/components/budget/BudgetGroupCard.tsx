import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useForm, Controller } from "react-hook-form";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@nixus/shared";
import { Button } from "@nixus/shared";
import { Input } from "@nixus/shared";
import { Label } from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { InlineEditText } from "@/components/shared/InlineEdit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nixus/shared";
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
import type { BudgetGroup, BudgetCategory, BudgetCategoryStatus, Expense } from "@/lib/types";

interface CategoryFormData {
  name: string;
  target_cents: number;
}

interface BudgetGroupCardProps {
  group: BudgetGroup;
  statusByCategory?: Map<number, BudgetCategoryStatus>;
  expensesByCategory?: Record<number, Expense[]>;
}

export function BudgetGroupCard({ group, statusByCategory, expensesByCategory }: BudgetGroupCardProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
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
    mode: "onSubmit",
  });

  const onSubmit = (data: CategoryFormData) => {
    createCategory.mutate(
      {
        group_id: group.id,
        name: data.name,
        target_cents: data.target_cents,
      },
      {
        onSuccess: () => {
          toast.success(`Category "${data.name}" added`);
          reset();
          setShowForm(false);
        },
        onError: () => {
          toast.error("Failed to create category");
        },
      }
    );
  };

  const handleUpdateGroupName = (name: string) => {
    updateGroup.mutate(
      { id: group.id, name },
      {
        onSuccess: () => {
          toast.success("Group name updated");
        },
        onError: () => {
          toast.error("Failed to update group name");
        },
      }
    );
  };

  const handleUpdateCategoryName = (cat: BudgetCategory, name: string) => {
    updateCategory.mutate(
      { id: cat.id, group_id: cat.group_id, name },
      {
        onSuccess: () => {
          toast.success("Category name updated");
        },
        onError: () => {
          toast.error("Failed to update category name");
        },
      }
    );
  };

  const handleUpdateCategoryTarget = (cat: BudgetCategory, target_cents: number) => {
    updateCategory.mutate(
      { id: cat.id, group_id: cat.group_id, target_cents },
      {
        onSuccess: (updated) => {
          toast.success(`Budget target updated to ${formatCurrency(updated.target_cents)}`);
        },
        onError: () => {
          toast.error("Failed to update budget target");
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
          toast.success("Category deleted");
          setDeleteTarget(null);
        },
        onError: (err) => {
          const error = err as { message?: string };
          toast.error(error.message ?? "Failed to delete category");
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
        toast.success("Group deleted");
        setShowDeleteGroupDialog(false);
      },
      onError: () => {
        toast.error("Failed to delete group");
        setShowDeleteGroupDialog(false);
      },
    });
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCollapsed(!collapsed)}
                className="p-0.5 rounded hover:bg-muted/50 transition-colors"
                aria-label={collapsed ? t("budget.expandGroup") : t("budget.collapseGroup")}
                data-testid="toggle-group-button"
              >
                {collapsed ? (
                  <ChevronRight className="size-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-4 text-muted-foreground" />
                )}
              </button>
              <CardTitle>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <InlineEditText
                    value={group.name}
                    onSave={handleUpdateGroupName}
                    data-testid="group-name"
                  />
                  {categories.length > 0 && (
                    <span className="text-sm font-normal text-muted-foreground" data-testid="group-total">
                      {formatCurrency(categories.reduce((sum, cat) => sum + cat.target_cents, 0))}
                    </span>
                  )}
                </h2>
              </CardTitle>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleDeleteGroup}
              data-testid="delete-group-button"
              aria-label={t("budget.deleteGroup")}
            >
              <Trash2 className="size-4 text-muted-foreground" />
            </Button>
          </div>
          {groupError && (
            <p className="text-xs text-destructive mt-1" data-testid="group-error">
              {groupError}
            </p>
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
              className="space-y-3 border-t pt-3"
            >
              <div className="space-y-1.5">
                <Label htmlFor={`cat-name-${group.id}`}>{t("budget.categoryName")}</Label>
                <Input
                  id={`cat-name-${group.id}`}
                  placeholder={t("budget.categoryNamePlaceholder")}
                  aria-invalid={!!errors.name}
                  {...register("name", { required: t("budget.nameRequired") })}
                />
                {errors.name && (
                  <p className="text-xs text-destructive">{errors.name.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`cat-target-${group.id}`}>{t("budget.monthlyTarget")}</Label>
                <Controller
                  name="target_cents"
                  control={control}
                  rules={{
                    validate: (v) => v > 0 || t("budget.targetRequired"),
                  }}
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
                {errors.target_cents && (
                  <p className="text-xs text-destructive">
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
              className="w-full justify-start text-muted-foreground"
              data-testid="add-category-button"
            >
              <Plus className="size-4 mr-1" />
              {t("budget.addCategory")}
            </Button>
          )}
        </CardContent>)}
      </Card>

      {/* Delete Category Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent data-testid="delete-category-dialog">
          <DialogHeader>
            <DialogTitle>{t("budget.deleteCategory")}</DialogTitle>
            <DialogDescription>
              {t("budget.confirmDelete")} {deleteTarget?.name}? {t("budget.cannotBeUndone")}
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
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Group Confirmation Dialog */}
      <Dialog open={showDeleteGroupDialog} onOpenChange={setShowDeleteGroupDialog}>
        <DialogContent data-testid="delete-group-dialog">
          <DialogHeader>
            <DialogTitle>{t("budget.deleteGroupTitle")}</DialogTitle>
            <DialogDescription>
              {t("budget.confirmDelete")} {group.name}? {t("budget.cannotBeUndone")}
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
              data-testid="confirm-delete-button"
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
