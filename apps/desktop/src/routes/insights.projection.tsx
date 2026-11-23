import { useCallback, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  InfoIcon,
  ShieldIcon,
  TargetIcon,
  TrendingUpIcon,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  EmptyState,
  Money,
  PillTabs,
} from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricTile } from "@/components/shared/MetricTile";
import { ProjectionChart } from "@/components/projection/ProjectionChart";
import {
  ASSUMPTIONS_PANEL_ID,
  AssumptionsPanel,
} from "@/components/projection/AssumptionsPanel";
import { MilestonesCard } from "@/components/projection/MilestonesCard";
import { WhatIfCard } from "@/components/projection/WhatIfCard";
import {
  projectionEndYear,
  projectionMilestones,
} from "@/components/projection/milestones";
import { insightsLocale } from "@/components/spending-trends/insights-chart";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { useProjectionInput } from "@/hooks/useProjectionData";
import { computeProjection } from "@/lib/projection";

export const Route = createFileRoute("/insights/projection")({
  component: ProjectionPage,
});

const HORIZONS = ["6m", "1y", "2y", "5y", "10y", "20y"] as const;
const HORIZON_LABEL_KEYS: Record<string, string> = {
  "6m": "projection.period6M",
  "1y": "projection.period1Y",
  "2y": "projection.period2Y",
  "5y": "projection.period5Y",
  "10y": "projection.period10Y",
  "20y": "projection.period20Y",
};
const HORIZON_MONTHS: Record<string, number> = {
  "6m": 6,
  "1y": 12,
  "2y": 24,
  "5y": 60,
  "10y": 120,
  "20y": 240,
};

function ProjectionPage() {
  const { t, i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);
  const [horizon, setHorizon] = useState<string>("5y");
  const { data, isPending } = useProjectionInput();

  const horizonLabels = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(HORIZON_LABEL_KEYS).map(([key, value]) => [
          key,
          t(value),
        ]),
      ) as Record<string, string>,
    [t],
  );

  const months = HORIZON_MONTHS[horizon];

  const points = useMemo(() => {
    if (!data) return [];
    return computeProjection(data, months);
  }, [data, months]);

  const summary = useMemo(() => {
    const now = new Date();
    const startCents = points[0]?.total_cents ?? 0;
    const endCents = points[points.length - 1]?.total_cents ?? startCents;
    return {
      startCents,
      endCents,
      gainCents: endCents - startCents,
      endYear: projectionEndYear(points, now),
      milestones: projectionMilestones(points, now),
    };
  }, [points]);

  const scrollToAssumptions = useCallback(() => {
    const panel = document.getElementById(ASSUMPTIONS_PANEL_ID);
    panel?.scrollIntoView({ behavior: "smooth", block: "start" });
    panel?.focus({ preventScroll: true });
  }, []);

  const isEmpty =
    !isPending &&
    (!data ||
      (data.account_balances.length === 0 && data.asset_values.length === 0));

  const noCashFlowHistory =
    data &&
    data.income_month_count === 0 &&
    data.expense_month_count === 0 &&
    !isEmpty;

  return (
    <div>
      <PageHeader
        title={t("nav.projection")}
        subtitle={t("surface.subtitle.projection")}
        actions={
          <PillTabs
            options={HORIZONS}
            labels={horizonLabels}
            value={horizon}
            onChange={setHorizon}
            data-testid="horizon-tabs"
          />
        }
      />

      {isEmpty ? (
        <Card data-testid="projection-empty">
          <EmptyState
            icon={<TrendingUpIcon />}
            title={t("insights.projectionEmptyTitle")}
            description={t("projection.noAccountsOrAssets")}
            action={
              <Button render={<Link to="/wealth/accounts" />}>
                {t("dashboard.goToAccounts")}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-grid-gap">
          {noCashFlowHistory && (
            <Card flush data-testid="projection-no-cash-flow">
              <Alert variant="caution" icon={<InfoIcon />}>
                <AlertDescription>
                  {t("projection.noIncomeOrExpense")}
                </AlertDescription>
              </Alert>
            </Card>
          )}

          <div className="grid gap-grid-gap md:grid-cols-3">
            <MetricTile
              icon={ShieldIcon}
              label={t("insights.v2.whereYouAreToday")}
              value={
                <Money
                  cents={summary.startCents}
                  locale={locale}
                  {...maskProps}
                />
              }
              caption={t("insights.v2.accountsAndAssetsNow")}
              isLoading={isPending}
              data-testid="projection-today-total"
            />
            <MetricTile
              icon={TargetIcon}
              featured
              label={t("insights.v2.inYear", { year: summary.endYear })}
              value={
                <Money cents={summary.endCents} locale={locale} {...maskProps} />
              }
              caption={t("insights.v2.ifTodaysPaceHolds")}
              isLoading={isPending}
              data-testid="projection-end-total"
            />
            <MetricTile
              icon={TrendingUpIcon}
              label={t("projection.gainFromToday")}
              value={
                <Money
                  cents={summary.gainCents}
                  locale={locale}
                  sign="always"
                  {...maskProps}
                />
              }
              caption={t("insights.v2.savingsPlusReturns")}
              isLoading={isPending}
              data-testid="projection-gain-total"
            />
          </div>

          <div className="grid items-start gap-grid-gap lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <ProjectionChart data={points} isLoading={isPending} />

            <div className="flex flex-col gap-grid-gap">
              {data && (
                <WhatIfCard
                  netMonthlyCents={
                    data.avg_monthly_income_cents - data.avg_monthly_expense_cents
                  }
                  horizonLabel={
                    months < 12
                      ? t("insights.v2.monthsCount", { months })
                      : t("insights.v2.yearsCount", { years: months / 12 })
                  }
                  onSeeAssumptions={scrollToAssumptions}
                />
              )}
              <MilestonesCard milestones={summary.milestones} />
            </div>
          </div>

          {data && (
            <AssumptionsPanel
              avgMonthlyIncomeCents={data.avg_monthly_income_cents}
              avgMonthlyExpenseCents={data.avg_monthly_expense_cents}
              incomeMonthCount={data.income_month_count}
              expenseMonthCount={data.expense_month_count}
            />
          )}

          <p className="text-caption text-ink-dim">
            {t("projection.assumptionCaption")}
          </p>
        </div>
      )}
    </div>
  );
}
