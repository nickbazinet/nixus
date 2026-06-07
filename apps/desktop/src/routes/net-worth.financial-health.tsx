import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Compass } from "lucide-react";
import { Button } from "@nixus/shared";
import { Card, CardContent } from "@nixus/shared";
import { ActionWaterfall } from "@/components/financial-health/ActionWaterfall";
import { EmergencyFundPanel } from "@/components/financial-health/EmergencyFundPanel";
import { FinancialHealthDisclaimer } from "@/components/financial-health/FinancialHealthDisclaimer";
import { SavingsCapacityPanel } from "@/components/financial-health/SavingsCapacityPanel";
import { useFinancialHealthSummary } from "@/hooks/useFinancialHealth";

export const Route = createFileRoute("/net-worth/financial-health")({
  component: FinancialHealthSectionPage,
});

function FinancialHealthSectionPage() {
  const { t } = useTranslation();
  const { data, isPending } = useFinancialHealthSummary();

  if (isPending) {
    return (
      <Card className="shadow-sm rounded-lg" data-testid="financial-health-section-loading">
        <CardContent className="p-8">
          <div className="h-4 w-48 bg-muted animate-pulse rounded mb-3" />
          <div className="h-3 w-full max-w-md bg-muted animate-pulse rounded" />
        </CardContent>
      </Card>
    );
  }

  if (!data?.data_sufficient) {
    return (
      <Card className="shadow-sm rounded-lg" data-testid="financial-health-section-empty">
        <CardContent className="p-8 text-center">
          <Compass
            className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3"
            aria-hidden="true"
          />
          <p className="font-medium text-foreground mb-1">
            {t("financialHealth.empty.sectionTitle")}
          </p>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            {t("financialHealth.empty.sectionDescription")}
          </p>
          <Link to="/import">
            <Button data-testid="financial-health-import-cta">
              {t("financialHealth.empty.importCta")}
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <EmergencyFundPanel />
      <ActionWaterfall />
      <SavingsCapacityPanel />
      <FinancialHealthDisclaimer testId="financial-health-section-disclaimer" />
    </div>
  );
}
