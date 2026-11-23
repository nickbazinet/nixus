import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ChartNoAxesColumn,
  ChevronDown,
  ChevronsUpDown,
  FolderPlus,
  Lightbulb,
  PencilLine,
  Plus,
  Repeat,
  Search,
  Sparkles,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { usePeriod } from "@/hooks/usePeriod";
import { BudgetSummaryStrip } from "@/components/budget/BudgetSummaryStrip";
import { AddExpenseForm } from "@/components/expenses/AddExpenseForm";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Label,
  PillTabs,
  SlideOver,
} from "@nixus/shared";
import { InsightCallout } from "@/components/shared/InsightCallout";
import { BudgetGroupCard } from "@/components/budget/BudgetGroupCard";
import { GroupSpendBar } from "@/components/budget/GroupSpendBar";
import {
  groupRanks,
  groupStatsFrom,
  type GroupFilter,
} from "@/components/budget/groupStats";
import { useBudgetGroupsForMonth, useCreateBudgetGroup, useBudgetStatus } from "@/hooks/useBudget";
import { useBudgetSummary, useSpendingBreakdown } from "@/hooks/useDashboard";
import { useExpensesByMonth, groupExpensesByCategory } from "@/hooks/useExpenses";
import { useApplyRecurringExpenses } from "@/hooks/useRecurringExpenses";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import type { BudgetCategoryStatus } from "@/lib/types";

const GROUP_FILTERS = ["all", "over", "onTrack", "notStarted"] as const satisfies readonly GroupFilter[];

export const Route = createFileRoute("/spending/budget")({
  component: BudgetPage,
});

interface GroupFormData {
  name: string;
}

interface Rebalance {
  overName: string;
  overAmountCents: number;
  underName: string;
  underAmountCents: number;
  moveAmountCents: number;
}

/**
 * The one sentence worth reading on this surface: the category that went over, paired with the one
 * that has room for it. Derived from the month's own status rows — nothing is estimated, and a
 * savings line is never "over" because setting aside more than planned is not overspending.
 */
function findRebalance(statuses: BudgetCategoryStatus[]): Rebalance | null {
  const live = statuses.filter(
    (status) => !status.is_deleted && status.project_id == null && status.target_cents > 0
  );
  const worst = live
    .filter((status) => status.spent_cents > status.target_cents)
    .sort(
      (a, b) =>
        b.spent_cents - b.target_cents - (a.spent_cents - a.target_cents)
    )[0];
  if (!worst) return null;

  const roomiest = live
    .filter((status) => status.id !== worst.id && status.target_cents > status.spent_cents)
    .sort(
      (a, b) =>
        b.target_cents - b.spent_cents - (a.target_cents - a.spent_cents)
    )[0];
  if (!roomiest) return null;

  const overAmountCents = worst.spent_cents - worst.target_cents;
  const underAmountCents = roomiest.target_cents - roomiest.spent_cents;
  return {
    overName: worst.name,
    overAmountCents,
    underName: roomiest.name,
    underAmountCents,
    moveAmountCents: Math.min(overAmountCents, underAmountCents),
  };
}

