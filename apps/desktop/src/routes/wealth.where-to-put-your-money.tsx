import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChartNoAxesColumn, Check, Compass } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  StepProgress,
  formatMoney,
} from "@nixus/shared";
import { DonutBreakdown, type DonutItem } from "@/components/charts/DonutBreakdown";
import { InsightCallout } from "@/components/shared/InsightCallout";
import { PageHeader } from "@/components/shared/PageHeader";
import { ActionWaterfall } from "@/components/financial-health/ActionWaterfall";
import { EmergencyFundPanel } from "@/components/financial-health/EmergencyFundPanel";
import { FinancialHealthDisclaimer } from "@/components/financial-health/FinancialHealthDisclaimer";
import { SavingsCapacityPanel } from "@/components/financial-health/SavingsCapacityPanel";
import { TfsaRoomPanel } from "@/components/financial-health/TfsaRoomPanel";
import { useFinancialHealthDetail } from "@/hooks/useFinancialHealth";
import { useSuggestedAllocation } from "@/hooks/useProjects";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";

export const Route = createFileRoute("/wealth/where-to-put-your-money")({
  component: FinancialHealthSectionPage,
});

const REQUIRED_MONTHS = 3;

function MonthsProgress({ completed }: { completed: number }) {
  const { t } = useTranslation();
  const filled = Math.min(completed, REQUIRED_MONTHS);
  const readout = t("financialHealth.empty.progress", {
    done: filled,
    total: REQUIRED_MONTHS,
  });

  return (
    <div className="mt-4 flex flex-col items-center gap-1.5">
      <StepProgress
        completed={filled}
        total={REQUIRED_MONTHS}
        label={t("financialHealth.empty.progressLabel")}
        valueText={readout}
        data-testid="financial-health-months-progress"
      />
      <span className="text-caption text-ink-dim">{readout}</span>
    </div>
  );
}

function FinancialHealthSectionPage() {
  const { t, i18n } = useTranslation();
  const { hidden } = useValuesHidden();
  const { data, isPending } = useFinancialHealthDetail();
  const { data: suggestion } = useSuggestedAllocation();

  // The left-over amount is the typical-month surplus Rust computed (income minus spending,
  // averaged over completed months), and it is only stated when it exists and is positive: a
  // callout promising money to place in a month that ran short would be a lie.
  const surplusCents = data?.savings?.avg_monthly_surplus_cents ?? null;
  const hasSurplus = surplusCents !== null && surplusCents > 0;
  const surplusLabel = hidden
    ? t("common.amountHidden")
    : formatMoney({ cents: surplusCents ?? 0, locale: i18n.language });
  const subtitle = t("surface.subtitle.whereToPutYourMoneyNoAmount");

  // The month's split is only a real split when the backend actually suggested one per goal.
  const splitItems: DonutItem[] = (suggestion?.suggestions ?? [])
    .filter((entry) => entry.suggested_cents > 0)
    .map((entry) => ({
      key: entry.project_id,
      label: entry.project_name,
      cents: entry.suggested_cents,
    }));

  const header = (
    <PageHeader title={t("nav.whereToPutYourMoney")} subtitle={subtitle} />
  );

  if (isPending) {
    return (
      <div>
        {header}
        <div className="grid grid-cols-1 gap-grid-gap min-[1100px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Card data-testid="financial-health-section-loading">
            <CardContent>
              <Skeleton rows={4} />
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Skeleton rows={6} />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!data?.data_sufficient) {
    return (
      <div>
        {header}
        <div className="flex flex-col gap-grid-gap">
          <Card data-testid="financial-health-section-empty">
            <CardContent>
              {/* No financial-health figure renders here. A number the app cannot yet know is the
                  exact failure this state exists to prevent. */}
              <EmptyState
                icon={<Compass />}
                title={t("financialHealth.empty.title")}
                description={t("financialHealth.empty.body", {
                  months: data?.figures.expense_month_count ?? 0,
                })}
                action={
                  <Button
                    render={<Link to="/import" />}
                    data-testid="financial-health-import-cta"
                  >
                    {t("financialHealth.empty.importCta")}
                  </Button>
                }
              >
                <MonthsProgress completed={data?.figures.expense_month_count ?? 0} />
              </EmptyState>
            </CardContent>
          </Card>
          <FinancialHealthDisclaimer testId="financial-health-section-disclaimer" />
        </div>
      </div>
    );
  }

  return (
    <div>
      {header}
      <div className="flex flex-col gap-section-gap">
        {hasSurplus && (
          <InsightCallout
            icon={Check}
            eyebrow={t("wealth.v2.plan.ready")}
            title={t("wealth.v2.plan.readyTitle", { amount: surplusLabel })}
            data-testid="plan-ready-callout"
          >
            <p>
              {t("wealth.v2.plan.readyBody", {
                months: data.figures.expense_month_count,
              })}
            </p>
            <p className="mt-2">
              {t("wealth.v2.plan.readyNext", {
                step: t(
                  `financialHealth.waterfall.steps.${data.waterfall.current_step}`,
                ),
              })}
            </p>
          </InsightCallout>
        )}
        {/* Two columns at 1100px and up, one below — the widest structure that holds at 1024x680. */}
        <div className="grid grid-cols-1 gap-grid-gap min-[1100px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-grid-gap">
            <ActionWaterfall />
          </div>
          <div className="flex flex-col gap-grid-gap">
            {splitItems.length > 0 && (
              <Card data-testid="plan-split">
                <CardHeader>
                  <CardTitle icon={ChartNoAxesColumn}>
                    {t("wealth.v2.plan.splitTitle")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DonutBreakdown
                    items={splitItems}
                    centerLabel={t("wealth.v2.plan.toPlace")}
                    listLabel={t("wealth.v2.plan.splitTitle")}
                  />
                </CardContent>
              </Card>
            )}
            <EmergencyFundPanel />
            <SavingsCapacityPanel />
            <TfsaRoomPanel />
          </div>
        </div>
        <FinancialHealthDisclaimer testId="financial-health-section-disclaimer" />
      </div>
    </div>
  );
}
