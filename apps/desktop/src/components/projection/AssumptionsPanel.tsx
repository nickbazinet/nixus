import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@nixus/shared";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { INCOME_GROWTH_RATE, EXPENSE_GROWTH_RATE } from "@/lib/projection";

interface AssumptionsPanelProps {
  avgMonthlyIncomeCents: number;
  avgMonthlyExpenseCents: number;
  incomeMonthCount: number;
  expenseMonthCount: number;
}

const GROWTH_RATE_KEYS = [
  { categoryKey: "projection.tfsaRrspFhsa", rateKey: "projection.tfsaRrspFhsaRate" },
  { categoryKey: "projection.realEstate", rateKey: "projection.realEstateRate" },
  { categoryKey: "projection.vehicles", rateKey: "projection.vehiclesRate" },
  { categoryKey: "projection.cashBusinessOther", rateKey: "projection.cashBusinessOtherRate" },
];

export function AssumptionsPanel({
  avgMonthlyIncomeCents,
  avgMonthlyExpenseCents,
  incomeMonthCount,
  expenseMonthCount,
}: AssumptionsPanelProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const netCashFlow = avgMonthlyIncomeCents - avgMonthlyExpenseCents;

  return (
    <Card className="shadow-sm rounded-lg">
      <CardContent className="p-6 space-y-5">
        {/* Cash Flow Assumptions */}
        <div>
          <h3 className="text-sm font-semibold mb-2">{t("projection.cashFlowAssumptions")}</h3>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("projection.avgMonthlyIncome")}</dt>
              <dd>
                {incomeMonthCount > 0 ? (
                  <>
                    {formatCurrency(avgMonthlyIncomeCents)}
                    <span className="text-muted-foreground ml-1">
                      ({t("projection.basedOn")} {incomeMonthCount} {incomeMonthCount !== 1 ? t("projection.months") : t("projection.month")} {t("projection.ofData")})
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">{t("projection.noIncomeHistory")}</span>
                )}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("projection.avgMonthlyExpenses")}</dt>
              <dd>
                {expenseMonthCount > 0 ? (
                  <>
                    {formatCurrency(avgMonthlyExpenseCents)}
                    <span className="text-muted-foreground ml-1">
                      ({t("projection.basedOn")} {expenseMonthCount} {expenseMonthCount !== 1 ? t("projection.months") : t("projection.month")} {t("projection.ofData")})
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">{t("projection.noExpenseHistory")}</span>
                )}
              </dd>
            </div>
            <div className="flex justify-between font-medium">
              <dt>{t("projection.netMonthlyCashFlow")}</dt>
              <dd>{formatCurrency(netCashFlow)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("projection.incomeGrowth")}</dt>
              <dd>+{(INCOME_GROWTH_RATE * 100).toFixed(1)}{t("projection.wageGrowthRate")}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t("projection.expenseGrowth")}</dt>
              <dd>+{(EXPENSE_GROWTH_RATE * 100).toFixed(1)}{t("projection.inflationRate")}</dd>
            </div>
          </dl>
        </div>

        {/* Growth Rate Assumptions */}
        <div>
          <h3 className="text-sm font-semibold mb-2">{t("projection.growthRateAssumptions")}</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground text-left">
                <th className="font-medium pb-1">{t("common.category")}</th>
                <th className="font-medium pb-1 text-right">{t("projection.annualRate")}</th>
              </tr>
            </thead>
            <tbody>
              {GROWTH_RATE_KEYS.map((row) => (
                <tr key={row.categoryKey}>
                  <td className="py-0.5">{t(row.categoryKey)}</td>
                  <td className="py-0.5 text-right">{t(row.rateKey)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
