import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, Compass, Info, Lightbulb } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Meter,
  Skeleton,
  focusRing,
  formatMoney,
} from "@nixus/shared";
import { InsightCallout } from "@/components/shared/InsightCallout";
import { useFinancialHealthSummary } from "@/hooks/useFinancialHealth";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { cn } from "@/lib/utils";

const DETAIL_ROUTE = "/wealth/where-to-put-your-money";
/** The one other place a surplus can honestly be sent today: a savings goal. */
const ALTERNATIVE_ROUTE = "/wealth/projects";

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
    <Card tone="glass" data-testid="financial-health-skeleton">
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

/**
 * The one thing worth doing next, in the glass callout that is the only place a surface speaks to
 * the user. The surface's single primary action lives here — its scarcity is what makes it read as
 * "do this" rather than as one option among a page of cards.
 */
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
    <InsightCallout
      icon={Lightbulb}
      eyebrow={t("financialHealth.card.suggestedNextStep")}
      title={
        <span data-testid="financial-health-action">{actionLine}</span>
      }
      data-testid="financial-health-card"
      actions={
        <>
          <Button size="lg" render={<Link to={DETAIL_ROUTE} />}>
            {t("financialHealth.card.seeThePlan")}
          </Button>
          <Button size="lg" variant="outline" render={<Link to={ALTERNATIVE_ROUTE} />}>
            {t("dashboard.v2.seeOtherOptions")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {emergencyFund && (
          <div className="flex max-w-xl flex-col gap-2">
            <p data-testid="financial-health-months">
              {t("financialHealth.card.cushionSentence", {
                months: monthsText,
                target: targetMonths,
              })}
            </p>
            {/* The meter is never the only indicator: the sentence above carries the figures. */}
            <Meter
              className="bg-card/70"
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
          <p data-testid="financial-health-savings-rate">
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

        <p className="text-caption text-ink-dim" data-testid="financial-health-trailing-note">
          {t("financialHealth.card.trailingNote")}
        </p>

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
      </div>
    </InsightCallout>
  );
}
