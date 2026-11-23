import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { usePeriod } from "@/hooks/usePeriod";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Money,
  Skeleton,
  formatMoney,
} from "@nixus/shared";
import { ChevronDown, ChevronRight, PiggyBank, Sparkles, Tag, Tags, Wallet } from "lucide-react";
import { BudgetRemainingCard } from "@/components/dashboard/BudgetRemainingCard";
import { DashboardBudgetCategoryRow } from "@/components/dashboard/BudgetCategoryRow";
import { NetWorthCard } from "@/components/dashboard/NetWorthCard";
import { useBudgetSummary, useTopBudgetCategories, useSpendingBreakdown } from "@/hooks/useDashboard";
import { useCurrentNetWorth, useRecentNetWorthSnapshots } from "@/hooks/useNetWorth";
import { fetchOnboardingStatus, useOnboardingStatus } from "@/hooks/useOnboardingStatus";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { CashFlowSummaryCard } from "@/components/dashboard/CashFlowSummaryCard";
import { FinancialHealthCard } from "@/components/dashboard/FinancialHealthCard";
import { SavingsProjectsRow } from "@/components/dashboard/SavingsProjectsRow";
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

/** The hero card's own shape while the budget read is in flight: label, figure, meter. */
function MetricCardSkeleton() {
  return (
    <Card data-testid="metric-card-skeleton">
      <CardContent>
        <Skeleton rows={3} />
      </CardContent>
    </Card>
  );
}

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
  const money = (cents: number, sign?: "always") =>
    hidden ? amountHidden : formatMoney({ cents, locale: i18n.language, sign });

  const monthLabel = new Date(selectedYear, selectedMonth - 1).toLocaleDateString(
    i18n.language,
    { month: "long", year: "numeric" },
  );

  const hasBudget = summary && summary.total_target_cents > 0;
  const hasExpenses = summary && summary.total_spent_cents > 0;
  const hasNetWorth = nw && nw.total_cents !== 0;

  // What the year has added, preferred over the snapshot-to-snapshot step: "up $68,814.54 this
  // year" is the sentence a person can act on. The step is the fallback when the year's gain
  // cannot be stated at all.
  const netWorthChange = (() => {
    const ytd = yearlySummary.data;
    if (ytd?.net_worth_gain_available && ytd.net_worth_gain_cents !== null) {
      return {
        cents: ytd.net_worth_gain_cents,
        label: t("dashboard.v2.thisYear", { amount: money(ytd.net_worth_gain_cents, "always") }),
      };
    }
    if (snapshotData.length < 2 || !nw) return undefined;
    const previous = snapshotData[snapshotData.length - 2].total_cents;
    const diff = nw.total_cents - previous;
    if (diff === 0) return { cents: 0, label: t("dashboard.noChange") };
    const percent = previous !== 0 ? Math.abs((diff / previous) * 100).toFixed(1) : "0.0";
    return { cents: diff, label: `${money(diff, "always")} (${percent}%)` };
  })();

  return (
    <div className="flex flex-col gap-grid-gap">
      <PageHeader
        title={t("nav.today")}
        subtitle={t("surface.subtitle.today")}
        actions={
          <Button render={<Link to="/import" />} data-testid="import-statement-btn">
            <Sparkles data-icon="inline-start" aria-hidden="true" />
            {t("dashboard.importStatement")}
          </Button>
        }
      />

      {onboarding.data?.setup_incomplete && <SetupIncompleteBanner />}

      {/* Row 1 — the month in two figures: what is left to spend, and whether more came in than
          went out. The budget card is the surface's one featured card and its one display figure. */}
      <div className="grid grid-cols-1 gap-grid-gap lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
        {budgetSummary.isPending ? (
          <MetricCardSkeleton />
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
          <BudgetRemainingCard
            summary={summary}
            year={selectedYear}
            month={selectedMonth}
          />
        )}

        <CashFlowSummaryCard
          incomeCents={incomeTotal.data?.total_cents ?? 0}
          expensesCents={summary?.total_spent_cents ?? 0}
          isLoading={incomeTotal.isPending || budgetSummary.isPending}
        />
      </div>

      {/* Row 2 — the surface's one glass callout: the single thing worth doing next. */}
      <FinancialHealthCard />

      {/* Row 3 — the longer view. Secondary figures only; never a second display figure. */}
      <div className="grid grid-cols-1 gap-grid-gap lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)] lg:items-start">
        {netWorth.isPending ? (
          <MetricCardSkeleton />
        ) : hasNetWorth ? (
          <NetWorthCard netWorth={nw} snapshots={snapshotData} change={netWorthChange}>
            {/* Renders nothing when there are no active goals. */}
            <SavingsProjectsRow />
          </NetWorthCard>
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

        <div className="flex flex-col gap-grid-gap">
          <YearToDateCard data={yearlySummary.data} isLoading={yearlySummary.isPending} />

          {topCategories.isPending ? (
            <Card data-testid="categories-skeleton">
              <CardContent>
                <Skeleton rows={5} />
              </CardContent>
            </Card>
          ) : hasBudget && categories && categories.length > 0 ? (
            <Card data-testid="top-categories">
              <CardHeader>
                <CardTitle icon={Tag}>{t("dashboard.topCategories")}</CardTitle>
                <CardAction>
                  <Button
                    variant="outline"
                    size="sm"
                    render={<Link to="/spending/budget" />}
                    data-testid="top-categories-link"
                  >
                    {t("dashboard.v2.details")}
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent>
                {categories.map((category, rank) => (
                  <DashboardBudgetCategoryRow
                    key={category.id}
                    rank={rank}
                    name={category.name}
                    targetCents={category.target_cents}
                    spentCents={category.spent_cents}
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
        </div>
      </div>

      {/* Everything the month contained, folded away: the rows above answer the questions, this
          is the ledger behind them. */}
      {spending.isPending ? null : spendingData.length > 0 ? (
        <SpendingBreakdown monthLabel={monthLabel} spendingData={spendingData} />
      ) : null}

      <LastExpenseLine />
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
  const { maskProps } = useValuesHidden();
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Card data-testid="spending-breakdown">
      <CardHeader>
        <CardTitle icon={Tags}>
          {t("dashboard.spendingBreakdown")} — {monthLabel}
        </CardTitle>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsOpen(!isOpen)}
            aria-expanded={isOpen}
            data-testid="spending-breakdown-toggle"
          >
            {isOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
            {isOpen ? t("dashboard.v2.hide") : t("dashboard.v2.showAll")}
          </Button>
        </CardAction>
      </CardHeader>
      {isOpen && (
        <CardContent>
          {spendingData.map((item) => (
            <div
              key={item.category_id}
              className="flex items-baseline justify-between gap-3 border-b border-line py-3 last:border-b-0"
              data-testid="spending-row"
            >
              <span className="min-w-0 truncate text-body text-ink">{item.category_name}</span>
              <Money
                className="shrink-0 font-bold text-ink"
                cents={item.spent_cents}
                locale={i18n.language}
                {...maskProps}
              />
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
