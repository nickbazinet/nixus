import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useForm, Controller } from "react-hook-form";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Plus, Trash2, TriangleAlert } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  IconChip,
  Meter,
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
import { useCategoryReorder } from "@/hooks/useCategoryReorder";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { useMaskProps, useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { rampColor } from "@/components/spending-trends/insights-chart";
import { cn } from "@/lib/utils";
import { groupIcon } from "./groupIcon";
import { isCategoryOver } from "./groupStats";
import type { BudgetGroup, BudgetCategory, BudgetCategoryStatus, Expense } from "@/lib/types";

interface CategoryFormData {
  name: string;
  target_cents: number;
}

interface BudgetGroupCardProps {
  group: BudgetGroup;
  statusByCategory?: Map<number, BudgetCategoryStatus>;
  /**
   * Each category's spend rank across the whole budget, so a category wears the same ramp colour
   * here as in the "Where it went" donut beside it. Falls back to the row's position in the group.
   */
  colorRankByCategory?: Map<number, number>;
  expensesByCategory?: Record<number, Expense[]>;
  onAddExpense?: (categoryId: number) => void;
  /** True when another active group exists, so a category row can be dragged into it. */
  canMoveBetweenGroups?: boolean;
  /** Whether the group's categories are showing. Owned by the page so "Expand all" can drive it. */
  open: boolean;
  onToggle: () => void;
  /**
   * Edit mode: the structural controls — reorder handles, delete — are shown. Outside it the list
   * reads as a plan, not a form; renaming and retargeting stay one click away inline either way.
   */
  editing?: boolean;
  /** The group's spend rank across the budget, which picks its bar colour. */
  colorRank?: number;
  /**
   * The page's merchant search is active, and `expensesByCategory` holds only the matches: show
   * just the categories with a match, their transactions open, and nothing structural.
   */
  searching?: boolean;
}

export function BudgetGroupCard({
  group,
  statusByCategory,
  colorRankByCategory,
  expensesByCategory,
  onAddExpense,
  canMoveBetweenGroups = false,
  open,
  onToggle,
  editing = false,
  colorRank = 0,
  searching = false,
}: BudgetGroupCardProps) {
  const { t, i18n } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const maskProps = useMaskProps();
  const { hidden } = useValuesHidden();
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BudgetCategory | null>(null);
  const [showDeleteGroupDialog, setShowDeleteGroupDialog] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);

  const { data: categories = [] } = useBudgetCategories(group.id);
  const { orderedCategories, drag, setRowRef, beginPointerDrag } =
    useCategoryReorder(group.id, categories);
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

  // The status carries a savings line's calculated target; the stored one is only a snapshot.
  const groupTargetCents = categories.reduce(
    (sum, cat) => sum + (statusByCategory?.get(cat.id)?.target_cents ?? cat.target_cents),
    0
  );

  const activeStatuses = categories.map((cat) => statusByCategory?.get(cat.id));
  const groupSpentCents =
    activeStatuses.reduce((sum, status) => sum + (status?.spent_cents ?? 0), 0) +
    archivedStatuses.reduce((sum, status) => sum + status.spent_cents, 0);
  const overCount = activeStatuses.filter(
    (status): status is BudgetCategoryStatus => status !== undefined && isCategoryOver(status)
  ).length;
  const groupStatus = group.is_deleted
    ? null
    : overCount > 0
      ? { variant: "over" as const, label: t("budget.v3.groupOver", { count: overCount }) }
      : groupSpentCents > 0
        ? { variant: "good" as const, label: t("budget.v3.groupOnTrack") }
        : { variant: "neutral" as const, label: t("budget.v3.groupNotStarted") };
  const groupColor = overCount > 0 && groupSpentCents > groupTargetCents
    ? "var(--over)"
    : rampColor(colorRank);
  const Icon = groupIcon(group.name);

  return (
    <>
      {/* One card per group, closed to a single summary line until the user asks for its
        * categories — the budget reads as seven lines, not seventy. */}
      <Card
        flush
        render={<section />}
        data-budget-group-id={group.is_deleted ? undefined : group.id}
        data-open={open || undefined}
        className="overflow-visible data-[drop-target=true]:ring-2 data-[drop-target=true]:ring-brand"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggle}
            aria-label={open ? t("budget.collapseGroup") : t("budget.expandGroup")}
            aria-expanded={open}
            data-testid="toggle-group-button"
            className="-ml-1.5 shrink-0"
          >
            {open ? (
              <ChevronDown className="text-ink-dim" aria-hidden="true" />
            ) : (
              <ChevronRight className="text-ink-dim" aria-hidden="true" />
            )}
          </Button>
          <IconChip icon={Icon} />
          <div className="min-w-0 basis-44 shrink-0">
            <h2 className="flex min-w-0 items-center gap-2 text-h2 text-ink">
              {group.is_deleted ? (
                <span className="truncate" data-testid="group-name">
                  {group.name}
                </span>
              ) : (
                <InlineEditText
                  value={group.name}
                  onSave={handleUpdateGroupName}
                  className="font-display text-h2"
                  data-testid="group-name"
                />
              )}
              {group.is_deleted && (
                <Badge variant="neutral" data-testid="archived-group-badge">
                  {t("budget.archivedGroup")}
                </Badge>
              )}
            </h2>
            <p className="text-caption text-ink-dim">
              {t("budget.v3.categoryCount", { count: categories.length })}
            </p>
          </div>

          <div className="min-w-32 flex-1">
            {groupTargetCents > 0 && (
              <Meter
                value={groupSpentCents}
                max={groupTargetCents}
                color={groupColor}
                label={t("budget.v3.groupMeterLabel", { name: group.name })}
                valueText={
                  hidden
                    ? t("common.amountHidden")
                    : t("budget.categoryMeterValue", {
                        spent: formatCurrency(groupSpentCents),
                        target: formatCurrency(groupTargetCents),
                      })
                }
                data-testid="group-progress"
              />
            )}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-4">
            {categories.length > 0 && (
              <span className="text-right text-label whitespace-nowrap text-ink">
                <Money
                  cents={groupSpentCents}
                  locale={i18n.language}
                  className="font-bold"
                  data-testid="group-spent"
                  {...maskProps}
                />
                <span className="text-caption font-normal text-ink-dim">
                  {" "}
                  {t("budget.ofSeparator")}{" "}
                  <span data-testid="group-total">
                    <Money cents={groupTargetCents} locale={i18n.language} {...maskProps} />
                  </span>
                </span>
              </span>
            )}
            {groupStatus && (
              <Badge
                variant={groupStatus.variant}
                className="min-w-[5.5rem]"
                data-testid="group-status-badge"
              >
                {groupStatus.label}
              </Badge>
            )}
            {editing && !group.is_deleted && (
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
            )}
          </div>
        </div>

        {groupError && (
          <Alert
            variant="over"
            icon={<TriangleAlert />}
            className="mx-5 mb-4"
            data-testid="group-error"
          >
            <AlertDescription>{groupError}</AlertDescription>
          </Alert>
        )}

        {open && (
          <div className="px-5 pb-4 md:pl-[4.25rem]">
            {(categories.length > 0 || archivedStatuses.length > 0) && (
              <div>
                {orderedCategories.map((cat, index) => {
                  // Skipped rather than filtered out, so `index` stays the drag hook's index.
                  if (searching && !(expensesByCategory?.[cat.id]?.length ?? 0)) return null;
                  const status: BudgetCategoryStatus = statusByCategory?.get(cat.id) ?? {
                    id: cat.id,
                    group_id: cat.group_id,
                    name: cat.name,
                    target_cents: cat.target_cents,
                    spent_cents: 0,
                    is_deleted: false,
                    project_id: cat.project_id,
                  };
                  return (
                    <BudgetCategoryRow
                      key={cat.id}
                      category={status}
                      expenses={expensesByCategory?.[cat.id]}
                      colorRank={colorRankByCategory?.get(cat.id) ?? index}
                      onRename={(name) => handleUpdateCategoryName(cat, name)}
                      onUpdateTarget={(cents) => handleUpdateCategoryTarget(cat, cents)}
                      onDelete={editing ? () => setDeleteTarget(cat) : undefined}
                      onAddExpense={onAddExpense ? () => onAddExpense(cat.id) : undefined}
                      showDragHandle={
                        editing && (orderedCategories.length > 1 || canMoveBetweenGroups)
                      }
                      onDragHandlePointerDown={beginPointerDrag(index)}
                      rowRef={setRowRef(index)}
                      isDragSource={drag?.from === index}
                      isDragOver={drag !== null && drag.over === index && drag.from !== index}
                      forceExpanded={searching}
                    />
                  );
                })}
                {archivedStatuses
                  .filter((status) => !searching || (expensesByCategory?.[status.id]?.length ?? 0) > 0)
                  .map((status) => (
                    <div key={status.id} data-testid="archived-budget-category-row">
                      <BudgetCategoryRow
                        category={status}
                        expenses={expensesByCategory?.[status.id]}
                        archived
                        forceExpanded={searching}
                      />
                    </div>
                  ))}
              </div>
            )}

            {!group.is_deleted && !searching &&
              (showForm ? (
                <form
                  onSubmit={handleSubmit(onSubmit)}
                  className={cn(
                    "space-y-3 pt-3",
                    categories.length > 0 && "border-t border-line"
                  )}
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
                          className="w-full max-w-48"
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
                  className="mt-1 -ml-2 text-ink-dim"
                  data-testid="add-category-button"
                >
                  <Plus aria-hidden="true" />
                  {t("budget.addCategory")}
                </Button>
              ))}
          </div>
        )}
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
