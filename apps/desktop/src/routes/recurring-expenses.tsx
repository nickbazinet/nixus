import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "@nixus/shared";
import { Card, CardContent } from "@nixus/shared";
import { SlideOver } from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { AddRecurringTemplateForm } from "@/components/expenses/AddRecurringTemplateForm";
import { RecurringTemplateList } from "@/components/expenses/RecurringTemplateList";
import { useRecurringTemplates } from "@/hooks/useRecurringExpenses";
import { useAllBudgetCategories } from "@/hooks/useExpenses";

export const Route = createFileRoute("/recurring-expenses")({
  component: RecurringExpensesPage,
});

function RecurringExpensesPage() {
  const { t } = useTranslation();
  const [showAddForm, setShowAddForm] = useState(false);
  const { data: templates = [], isLoading } = useRecurringTemplates();
  const { data: categories = [] } = useAllBudgetCategories();

  return (
    <div>
      <PageHeader
        title={t("recurring.title")}
        subtitle={t("recurring.subtitle")}
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAddForm(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            {t("recurring.addTemplate")}
          </Button>
        }
      />

      <div
        className="mb-4 flex gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4"
        data-testid="recurring-auto-apply-banner"
      >
        <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-foreground">
            {t("recurring.autoApplyTitle")}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("recurring.autoApplyDescription")}
          </p>
        </div>
      </div>

      <Card className="shadow-sm rounded-lg">
        <CardContent className="p-4">
          {isLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-muted animate-pulse rounded" />
              ))}
            </div>
          )}

          {!isLoading && (
            <RecurringTemplateList
              templates={templates}
              categories={categories}
            />
          )}
        </CardContent>
      </Card>

      <SlideOver
        open={showAddForm}
        onClose={() => setShowAddForm(false)}
        title={t("recurring.addTemplate")}
        data-testid="add-recurring-template-slide-over"
      >
        <AddRecurringTemplateForm onClose={() => setShowAddForm(false)} />
      </SlideOver>
    </div>
  );
}
