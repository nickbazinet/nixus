import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Plus, Repeat, Sparkles, TriangleAlert } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
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
  onApplyRecurring: () => void;
  applyRecurringPending: boolean;
}

export function BudgetSummaryStrip({
  totalTargetCents,
  totalSpentCents,
  remainingCents,
  averageMonthlyIncomeCents,
  incomeMonthCount,
  onAddExpense,
  onApplyRecurring,
  applyRecurringPending,
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
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button size="sm" data-testid="add-transactions-trigger" />}
              >
                <Plus data-icon="inline-start" aria-hidden="true" />
                {t("budget.addTransactions")}
                <ChevronDown data-icon="inline-end" aria-hidden="true" />
              </DropdownMenuTrigger>
              {/* `w-max` is load-bearing: DropdownMenuContent is
               * `w-(--anchor-width)`, so anchored to this compact trigger the
               * longest label — French manual entry — would wrap or clip. Sizing
               * to content lets any locale set the width; `min-w-56` keeps the
               * panel from looking cramped beside the trigger.
               *
               * Named by its trigger rather than an `aria-label`: Base UI points
               * the panel's `aria-labelledby` at the button, and labelledby wins
               * the accessible-name calculation, so an `aria-label` would be dead. */}
              <DropdownMenuContent
                align="end"
                className="w-max min-w-56"
                data-testid="add-transactions-menu"
              >
                {/* `render` rather than a nested anchor: Base UI's menu item owns
                 * roving focus and typeahead, and an anchor child would take the
                 * tab stop away from it. */}
                <DropdownMenuItem
                  render={<Link to="/import" data-testid="import-statement-item" />}
                >
                  <Sparkles aria-hidden="true" />
                  {t("dashboard.importStatement")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={onAddExpense}
                  data-testid="add-expense-manually-item"
                >
                  <Plus aria-hidden="true" />
                  {t("budget.addExpenseManually")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={onApplyRecurring}
                  disabled={applyRecurringPending}
                  data-testid="apply-recurring-item"
                >
                  <Repeat aria-hidden="true" />
                  {t("budget.applyRecurringExpenses")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
