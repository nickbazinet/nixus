import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Plus, RefreshCw } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  SlideOver,
  Stat,
  formatMoney,
} from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { AddRecurringTemplateForm } from "@/components/expenses/AddRecurringTemplateForm";
import { RecurringTemplateList } from "@/components/expenses/RecurringTemplateList";
import { useRecurringTemplates } from "@/hooks/useRecurringExpenses";
import { useAllBudgetCategories } from "@/hooks/useExpenses";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";

export const Route = createFileRoute("/spending/recurring")({
  component: RecurringExpensesPage,
});

function RecurringExpensesPage() {
  const { t, i18n } = useTranslation();
  const maskProps = useMaskProps();
  const [showAddForm, setShowAddForm] = useState(false);
  const { data: templates = [], isLoading } = useRecurringTemplates();
  const { data: categories = [] } = useAllBudgetCategories();

  const activeTemplates = templates.filter((template) => template.is_active);
  const committedCents = activeTemplates.reduce(
    (sum, template) => sum + template.amount_cents,
    0
  );

  return (
    <div>
      <PageHeader
        title={t("recurring.title")}
        subtitle={t("recurring.subtitle")}
        actions={
          <Button size="sm" variant="outline" onClick={() => setShowAddForm(true)}>
            <Plus aria-hidden="true" />
            {t("recurring.addTemplate")}
          </Button>
        }
      />

      <Card className="mb-section-gap">
        <CardContent>
          <Stat
            label={t("recurring.committedLabel")}
            value={formatMoney({ cents: committedCents, locale: i18n.language })}
            caption={t("recurring.activeTemplateCount", { count: activeTemplates.length })}
            {...maskProps}
            data-testid="recurring-committed-total"
          />
        </CardContent>
      </Card>

      <Alert
        variant="info"
        icon={<RefreshCw />}
        className="mb-section-gap rounded-lg"
        data-testid="recurring-auto-apply-banner"
      >
        <AlertTitle>{t("recurring.autoApplyTitle")}</AlertTitle>
        <AlertDescription className="mt-1">
          {t("recurring.autoApplyDescription")}
        </AlertDescription>
      </Alert>

      <Card flush>
        <RecurringTemplateList
          templates={templates}
          categories={categories}
          isLoading={isLoading}
          onAddTemplate={() => setShowAddForm(true)}
        />
      </Card>

      <SlideOver
        open={showAddForm}
        onClose={() => setShowAddForm(false)}
        title={t("recurring.addTemplate")}
        description={t("recurring.addTemplateDescription")}
        data-testid="add-recurring-template-slide-over"
      >
        <AddRecurringTemplateForm onClose={() => setShowAddForm(false)} />
      </SlideOver>
    </div>
  );
}
