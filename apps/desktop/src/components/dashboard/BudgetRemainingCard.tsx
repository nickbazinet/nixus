import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Card, Meter, Money, focusRing, formatMoney } from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { cn } from "@/lib/utils";
import { daysLeftInMonth, monthName } from "@/components/dashboard/monthPace";
import type { BudgetSummary } from "@/lib/types";

interface BudgetRemainingCardProps {
  summary: BudgetSummary;
  year: number;
  month: number;
}

/**
 * The surface's one featured card and its one `text-display` figure: what is left of the month's
 * budget, the meter that shows how much of it has gone, and the single sentence that turns the
 * remainder into a daily pace.
 *
 * The pace line only renders for the month in progress — a closed month has no "a day left", and
 * dividing its remainder by zero days would be arithmetic about nothing.
 */
export function BudgetRemainingCard({ summary, year, month }: BudgetRemainingCardProps) {
  const { t, i18n } = useTranslation();
  const { hidden, maskProps } = useValuesHidden();

  const amountHidden = t("common.amountHidden");
  const money = (cents: number) =>
    hidden ? amountHidden : formatMoney({ cents, locale: i18n.language });

  const spent = summary.total_spent_cents;
  const target = summary.total_target_cents;
  const remaining = summary.remaining_cents;
  const utilization = target > 0 ? (spent / target) * 100 : 0;
  const isOver = remaining < 0;

  const label = monthName(year, month, i18n.language);
  const daysLeft = daysLeftInMonth(year, month);

  const paceLine = isOver
    ? t("dashboard.v2.overBudgetLine", { amount: money(Math.abs(remaining)), month: label })
    : daysLeft === null
      ? t("dashboard.budgetMeterValue", { spent: money(spent), target: money(target) })
      : daysLeft === 0
        ? t("dashboard.v2.monthClosing", { month: label })
        : t("dashboard.v2.dailyPace", {
            count: daysLeft,
            month: label,
            amount: money(Math.round(remaining / daysLeft)),
          });

  return (
    <Card
      tone="featured"
      className="gap-0 px-card-pad"
      data-testid="metric-card"
      render={
        <Link
          to="/spending/budget"
          aria-label={`${t("dashboard.budgetRemaining")}: ${money(remaining)}`}
          className={cn("no-underline", focusRing)}
        />
      }
    >
      <span className="text-label text-ink-dim">{t("dashboard.budgetRemaining")}</span>
      <div
        aria-hidden="true"
        className={cn("money mt-1.5 text-display", isOver ? "text-over-ink" : "text-ink")}
        data-testid="metric-value"
      >
        <Money cents={remaining} locale={i18n.language} {...maskProps} />
      </div>

      <Meter
        className="mt-5"
        label={t("dashboard.budgetMeterLabel")}
        value={Math.min(utilization, 100)}
        valueText={t("dashboard.budgetMeterValue", {
          spent: money(spent),
          target: money(target),
        })}
        color={isOver ? "var(--over)" : undefined}
        data-testid="budget-overall-progress"
      />

      <div aria-hidden="true" className="mt-3 flex items-baseline justify-between gap-4">
        <span className="text-caption text-ink-dim">
          {t("dashboard.v2.spent")}{" "}
          <Money
            cents={spent}
            locale={i18n.language}
            className="font-bold text-ink"
            {...maskProps}
          />
        </span>
        <span className="text-caption text-ink-dim">
          {t("dashboard.v2.budgetTotal")}{" "}
          <Money
            cents={target}
            locale={i18n.language}
            className="font-bold text-ink"
            {...maskProps}
          />
        </span>
      </div>

      <p className="mt-5 text-body text-ink-dim" data-testid="budget-pace-line">
        {paceLine}
      </p>    </Card>
  );
}
