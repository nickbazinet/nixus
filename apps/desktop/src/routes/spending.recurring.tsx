import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Calendar, Clock, Lightbulb, Plus, Repeat, RefreshCw, Tag } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  IconChip,
  Money,
  PillTabs,
  SlideOver,
} from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricTile } from "@/components/shared/MetricTile";
import { InsightCallout } from "@/components/shared/InsightCallout";
import { AddRecurringTemplateForm } from "@/components/expenses/AddRecurringTemplateForm";
import { AddRecurringIncomeForm } from "@/components/income/AddRecurringIncomeForm";
import { RecurringTransferForm } from "@/components/accounts/RecurringTransferForm";
import { RecurringTemplateList } from "@/components/expenses/RecurringTemplateList";
import {
  accountNameMap,
  buildRecurringRows,
  rowKey,
  rowName,
  upcomingRecurringRows,
} from "@/components/expenses/recurringRows";
import { formatNextDate } from "@/components/expenses/recurringSchedule";
import { useRecurringTemplates } from "@/hooks/useRecurringExpenses";
import { useRecurringIncomeTemplates } from "@/hooks/useRecurringIncome";
import { useRecurringTransferTemplates } from "@/hooks/useRecurringTransfers";
import { useAccounts } from "@/hooks/useAccounts";
import { useAllBudgetCategories } from "@/hooks/useExpenses";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import { monthlyEquivalentCents } from "@/lib/recurrence";
import type { BudgetCategory, RecurringExpenseTemplate } from "@/lib/types";

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

/** How many of the next payments the side card lists before it stops being a glance. */
const UPCOMING_LIMIT = 5;

/**
 * Category names that read as a subscription, in both languages. The data carries no "is a
 * subscription" flag — the only thing it has is the category the user filed the bill under — so the
 * match is on the name, the same way the Insights surfaces classify a bill.
 */
const SUBSCRIPTION_NAME_PATTERNS = ["subscription", "abonnement"] as const;

function isSubscriptionCategory(name: string): boolean {
  const lower = name.toLocaleLowerCase();
  return SUBSCRIPTION_NAME_PATTERNS.some((pattern) => lower.includes(pattern));
}

function subscriptionSummary(
  templates: readonly RecurringExpenseTemplate[],
  categories: readonly BudgetCategory[]
): { monthlyCents: number; count: number } | null {
  const subscriptionIds = new Set(
    categories.filter((category) => isSubscriptionCategory(category.name)).map((c) => c.id)
  );
  if (subscriptionIds.size === 0) return null;

  const matching = templates.filter(
    (template) => template.is_active && subscriptionIds.has(template.budget_category_id)
  );
  if (matching.length === 0) return null;

  return {
    monthlyCents: matching.reduce(
      (sum, template) => sum + monthlyEquivalentCents(template),
      0
    ),
    count: matching.length,
  };
}

function RecurringExpensesPage() {
  const { t, i18n } = useTranslation();
  const maskProps = useMaskProps();
  const formatCurrency = useFormatCurrency();
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
  const subscriptions = subscriptionSummary(templates, categories);

  const accountNames = useMemo(() => accountNameMap(accounts), [accounts]);
  const upcoming = useMemo(
    () =>
      upcomingRecurringRows(
        buildRecurringRows(templates, incomeTemplates, transferTemplates),
        UPCOMING_LIMIT
      ),
    [templates, incomeTemplates, transferTemplates]
  );

  const openAddForm = (kind: AddKind) => {
    setAddKind(kind);
    setShowAddForm(true);
  };

  const tileCount = subscriptions ? 4 : 3;

  return (
    <div>
      <PageHeader title={t("recurring.title")} subtitle={t("recurring.subtitle")} />

      <div className="flex flex-col gap-grid-gap">
        <div
          className={
            tileCount === 4
              ? "grid gap-grid-gap md:grid-cols-2 xl:grid-cols-4"
              : "grid gap-grid-gap md:grid-cols-3"
          }
        >
          {/* The featured tile: every other figure here is a consequence of this one. */}
          <MetricTile
            featured
            icon={Repeat}
            label={t("recurring.committedLabel")}
            value={<Money cents={committedCents} locale={i18n.language} {...maskProps} />}
            caption={t("recurring.activeTemplateCount", { count: activeTemplates.length })}
            data-testid="recurring-committed-total"
          />
          <MetricTile
            icon={Calendar}
            label={t("recurring.v2.perYear")}
            value={
              <Money cents={committedCents * 12} locale={i18n.language} {...maskProps} />
            }
            caption={t("recurring.v2.perYearCaption")}
          />
          <MetricTile
            icon={Repeat}
            label={t("recurring.expectedLabel")}
            value={
              <Money cents={expectedIncomeCents} locale={i18n.language} {...maskProps} />
            }
            caption={t("recurring.activeIncomeTemplateCount", {
              count: activeIncomeTemplates.length,
            })}
            data-testid="recurring-expected-total"
          />
          {subscriptions && (
            <MetricTile
              icon={Tag}
              label={t("recurring.v2.subscriptions")}
              value={
                <Money
                  cents={subscriptions.monthlyCents}
                  locale={i18n.language}
                  {...maskProps}
                />
              }
              caption={t("recurring.v2.serviceCount", { count: subscriptions.count })}
              data-testid="recurring-subscriptions-total"
            />
          )}
        </div>

        <div className="grid gap-grid-gap lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Card flush>
            <CardHeader className="border-b border-line pt-card-pad pb-4">
              <CardTitle icon={Repeat}>{t("recurring.v2.allPayments")}</CardTitle>
              <CardAction>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openAddForm("expense")}
                  data-testid="add-recurring-button"
                >
                  <Plus aria-hidden="true" />
                  {t("recurring.addTemplate")}
                </Button>
              </CardAction>
            </CardHeader>
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

          <div className="flex flex-col gap-grid-gap">
            {upcoming.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle icon={Clock}>{t("recurring.v2.comingUp")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul data-testid="recurring-upcoming">
                    {upcoming.map(({ row, date }) => (
                      <li
                        key={rowKey(row)}
                        className="flex items-center gap-3 border-b border-line py-3.5 first:pt-0 last:border-b-0 last:pb-0"
                      >
                        <IconChip icon={Calendar} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-label text-ink">
                            {rowName(row, accountNames)}
                          </p>
                          <p className="text-caption text-ink-dim">
                            {formatNextDate(date, i18n.language)}
                          </p>
                        </div>
                        <Money
                          cents={row.template.amount_cents}
                          locale={i18n.language}
                          className="shrink-0 font-bold text-ink"
                          {...maskProps}
                        />
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {subscriptions && (
              <InsightCallout
                icon={Lightbulb}
                eyebrow={t("recurring.v2.worthALookEyebrow")}
                data-testid="recurring-subscriptions-insight"
              >
                {t("recurring.v2.subscriptionsInsight", {
                  count: subscriptions.count,
                  monthly: formatCurrency(subscriptions.monthlyCents),
                  yearly: formatCurrency(subscriptions.monthlyCents * 12),
                })}
              </InsightCallout>
            )}
          </div>
        </div>

        <Alert
          variant="info"
          icon={<RefreshCw />}
          data-testid="recurring-auto-apply-banner"
        >
          <AlertTitle>{t("recurring.autoApplyTitle")}</AlertTitle>
          <AlertDescription className="mt-1">
            {t("recurring.autoApplyDescription")}
          </AlertDescription>
        </Alert>
      </div>

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
