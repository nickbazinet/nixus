import { useTranslation } from "react-i18next";
import { Plus, TriangleAlert } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Meter,
  Money,
  Stat,
  formatMoney,
} from "@nixus/shared";
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
  onAddExpense: () => void;
}

export function BudgetSummaryStrip({
  totalTargetCents,
  totalSpentCents,
  remainingCents,
  averageMonthlyIncomeCents,
  incomeMonthCount,
  onAddExpense,
}: BudgetSummaryStripProps) {
  const { t, i18n } = useTranslation();
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
  // leading minus on a 34px figure is the easiest thing on the surface to misread.
  const heroCents = Math.abs(remainingCents);

  return (
    <Card className="mb-section-gap" data-testid="budget-summary-strip">
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <Stat
              label={overspent ? t("budget.overBudgetLabel") : t("budget.remaining")}
              value={formatMoney({ cents: heroCents, locale: i18n.language })}
              caption={t("budget.remainingCaption")}
              {...maskProps}
            />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="text-label">
              <span className="text-ink-dim">{t("budget.budget")} </span>
              <Money
                cents={totalTargetCents}
                locale={i18n.language}
                className="text-ink"
                {...maskProps}
              />
            </div>
            <div className="text-label">
              <span className="text-ink-dim">{t("budget.spent")} </span>
              <Money
                cents={totalSpentCents}
                locale={i18n.language}
                className="text-ink"
                {...maskProps}
              />
            </div>
            {totalTargetCents > 0 ? (
              <Badge variant={overspent ? "over" : "neutral"}>{paceSentence}</Badge>
            ) : (
              <Badge variant="neutral">{t("budget.categoryNoTarget")}</Badge>
            )}
            <Button size="sm" onClick={onAddExpense} data-testid="add-expense-button">
              <Plus aria-hidden="true" />
              {t("budget.addExpense")}
            </Button>
          </div>
        </div>
        {totalTargetCents > 0 && (
          <Meter
            value={totalSpentCents}
            max={totalTargetCents}
            label={t("budget.overallMeterLabel")}
            valueText={hidden ? t("common.amountHidden") : paceSentence}
            data-testid="budget-overall-progress"
          />
        )}
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
      </CardContent>
    </Card>
  );
}
