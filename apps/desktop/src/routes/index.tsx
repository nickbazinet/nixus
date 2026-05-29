import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@nixus/shared";
import { Card, CardContent } from "@nixus/shared";
import { ChevronDown, ChevronRight } from "lucide-react";
import { DashboardMetricCard } from "@/components/dashboard/DashboardMetricCard";
import { DashboardBudgetCategoryRow } from "@/components/dashboard/BudgetCategoryRow";
import { NetWorthSparkline } from "@/components/dashboard/NetWorthSparkline";
import { useBudgetSummary, useTopBudgetCategories, useSpendingBreakdown } from "@/hooks/useDashboard";
import { useCurrentNetWorth, useRecentNetWorthSnapshots } from "@/hooks/useNetWorth";
import { useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { CashFlowSummaryCard } from "@/components/dashboard/CashFlowSummaryCard";
import { YearToDateCard } from "@/components/yearly-summary/YearToDateCard";
import { useIncomeTotal } from "@/hooks/useIncome";
import { useYearlySummary } from "@/hooks/useYearlySummary";
import { MonthNavigator } from "@/components/budget/MonthNavigator";

export const Route = createFileRoute("/")({
  component: IndexPage,
});

function IndexPage() {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const navigate = useNavigate();
  const onboarding = useOnboardingStatus();

  useEffect(() => {
    if (onboarding.data?.needs_onboarding) {
      navigate({ to: "/onboarding" });
    }
  }, [onboarding.data, navigate]);

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);

  const handleMonthChange = (year: number, month: number) => {
    setSelectedYear(year);
    setSelectedMonth(month);
  };

  const budgetSummary = useBudgetSummary(selectedYear, selectedMonth);
  const topCategories = useTopBudgetCategories(selectedYear, selectedMonth);
  const netWorth = useCurrentNetWorth();
  const snapshots = useRecentNetWorthSnapshots(12);
  const spending = useSpendingBreakdown(selectedYear, selectedMonth);
  const incomeTotal = useIncomeTotal(selectedYear, selectedMonth);
  const yearlySummary = useYearlySummary(now.getFullYear());

  const summary = budgetSummary.data;
  const categories = topCategories.data;
  const nw = netWorth.data;
  const snapshotData = snapshots.data ?? [];
  const spendingData = spending.data ?? [];

  const monthLabel = new Date(selectedYear, selectedMonth - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

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
      ? { direction: "up" as const, percentage: `+${formatCurrency(diff)} (+${pct}%)` }
      : { direction: "down" as const, percentage: `${formatCurrency(diff)} (${pct}%)` };
  })();

  return (
    <div>
      <PageHeader
        title={t("nav.dashboard")}
        actions={
          <>
            <MonthNavigator
              selectedYear={selectedYear}
              selectedMonth={selectedMonth}
              onChange={handleMonthChange}
            />
            <Link to="/import">
              <Button data-testid="import-statement-btn">{t("dashboard.importStatement")}</Button>
            </Link>
          </>
        }
      />

      {/* Cash Flow Card */}
      <div className="mb-4">
        <CashFlowSummaryCard
          incomeCents={incomeTotal.data?.total_cents ?? 0}
          expensesCents={summary?.total_spent_cents ?? 0}
          isLoading={incomeTotal.isPending || budgetSummary.isPending}
        />
      </div>

      {/* Year to Date Card */}
      <div className="mb-4">
        <YearToDateCard
          data={yearlySummary.data}
          isLoading={yearlySummary.isPending}
        />
      </div>

      {/* Hero Section: 2-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Net Worth Hero */}
        {netWorth.isPending ? (
          <DashboardMetricCard title={t("nav.netWorth")} value="" variant="hero" isLoading />
        ) : hasNetWorth ? (
          <DashboardMetricCard
            title={t("nav.netWorth")}
            value={formatCurrency(nw!.total_cents)}
            variant="hero"
            href="/net-worth"
            trend={netWorthTrend}
            progressBar={
              snapshotData.length >= 2 ? (
                <NetWorthSparkline snapshots={snapshotData} />
              ) : undefined
            }
          />
        ) : (
          <Card className="shadow-sm rounded-lg" data-testid="empty-net-worth">
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">
                {t("dashboard.noAccountsOrAssets")}
              </p>
              <Link to="/accounts">
                <Button className="mt-3" data-testid="add-account-link">
                  {t("dashboard.goToAccounts")}
                </Button>
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Budget Remaining Hero */}
        {budgetSummary.isPending ? (
          <DashboardMetricCard title={t("dashboard.budgetRemaining")} value="" variant="hero" isLoading />
        ) : !hasBudget ? (
          <Card className="shadow-sm rounded-lg" data-testid="empty-budget">
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">
                {t("dashboard.noBudget")}
              </p>
              <Link to="/budget">
                <Button className="mt-3" data-testid="create-budget-link">
                  {t("dashboard.goToBudget")}
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <DashboardMetricCard
            title={`${t("dashboard.budgetRemaining")} — ${monthLabel}`}
            value={formatCurrency(summary!.remaining_cents)}
            variant="hero"
            href="/budget"
            trend={
              summary!.remaining_cents >= 0
                ? { direction: "up", percentage: `${Math.round(100 - budgetUtilization)}${t("dashboard.percentLeft")}` }
                : { direction: "down", percentage: `${Math.round(budgetUtilization - 100)}${t("dashboard.percentOver")}` }
            }
            progressBar={
              <div
                className="h-2 w-full rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={summary!.total_spent_cents}
                aria-valuemin={0}
                aria-valuemax={summary!.total_target_cents}
                data-testid="budget-overall-progress"
              >
                <div
                  className={`h-full rounded-full transition-all ${
                    budgetUtilization > 100
                      ? "bg-rose-500"
                      : budgetUtilization >= 75
                        ? "bg-amber-500"
                        : "bg-primary"
                  }`}
                  style={{ width: `${Math.min(budgetUtilization, 100)}%` }}
                />
              </div>
            }
          />
        )}
      </div>

      {/* Secondary Cards: 3-column grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
        <DashboardMetricCard
          title={t("dashboard.cash")}
          value={formatCurrency(nw?.cash_cents ?? 0)}
          variant="secondary"
          isLoading={netWorth.isPending}
        />
        <DashboardMetricCard
          title={t("dashboard.investments")}
          value={formatCurrency(nw?.investments_cents ?? 0)}
          variant="secondary"
          isLoading={netWorth.isPending}
        />
        <DashboardMetricCard
          title={t("dashboard.assets")}
          value={formatCurrency(nw?.assets_cents ?? 0)}
          variant="secondary"
          isLoading={netWorth.isPending}
        />
      </div>

      {/* Top Budget Categories */}
      <div className="mt-6">
        {topCategories.isPending ? (
          <Card className="shadow-sm rounded-lg" data-testid="categories-skeleton">
            <CardContent className="p-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="py-2">
                  <div className="h-4 w-32 bg-muted animate-pulse rounded mb-2" />
                  <div className="h-2 w-full bg-muted animate-pulse rounded" />
                </div>
              ))}
            </CardContent>
          </Card>
        ) : hasBudget && categories && categories.length > 0 ? (
          <Card className="shadow-sm rounded-lg" data-testid="top-categories">
            <CardContent className="p-6">
              <p className="text-sm font-medium text-muted-foreground mb-3">
                {t("dashboard.topCategories")} — {monthLabel}
              </p>
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
          <Card className="shadow-sm rounded-lg" data-testid="empty-expenses">
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">
                {t("dashboard.noExpenses")}
              </p>
              <Link to="/import">
                <Button className="mt-3" data-testid="import-link">
                  {t("dashboard.importStatement")}
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {/* Spending Breakdown */}
      {spending.isPending ? null : spendingData.length > 0 ? (
        <SpendingBreakdown
          monthLabel={monthLabel}
          spendingData={spendingData}
          formatCurrency={formatCurrency}
        />
      ) : null}
    </div>
  );
}

function SpendingBreakdown({
  monthLabel,
  spendingData,
  formatCurrency,
}: {
  monthLabel: string;
  spendingData: { category_id: number; category_name: string; spent_cents: number }[];
  formatCurrency: (cents: number) => string;
}) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="mt-4">
      <Card className="shadow-sm rounded-lg" data-testid="spending-breakdown">
        <CardContent className="p-6">
          <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground mb-3 -ml-2"
            onClick={() => setIsOpen(!isOpen)}
            data-testid="spending-breakdown-toggle"
          >
            {isOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            {t("dashboard.spendingBreakdown")} — {monthLabel}
          </Button>
          {isOpen &&
            spendingData.map((item) => (
              <div
                key={item.category_id}
                className="flex items-center justify-between py-2"
                data-testid="spending-row"
              >
                <span className="text-sm">{item.category_name}</span>
                <span className="font-mono text-sm">
                  {formatCurrency(item.spent_cents)}
                </span>
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
