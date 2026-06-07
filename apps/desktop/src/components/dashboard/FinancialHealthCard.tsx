import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@nixus/shared";
import { useFinancialHealthSummary } from "@/hooks/useFinancialHealth";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { cn } from "@/lib/utils";
import type { EmergencyFundStatus } from "@/lib/types";

const DETAIL_ROUTE = "/net-worth/financial-health";

function formatCoverageMonths(months: number, cappedLabel: string): string {
  if (months >= 12) return cappedLabel;
  return months.toFixed(1);
}

function emergencyFundBarColor(status: EmergencyFundStatus): string {
  switch (status) {
    case "funded":
      return "bg-teal-500";
    case "approaching":
      return "bg-amber-500";
    case "underfunded":
      return "bg-rose-500";
  }
}

function emergencyFundTextColor(status: EmergencyFundStatus): string {
  switch (status) {
    case "funded":
      return "text-teal-600 dark:text-teal-400";
    case "approaching":
      return "text-amber-600 dark:text-amber-400";
    case "underfunded":
      return "text-rose-500";
  }
}

function getActionLine(
  t: (key: string) => string,
  actionLineKey: string | undefined,
): string {
  if (!actionLineKey) return "";
  const key = `financialHealth.card.action.${actionLineKey}`;
  const translated = t(key);
  return translated === key ? actionLineKey : translated;
}

function buildAriaLabel(
  t: (key: string, opts?: Record<string, unknown>) => string,
  monthsDisplay: string,
  savingsRateDisplay: string,
  surplusDisplay: string,
  actionLine: string,
): string {
  return t("financialHealth.card.ariaLabel", {
    months: monthsDisplay,
    savingsRate: savingsRateDisplay,
    surplus: surplusDisplay,
    action: actionLine,
  });
}

function FinancialHealthSkeleton() {
  return (
    <Card className="shadow-sm rounded-lg" data-testid="financial-health-skeleton">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="h-4 w-28 bg-muted animate-pulse rounded" />
          <div className="h-4 w-24 bg-muted animate-pulse rounded" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i}>
              <div className="h-3 w-20 bg-muted animate-pulse rounded mb-2" />
              <div className="h-7 w-16 bg-muted animate-pulse rounded mb-2" />
              <div className="h-1.5 w-full bg-muted animate-pulse rounded" />
            </div>
          ))}
        </div>
        <div className="h-3 w-3/4 bg-muted animate-pulse rounded mt-4" />
      </CardContent>
    </Card>
  );
}

function InsufficientDataCard() {
  const { t } = useTranslation();

  return (
    <Link to="/import" className="block">
      <Card
        className="shadow-sm rounded-lg hover:ring-1 hover:ring-primary/20 transition-all cursor-pointer"
        role="link"
        aria-label={t("financialHealth.empty.insufficientData")}
        data-testid="financial-health-empty"
      >
        <CardContent className="p-6 text-center">
          <p className="text-sm text-muted-foreground">
            {t("financialHealth.empty.insufficientData")}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

export function FinancialHealthCard() {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const { data, isPending } = useFinancialHealthSummary();

  if (isPending) {
    return <FinancialHealthSkeleton />;
  }

  if (!data?.data_sufficient) {
    return <InsufficientDataCard />;
  }

  const emergencyFund = data.emergency_fund;
  const savings = data.savings;
  const waterfall = data.waterfall;

  const hasIncome = savings?.savings_rate_percent != null;
  const coverageMonths = emergencyFund?.coverage_months ?? 0;
  const monthsCapped = coverageMonths >= 12;
  const monthsDisplay = monthsCapped
    ? t("financialHealth.card.monthsCapped")
    : t("financialHealth.card.months", {
        months: formatCoverageMonths(coverageMonths, t("financialHealth.card.monthsCapped")),
      });

  const savingsRateDisplay = hasIncome
    ? `${Math.round(savings!.savings_rate_percent!)}%`
    : "";

  const surplusCents = savings?.avg_monthly_surplus_cents ?? 0;
  const surplusDisplay = hasIncome
    ? surplusCents >= 0
      ? `+${formatCurrency(surplusCents)}${t("financialHealth.card.perMonth")}`
      : `${formatCurrency(surplusCents)}${t("financialHealth.card.perMonth")}`
    : "";

  const actionLine = getActionLine(t, waterfall?.action_line_key);
  const ariaLabel = buildAriaLabel(
    t,
    monthsDisplay,
    savingsRateDisplay || t("financialHealth.empty.noIncome"),
    surplusDisplay,
    actionLine,
  );

  const efStatus = emergencyFund?.status ?? "underfunded";
  const progressPercent = Math.min((emergencyFund?.progress_ratio ?? 0) * 100, 100);
  const isDeficit = hasIncome && surplusCents < 0;

  return (
    <Link to={DETAIL_ROUTE} className="block">
      <Card
        className="shadow-sm rounded-lg hover:ring-1 hover:ring-primary/20 transition-all cursor-pointer"
        role="link"
        aria-label={ariaLabel}
        data-testid="financial-health-card"
      >
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium text-muted-foreground">
              {t("financialHealth.card.title")}
            </p>
            <span className="text-xs text-primary">
              {t("financialHealth.card.viewDetails")}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {/* Emergency fund column */}
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                {t("financialHealth.card.emergencyFund")}
              </p>
              <p
                className={cn(
                  "text-lg font-mono font-medium",
                  emergencyFundTextColor(efStatus),
                )}
                data-testid="financial-health-months"
              >
                {monthsDisplay}
              </p>
              {emergencyFund && (
                <div className="flex items-center gap-1 mt-1">
                  <div
                    className="relative flex-1 h-1.5 rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={Math.round(progressPercent)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    data-testid="financial-health-progress"
                  >
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        emergencyFundBarColor(efStatus),
                      )}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono whitespace-nowrap">
                    {t("financialHealth.card.targetMarker", {
                      months: emergencyFund.target_months,
                    })}
                  </span>
                </div>
              )}
            </div>

            {/* Savings rate column */}
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                {t("financialHealth.card.savingsRate")}
              </p>
              {hasIncome ? (
                <>
                  <p
                    className={cn(
                      "text-lg font-mono font-medium",
                      isDeficit ? "text-rose-500" : "text-teal-600 dark:text-teal-400",
                    )}
                    data-testid="financial-health-savings-rate"
                  >
                    {savingsRateDisplay}
                  </p>
                  <p
                    className={cn(
                      "text-sm font-mono mt-0.5",
                      isDeficit ? "text-rose-500" : "text-muted-foreground",
                    )}
                    data-testid="financial-health-surplus"
                  >
                    {surplusDisplay}
                  </p>
                </>
              ) : (
                <Link
                  to="/income"
                  className="block"
                  onClick={(e) => e.stopPropagation()}
                  data-testid="financial-health-no-income"
                >
                  <p className="text-sm text-muted-foreground hover:text-primary transition-colors">
                    {t("financialHealth.empty.noIncome")}
                  </p>
                </Link>
              )}
            </div>

            {/* Next best action column */}
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                {t("financialHealth.card.nextAction")}
              </p>
              <p
                className="text-sm font-medium leading-snug"
                data-testid="financial-health-action"
              >
                {actionLine}
              </p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground mt-4" data-testid="financial-health-disclaimer">
            {t("financialHealth.disclaimer")}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
