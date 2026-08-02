import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useForm, Controller } from "react-hook-form";
import {
  Badge,
  BulkBar,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Money,
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SlideOver,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  focusRing,
  type EmptyStateProps,
  type SortDirection,
} from "@nixus/shared";
import { toast } from "sonner";
import { Plus, Receipt, Search } from "lucide-react";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { InlineEditMoney } from "@/components/shared/InlineEdit";
import { OptionalAccountSelect } from "@/components/shared/OptionalAccountSelect";
import { useUpdateExpense, useDeleteExpense, useAllBudgetCategories } from "@/hooks/useExpenses";
import { useAccounts } from "@/hooks/useAccounts";
import { useBudgetGroups } from "@/hooks/useBudget";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import { cn } from "@/lib/utils";
import type { Expense } from "@/lib/types";

interface ExpenseListProps {
  expenses: Expense[];
  onAddExpense?: () => void;
  /**
   * Off inside a budget category row, where the category is already the heading. The standalone
   * Transactions surface needs it. Named "Category or source" because the column is the reserved
   * shape for the unified view, where an income row's source lands in the same slot.
   */
  showCategory?: boolean;
}

interface EditFormData {
  merchant: string;
  amount_cents: number;
  budget_category_id: string;
  account_id: string;
  date: string;
}

type SortKey = "date" | "merchant" | "amount";

