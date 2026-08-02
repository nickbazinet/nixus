import { useTranslation } from "react-i18next";
import { Card, CardContent, SubStat, formatMoney } from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { insightsLocale } from "@/components/spending-trends/insights-chart";
import type { YearlySummaryData } from "@/lib/types";

interface YearSummaryMetricsProps {
  data: YearlySummaryData;
}

export function YearSummaryMetrics({ data }: YearSummaryMetricsProps) {
  const { t, i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);

  const gainCents = data.net_worth_gain_cents;
  const gainAvailable = data.net_worth_gain_available;

  const metrics = [
    {
      label: t("yearSummary.spent"),
      value: formatMoney({ cents: data.total_spent_cents, locale }),
      testId: "year-metric-spent",
      caption: undefined,
      maskable: true,
    },
    {
      label: t("yearSummary.income"),
      value: formatMoney({ cents: data.total_income_cents, locale }),
      testId: "year-metric-income",
      caption: undefined,
      maskable: true,
    },
    {
      label: t("yearSummary.cashFlowNet"),
      value: formatMoney({
        cents: data.cash_flow_net_cents,
        locale,
        sign: "always",
      }),
      testId: "year-metric-cash-flow",
      // A spreadsheet user's most practised habit is reading a running balance, so a bare net
      // figure gets read as one. This is the single most consequential misreading in the product.
      caption: t("yearSummary.cashFlowNetCaption"),
      maskable: true,
    },
    {
      label: t("yearSummary.gained"),
      value:
        gainAvailable && gainCents !== null
          ? formatMoney({ cents: gainCents, locale, sign: "always" })
          : "\u2014",
      testId: "year-metric-gain",
      caption: gainAvailable ? undefined : t("yearSummary.noGainData"),
      // Masking a dash would announce "Amount hidden" over an absence.
      maskable: gainAvailable && gainCents !== null,
    },
  ];

  return (
    // Two columns, not four: three is the widest hero row the spine permits, and at the 1024px
    // minimum window four figures each lose the room their caption needs.
    <div
      className="grid grid-cols-1 gap-grid-gap sm:grid-cols-2"
      data-testid="year-summary-metrics"
    >
      {metrics.map((metric) => (
        <Card key={metric.testId}>
          <CardContent>
            <SubStat
              label={metric.label}
              value={metric.value}
              caption={metric.caption}
              masked={metric.maskable && maskProps.masked}
              maskedLabel={maskProps.maskedLabel}
              data-testid={metric.testId}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
