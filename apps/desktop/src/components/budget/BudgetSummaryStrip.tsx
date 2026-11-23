import { useTranslation } from "react-i18next";
import { Tag, Target, TriangleAlert, Wallet } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Meter,
  Money,
} from "@nixus/shared";
import { MetricTile } from "@/components/shared/MetricTile";
import { usePeriod } from "@/hooks/usePeriod";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { useMaskProps, useValuesHidden } from "@/contexts/ValuesVisibilityContext";

// Six completed income months is the agreed floor for calling a history established. Anything
// shorter would warn a user off a target from one unusual month.
const ESTABLISHED_INCOME_MONTHS = 6;

interface BudgetSummaryStripProps {
  totalTargetCents: number;
  totalSpentCents: number;
  remainingCents: number;
  averageMonthlyIncomeCents: number;
  incomeMonthCount: number;
  /** Under the Budgeted figure: what the plan is made of, e.g. "7 groups, 14 categories". */
  budgetedCaption?: string;
}

/** Whole days left in the selected month, or null unless that month is the one in progress. */
function daysLeftInPeriod(year: number, month: number): number | null {
  const now = new Date();
  if (now.getFullYear() !== year || now.getMonth() + 1 !== month) return null;
  const lastDay = new Date(year, month, 0).getDate();
  return Math.max(lastDay - now.getDate(), 0);
}

/**
 * The surface's KPI row: what was planned, what is gone, and the one figure that answers the
 * question — what is left. Remaining is the featured tile; the other two are the context it needs.
 */
export function BudgetSummaryStrip({
  totalTargetCents,
  totalSpentCents,
  remainingCents,
  averageMonthlyIncomeCents,
  incomeMonthCount,
  budgetedCaption,
}: BudgetSummaryStripProps) {
  const { t, i18n } = useTranslation();
  const { year, month } = usePeriod();
  const formatCurrency = useFormatCurrency();
  const maskProps = useMaskProps();
  const { hidden } = useValuesHidden();

  const overspent = remainingCents < 0;
  const paceSentence = t("budget.categoryMeterValue", {
    spent: formatCurrency(totalSpentCents),
    target: formatCurrency(totalTargetCents),
  });

  const budgetOutrunsIncome =
    incomeMonthCount >= ESTABLISHED_INCOME_MONTHS &&
    totalTargetCents > averageMonthlyIncomeCents;

  // The headline figure is the absolute amount with its own label rather than a signed number: a
  // leading minus on a 28px figure is the easiest thing on the surface to misread.
  const heroCents = Math.abs(remainingCents);
  const spentShare =
    totalTargetCents > 0 ? Math.round((totalSpentCents / totalTargetCents) * 100) : null;
  const daysLeft = daysLeftInPeriod(year, month);

  return (
    <div className="flex flex-col gap-grid-gap" data-testid="budget-summary-strip">
      <div className="grid gap-grid-gap md:grid-cols-3">
        <MetricTile
          icon={Target}
          label={t("budget.v2.budgeted")}
          value={<Money cents={totalTargetCents} locale={i18n.language} {...maskProps} />}
          caption={budgetedCaption}
        />
        <MetricTile
          icon={Tag}
          label={t("budget.v2.spentSoFar")}
          value={<Money cents={totalSpentCents} locale={i18n.language} {...maskProps} />}
          caption={
            spentShare !== null ? t("budget.v2.percentOfBudget", { percent: spentShare }) : undefined
          }
          footer={
            totalTargetCents > 0 ? (
              <Meter
                value={totalSpentCents}
                max={totalTargetCents}
                label={t("budget.overallMeterLabel")}
                valueText={hidden ? t("common.amountHidden") : paceSentence}
                data-testid="budget-overall-progress"
              />
            ) : undefined
          }
        />
        <MetricTile
          featured
          icon={Wallet}
          label={overspent ? t("budget.overBudgetLabel") : t("budget.remaining")}
          value={<Money cents={heroCents} locale={i18n.language} {...maskProps} />}
          caption={
            daysLeft !== null
              ? t("budget.v2.daysLeft", { count: daysLeft })
              : t("budget.remainingCaption")
          }
        />
      </div>

      {budgetOutrunsIncome && (
        <Alert
          variant="caution"
          icon={<TriangleAlert className="text-caution" />}
          data-testid="budget-income-warning"
        >
          <AlertTitle>{t("budget.incomeWarningTitle")}</AlertTitle>
          <AlertDescription>
            {t("budget.incomeWarningDescription", {
              target: formatCurrency(totalTargetCents),
              average: formatCurrency(averageMonthlyIncomeCents),
            })}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
