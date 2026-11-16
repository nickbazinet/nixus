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
import { RecurringTransferForm } from "@/components/accounts/RecurringTransferForm";
import { RecurringTemplateList } from "@/components/expenses/RecurringTemplateList";
import { useRecurringTemplates } from "@/hooks/useRecurringExpenses";
import { useRecurringIncomeTemplates } from "@/hooks/useRecurringIncome";
import { useRecurringTransferTemplates } from "@/hooks/useRecurringTransfers";
import { useAccounts } from "@/hooks/useAccounts";
import { useAllBudgetCategories } from "@/hooks/useExpenses";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import { monthlyEquivalentCents } from "@/lib/recurrence";

export const Route = createFileRoute("/spending/recurring")({
  component: RecurringExpensesPage,
});

const ADD_KINDS = ["expense", "income", "transfer"] as const;
type AddKind = (typeof ADD_KINDS)[number];

const ADD_TITLE_KEYS: Record<AddKind, string> = {
  expense: "recurring.addTemplate",
  income: "recurring.addIncome",
  transfer: "recurring.addTransfer",
};

const ADD_DESCRIPTION_KEYS: Record<AddKind, string> = {
  expense: "recurring.addTemplateDescription",
  income: "recurring.addIncomeDescription",
  transfer: "recurring.addTransferDescription",
};

function RecurringExpensesPage() {
  const { t, i18n } = useTranslation();
  const maskProps = useMaskProps();
  const [showAddForm, setShowAddForm] = useState(false);
  const [addKind, setAddKind] = useState<AddKind>("expense");
  const { data: templates = [], isLoading } = useRecurringTemplates();
  const { data: incomeTemplates = [], isLoading: isLoadingIncome } =
    useRecurringIncomeTemplates();
  const { data: transferTemplates = [], isLoading: isLoadingTransfers } =
    useRecurringTransferTemplates();
  const { data: categories = [] } = useAllBudgetCategories();
  const { data: accounts = [] } = useAccounts();

  const activeTemplates = templates.filter((template) => template.is_active);
  const activeIncomeTemplates = incomeTemplates.filter(
    (template) => template.is_active
  );
  const committedCents = activeTemplates.reduce(
    (sum, template) => sum + monthlyEquivalentCents(template),
    0
  );
  const expectedIncomeCents = activeIncomeTemplates.reduce(
    (sum, template) => sum + monthlyEquivalentCents(template),
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
          transferTemplates={transferTemplates}
          categories={categories}
          accounts={accounts}
          isLoading={isLoading || isLoadingIncome || isLoadingTransfers}
          onAddTemplate={() => openAddForm("expense")}
        />
      </Card>

      <SlideOver
        open={showAddForm}
        onClose={() => setShowAddForm(false)}
        title={t(ADD_TITLE_KEYS[addKind])}
        description={t(ADD_DESCRIPTION_KEYS[addKind])}
        data-testid="add-recurring-template-slide-over"
      >
        <div className="space-y-4">
          <PillTabs
            options={ADD_KINDS}
            labels={{
              expense: t("recurring.typeExpense"),
              income: t("recurring.typeIncome"),
              transfer: t("recurring.typeTransfer"),
            }}
            value={addKind}
            onChange={setAddKind}
            data-testid="recurring-add-kind"
          />
          {addKind === "expense" && (
            <AddRecurringTemplateForm onClose={() => setShowAddForm(false)} />
          )}
          {addKind === "income" && (
            <AddRecurringIncomeForm onClose={() => setShowAddForm(false)} />
          )}
          {addKind === "transfer" && (
            <RecurringTransferForm onClose={() => setShowAddForm(false)} />
          )}
        </div>
      </SlideOver>
    </div>
  );
}
