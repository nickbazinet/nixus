import { useTranslation } from "react-i18next";

interface FinancialHealthDisclaimerProps {
  testId?: string;
}

export function FinancialHealthDisclaimer({
  testId = "financial-health-disclaimer",
}: FinancialHealthDisclaimerProps) {
  const { t } = useTranslation();

  return (
    <p className="text-xs text-muted-foreground" data-testid={testId}>
      {t("financialHealth.disclaimer")}
    </p>
  );
}
