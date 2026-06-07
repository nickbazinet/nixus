import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@nixus/shared";
import { useFinancialHealthDetail } from "@/hooks/useFinancialHealth";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { cn } from "@/lib/utils";
import type { MonthlySurplusPoint } from "@/lib/types";

function SavingsCapacityPanelSkeleton() {
  return (
    <Card className="shadow-sm rounded-lg" data-testid="savings-capacity-panel-loading">
      <CardContent className="p-6">
        <div className="h-4 w-36 bg-muted animate-pulse rounded mb-4" />
        <div className="h-8 w-24 bg-muted animate-pulse rounded mb-3" />
        <div className="h-16 w-full bg-muted animate-pulse rounded mb-4" />
        <div className="h-3 w-48 bg-muted animate-pulse rounded" />
      </CardContent>
    </Card>
  );
}

function formatMonthLabel(monthStr: string): string {
  const [year, month] = monthStr.split("-");
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleString(undefined, { month: "short" });
}

function SurplusTrendBars({
  data,
  formatCurrency,
}: {
  data: MonthlySurplusPoint[];
  formatCurrency: (cents: number) => string;
}) {
  if (data.length === 0) return null;

  const maxAbs = Math.max(...data.map((p) => Math.abs(p.surplus_cents)), 1);

  return (
    <div
      className="flex items-end gap-1.5 h-16"
      data-testid="savings-capacity-trend"
      role="img"
      aria-hidden="true"
    >
      {data.map((point) => {
        const heightPercent = Math.max(
          (Math.abs(point.surplus_cents) / maxAbs) * 100,
          8,
        );
        const isPositive = point.surplus_cents >= 0;
        const surplusLabel =
          point.surplus_cents >= 0
            ? `+${formatCurrency(point.surplus_cents)}`
            : formatCurrency(point.surplus_cents);

        return (
          <div
            key={point.month}
            className="flex flex-1 flex-col items-center justify-end h-full"
            title={`${formatMonthLabel(point.month)}: ${surplusLabel}`}
          >
            <div
              className={cn(
                "w-full rounded-sm transition-all",
                isPositive ? "bg-teal-500" : "bg-rose-500",
              )}
              style={{ height: `${heightPercent}%` }}
            />
            <span className="mt-1 text-[10px] text-muted-foreground">
              {formatMonthLabel(point.month)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SavingsCapacityPanel() {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const { data, isPending } = useFinancialHealthDetail();

  if (isPending) {
    return <SavingsCapacityPanelSkeleton />;
  }

  if (!data?.data_sufficient) {
    return null;
  }

  const savings = data.savings;
  const figures = data.figures;
  const hasIncome = savings?.savings_rate_percent != null;
  const surplusCents = savings?.avg_monthly_surplus_cents ?? 0;
  const isDeficit = hasIncome && surplusCents < 0;
  const hasTrendData =
    figures.expense_month_count >= 1 && data.monthly_surplus_trend.length > 0;
  const categories = data.top_discretionary_categories;

  const surplusDisplay = hasIncome
    ? surplusCents >= 0
      ? `+${formatCurrency(surplusCents)}${t("financialHealth.panel.savingsCapacity.perMonth")}`
      : `${formatCurrency(surplusCents)}${t("financialHealth.panel.savingsCapacity.perMonth")}`
    : "";

  return (
    <Card className="shadow-sm rounded-lg" data-testid="savings-capacity-panel">
      <CardContent className="p-6">
        <p className="text-sm font-medium text-muted-foreground mb-4">
          {t("financialHealth.panel.savingsCapacity.title")}
        </p>

        {hasIncome ? (
          <div className="mb-4">
            <p
              className={cn(
                "text-3xl font-mono font-medium",
                isDeficit ? "text-rose-500" : "text-teal-600 dark:text-teal-400",
              )}
              data-testid="savings-capacity-rate"
            >
              {Math.round(savings!.savings_rate_percent!)}%
            </p>
            <p
              className={cn(
                "text-sm font-mono mt-1",
                isDeficit ? "text-rose-500" : "text-muted-foreground",
              )}
              data-testid="savings-capacity-surplus"
            >
              {surplusDisplay}
            </p>
          </div>
        ) : (
          <p
            className="text-sm text-muted-foreground mb-4"
            data-testid="savings-capacity-no-income"
          >
            {t("financialHealth.panel.savingsCapacity.noIncome")}
          </p>
        )}

        {hasTrendData ? (
          <SurplusTrendBars
            data={data.monthly_surplus_trend}
            formatCurrency={formatCurrency}
          />
        ) : (
          <p
            className="text-sm text-muted-foreground"
            data-testid="savings-capacity-trend-empty"
          >
            {t("financialHealth.panel.savingsCapacity.trendEmpty")}
          </p>
        )}

        <div className="mt-6">
          <p className="text-xs font-medium text-muted-foreground mb-2">
            {t("financialHealth.panel.savingsCapacity.discretionaryTitle")}
          </p>

          {categories.length > 0 ? (
            <ul className="space-y-2" data-testid="savings-capacity-categories">
              {categories.map((cat) => (
                <li
                  key={cat.category_id}
                  className="flex items-center justify-between text-sm"
                  data-testid={`savings-capacity-category-${cat.category_id}`}
                >
                  <span className="text-foreground">{cat.category_name}</span>
                  <span className="font-mono text-muted-foreground tabular-nums">
                    {formatCurrency(cat.avg_monthly_spend_cents)}
                    {t("financialHealth.panel.savingsCapacity.perMonth")}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p
              className="text-sm text-muted-foreground"
              data-testid="savings-capacity-categories-empty"
            >
              {t("financialHealth.panel.savingsCapacity.discretionaryEmpty")}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
