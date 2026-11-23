import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeftRight, Landmark, Repeat, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  IconChip,
  Money,
  Skeleton,
  SlideOver,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@nixus/shared";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import {
  useDeleteRecurringTemplate,
  useUpdateRecurringTemplate,
} from "@/hooks/useRecurringExpenses";
import {
  useDeleteRecurringIncomeTemplate,
  useUpdateRecurringIncomeTemplate,
} from "@/hooks/useRecurringIncome";
import {
  useDeleteRecurringTransferTemplate,
  useUpdateRecurringTransferTemplate,
} from "@/hooks/useRecurringTransfers";
import type {
  Account,
  RecurringExpenseTemplate,
  RecurringIncomeTemplate,
  RecurringTransferTemplate,
  BudgetCategory,
} from "@/lib/types";
import { scheduleLabel, monthlyEquivalentCents } from "@/lib/recurrence";
import { cn } from "@/lib/utils";
import { rampColor } from "@/components/spending-trends/insights-chart";
import { formatNextDate, nextOccurrence } from "./recurringSchedule";
import {
  BADGES,
  INCOME_TYPE_KEYS,
  ROW_TEST_IDS,
  buildRecurringRows,
  rowKey,
  rowName,
  type RecurringRow,
} from "./recurringRows";
import { EditRecurringTemplateForm } from "./EditRecurringTemplateForm";
import { EditRecurringIncomeForm } from "@/components/income/EditRecurringIncomeForm";
import { RecurringTransferForm } from "@/components/accounts/RecurringTransferForm";

interface RecurringTemplateListProps {
  expenseTemplates: RecurringExpenseTemplate[];
  incomeTemplates: RecurringIncomeTemplate[];
  transferTemplates: RecurringTransferTemplate[];
  categories: BudgetCategory[];
  accounts: Account[];
  isLoading?: boolean;
  onAddTemplate?: () => void;
}

const ROW_ICONS = {
  expense: Repeat,
  income: Landmark,
  transfer: ArrowLeftRight,
} as const;

/** The table lives in a flush card, so its outer cells line up with the card's padding. */
const CELL_INSET =
  "[&_td:first-child]:pl-card-pad [&_td:last-child]:pr-card-pad [&_th:first-child]:pl-card-pad [&_th:last-child]:pr-card-pad";

