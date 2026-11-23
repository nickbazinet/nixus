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
  /** The pinned row is a hypothetical rather than the user's real pace — say so, do not imply it. */
  isExploring: boolean;
}

const STATUS_CLASSES: Record<string, string> = {
  achieved: "bg-good-bg text-good-ink",
  close: "bg-caution-bg text-caution-ink",
  shortfall: "bg-over-bg text-over-ink",
};

/**
 * Every pace against every age: what you would have, coloured against what that age needs. The
 * surface's sentence now lives in the callout above — this is the evidence behind it, which is why
 * the current-pace row is outlined rather than restated in words.
 */
export function RetirementMatrix({
  matrix,
  currentAge,
  isExploring,
}: RetirementMatrixProps) {
  const { t, i18n } = useTranslation();
  const formatCurrency = useFormatCurrency();

  const columns = matrix.rows[0] ?? [];

  const inflationRateLabel = new Intl.NumberFormat(i18n.language, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(INFLATION_RATE_ANNUAL);

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto px-card-pad">
        <table className="w-full border-collapse text-caption">
          <thead>
            <tr>
              <th className="py-2.5 pr-3 text-left text-column-head uppercase text-ink-faint">
                {t("retirement.monthlySavings")}
              </th>
              {columns.map((cell) => (
                <th
                  key={cell.years}
                  className="py-2.5 pl-3 text-right text-column-head uppercase text-ink-faint"
                >
                  {t("retirement.columnAge", { age: currentAge + cell.years })}
                </th>
              ))}
            </tr>
            <tr>
              <th className="border-b border-line py-2.5 pr-3 text-left text-caption font-normal text-ink-faint">
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
                    className="border-b border-line py-2.5 pl-3 text-right text-caption font-normal text-ink-faint"
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
                <td className="money py-2.5 pr-3 font-semibold text-ink">
                  {formatCurrency(row[0]?.monthlySavingsCents ?? 0)}
                  {rowIndex === CURRENT_PACE_TIER_INDEX && (
                    <span className="ml-1 font-sans text-caption font-normal text-ink-faint">
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
                      "money px-3 py-2.5 text-right font-semibold transition-colors",
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

      <p className="px-card-pad pb-card-pad text-caption text-ink-faint">
        {t("retirement.matrixLegend")}
      </p>
    </div>
  );
}