function BudgetPage() {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseCategoryId, setExpenseCategoryId] = useState<number | undefined>(undefined);
  const { year: selectedYear, month: selectedMonth, label: periodLabel } = usePeriod();
  const groupsQuery = useBudgetGroupsForMonth(selectedYear, selectedMonth);
  const groups = groupsQuery.data ?? [];
  const activeGroupCount = groups.filter((group) => !group.is_deleted).length;
  const createGroup = useCreateBudgetGroup();

  const statusQuery = useBudgetStatus(selectedYear, selectedMonth);
  const statusList = statusQuery.data ?? [];
  const [filter, setFilter] = useState<GroupFilter>("all");
  const [editing, setEditing] = useState(false);
  // Which groups are open, by id. A group is seeded the first time it is seen with real status
  // data: open when it needs attention (a category over) or has nothing in it yet (so its "Add
  // category" is right there), closed otherwise. After that it is the user's choice.
  const [openGroups, setOpenGroups] = useState<Record<number, boolean>>({});
  // One merchant search for the whole budget, rather than a field inside every open category.
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const searching = needle !== "";
  const { data: monthExpenses = [] } = useExpensesByMonth(selectedYear, selectedMonth);
  const { data: breakdown } = useSpendingBreakdown(selectedYear, selectedMonth);
  const allExpensesByCategory = groupExpensesByCategory(monthExpenses);
  const budgetSummary = useBudgetSummary(selectedYear, selectedMonth);
  const summary = budgetSummary.data;
  const applyRecurring = useApplyRecurringExpenses();

  const hasGroups = groups.length > 0;
  const rebalance = findRebalance(statusList ?? []);
  const categorySpend = (breakdown ?? []).map((row) => ({
    key: row.category_id,
    label: row.category_name,
    cents: row.spent_cents,
  }));
  const groupStats = groupStatsFrom(statusList);
  const groupRank = groupRanks(groupStats);
  const activeGroups = groups.filter((group) => !group.is_deleted);
  const activeCategoryCount = statusList.filter((status) => !status.is_deleted).length;

  // The first pass applies the rule to the budget the user arrived at. A group that appears after
  // that was just created here, so it opens: the next thing the user does is fill it.
  const loadedStatuses = statusQuery.isSuccess ? statusQuery.data : undefined;
  const loadedGroups = groupsQuery.isSuccess ? groupsQuery.data : undefined;
  const seededRef = useRef(false);
  useEffect(() => {
    if (!loadedStatuses || !loadedGroups) return;
    const firstPass = !seededRef.current;
    seededRef.current = true;
    const stats = groupStatsFrom(loadedStatuses);
    setOpenGroups((current) => {
      const unseen = loadedGroups.filter((group) => !(group.id in current));
      if (unseen.length === 0) return current;
      const next = { ...current };
      for (const group of unseen) {
        const entry = stats.get(group.id);
        next[group.id] =
          !firstPass || !entry || entry.categoryCount === 0 || entry.overCount > 0;
      }
      return next;
    });
  }, [loadedGroups, loadedStatuses]);

  // Matching is on the merchant only — the same rule, and the same hint, as the Transactions search.
  const expensesByCategory = searching
    ? Object.fromEntries(
        Object.entries(allExpensesByCategory).map(([categoryId, expenses]) => [
          categoryId,
          expenses.filter((expense) => expense.merchant.toLocaleLowerCase().includes(needle)),
        ])
      )
    : allExpensesByCategory;
  const matchCount = searching
    ? Object.values(expensesByCategory).reduce((sum, expenses) => sum + expenses.length, 0)
    : 0;
  const groupHasMatch = (groupId: number) =>
    statusList.some(
      (status) =>
        status.group_id === groupId && (expensesByCategory[status.id]?.length ?? 0) > 0
    );

  const isOpen = (groupId: number) =>
    editing || searching || (openGroups[groupId] ?? true);
  const allOpen = groups.length > 0 && groups.every((group) => isOpen(group.id));
  const setAllOpen = (open: boolean) =>
    setOpenGroups(Object.fromEntries(groups.map((group) => [group.id, open])));

  const visibleGroups = groups.filter((group) => {
    if (searching && !groupHasMatch(group.id)) return false;
    if (filter === "all") return true;
    if (group.is_deleted) return false;
    return (groupStats.get(group.id)?.status ?? "notStarted") === filter;
  });

  const groupSpend = activeGroups
    .map((group) => ({
      key: group.id,
      label: group.name,
      cents: groupStats.get(group.id)?.spentCents ?? 0,
      rank: groupRank.get(group.id) ?? 0,
    }))
    .filter((item) => item.cents > 0);
  const hasBreakdown = groupSpend.length > 0;

  const openExpenseForm = (categoryId?: number) => {
    setExpenseCategoryId(categoryId);
    setShowExpenseForm(true);
  };

  const statusByCategory = new Map<number, BudgetCategoryStatus>();
  for (const s of statusList) {
    statusByCategory.set(s.id, s);
  }

  // The donut ranks slices by spend, largest first; ranking the rows the same way gives each
  // category one colour across both cards. Categories with nothing spent rank after every slice.
  const colorRankByCategory = new Map<number, number>();
  [...categorySpend]
    .filter((item) => item.cents > 0)
    .sort((a, b) => b.cents - a.cents)
    .forEach((item, rank) => colorRankByCategory.set(item.key, rank));
  [...statusList]
    .sort((a, b) => b.spent_cents - a.spent_cents)
    .forEach((status) => {
      if (!colorRankByCategory.has(status.id)) {
        colorRankByCategory.set(status.id, colorRankByCategory.size);
      }
    });

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
      onError: () => {
        toast.error(t("budget.groupCreateFailed"));
      },
    });
  };

  const handleApplyRecurring = () => {
    applyRecurring.mutate(
      { year: selectedYear, month: selectedMonth },
      {
        onSuccess: (created) => {
          if (created.length > 0) {
            toast.success(t("recurring.appliedExpenses", { count: created.length }));
          } else {
            toast.success(t("recurring.allAlreadyApplied"));
          }
        },
        onError: () => {
          toast.error(t("recurring.applyFailed"));
        },
      }
    );
  };

  return (
    <div>
      <PageHeader
        title={t("nav.budget")}
        subtitle={t("surface.subtitle.budget")}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button data-testid="add-transactions-trigger" disabled={!hasGroups} />}
            >
              <Plus data-icon="inline-start" aria-hidden="true" />
              {t("budget.addTransactions")}
              <ChevronDown data-icon="inline-end" aria-hidden="true" />
            </DropdownMenuTrigger>
            {/* `w-max` is load-bearing: DropdownMenuContent is
             * `w-(--anchor-width)`, so anchored to this compact trigger the
             * longest label — French manual entry — would wrap or clip. Sizing
             * to content lets any locale set the width; `min-w-56` keeps the
             * panel from looking cramped beside the trigger.
             *
             * Named by its trigger rather than an `aria-label`: Base UI points
             * the panel's `aria-labelledby` at the button, and labelledby wins
             * the accessible-name calculation, so an `aria-label` would be dead. */}
            <DropdownMenuContent
              align="end"
              className="w-max min-w-56"
              data-testid="add-transactions-menu"
            >
              {/* `render` rather than a nested anchor: Base UI's menu item owns
               * roving focus and typeahead, and an anchor child would take the
               * tab stop away from it. */}
              <DropdownMenuItem
                render={<Link to="/import" data-testid="import-statement-item" />}
              >
                <Sparkles aria-hidden="true" />
                {t("dashboard.importStatement")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => openExpenseForm()}
                data-testid="add-expense-manually-item"
              >
                <Plus aria-hidden="true" />
                {t("budget.addExpenseManually")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleApplyRecurring}
                disabled={applyRecurring.isPending}
                data-testid="apply-recurring-item"
              >
                <Repeat aria-hidden="true" />
                {t("budget.applyRecurringExpenses")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="flex flex-col gap-grid-gap">
        {!hasGroups && (
          <p className="text-caption text-ink-dim" data-testid="add-transactions-hint">
            {t("budget.createGroupFirst")}
          </p>
        )}

        <BudgetSummaryStrip
          totalTargetCents={summary?.total_target_cents ?? 0}
          totalSpentCents={summary?.total_spent_cents ?? 0}
          remainingCents={summary?.remaining_cents ?? 0}
          averageMonthlyIncomeCents={summary?.average_monthly_income_cents ?? 0}
          incomeMonthCount={summary?.income_month_count ?? 0}
          budgetedCaption={
            hasGroups
              ? `${t("budget.v3.groupCount", { count: activeGroups.length })}, ${t(
                  "budget.v3.categoryCount",
                  { count: activeCategoryCount }
                )}`
              : undefined
          }
        />

        {(hasBreakdown || rebalance) && (
          <div
            className={
              hasBreakdown && rebalance
                ? "grid items-start gap-grid-gap lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]"
                : "grid gap-grid-gap"
            }
          >
            {hasBreakdown && (
              <Card>
                <CardHeader>
                  <CardTitle icon={ChartNoAxesColumn}>{t("budget.v3.byGroupTitle")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <GroupSpendBar
                    items={groupSpend}
                    listLabel={t("budget.v3.byGroupListLabel", { period: periodLabel })}
                    data-testid="budget-breakdown"
                  />
                </CardContent>
              </Card>
            )}

            {rebalance && (
              <InsightCallout
                icon={Lightbulb}
                eyebrow={t("budget.v2.headsUpEyebrow")}
                actions={
                  !editing ? (
                    <Button size="sm" onClick={() => setEditing(true)} data-testid="rebalance-adjust">
                      {t("budget.v3.adjustTargets")}
                    </Button>
                  ) : undefined
                }
                data-testid="budget-rebalance-insight"
              >
                {t("budget.v2.rebalanceInsight", {
                  overName: rebalance.overName,
                  overAmount: formatCurrency(rebalance.overAmountCents),
                  underName: rebalance.underName,
                  underAmount: formatCurrency(rebalance.underAmountCents),
                  moveAmount: formatCurrency(rebalance.moveAmountCents),
                })}
              </InsightCallout>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {hasGroups ? (
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-64">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-faint"
                />
                <Input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("expenses.searchMerchants")}
                  aria-label={t("expenses.searchMerchants")}
                  className="rounded-full bg-card pl-10"
                  data-testid="expense-search"
                />
              </div>
              {searching && (
                <span className="text-caption text-ink-dim" data-testid="expense-count">
                  {t("expenses.rowCount", { count: matchCount })}
                </span>
              )}
              <div role="group" aria-label={t("budget.v3.filterLabel")}>
                <PillTabs
                  options={GROUP_FILTERS}
                  labels={{
                    all: t("budget.v3.filterAll"),
                    over: t("budget.v3.filterOver"),
                    onTrack: t("budget.v3.filterOnTrack"),
                    notStarted: t("budget.v3.filterNotStarted"),
                  }}
                  value={filter}
                  onChange={setFilter}
                  data-testid="budget-group-filter"
                />
              </div>
            </div>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {hasGroups && !editing && !searching && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAllOpen(!allOpen)}
                data-testid="expand-all-groups"
              >
                <ChevronsUpDown aria-hidden="true" />
                {allOpen ? t("budget.v3.collapseAll") : t("budget.v3.expandAll")}
              </Button>
            )}
            {hasGroups && (
              <Button
                variant={editing ? "default" : "outline"}
                size="sm"
                onClick={() => setEditing(!editing)}
                aria-pressed={editing}
                data-testid="edit-budget-toggle"
              >
                <PencilLine aria-hidden="true" />
                {editing ? t("budget.v3.doneEditing") : t("budget.v3.editBudget")}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowGroupForm(true)}
              data-testid="add-group-button"
            >
              <Plus aria-hidden="true" />
              {t("budget.addGroup")}
            </Button>
          </div>
        </div>

        {hasGroups ? (
          <div className="flex flex-col gap-3">
            {visibleGroups.map((group) => (
              <BudgetGroupCard
                key={group.id}
                group={group}
                statusByCategory={statusByCategory}
                colorRankByCategory={colorRankByCategory}
                expensesByCategory={expensesByCategory}
                onAddExpense={openExpenseForm}
                canMoveBetweenGroups={activeGroupCount > 1}
                open={isOpen(group.id)}
                onToggle={() =>
                  setOpenGroups((current) => ({ ...current, [group.id]: !isOpen(group.id) }))
                }
                editing={editing}
                colorRank={groupRank.get(group.id) ?? 0}
                searching={searching}
              />
            ))}
            {searching && visibleGroups.length === 0 && (
              <Card>
                <CardContent>
                  <EmptyState
                    icon={<Search />}
                    title={t("expenses.noMatchTitle", { query: query.trim() })}
                    description={t("expenses.searchScopeHint")}
                    action={
                      <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                        {t("expenses.clearFilters")}
                      </Button>
                    }
                    data-testid="expense-no-match"
                  />
                </CardContent>
              </Card>
            )}
            {!searching && visibleGroups.length === 0 && (
              <p
                className="rounded-xl border border-dashed border-line-strong px-5 py-8 text-center text-body text-ink-dim"
                data-testid="budget-no-matching-groups"
              >
                {t("budget.v3.noMatchingGroups")}
              </p>
            )}
          </div>
        ) : (
          <Card>
            <CardContent>
              <EmptyState
                icon={<FolderPlus />}
                title={t("budget.noGroupsTitle")}
                description={t("budget.noGroupsDescription")}
                action={
                  <Button size="sm" onClick={() => setShowGroupForm(true)}>
                    <Plus aria-hidden="true" />
                    {t("budget.addGroup")}
                  </Button>
                }
                data-testid="budget-empty-state"
              />
            </CardContent>
          </Card>
        )}
      </div>

      <SlideOver
        open={showExpenseForm}
        onClose={() => setShowExpenseForm(false)}
        title={t("budget.addExpense")}
        description={t("expenses.addExpenseDescription")}
        data-testid="expense-slide-over"
      >
        <AddExpenseForm
          defaultCategoryId={expenseCategoryId}
          onClose={() => setShowExpenseForm(false)}
        />
      </SlideOver>

      <SlideOver
        open={showGroupForm}
        onClose={() => {
          reset();
          setShowGroupForm(false);
        }}
        title={t("budget.addBudgetGroup")}
        description={t("budget.addBudgetGroupDescription")}
        data-testid="group-slide-over"
      >
        <form
          onSubmit={handleSubmit(onSubmitGroup)}
          className="space-y-3"
          data-testid="add-group-form"
        >
          <div className="space-y-1.5">
            <Label htmlFor="group-name" required>
              {t("budget.groupName")}
            </Label>
            <Input
              id="group-name"
              placeholder={t("budget.groupNamePlaceholder")}
              autoFocus
              aria-required="true"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "group-name-error" : undefined}
              {...register("name", { required: t("budget.groupNameRequired") })}
            />
            {errors.name && (
              <p id="group-name-error" className="text-caption text-over">
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
              variant="ghost"
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
      </SlideOver>
    </div>
  );
}