export function RecurringTemplateList({
  expenseTemplates,
  incomeTemplates,
  transferTemplates,
  categories,
  accounts,
  isLoading = false,
  onAddTemplate,
}: RecurringTemplateListProps) {
  const { t, i18n } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const maskProps = useMaskProps();
  const deleteTemplate = useDeleteRecurringTemplate();
  const updateTemplate = useUpdateRecurringTemplate();
  const deleteIncomeTemplate = useDeleteRecurringIncomeTemplate();
  const updateIncomeTemplate = useUpdateRecurringIncomeTemplate();
  const deleteTransferTemplate = useDeleteRecurringTransferTemplate();
  const updateTransferTemplate = useUpdateRecurringTransferTemplate();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RecurringRow | null>(null);

  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const nameOf = (row: RecurringRow) => rowName(row, accountNames);
  const rows = buildRecurringRows(
    expenseTemplates,
    incomeTemplates,
    transferTemplates
  ).sort((a, b) => nameOf(a).localeCompare(nameOf(b), i18n.language));

  const lastRowCount = useRef(3);
  useEffect(() => {
    if (!isLoading && rows.length > 0) lastRowCount.current = rows.length;
  }, [isLoading, rows.length]);

  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

  const handleToggleActive = (row: RecurringRow, isActive: boolean) => {
    const onError = () => toast.error(t("toast.saveFailed"));

    if (row.kind === "expense") {
      const template = row.template;
      updateTemplate.mutate(
        {
          id: template.id,
          merchant: template.merchant,
          amount_cents: template.amount_cents,
          budget_category_id: template.budget_category_id,
          day_of_month: template.day_of_month,
          frequency: template.frequency,
          start_date: template.start_date,
          is_active: isActive,
        },
        { onError }
      );
      return;
    }

    if (row.kind === "transfer") {
      updateTransferTemplate.mutate({ ...row.template, is_active: isActive }, { onError });
      return;
    }

    const template = row.template;
    updateIncomeTemplate.mutate(
      {
        id: template.id,
        source_id: template.source_id,
        amount_cents: template.amount_cents,
        day_of_month: template.day_of_month,
        frequency: template.frequency,
        start_date: template.start_date,
        account_id: template.account_id,
        is_active: isActive,
      },
      { onError }
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    const mutation = {
      expense: deleteTemplate,
      income: deleteIncomeTemplate,
      transfer: deleteTransferTemplate,
    }[deleteTarget.kind];

    mutation.mutate(deleteTarget.template.id, {
      onSuccess: () => {
        toast.success(t("toast.deleteSuccess"));
        setDeleteTarget(null);
      },
      onError: () => {
        toast.error(t("toast.deleteFailed"));
        setDeleteTarget(null);
      },
    });
  };

  const editingRow = rows.find((row) => rowKey(row) === editingKey);
  const activeExpenseCount = expenseTemplates.filter((tpl) => tpl.is_active).length;
  const activeIncomeCount = incomeTemplates.filter((tpl) => tpl.is_active).length;
  const activeTransferCount = transferTemplates.filter((tpl) => tpl.is_active).length;

  // What the row is filed under: an expense's category, an income's type, or "between accounts".
  const secondaryOf = (row: RecurringRow): string =>
    row.kind === "expense"
      ? (categoryMap.get(row.template.budget_category_id) ?? "—")
      : row.kind === "income"
        ? t(INCOME_TYPE_KEYS[row.template.income_type] ?? "income.typeOther")
        : t("recurring.transferCategory");

  // The chip's dot is coloured by RANK — the heaviest monthly commitment takes the first ramp step
  // — so no category keeps a hue it could lose when the templates change.
  const categoryColors = (() => {
    const totals = new Map<string, number>();
    for (const row of rows) {
      const label = secondaryOf(row);
      totals.set(label, (totals.get(label) ?? 0) + monthlyEquivalentCents(row.template));
    }
    return new Map(
      [...totals.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([label], rank) => [label, rampColor(rank)])
    );
  })();

  // Chrome resolves first and only the cells are skeletons; the row count is the last real one so
  // the list does not jump when data lands.
  if (isLoading) {
    return (
      <Table className={CELL_INSET}>
        <caption className="sr-only">{t("common.loading")}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{t("recurring.nameColumn")}</TableHead>
            <TableHead>{t("recurring.categoryColumn")}</TableHead>
            <TableHead>{t("recurring.v2.nextColumn")}</TableHead>
            <TableHead numeric>{t("common.amount")}</TableHead>
            <TableHead>{t("recurring.activeColumn")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell colSpan={5}>
              <Skeleton rows={lastRowCount.current} data-testid="recurring-skeleton" />
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Repeat />}
        title={t("recurring.emptyTitle")}
        description={t("recurring.emptyDescription")}
        action={
          onAddTemplate ? (
            <Button size="sm" onClick={onAddTemplate}>
              {t("recurring.addBill")}
            </Button>
          ) : undefined
        }
        className="py-6"
        data-testid="recurring-empty-state"
      />
    );
  }

  return (
    <>
      <Table className={cn("table-fixed", CELL_INSET)}>
        <caption className="sr-only">{t("recurring.tableCaption")}</caption>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[38%]">{t("recurring.nameColumn")}</TableHead>
            <TableHead className="w-[22%]">{t("recurring.categoryColumn")}</TableHead>
            <TableHead className="w-[10%]">{t("recurring.v2.nextColumn")}</TableHead>
            <TableHead numeric className="w-[14%]">
              {t("common.amount")}
            </TableHead>
            <TableHead className="w-[9%]">{t("recurring.activeColumn")}</TableHead>
            <TableHead className="w-[7%]">
              <span className="sr-only">{t("common.delete")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const name = nameOf(row);
            const secondary = secondaryOf(row);
            const badge = BADGES[row.kind];
            const due = row.template.is_active ? nextOccurrence(row.template) : null;

            return (
              <TableRow
                key={rowKey(row)}
                onActivate={() => setEditingKey(rowKey(row))}
                aria-label={t("recurring.openTemplate", { merchant: name })}
                data-testid={ROW_TEST_IDS[row.kind]}
              >
                <TableCell>
                  <div className="flex items-center gap-3">
                    <IconChip icon={ROW_ICONS[row.kind]} size="sm" />
                    <div className="min-w-0">
                      <p className="font-bold text-ink">{name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge variant={badge.variant}>{t(badge.labelKey)}</Badge>
                        <span className="text-caption text-ink-dim">
                          {scheduleLabel(t, row.template, i18n.language)}
                        </span>
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="brand">
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: categoryColors.get(secondary) ?? rampColor(7) }}
                    />
                    {secondary}
                  </Badge>
                </TableCell>
                <TableCell dim className="whitespace-nowrap" data-testid="recurring-next-due">
                  {due ? formatNextDate(due, i18n.language) : "—"}
                </TableCell>
                <TableCell numeric className="whitespace-nowrap">
                  <Money
                    cents={row.template.amount_cents}
                    locale={i18n.language}
                    {...maskProps}
                  />
                </TableCell>
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <Switch
                    checked={row.template.is_active}
                    onCheckedChange={(checked) => handleToggleActive(row, checked)}
                    aria-label={
                      row.template.is_active
                        ? t("recurring.deactivate")
                        : t("recurring.activate")
                    }
                    data-testid="recurring-toggle"
                  />
                </TableCell>
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setDeleteTarget(row)}
                    className="text-ink-faint hover:text-over"
                    aria-label={t("recurring.deleteTemplate", { merchant: name })}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2} className="text-caption">
              {t("recurring.activeCount", { count: activeExpenseCount })}
            </TableCell>
            <TableCell colSpan={2} className="text-caption" data-testid="recurring-active-income-count">
              {t("recurring.activeIncomeCount", { count: activeIncomeCount })}
            </TableCell>
            <TableCell colSpan={2} className="text-caption" data-testid="recurring-active-transfer-count">
              {t("recurring.activeTransferCount", { count: activeTransferCount })}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>

      <SlideOver
        open={!!editingRow}
        onClose={() => setEditingKey(null)}
        title={
          editingRow?.kind === "income"
            ? t("recurring.editIncome")
            : editingRow?.kind === "transfer"
              ? t("recurring.editTransfer")
              : t("recurring.editTemplate")
        }
        description={
          editingRow?.kind === "income"
            ? t("recurring.editIncomeDescription")
            : editingRow?.kind === "transfer"
              ? t("recurring.editTransferDescription")
              : t("recurring.editTemplateDescription")
        }
        data-testid="edit-recurring-template-slide-over"
      >
        {editingRow?.kind === "expense" && (
          <EditRecurringTemplateForm
            template={editingRow.template}
            onClose={() => setEditingKey(null)}
          />
        )}
        {editingRow?.kind === "income" && (
          <EditRecurringIncomeForm
            template={editingRow.template}
            onClose={() => setEditingKey(null)}
          />
        )}
        {editingRow?.kind === "transfer" && (
          <RecurringTransferForm
            template={editingRow.template}
            onClose={() => setEditingKey(null)}
          />
        )}
      </SlideOver>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent data-testid="delete-recurring-template-dialog">
          <DialogHeader>
            <DialogTitle>
              {t("recurring.deleteTemplate", {
                merchant: deleteTarget ? nameOf(deleteTarget) : "",
              })}
            </DialogTitle>
            <DialogDescription>
              {deleteTarget?.kind === "income"
                ? t("recurring.deleteIncomeExplain", {
                    amount: formatCurrency(deleteTarget.template.amount_cents),
                  })
                : deleteTarget?.kind === "transfer"
                  ? t("recurring.deleteTransferExplain", {
                      amount: formatCurrency(deleteTarget.template.amount_cents),
                    })
                  : t("recurring.deleteTemplateExplain", {
                    amount: deleteTarget
                      ? formatCurrency(deleteTarget.template.amount_cents)
                      : "",
                  })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              data-testid="confirm-delete-recurring-button"
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
