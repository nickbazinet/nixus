import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SlideOver } from "@nixus/shared";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import {
  useDeleteRecurringTemplate,
  useUpdateRecurringTemplate,
} from "@/hooks/useRecurringExpenses";
import type { RecurringExpenseTemplate, BudgetCategory } from "@/lib/types";
import { EditRecurringTemplateForm } from "./EditRecurringTemplateForm";

interface RecurringTemplateListProps {
  templates: RecurringExpenseTemplate[];
  categories: BudgetCategory[];
}

export function RecurringTemplateList({
  templates,
  categories,
}: RecurringTemplateListProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const deleteTemplate = useDeleteRecurringTemplate();
  const updateTemplate = useUpdateRecurringTemplate();
  const [editingId, setEditingId] = useState<number | null>(null);

  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));

  const handleToggleActive = (template: RecurringExpenseTemplate) => {
    updateTemplate.mutate(
      {
        id: template.id,
        merchant: template.merchant,
        amount_cents: template.amount_cents,
        budget_category_id: template.budget_category_id,
        day_of_month: template.day_of_month,
        is_active: !template.is_active,
      },
      {
        onError: () => toast.error(t("toast.saveFailed")),
      }
    );
  };

  const handleDelete = (id: number) => {
    deleteTemplate.mutate(id, {
      onSuccess: () => toast.success(t("toast.deleteSuccess")),
      onError: () => toast.error(t("toast.deleteFailed")),
    });
  };

  const editingTemplate = templates.find((t) => t.id === editingId);

  if (templates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        {t("recurring.noTemplates")}
      </p>
    );
  }

  return (
    <>
      <div className="space-y-0.5">
        {templates.map((template) => (
          <div
            key={template.id}
            className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => handleToggleActive(template)}
                className={`w-2.5 h-2.5 rounded-full shrink-0 border-2 transition-colors ${
                  template.is_active
                    ? "bg-emerald-500 border-emerald-500"
                    : "bg-transparent border-muted-foreground/40"
                }`}
                title={
                  template.is_active
                    ? t("recurring.deactivate")
                    : t("recurring.activate")
                }
                aria-label={
                  template.is_active
                    ? t("recurring.deactivate")
                    : t("recurring.activate")
                }
              />
              <div className="min-w-0">
                <span className="text-sm font-medium truncate block">
                  {template.merchant}
                </span>
                <span className="text-xs text-muted-foreground">
                  {categoryMap.get(template.budget_category_id) ?? "—"} &middot;{" "}
                  {t("recurring.dayLabel", { day: template.day_of_month })}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm font-mono text-foreground">
                {formatCurrency(template.amount_cents)}
              </span>
              <button
                onClick={() => setEditingId(template.id)}
                className="text-muted-foreground hover:text-foreground transition-colors p-1"
                aria-label={t("common.edit")}
              >
                <Pencil size={14} />
              </button>
              <button
                onClick={() => handleDelete(template.id)}
                className="text-muted-foreground hover:text-destructive transition-colors p-1"
                aria-label={t("common.delete")}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <SlideOver
        open={editingId !== null}
        onClose={() => setEditingId(null)}
        title={t("recurring.editTemplate")}
      >
        {editingTemplate && (
          <EditRecurringTemplateForm
            template={editingTemplate}
            onClose={() => setEditingId(null)}
          />
        )}
      </SlideOver>
    </>
  );
}
