import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Repeat, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
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
import type { RecurringExpenseTemplate, BudgetCategory } from "@/lib/types";
import { EditRecurringTemplateForm } from "./EditRecurringTemplateForm";

interface RecurringTemplateListProps {
  templates: RecurringExpenseTemplate[];
  categories: BudgetCategory[];
  isLoading?: boolean;
  onAddTemplate?: () => void;
}

export function RecurringTemplateList({
  templates,
  categories,
  isLoading = false,
  onAddTemplate,
}: RecurringTemplateListProps) {
  const { t, i18n } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const maskProps = useMaskProps();
  const deleteTemplate = useDeleteRecurringTemplate();
  const updateTemplate = useUpdateRecurringTemplate();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RecurringExpenseTemplate | null>(null);

  const lastRowCount = useRef(3);
  useEffect(() => {
    if (!isLoading && templates.length > 0) lastRowCount.current = templates.length;
  }, [isLoading, templates.length]);

  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

  const handleToggleActive = (template: RecurringExpenseTemplate, isActive: boolean) => {
    updateTemplate.mutate(
      {
        id: template.id,
        merchant: template.merchant,
        amount_cents: template.amount_cents,
        budget_category_id: template.budget_category_id,
        day_of_month: template.day_of_month,
        is_active: isActive,
      },
      {
        onError: () => toast.error(t("toast.saveFailed")),
      }
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteTemplate.mutate(deleteTarget.id, {
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

  const editingTemplate = templates.find((template) => template.id === editingId);
  const activeTotalCents = templates
    .filter((template) => template.is_active)
    .reduce((sum, template) => sum + template.amount_cents, 0);

  // Chrome resolves first and only the cells are skeletons; the row count is the last real one so
  // the list does not jump when data lands.
  if (isLoading) {
    return (
      <Table>
        <caption className="sr-only">{t("common.loading")}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>{t("expenses.merchant")}</TableHead>
            <TableHead>{t("common.category")}</TableHead>
            <TableHead>{t("recurring.dayColumn")}</TableHead>
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

  if (templates.length === 0) {
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
            <TableHead>{t("expenses.merchant")}</TableHead>
            <TableHead>{t("common.category")}</TableHead>
            <TableHead>{t("recurring.dayColumn")}</TableHead>
            <TableHead numeric>{t("common.amount")}</TableHead>
            <TableHead>{t("recurring.activeColumn")}</TableHead>
            <TableHead>
              <span className="sr-only">{t("common.delete")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {templates.map((template) => (
            <TableRow
              key={template.id}
              onActivate={() => setEditingId(template.id)}
              aria-label={t("recurring.openTemplate", { merchant: template.merchant })}
              data-testid="recurring-template-row"
            >
              <TableCell>{template.merchant}</TableCell>
              <TableCell dim>{categoryMap.get(template.budget_category_id) ?? "—"}</TableCell>
              <TableCell dim>
                {t("recurring.dayLabel", { day: template.day_of_month })}
              </TableCell>
              <TableCell numeric>
                <Money cents={template.amount_cents} locale={i18n.language} {...maskProps} />
              </TableCell>
              <TableCell onClick={(event) => event.stopPropagation()}>
                <Switch
                  checked={template.is_active}
                  onCheckedChange={(checked) => handleToggleActive(template, checked)}
                  aria-label={
                    template.is_active
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
                  onClick={() => setDeleteTarget(template)}
                  className="text-ink-faint hover:text-over"
                  aria-label={t("recurring.deleteTemplate", { merchant: template.merchant })}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={3} className="text-caption">
              {t("recurring.activeCount", {
                count: templates.filter((template) => template.is_active).length,
              })}
            </TableCell>
            <TableCell numeric data-testid="recurring-active-total">
              <Money cents={activeTotalCents} locale={i18n.language} {...maskProps} />
            </TableCell>
            <TableCell colSpan={2} />
          </TableRow>
        </TableFooter>
      </Table>

      <SlideOver
        open={editingId !== null}
        onClose={() => setEditingId(null)}
        title={t("recurring.editTemplate")}
        description={t("recurring.editTemplateDescription")}
        data-testid="edit-recurring-template-slide-over"
      >
        {editingTemplate && (
          <EditRecurringTemplateForm
            template={editingTemplate}
            onClose={() => setEditingId(null)}
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
              {t("recurring.deleteTemplate", { merchant: deleteTarget?.merchant ?? "" })}
            </DialogTitle>
            <DialogDescription>
              {t("recurring.deleteTemplateExplain", {
                amount: deleteTarget ? formatCurrency(deleteTarget.amount_cents) : "",
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
