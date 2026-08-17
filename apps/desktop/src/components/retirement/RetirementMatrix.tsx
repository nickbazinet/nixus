import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import {
  CURRENT_PACE_TIER_INDEX,
  type RetirementMatrixResult,
} from "@/lib/retirement";

interface RetirementMatrixProps {
  matrix: RetirementMatrixResult;
  currentAge: number;
  avgMonthlyExpenseCents: number;
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
}: RetirementMatrixProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();

  const headlineArgs = {
    expense: formatCurrency(avgMonthlyExpenseCents),
    amount: formatCurrency(matrix.tiersMonthlyCents[CURRENT_PACE_TIER_INDEX]),
  };

  const headline =
    matrix.earliestAchievedYears != null
      ? t("retirement.headlineAchievedWithAge", {
          ...headlineArgs,
          age: currentAge + matrix.earliestAchievedYears,
          years: matrix.earliestAchievedYears,
        })
      : t("retirement.headlineNotAchieved", headlineArgs);

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
              {matrix.rows[0]?.map((cell) => (
                <th key={cell.years} className="p-2 text-right text-ink-dim">
                  {t("retirement.columnAge", { age: currentAge + cell.years })}
                </th>
              ))}
            </tr>
            <tr>
              <th className="p-2 text-left text-caption text-ink-faint">
                {t("retirement.nestEggNeeded")}
              </th>
              {matrix.columnNestEggCents.map((cents, index) => (
                <th
                  key={matrix.rows[0]?.[index]?.years ?? index}
                  className="p-2 text-right text-caption text-ink-faint"
                >
                  {formatCurrency(cents)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row, rowIndex) => (
              <tr
                key={row[0]?.monthlySavingsCents ?? rowIndex}
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
                      {t("retirement.currentPace")}
                    </span>
                  )}
                </td>
                {row.map((cell) => (
                  <td
                    key={cell.years}
                    className={cn(
                      "p-2 text-right",
                      STATUS_CLASSES[cell.status],
                    )}
                  >
                    {formatCurrency(cell.projectedValueCents)}
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
