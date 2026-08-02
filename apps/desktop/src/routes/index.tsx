import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { usePeriod } from "@/hooks/usePeriod";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Meter,
  Money,
  Skeleton,
  formatMoney,
} from "@nixus/shared";
import { ChevronDown, ChevronRight, PiggyBank, Wallet } from "lucide-react";
import { DashboardMetricCard } from "@/components/dashboard/DashboardMetricCard";
import { DashboardBudgetCategoryRow } from "@/components/dashboard/BudgetCategoryRow";
import { NetWorthSparkline } from "@/components/dashboard/NetWorthSparkline";
import { useBudgetSummary, useTopBudgetCategories, useSpendingBreakdown } from "@/hooks/useDashboard";
import { useCurrentNetWorth, useRecentNetWorthSnapshots } from "@/hooks/useNetWorth";
import { fetchOnboardingStatus, useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { CashFlowSummaryCard } from "@/components/dashboard/CashFlowSummaryCard";
import { FinancialHealthCard } from "@/components/dashboard/FinancialHealthCard";
import { YearToDateCard } from "@/components/yearly-summary/YearToDateCard";
import { useIncomeTotal } from "@/hooks/useIncome";
import { useYearlySummary } from "@/hooks/useYearlySummary";
import { LastExpenseLine } from "@/components/dashboard/LastExpenseLine";
import { SetupIncompleteBanner } from "@/components/dashboard/SetupIncompleteBanner";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    // A failed status check must not block the dashboard, so it degrades to "no
    // redirect" rather than propagating into the route error boundary.
    const status = await fetchOnboardingStatus().catch(() => null);
    if (status?.needs_onboarding) {
      throw redirect({ to: "/onboarding" });
    }
  },
  component: IndexPage,
});

