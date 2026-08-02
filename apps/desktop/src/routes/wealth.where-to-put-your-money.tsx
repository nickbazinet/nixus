import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Compass } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Skeleton,
  StepProgress,
} from "@nixus/shared";
import { ActionWaterfall } from "@/components/financial-health/ActionWaterfall";
import { EmergencyFundPanel } from "@/components/financial-health/EmergencyFundPanel";
import { FinancialHealthDisclaimer } from "@/components/financial-health/FinancialHealthDisclaimer";
import { SavingsCapacityPanel } from "@/components/financial-health/SavingsCapacityPanel";
import { useFinancialHealthDetail } from "@/hooks/useFinancialHealth";

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
  const { t } = useTranslation();
  const { data, isPending } = useFinancialHealthDetail();

  if (isPending) {
    return (
      <div className="grid grid-cols-1 gap-grid-gap min-[1100px]:grid-cols-[1.1fr_1fr]">
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
    );
  }

  if (!data?.data_sufficient) {
    return (
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
    );
  }

  return (
    <div className="flex flex-col gap-grid-gap">
      {/* Two columns at 1100px and up, one below — the widest structure that holds at 1024x680. */}
      <div className="grid grid-cols-1 gap-grid-gap min-[1100px]:grid-cols-[1.1fr_1fr]">
        <ActionWaterfall />
        <div className="flex flex-col gap-grid-gap">
          <EmergencyFundPanel />
          <SavingsCapacityPanel />
        </div>
      </div>
      <FinancialHealthDisclaimer testId="financial-health-section-disclaimer" />
    </div>
  );
}
