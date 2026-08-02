import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, Compass, Info } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Meter,
  Skeleton,
  focusRing,
  formatMoney,
} from "@nixus/shared";
import { useFinancialHealthSummary } from "@/hooks/useFinancialHealth";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { cn } from "@/lib/utils";

const DETAIL_ROUTE = "/wealth/where-to-put-your-money";

function formatCoverageMonths(months: number): string {
  return months.toFixed(1);
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

function FinancialHealthSkeleton() {
  return (
    <Card data-testid="financial-health-skeleton">
      <CardContent>
        {/* Title, action line, cushion sentence, meter, savings sentence, trailing note. */}
        <Skeleton rows={6} />
      </CardContent>
    </Card>
  );
}

// `data_sufficient: false` is a first-class state, not an error, and no financial-health figure may
// render inside it. `get_financial_health_summary` returns no completed-month count, so this state
// cannot honestly show the 1-of-3 progress indicator that the Financial Health surface does.
function InsufficientDataCard() {
  const { t } = useTranslation();

  return (
    <Card data-testid="financial-health-empty">
      <CardContent>
        <EmptyState
          icon={<Compass />}
          title={t("financialHealth.empty.title")}
          description={t("financialHealth.empty.bodyNoCount")}
          action={
            <Button render={<Link to="/import" />} data-testid="financial-health-empty-cta">
              {t("financialHealth.empty.importCta")}
            </Button>
          }
        />
      </CardContent>
    </Card>
  );
}

export function FinancialHealthCard() {
  const { t, i18n } = useTranslation();
  const { hidden } = useValuesHidden();
  const { data, isPending } = useFinancialHealthSummary();
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);

  if (isPending) {
    return <FinancialHealthSkeleton />;
  }

  if (!data?.data_sufficient) {
    return <InsufficientDataCard />;
  }

  const emergencyFund = data.emergency_fund;
  const savings = data.savings;
  const waterfall = data.waterfall;

  const amountHidden = t("common.amountHidden");
  const money = (cents: number) =>
    hidden ? amountHidden : formatMoney({ cents, locale: i18n.language });

  const coverageMonths = emergencyFund?.coverage_months ?? 0;
  const targetMonths = emergencyFund?.target_months ?? 6;
  const monthsCapped = coverageMonths >= 12;
  const monthsText = monthsCapped
    ? t("financialHealth.monthsCapped")
    : t("financialHealth.months", { months: formatCoverageMonths(coverageMonths) });

  const savingsRatePercent = savings?.savings_rate_percent;
  const surplusCents = savings?.avg_monthly_surplus_cents ?? 0;
  const hasIncome = savingsRatePercent != null;
  const isDeficit = hasIncome && surplusCents < 0;

  const actionLine = getActionLine(t, waterfall?.action_line_key);

  return (
    <Card
      // {components.action-card}: a 3px brand left border, used once per surface. Its scarcity is
      // what makes it read as "do this".
      className="border-l-3 border-l-brand"
      data-testid="financial-health-card"
    >
      <CardHeader>
        <CardTitle>{t("financialHealth.card.suggestedNextStep")}</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        <p className="text-h2 text-ink" data-testid="financial-health-action">
          {actionLine}
        </p>

        {emergencyFund && (
          <div className="flex flex-col gap-1.5">
            <p className="text-body text-ink-dim" data-testid="financial-health-months">
              {t("financialHealth.card.cushionSentence", {
                months: monthsText,
                target: targetMonths,
              })}
            </p>
            {/* The meter is never the only indicator: the sentence above carries the figures. */}
            <Meter
              label={t("financialHealth.card.cushionMeterLabel")}
              value={Math.min(emergencyFund.progress_ratio * 100, 100)}
              valueText={t("financialHealth.card.cushionMeterValue", {
                months: monthsText,
                target: targetMonths,
              })}
              data-testid="financial-health-progress"
            />
          </div>
        )}

        {hasIncome ? (
          <p className="text-body text-ink-dim" data-testid="financial-health-savings-rate">
            {isDeficit
              ? t("financialHealth.card.deficitSentence", {
                  surplus: money(Math.abs(surplusCents)),
                })
              : t("financialHealth.card.savingsSentence", {
                  percent: Math.round(savingsRatePercent),
                  surplus: money(surplusCents),
                })}
          </p>
        ) : (
          <Link
            to="/spending/income"
            className={cn(
              "w-fit text-label text-brand-ink underline-offset-4 hover:underline",
              focusRing,
            )}
            data-testid="financial-health-no-income"
          >
            {t("financialHealth.empty.noIncome")}
          </Link>
        )}

        <p className="text-caption text-ink-faint" data-testid="financial-health-trailing-note">
          {t("financialHealth.card.trailingNote")}
        </p>

        <Button variant="outline" render={<Link to={DETAIL_ROUTE} />} className="w-fit">
          {t("financialHealth.card.seeThePlan")}
        </Button>

        {/* Calibrated weight: a full disclaimer beside the very first recommendation a user ever
            receives stacks two hedges in one session and reads as the app retracting itself. */}
        <div className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setDisclaimerOpen((open) => !open)}
            aria-expanded={disclaimerOpen}
            className={cn(
              "inline-flex w-fit min-h-target-min items-center gap-1 text-caption text-ink-dim hover:text-ink",
              focusRing,
            )}
            data-testid="financial-health-disclaimer-toggle"
          >
            <Info className="size-3.5 shrink-0" aria-hidden="true" />
            {t("financialHealth.card.disclaimerCompact")}
            <ChevronDown
              className={cn("size-3 transition-transform", disclaimerOpen && "rotate-180")}
              aria-hidden="true"
            />
          </button>
          {disclaimerOpen && (
            <p className="text-caption text-ink-dim" data-testid="financial-health-disclaimer">
              {t("financialHealth.disclaimerFull")}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
