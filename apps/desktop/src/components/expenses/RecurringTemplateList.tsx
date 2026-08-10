import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Repeat, Trash2 } from "lucide-react";
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
import type {
  RecurringExpenseTemplate,
  RecurringIncomeTemplate,
  BudgetCategory,
} from "@/lib/types";
import { EditRecurringTemplateForm } from "./EditRecurringTemplateForm";
import { EditRecurringIncomeForm } from "@/components/income/EditRecurringIncomeForm";

// One table renders both kinds, so every row carries its origin rather than the caller
// keeping two parallel lists in sync.
type RecurringRow =
  | { kind: "expense"; template: RecurringExpenseTemplate }
  | { kind: "income"; template: RecurringIncomeTemplate };

interface RecurringTemplateListProps {
  expenseTemplates: RecurringExpenseTemplate[];
  incomeTemplates: RecurringIncomeTemplate[];
  categories: BudgetCategory[];
  isLoading?: boolean;
  onAddTemplate?: () => void;
}

const INCOME_TYPE_KEYS: Record<string, string> = {
  employment: "income.typeEmployment",
  freelance: "income.typeFreelance",
  investment: "income.typeInvestment",
  other: "income.typeOther",
};

function rowName(row: RecurringRow): string {
  return row.kind === "expense" ? row.template.merchant : row.template.source_name;
}

function rowKey(row: RecurringRow): string {
  return `${row.kind}-${row.template.id}`;
}

export function RecurringTemplateList({
  expenseTemplates,
  incomeTemplates,
  categories,
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
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RecurringRow | null>(null);

  const rows: RecurringRow[] = [
    ...expenseTemplates.map(
      (template): RecurringRow => ({ kind: "expense", template })
    ),
    ...incomeTemplates.map((template): RecurringRow => ({ kind: "income", template })),
  ].sort((a, b) => rowName(a).localeCompare(rowName(b), i18n.language));

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
          is_active: isActive,
        },
        { onError }
      );
      return;
    }

    const template = row.template;
    updateIncomeTemplate.mutate(
      {
        id: template.id,
        source_id: template.source_id,
        amount_cents: template.amount_cents,
        day_of_month: template.day_of_month,
        account_id: template.account_id,
        is_active: isActive,
      },
      { onError }
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    const mutation =
      deleteTarget.kind === "expense" ? deleteTemplate : deleteIncomeTemplate;

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

  // Chrome resolves first and only the cells are skeletons; the row count is the last real one so
  // the list does not jump when data lands.
  if (isLoading) {
    return (
      <Table>
        <caption className="sr-only">{t("common.loading")}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{t("recurring.typeColumn")}</TableHead>
            <TableHead>{t("recurring.nameColumn")}</TableHead>
            <TableHead>{t("recurring.categoryColumn")}</TableHead>
            <TableHead>{t("recurring.dayColumn")}</TableHead>
            <TableHead numeric>{t("common.amount")}</TableHead>
            <TableHead>{t("recurring.activeColumn")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell colSpan={6}>
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
        data-testid="recurring-empty-state"
      />
    );
  }

  return (
    <>
      <Table>
        <caption className="sr-only">{t("recurring.tableCaption")}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{t("recurring.typeColumn")}</TableHead>
            <TableHead>{t("recurring.nameColumn")}</TableHead>
            <TableHead>{t("recurring.categoryColumn")}</TableHead>
            <TableHead>{t("recurring.dayColumn")}</TableHead>
            <TableHead numeric>{t("common.amount")}</TableHead>
            <TableHead>{t("recurring.activeColumn")}</TableHead>
            <TableHead>
              <span className="sr-only">{t("common.delete")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const name = rowName(row);
            const secondary =
              row.kind === "expense"
                ? (categoryMap.get(row.template.budget_category_id) ?? "—")
                : t(INCOME_TYPE_KEYS[row.template.income_type] ?? "income.typeOther");

            return (
              <TableRow
                key={rowKey(row)}
                onActivate={() => setEditingKey(rowKey(row))}
                aria-label={t("recurring.openTemplate", { merchant: name })}
                data-testid={
                  row.kind === "expense"
                    ? "recurring-template-row"
                    : "recurring-income-row"
                }
              >
                <TableCell>
                  <Badge variant={row.kind === "income" ? "good" : "neutral"}>
                    {row.kind === "income"
                      ? t("recurring.typeIncome")
                      : t("recurring.typeExpense")}
                  </Badge>
                </TableCell>
                <TableCell>{name}</TableCell>
                <TableCell dim>{secondary}</TableCell>
                <TableCell dim>
                  {t("recurring.dayLabel", { day: row.template.day_of_month })}
                </TableCell>
                <TableCell numeric>
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
            <TableCell colSpan={4} className="text-caption">
              {t("recurring.activeCount", { count: activeExpenseCount })}
            </TableCell>
            <TableCell colSpan={3} className="text-caption" data-testid="recurring-active-income-count">
              {t("recurring.activeIncomeCount", { count: activeIncomeCount })}
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
            : t("recurring.editTemplate")
        }
        description={
          editingRow?.kind === "income"
            ? t("recurring.editIncomeDescription")
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
                merchant: deleteTarget ? rowName(deleteTarget) : "",
              })}
            </DialogTitle>
            <DialogDescription>
              {deleteTarget?.kind === "income"
                ? t("recurring.deleteIncomeExplain", {
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
