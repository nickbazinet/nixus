import { useTranslation } from "react-i18next";

interface FinancialHealthDisclaimerProps {
  testId?: string;
}

// Permanent, always-visible, and not dismissible. On this surface it is the full sentence — the
// user came looking for guidance and deserves the caveat in full. The dashboard's next-step card
// carries the compact, expand-on-demand form instead.
//
// A plain footnote rather than a tinted box: a caveat that looks like an alert reads as a warning
// about the user's own numbers, which is not what it says.
export function FinancialHealthDisclaimer({
  testId = "financial-health-disclaimer",
}: FinancialHealthDisclaimerProps) {
  const { t } = useTranslation();

  return (
    <p className="max-w-3xl text-caption text-ink-dim" data-testid={testId}>
      {t("financialHealth.disclaimerFull")}
    </p>
  );
}
