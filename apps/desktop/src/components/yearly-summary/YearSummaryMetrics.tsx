import { useTranslation } from "react-i18next";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import type { YearlySummaryData } from "@/lib/types";

interface YearSummaryMetricsProps {
  data: YearlySummaryData;
}

export function YearSummaryMetrics({ data }: YearSummaryMetricsProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();

  const gainCents = data.net_worth_gain_cents;
  const gainAvailable = data.net_worth_gain_available;
  const gainPositive = gainAvailable && gainCents !== null && gainCents >= 0;

  const metrics = [
    {
      label: t("yearSummary.spent"),
      value: formatCurrency(data.total_spent_cents),
      className: "text-rose-500",
      testId: "year-metric-spent",
    },
    {
      label: t("yearSummary.income"),
      value: formatCurrency(data.total_income_cents),
      className: "text-emerald-600 dark:text-emerald-400",
      testId: "year-metric-income",
    },
    {
      label: t("yearSummary.cashFlowNet"),
      value: formatCurrency(data.cash_flow_net_cents),
      className:
        data.cash_flow_net_cents >= 0
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-rose-500",
      testId: "year-metric-cash-flow",
    },
    {
      label: t("yearSummary.gained"),
      value:
        gainAvailable && gainCents !== null
          ? `${gainPositive ? "+" : ""}${formatCurrency(gainCents)}`
          : "—",
      className: gainAvailable
        ? gainPositive
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-rose-500"
        : "text-muted-foreground",
      testId: "year-metric-gain",
      title: !gainAvailable ? t("yearSummary.noGainData") : undefined,
    },
  ];

  return (
    <div
      className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4"
      data-testid="year-summary-metrics"
    >
      {metrics.map((metric) => (
        <div
          key={metric.label}
          className="rounded-lg border border-border bg-card p-4 shadow-sm"
        >
          <span className="text-xs text-muted-foreground">{metric.label}</span>
          <p
            className={`text-xl font-mono font-semibold mt-1 ${metric.className}`}
            data-testid={metric.testId}
            title={metric.title}
          >
            {metric.value}
          </p>
        </div>
      ))}
    </div>
  );
}