function formatShortDate(isoDate: string, locale: string): string {
  const [, month, day] = isoDate.split("-");
  const date = new Date(Number(isoDate.slice(0, 4)), Number(month) - 1, Number(day));
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function EditExpenseForm({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: categories = [] } = useAllBudgetCategories();
  const { data: groups = [] } = useBudgetGroups();
  const updateExpense = useUpdateExpense();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<EditFormData>({
    defaultValues: {
      merchant: expense.merchant,
      amount_cents: expense.amount_cents,
      budget_category_id: String(expense.budget_category_id),
      account_id: expense.account_id ? String(expense.account_id) : "",
      date: expense.date,
    },
    // Validate as the user leaves each field, not once at submit — otherwise five fields are filled
    // before the first problem is reported.
    mode: "onBlur",
  });

  const onSubmit = (data: EditFormData) => {
    updateExpense.mutate(
      {
        id: expense.id,
        merchant: data.merchant,
        amount_cents: data.amount_cents,
        budget_category_id: Number(data.budget_category_id),
        date: data.date,
        account_id: data.account_id ? Number(data.account_id) : null,
      },
      {
        onSuccess: () => {
          toast.success(t("expenses.expenseUpdated"));
          onClose();
        },
        onError: () => {
          toast.error(t("expenses.expenseUpdateFailed"));
        },
      }
    );
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-3"
      data-testid="edit-expense-form"
    >
      <div className="space-y-1.5">
        <Label htmlFor="edit-merchant" required>
          {t("expenses.merchant")}
        </Label>
        <Input
          id="edit-merchant"
          autoFocus
          aria-required="true"
          aria-invalid={!!errors.merchant}
          aria-describedby={errors.merchant ? "edit-merchant-error" : undefined}
          {...register("merchant", { required: t("expenses.merchantRequired") })}
        />
        {errors.merchant && (
          <p id="edit-merchant-error" className="text-caption text-over">
            {errors.merchant.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-amount" required>
          {t("common.amount")}
        </Label>
        <Controller
          name="amount_cents"
          control={control}
          rules={{ validate: (v) => v > 0 || t("expenses.amountRequired") }}
          render={({ field }) => (
            <MoneyInput
              id="edit-amount"
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              aria-required
              aria-invalid={!!errors.amount_cents}
              aria-describedby={errors.amount_cents ? "edit-amount-error" : undefined}
            />
          )}
        />
        {errors.amount_cents && (
          <p id="edit-amount-error" className="text-caption text-over">
            {errors.amount_cents.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="edit-category" required>
          {t("common.category")}
        </Label>
        <Controller
          name="budget_category_id"
          control={control}
          rules={{ required: t("expenses.categoryRequired") }}
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange} items={categories.map((cat) => ({ value: String(cat.id), label: cat.name }))}>
              <SelectTrigger
                id="edit-category"
                aria-required="true"
                aria-invalid={!!errors.budget_category_id}
                aria-describedby={errors.budget_category_id ? "edit-category-error" : undefined}
              >
                <SelectValue placeholder={t("expenses.selectCategory")} />
              </SelectTrigger>
              <SelectContent>
                {groups.map((group) => {
                  const groupCats = categories.filter(
                    (c) => c.group_id === group.id
                  );
                  if (groupCats.length === 0) return null;
                  return (
                    <SelectGroup key={group.id}>
                      <SelectGroupLabel>{group.name}</SelectGroupLabel>
                      {groupCats.map((cat) => (
                        <SelectItem key={cat.id} value={String(cat.id)}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  );
                })}
              </SelectContent>
            </Select>
          )}
        />
        {errors.budget_category_id && (
          <p id="edit-category-error" className="text-caption text-over">
            {errors.budget_category_id.message}
          </p>
        )}
      </div>

      <Controller
        name="account_id"
        control={control}
        render={({ field }) => (
          <OptionalAccountSelect
            id="edit-expense-account"
            value={field.value}
            onChange={field.onChange}
            labelKey="expenses.accountOptional"
            helpKey="expenses.accountLinkHelp"
          />
        )}
      />

      <div className="space-y-1.5">
        <Label htmlFor="edit-date" required>
          {t("common.date")}
        </Label>
        <Controller
          name="date"
          control={control}
          rules={{ required: t("expenses.dateRequired") }}
          render={({ field }) => (
            <DatePicker
              id="edit-date"
              value={field.value}
              onChange={field.onChange}
              aria-required="true"
              aria-invalid={!!errors.date}
              aria-describedby={errors.date ? "edit-date-error" : undefined}
            />
          )}
        />
        {errors.date && (
          <p id="edit-date-error" className="text-caption text-over">
            {errors.date.message}
          </p>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm">{t("common.save")}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}

// An unlinked account cell is never a bare dash: the reason the cell is empty is a property of how
// the expense arrived, and a user cannot infer that from a dash. Import and recurring rows carry no
// account because nothing links them to one yet; a manual row is simply one the user left blank.
function unlinkedReason(source: string): { label: string; why: string } {
  if (source === "recurring") {
    return { label: "expenses.fromRecurring", why: "expenses.fromRecurringWhy" };
  }
  if (source === "import") {
    return { label: "expenses.fromImport", why: "expenses.fromImportWhy" };
  }
  return { label: "expenses.notLinked", why: "expenses.notLinkedWhy" };
}

function UnlinkedAccountCell({ source }: { source: string }) {
  const { t } = useTranslation();
  const reason = unlinkedReason(source);

  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="text-ink-faint">
        &mdash;
      </span>
      <TooltipProvider delay={0}>
        <Tooltip>
          {/* The reason is the trigger's accessible name, not a separate sr-only sentence: the
            * trigger is a tab stop, and a focusable element cannot also be aria-hidden. */}
          <TooltipTrigger
            render={
              <span
                tabIndex={0}
                role="note"
                aria-label={t(reason.why)}
                className={cn("inline-flex rounded-md", focusRing)}
              />
            }
          >
            <Badge variant="neutral" aria-hidden="true">
              {t(reason.label)}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{t(reason.why)}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </span>
  );
}

export function ExpenseList({
  expenses,
  onAddExpense,
  showCategory = false,
}: ExpenseListProps) {
  const { t, i18n } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const maskProps = useMaskProps();
  const { data: accounts = [] } = useAccounts();
  const accountNameById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account.name])),
    [accounts]
  );
  const { data: allCategories = [] } = useAllBudgetCategories();
  const categoryNameById = useMemo(
    () => new Map(allCategories.map((category) => [category.id, category.name])),
    [allCategories]
  );
  const [editing, setEditing] = useState<Expense | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDirection, setSortDirection] = useState<Exclude<SortDirection, "none">>(
    "descending"
  );
  const deleteExpense = useDeleteExpense();
  const updateExpense = useUpdateExpense();

  // Sorting happens over the rows already in hand. `get_expenses` takes no ORDER BY or offset
  // parameter, so there is no server sort to defer to — and because the whole month is loaded,
  // reordering it locally is the true order rather than a reordered page.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? expenses.filter((expense) => expense.merchant.toLowerCase().includes(needle))
      : expenses;
    const factor = sortDirection === "ascending" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "amount") return (a.amount_cents - b.amount_cents) * factor;
      if (sortKey === "merchant") {
        return a.merchant.localeCompare(b.merchant, i18n.language) * factor;
      }
      return a.date.localeCompare(b.date) * factor;
    });
  }, [expenses, query, sortKey, sortDirection, i18n.language]);

  const selected = useMemo(
    () => visible.filter((expense) => selectedIds.has(expense.id)),
    [visible, selectedIds]
  );
  const selectedSumCents = selected.reduce((sum, expense) => sum + expense.amount_cents, 0);
  const totalCents = visible.reduce((sum, expense) => sum + expense.amount_cents, 0);

  const allSelected = visible.length > 0 && selected.length === visible.length;
  const someSelected = selected.length > 0 && !allSelected;

  const directionFor = (key: SortKey): SortDirection =>
    sortKey === key ? sortDirection : "none";

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(sortDirection === "ascending" ? "descending" : "ascending");
      return;
    }
    setSortKey(key);
    // Text reads naturally A→Z; a date or an amount is nearly always wanted largest-first.
    setSortDirection(key === "merchant" ? "ascending" : "descending");
  };

  const toggleRow = (id: number, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleQueryChange = (value: string) => {
    setQuery(value);
    // A selection the filter has hidden would still be deleted by the bulk bar, so it is dropped
    // whenever the visible set changes.
    clearSelection();
  };

  const handleUpdateAmount = (expense: Expense, amountCents: number) => {
    updateExpense.mutate(
      {
        id: expense.id,
        merchant: expense.merchant,
        amount_cents: amountCents,
        budget_category_id: expense.budget_category_id,
        date: expense.date,
        account_id: expense.account_id ?? null,
      },
      {
        onError: () => toast.error(t("expenses.expenseUpdateFailed")),
      }
    );
  };

  const handleDeleteSelected = () => {
    const count = selected.length;
    let failed = 0;
    let settled = 0;
    for (const expense of selected) {
      deleteExpense.mutate(expense.id, {
        onError: () => {
          failed += 1;
        },
        onSettled: () => {
          settled += 1;
          if (settled < count) return;
          if (failed > 0) toast.error(t("expenses.deleteFailed", { count: failed }));
          else toast.success(t("expenses.deletedCount", { count }));
          clearSelection();
          setConfirmDelete(false);
        },
      });
    }
  };

  const addAction: EmptyStateProps["action"] = onAddExpense ? (
    <Button size="sm" onClick={onAddExpense}>
      <Plus aria-hidden="true" />
      {t("budget.addExpense")}
    </Button>
  ) : undefined;

  if (expenses.length === 0) {
    return (
      <EmptyState
        icon={<Receipt />}
        title={t("expenses.noExpensesThisMonth")}
        description={t("expenses.noExpensesHint")}
        action={addAction}
        data-testid="no-expenses-message"
      />
    );
  }

  return (
    <>
      <Card flush data-testid="expense-list">
        <div className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
          <div className="relative w-56">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-faint"
            />
            {/* "Search" alone would promise more than this does: matching is a merchant substring,
              * so a category or a note is unfindable and the placeholder has to say so. */}
            <Input
              type="search"
              value={query}
              onChange={(event) => handleQueryChange(event.target.value)}
              placeholder={t("expenses.searchMerchants")}
              aria-label={t("expenses.searchMerchants")}
              className="pl-7"
              data-testid="expense-search"
            />
          </div>
          <span className="flex-1" />
          {/* Only while filtering. Unfiltered it would just restate the footer total in the same
            * small card, and two counts that can differ is worse than one that cannot. */}
          {query.trim() !== "" && (
            <span className="text-caption text-ink-dim" data-testid="expense-count">
              {t("expenses.rowCount", { count: visible.length })}
            </span>
          )}
        </div>

        {selected.length > 0 && (
          <BulkBar
            countLabel={t("expenses.selectedCount", { count: selected.length })}
            sum={
              <Money cents={selectedSumCents} locale={i18n.language} {...maskProps} />
            }
            onClear={clearSelection}
            data-testid="expense-bulk-bar"
          >
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              data-testid="bulk-delete-button"
            >
              {t("common.delete")}
            </Button>
          </BulkBar>
        )}

        {visible.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title={t("expenses.noMatchTitle", { query: query.trim() })}
            description={t("expenses.searchScopeHint")}
            action={
              <Button variant="outline" size="sm" onClick={() => handleQueryChange("")}>
                {t("expenses.clearFilters")}
              </Button>
            }
            data-testid="expense-no-match"
          />
        ) : (
          <Table>
            <caption className="sr-only">{t("expenses.tableCaption")}</caption>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onCheckedChange={(checked) =>
                      setSelectedIds(
                        checked ? new Set(visible.map((expense) => expense.id)) : new Set()
                      )
                    }
                    aria-label={t("expenses.selectAllRows")}
                    data-testid="select-all-expenses"
                  />
                </TableHead>
                <TableHead
                  sortable
                  sortDirection={directionFor("date")}
                  onSort={() => toggleSort("date")}
                >
                  {t("common.date")}
                </TableHead>
                <TableHead
                  sortable
                  sortDirection={directionFor("merchant")}
                  onSort={() => toggleSort("merchant")}
                >
                  {t("expenses.merchant")}
                </TableHead>
                {showCategory && (
                  <TableHead>{t("expenses.categoryOrSource")}</TableHead>
                )}
                <TableHead>{t("expenses.account")}</TableHead>
                <TableHead
                  numeric
                  sortable
                  sortDirection={directionFor("amount")}
                  onSort={() => toggleSort("amount")}
                >
                  {t("common.amount")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((expense) => {
                const accountName =
                  expense.account_id != null
                    ? accountNameById.get(expense.account_id)
                    : undefined;
                const isSelected = selectedIds.has(expense.id);
                return (
                  <TableRow
                    key={expense.id}
                    selected={isSelected}
                    onActivate={() => setEditing(expense)}
                    aria-label={t("expenses.openExpense", { merchant: expense.merchant })}
                    data-testid="expense-row"
                  >
                    <TableCell onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => toggleRow(expense.id, checked)}
                        aria-label={t("expenses.selectRow", { merchant: expense.merchant })}
                        data-testid="select-expense"
                      />
                    </TableCell>
                    <TableCell dim data-testid="expense-date">
                      {formatShortDate(expense.date, i18n.language)}
                    </TableCell>
                    <TableCell data-testid="expense-merchant">{expense.merchant}</TableCell>
                    {showCategory && (
                      <TableCell data-testid="expense-category">
                        <Badge variant="brand">
                          {categoryNameById.get(expense.budget_category_id) ??
                            t("expenses.uncategorized")}
                        </Badge>
                      </TableCell>
                    )}
                    <TableCell dim data-testid="expense-account">
                      {accountName ?? <UnlinkedAccountCell source={expense.source} />}
                    </TableCell>
                    <TableCell
                      numeric
                      onClick={(event) => event.stopPropagation()}
                      data-testid="expense-amount"
                    >
                      <InlineEditMoney
                        value={expense.amount_cents}
                        onSave={(cents) => handleUpdateAmount(expense, cents)}
                        data-testid="expense-amount-edit"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={showCategory ? 5 : 4} className="text-caption">
                  {t("expenses.rowCount", { count: visible.length })}
                </TableCell>
                <TableCell numeric data-testid="expense-total">
                  <Money cents={totalCents} locale={i18n.language} {...maskProps} />
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </Card>

      <SlideOver
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t("expenses.editExpense")}
        description={t("expenses.editExpenseDescription")}
        data-testid="edit-expense-slide-over"
      >
        {editing && (
          <EditExpenseForm expense={editing} onClose={() => setEditing(null)} />
        )}
      </SlideOver>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent data-testid="delete-expense-dialog">
          <DialogHeader>
            <DialogTitle>{t("expenses.deleteExpense")}</DialogTitle>
            <DialogDescription>
              {t("expenses.deleteSelectedExplain", {
                count: selected.length,
                amount: formatCurrency(selectedSumCents),
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteSelected}
              data-testid="confirm-delete-expense-button"
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
