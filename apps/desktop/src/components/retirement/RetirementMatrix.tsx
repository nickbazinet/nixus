import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { AmountDetailTooltip } from "@/components/retirement/AmountDetailTooltip";
import { MetricInfoTooltip } from "@/components/financial-health/MetricInfoTooltip";
import {
  CURRENT_PACE_TIER_INDEX,
  INFLATION_RATE_ANNUAL,
  type RetirementMatrixResult,
} from "@/lib/retirement";

interface RetirementMatrixProps {
  matrix: RetirementMatrixResult;
  currentAge: number;
  avgMonthlyExpenseCents: number;
  /** The pinned row is a hypothetical rather than the user's real pace — say so, do not imply it. */
  isExploring: boolean;
}

const STATUS_CLASSES: Record<string, string> = {
  achieved: "bg-good-bg text-good-ink",
  close: "bg-caution-bg text-caution-ink",
  shortfall: "bg-over-bg text-over-ink",
};

export function RetirementMatrix({
  matrix,
  currentAge,
  avgMonthlyExpenseCents,
  isExploring,
}: RetirementMatrixProps) {
  const { t, i18n } = useTranslation();
  const formatCurrency = useFormatCurrency();

  const columns = matrix.rows[0] ?? [];
  // The "not on track" copy names a deadline, and the horizon zoom moves it — reading the furthest
  // column keeps the sentence true at 6y and 12y instead of always claiming 30.
  const horizonYears = columns[columns.length - 1]?.years ?? 0;

  const inflationRateLabel = new Intl.NumberFormat(i18n.language, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(INFLATION_RATE_ANNUAL);

  const headlineArgs = {
    expense: formatCurrency(avgMonthlyExpenseCents),
    amount: formatCurrency(matrix.tiersMonthlyCents[CURRENT_PACE_TIER_INDEX]),
    horizon: horizonYears,
  };

  const headlineKey =
    matrix.earliestAchievedYears != null
      ? isExploring
        ? "retirement.headlineExploringWithAge"
        : "retirement.headlineAchievedWithAge"
      : isExploring
        ? "retirement.headlineExploringNotAchieved"
        : "retirement.headlineNotAchieved";

  const headline = t(headlineKey, {
    ...headlineArgs,
    age: currentAge + (matrix.earliestAchievedYears ?? 0),
    years: matrix.earliestAchievedYears ?? 0,
  });

  return (
    <div className="flex flex-col gap-3 p-card-pad">
      <p className="text-label text-ink" data-testid="retirement-headline">
        {headline}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-caption">
          <thead>
            <tr>
              <th className="p-2 text-left text-ink-dim">
                {t("retirement.monthlySavings")}
              </th>
              {columns.map((cell) => (
                <th key={cell.years} className="p-2 text-right text-ink-dim">
                  {t("retirement.columnAge", { age: currentAge + cell.years })}
                </th>
              ))}
            </tr>
            <tr>
              <th className="p-2 text-left text-caption text-ink-faint">
                <span className="inline-flex items-center gap-1">
                  {t("retirement.nestEggNeeded")}
                  <MetricInfoTooltip
                    ariaLabel={t("retirement.todaysDollarsInfoAria")}
                    content={t("retirement.todaysDollarsInfoPlain", {
                      rate: inflationRateLabel,
                    })}
                    contentClassName="max-w-sm"
                    testId="retirement-todays-dollars-info"
                  />
                </span>
              </th>
              {matrix.columnNestEggTodayCents.map((todayCents, index) => {
                const years = columns[index]?.years ?? 0;
                const detailArgs = {
                  age: currentAge + years,
                  years,
                  futureAmount: formatCurrency(matrix.columnNestEggCents[index]),
                  todaysAmount: formatCurrency(todayCents),
                  rate: inflationRateLabel,
                };

                return (
                  <th
                    key={columns[index]?.years ?? index}
                    className="p-2 text-right text-caption text-ink-faint"
                  >
                    <AmountDetailTooltip
                      amount={detailArgs.todaysAmount}
                      derivedFrom={detailArgs.futureAmount}
                      years={years}
                      detail={t("retirement.nestEggFutureDetail", detailArgs)}
                      ariaLabel={t(
                        "retirement.nestEggFutureDetailAria",
                        detailArgs,
                      )}
                      testId="retirement-nest-egg-figure"
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row, rowIndex) => (
              // Keyed by position, not by amount: an explicit anchor bypasses the $100 floor, and a
              // low enough one collapses several tiers onto the same rounded figure — duplicate keys
              // that would make React drop rows.
              <tr
                key={rowIndex}
                className={cn(
                  rowIndex === CURRENT_PACE_TIER_INDEX &&
                    "outline outline-2 outline-brand",
                )}
                data-testid={
                  rowIndex === CURRENT_PACE_TIER_INDEX
                    ? "retirement-current-pace-row"
                    : undefined
                }
              >
                <td className="p-2 font-medium text-ink">
                  {formatCurrency(row[0]?.monthlySavingsCents ?? 0)}
                  {rowIndex === CURRENT_PACE_TIER_INDEX && (
                    <span className="ml-1 text-caption text-ink-faint">
                      {isExploring
                        ? t("retirement.exploringPace")
                        : t("retirement.currentPace")}
                    </span>
                  )}
                </td>
                {row.map((cell) => (
                  <td
                    key={cell.years}
                    className={cn(
                      "p-2 text-right transition-colors",
                      STATUS_CLASSES[cell.status],
                    )}
                  >
                    {formatCurrency(cell.projectedValueTodayCents)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-caption text-ink-faint">{t("retirement.matrixLegend")}</p>
    </div>
  );
}
