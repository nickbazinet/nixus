import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";

interface FinancialHealthDisclaimerProps {
  testId?: string;
}

// Permanent, always-visible, and not dismissible. On this surface it is the full sentence — the
// user came looking for guidance and deserves the caveat in full. The dashboard's next-step card
// carries the compact, expand-on-demand form instead.
export function FinancialHealthDisclaimer({
  testId = "financial-health-disclaimer",
}: FinancialHealthDisclaimerProps) {
  const { t } = useTranslation();

  return (
    <div
      className="flex items-start gap-2.5 rounded-md bg-neutral-bg px-3.5 py-2.5 text-caption text-ink-dim"
      data-testid={testId}
    >
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p>{t("financialHealth.disclaimerFull")}</p>
    </div>
  );
}
