import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { InfoIcon, TrendingUpIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  EmptyState,
  PillTabs,
} from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProjectionChart } from "@/components/projection/ProjectionChart";
import { AssumptionsPanel } from "@/components/projection/AssumptionsPanel";
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
  const { t } = useTranslation();
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

  const points = useMemo(() => {
    if (!data) return [];
    return computeProjection(data, HORIZON_MONTHS[horizon]);
  }, [data, horizon]);

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
        <div className="flex flex-col gap-section-gap">
          {noCashFlowHistory && (
            <Card flush data-testid="projection-no-cash-flow">
              <Alert variant="caution" icon={<InfoIcon />}>
                <AlertDescription>
                  {t("projection.noIncomeOrExpense")}
                </AlertDescription>
              </Alert>
            </Card>
          )}

          <ProjectionChart data={points} isLoading={isPending} />

          {data && (
            <AssumptionsPanel
              avgMonthlyIncomeCents={data.avg_monthly_income_cents}
              avgMonthlyExpenseCents={data.avg_monthly_expense_cents}
              incomeMonthCount={data.income_month_count}
              expenseMonthCount={data.expense_month_count}
            />
          )}
        </div>
      )}
    </div>
  );
}