function IndexPage() {
  const { t, i18n } = useTranslation();
  const { hidden } = useValuesHidden();
  const onboarding = useOnboardingStatus();

  const { year: selectedYear, month: selectedMonth } = usePeriod();

  const budgetSummary = useBudgetSummary(selectedYear, selectedMonth);
  const topCategories = useTopBudgetCategories(selectedYear, selectedMonth);
  const netWorth = useCurrentNetWorth();
  const snapshots = useRecentNetWorthSnapshots(12);
  const spending = useSpendingBreakdown(selectedYear, selectedMonth);
  const incomeTotal = useIncomeTotal(selectedYear, selectedMonth);
  const yearlySummary = useYearlySummary(selectedYear);

  const summary = budgetSummary.data;
  const categories = topCategories.data;
  const nw = netWorth.data;
  const snapshotData = snapshots.data ?? [];
  const spendingData = spending.data ?? [];

  const amountHidden = t("common.amountHidden");
  const money = (cents: number) =>
    hidden ? amountHidden : formatMoney({ cents, locale: i18n.language });
  const moneyNode = (cents: number) => (
    <Money
      cents={cents}
      locale={i18n.language}
      masked={hidden}
      maskedLabel={amountHidden}
    />
  );

  const monthLabel = new Date(selectedYear, selectedMonth - 1).toLocaleDateString(
    i18n.language,
    { month: "long", year: "numeric" },
  );

  const hasBudget = summary && summary.total_target_cents > 0;
  const hasExpenses = summary && summary.total_spent_cents > 0;
  const hasNetWorth = nw && nw.total_cents !== 0;

  const budgetUtilization =
    summary && summary.total_target_cents > 0
      ? (summary.total_spent_cents / summary.total_target_cents) * 100
      : 0;

  // Net worth trend from snapshots
  const netWorthTrend = (() => {
    if (snapshotData.length < 2 || !nw) return undefined;
    const prev = snapshotData[snapshotData.length - 2].total_cents;
    const current = nw.total_cents;
    const diff = current - prev;
    if (diff === 0) return { direction: "flat" as const, percentage: t("dashboard.noChange") };
    const pct = prev !== 0 ? Math.abs((diff / prev) * 100).toFixed(1) : "0.0";
    return diff > 0
      ? { direction: "up" as const, percentage: `${money(diff)} (+${pct}%)` }
      : { direction: "down" as const, percentage: `${money(diff)} (${pct}%)` };
  })();

  return (
    <div className="flex flex-col gap-grid-gap">
      <PageHeader
        title={t("nav.today")}
        actions={
          <>
            <Link to="/import">
              <Button data-testid="import-statement-btn">{t("dashboard.importStatement")}</Button>
            </Link>
          </>
        }
      />

      {onboarding.data?.setup_incomplete && <SetupIncompleteBanner />}

      <LastExpenseLine />

      {/* Hero row. One text-display figure lives here — budget remaining, which answers "am I OK
          this month?". Three columns at 1100px and up, one column below. */}
      <div className="grid grid-cols-1 gap-grid-gap min-[1100px]:grid-cols-3">
        {budgetSummary.isPending ? (
          <DashboardMetricCard
            title={t("dashboard.budgetRemaining")}
            value=""
            variant="hero"
            isLoading
          />
        ) : !hasBudget ? (
          <Card data-testid="empty-budget">
            <CardContent>
              <EmptyState
                icon={<PiggyBank />}
                title={t("dashboard.noBudget")}
                action={
                  <Button render={<Link to="/spending/budget" />} data-testid="create-budget-link">
                    {t("dashboard.goToBudget")}
                  </Button>
                }
              />
            </CardContent>
          </Card>
        ) : (
          <DashboardMetricCard
            title={`${t("dashboard.budgetRemaining")} — ${monthLabel}`}
            value={moneyNode(summary.remaining_cents)}
            valueLabel={money(summary.remaining_cents)}
            variant="hero"
            href="/spending/budget"
            trend={
              summary.remaining_cents >= 0
                ? {
                    direction: "up",
                    percentage: `${Math.round(100 - budgetUtilization)}${t("dashboard.percentLeft")}`,
                  }
                : {
                    direction: "down",
                    percentage: `${Math.round(budgetUtilization - 100)}${t("dashboard.percentOver")}`,
                  }
            }
            progressBar={
              <Meter
                label={t("dashboard.budgetMeterLabel")}
                value={Math.min(budgetUtilization, 100)}
                valueText={t("dashboard.budgetMeterValue", {
                  spent: money(summary.total_spent_cents),
                  target: money(summary.total_target_cents),
                })}
                data-testid="budget-overall-progress"
              />
            }
          />
        )}

        <CashFlowSummaryCard
          incomeCents={incomeTotal.data?.total_cents ?? 0}
          expensesCents={summary?.total_spent_cents ?? 0}
          isLoading={incomeTotal.isPending || budgetSummary.isPending}
        />

        {/* The surface's single action-card. */}
        <FinancialHealthCard />
      </div>

      {/* Net worth and its parts. Secondary figures only — never a second text-display. */}
      <div className="grid grid-cols-1 gap-grid-gap sm:grid-cols-2 min-[1100px]:grid-cols-4">
        {netWorth.isPending ? (
          <DashboardMetricCard title={t("nav.netWorth")} value="" variant="secondary" isLoading />
        ) : hasNetWorth ? (
          <DashboardMetricCard
            title={t("nav.netWorth")}
            value={moneyNode(nw.total_cents)}
            valueLabel={money(nw.total_cents)}
            variant="secondary"
            href="/wealth/net-worth"
            trend={netWorthTrend}
            progressBar={
              snapshotData.length >= 2 ? (
                <NetWorthSparkline snapshots={snapshotData} />
              ) : undefined
            }
          />
        ) : (
          <Card data-testid="empty-net-worth">
            <CardContent>
              <EmptyState
                icon={<Wallet />}
                title={t("dashboard.noAccountsOrAssets")}
                action={
                  <Button render={<Link to="/wealth/accounts" />} data-testid="add-account-link">
                    {t("dashboard.goToAccounts")}
                  </Button>
                }
              />
            </CardContent>
          </Card>
        )}

        <DashboardMetricCard
          title={t("dashboard.cash")}
          value={moneyNode(nw?.cash_cents ?? 0)}
          valueLabel={money(nw?.cash_cents ?? 0)}
          variant="secondary"
          isLoading={netWorth.isPending}
        />
        <DashboardMetricCard
          title={t("dashboard.investments")}
          value={moneyNode(nw?.investments_cents ?? 0)}
          valueLabel={money(nw?.investments_cents ?? 0)}
          variant="secondary"
          isLoading={netWorth.isPending}
        />
        <DashboardMetricCard
          title={t("dashboard.assets")}
          value={moneyNode(nw?.assets_cents ?? 0)}
          valueLabel={money(nw?.assets_cents ?? 0)}
          variant="secondary"
          isLoading={netWorth.isPending}
        />
      </div>

      <YearToDateCard data={yearlySummary.data} isLoading={yearlySummary.isPending} />

      {/* Top Budget Categories */}
      {topCategories.isPending ? (
        <Card data-testid="categories-skeleton">
          <CardContent>
            <Skeleton rows={5} />
          </CardContent>
        </Card>
      ) : hasBudget && categories && categories.length > 0 ? (
        <Card data-testid="top-categories">
          <CardHeader>
            <CardTitle>
              {t("dashboard.topCategories")} — {monthLabel}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {categories.map((cat) => (
              <DashboardBudgetCategoryRow
                key={cat.id}
                name={cat.name}
                targetCents={cat.target_cents}
                spentCents={cat.spent_cents}
              />
            ))}
          </CardContent>
        </Card>
      ) : hasBudget && !hasExpenses ? (
        <Card data-testid="empty-expenses">
          <CardContent>
            <EmptyState
              title={t("dashboard.noExpenses")}
              action={
                <Button render={<Link to="/import" />} data-testid="import-link">
                  {t("dashboard.importStatement")}
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : null}

      {/* Spending Breakdown */}
      {spending.isPending ? null : spendingData.length > 0 ? (
        <SpendingBreakdown monthLabel={monthLabel} spendingData={spendingData} />
      ) : null}
    </div>
  );
}

function SpendingBreakdown({
  monthLabel,
  spendingData,
}: {
  monthLabel: string;
  spendingData: { category_id: number; category_name: string; spent_cents: number }[];
}) {
  const { t, i18n } = useTranslation();
  const { hidden } = useValuesHidden();
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Card data-testid="spending-breakdown">
      <CardContent>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 mb-2 gap-1 text-ink-dim"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          data-testid="spending-breakdown-toggle"
        >
          {isOpen ? <ChevronDown /> : <ChevronRight />}
          {t("dashboard.spendingBreakdown")} — {monthLabel}
        </Button>
        {isOpen &&
          spendingData.map((item) => (
            <div
              key={item.category_id}
              className="flex items-center justify-between border-b border-line py-2 last:border-b-0"
              data-testid="spending-row"
            >
              <span className="text-caption text-ink">{item.category_name}</span>
              <Money
                className="text-caption text-ink"
                cents={item.spent_cents}
                locale={i18n.language}
                masked={hidden}
                maskedLabel={t("common.amountHidden")}
              />
            </div>
          ))}
      </CardContent>
    </Card>
  );
}
