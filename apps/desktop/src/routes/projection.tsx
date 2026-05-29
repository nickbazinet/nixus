import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@nixus/shared";
import { PillTabs } from "@nixus/shared";
import { ProjectionChart } from "@/components/projection/ProjectionChart";
import { AssumptionsPanel } from "@/components/projection/AssumptionsPanel";
import { useProjectionInput } from "@/hooks/useProjectionData";
import { computeProjection } from "@/lib/projection";

export const Route = createFileRoute("/projection")({
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
        Object.entries(HORIZON_LABEL_KEYS).map(([k, v]) => [k, t(v)])
      ) as Record<string, string>,
    [t]
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
      <PageHeader title={t("nav.projection")} />

      {isEmpty ? (
        <Card className="shadow-sm rounded-lg">
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">
              {t("projection.noAccountsOrAssets")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="mb-4">
            <PillTabs
              options={HORIZONS}
              labels={horizonLabels}
              value={horizon}
              onChange={setHorizon}
              data-testid="horizon-tabs"
            />
          </div>

          {noCashFlowHistory && (
            <p className="text-sm text-muted-foreground">
              {t("projection.noIncomeOrExpense")}
            </p>
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
