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
  PillTabs,
  SlideOver,
  Stat,
  formatMoney,
} from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { AddRecurringTemplateForm } from "@/components/expenses/AddRecurringTemplateForm";
import { AddRecurringIncomeForm } from "@/components/income/AddRecurringIncomeForm";
import { RecurringTemplateList } from "@/components/expenses/RecurringTemplateList";
import { useRecurringTemplates } from "@/hooks/useRecurringExpenses";
import { useRecurringIncomeTemplates } from "@/hooks/useRecurringIncome";
import { useAllBudgetCategories } from "@/hooks/useExpenses";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";

export const Route = createFileRoute("/spending/recurring")({
  component: RecurringExpensesPage,
});

const ADD_KINDS = ["expense", "income"] as const;
type AddKind = (typeof ADD_KINDS)[number];

function RecurringExpensesPage() {
  const { t, i18n } = useTranslation();
  const maskProps = useMaskProps();
  const [showAddForm, setShowAddForm] = useState(false);
  const [addKind, setAddKind] = useState<AddKind>("expense");
  const { data: templates = [], isLoading } = useRecurringTemplates();
  const { data: incomeTemplates = [], isLoading: isLoadingIncome } =
    useRecurringIncomeTemplates();
  const { data: categories = [] } = useAllBudgetCategories();

  const activeTemplates = templates.filter((template) => template.is_active);
  const activeIncomeTemplates = incomeTemplates.filter(
    (template) => template.is_active
  );
  const committedCents = activeTemplates.reduce(
    (sum, template) => sum + template.amount_cents,
    0
  );
  const expectedIncomeCents = activeIncomeTemplates.reduce(
    (sum, template) => sum + template.amount_cents,
    0
  );

  const openAddForm = (kind: AddKind) => {
    setAddKind(kind);
    setShowAddForm(true);
  };

  return (
    <div>
      <PageHeader
        title={t("recurring.title")}
        subtitle={t("recurring.subtitle")}
        actions={
          <Button size="sm" variant="outline" onClick={() => openAddForm("expense")}>
            <Plus aria-hidden="true" />
            {t("recurring.addTemplate")}
          </Button>
        }
      />

      <div className="mb-section-gap grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent>
            <Stat
              label={t("recurring.committedLabel")}
              value={formatMoney({ cents: committedCents, locale: i18n.language })}
              caption={t("recurring.activeTemplateCount", {
                count: activeTemplates.length,
              })}
              {...maskProps}
              data-testid="recurring-committed-total"
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <Stat
              label={t("recurring.expectedLabel")}
              value={formatMoney({
                cents: expectedIncomeCents,
                locale: i18n.language,
              })}
              caption={t("recurring.activeIncomeTemplateCount", {
                count: activeIncomeTemplates.length,
              })}
              {...maskProps}
              data-testid="recurring-expected-total"
            />
          </CardContent>
        </Card>
      </div>

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
          expenseTemplates={templates}
          incomeTemplates={incomeTemplates}
          categories={categories}
          isLoading={isLoading || isLoadingIncome}
          onAddTemplate={() => openAddForm("expense")}
        />
      </Card>

      <SlideOver
        open={showAddForm}
        onClose={() => setShowAddForm(false)}
        title={
          addKind === "income" ? t("recurring.addIncome") : t("recurring.addTemplate")
        }
        description={
          addKind === "income"
            ? t("recurring.addIncomeDescription")
            : t("recurring.addTemplateDescription")
        }
        data-testid="add-recurring-template-slide-over"
      >
        <div className="space-y-4">
          <PillTabs
            options={ADD_KINDS}
            labels={{
              expense: t("recurring.typeExpense"),
              income: t("recurring.typeIncome"),
            }}
            value={addKind}
            onChange={setAddKind}
            data-testid="recurring-add-kind"
          />
          {addKind === "expense" ? (
            <AddRecurringTemplateForm onClose={() => setShowAddForm(false)} />
          ) : (
            <AddRecurringIncomeForm onClose={() => setShowAddForm(false)} />
          )}
        </div>
      </SlideOver>
    </div>
  );
}
