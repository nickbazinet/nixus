import { useTranslation } from "react-i18next";
import {
  DatabaseIcon,
  TagIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react";
import { Money } from "@nixus/shared";
import { MetricTile } from "@/components/shared/MetricTile";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { insightsLocale } from "@/components/spending-trends/insights-chart";
import type { YearlySummaryData } from "@/lib/types";

interface YearSummaryMetricsProps {
  data: YearlySummaryData;
  /**
   * Today's net worth, used only to express the year's gain as a percentage of where the year
   * started. Omitted for a past year, where today's total is no longer that year's endpoint.
   */
  netWorthTotalCents?: number;
}

export function YearSummaryMetrics({
  data,
  netWorthTotalCents,
}: YearSummaryMetricsProps) {
  const { t, i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);

  const gainCents = data.net_worth_gain_cents;
  const gainAvailable = data.net_worth_gain_available && gainCents !== null;

  const savedSharePct =
    data.total_income_cents > 0
      ? Math.round((data.cash_flow_net_cents / data.total_income_cents) * 100)
      : null;

  // Where the year started, not where it is now: a gain of $68,814 on a $474,959 opening balance is
  // 14.5% growth, and dividing by today's total would understate it.
  const openingNetWorthCents =
    gainAvailable && netWorthTotalCents !== undefined
      ? netWorthTotalCents - (gainCents as number)
      : null;
  const growthPct =
    openingNetWorthCents !== null && openingNetWorthCents > 0
      ? (((gainCents as number) / openingNetWorthCents) * 100).toFixed(1)
      : null;

  return (
    <div
      className="grid grid-cols-1 gap-grid-gap sm:grid-cols-2 xl:grid-cols-4"
      data-testid="year-summary-metrics"
    >
      <MetricTile
        icon={WalletIcon}
        label={t("yearSummary.income")}
        value={
          <Money
            cents={data.total_income_cents}
            locale={locale}
            {...maskProps}
          />
        }
        caption={
          data.is_current_year ? t("insights.v2.januaryToToday") : undefined
        }
        data-testid="year-metric-income"
      />

      <MetricTile
        icon={TagIcon}
        label={t("yearSummary.spent")}
        value={
          <Money cents={data.total_spent_cents} locale={locale} {...maskProps} />
        }
        data-testid="year-metric-spent"
      />

      <MetricTile
        icon={DatabaseIcon}
        featured
        label={t("yearSummary.cashFlowNet")}
        value={
          <Money
            cents={data.cash_flow_net_cents}
            locale={locale}
            sign="always"
            {...maskProps}
          />
        }
        // A spreadsheet user's most practised habit is reading a running balance, so a bare net
        // figure gets read as one. This is the single most consequential misreading in the product.
        caption={
          savedSharePct !== null
            ? t("insights.v2.shareOfMoneyIn", { percent: savedSharePct })
            : t("yearSummary.cashFlowNetCaption")
        }
        data-testid="year-metric-cash-flow"
      />

      <MetricTile
        icon={TrendingUpIcon}
        label={t("yearSummary.gained")}
        value={
          gainAvailable ? (
            <Money
              cents={gainCents as number}
              locale={locale}
              sign="always"
              // Masking a dash would announce "Amount hidden" over an absence.
              {...maskProps}
            />
          ) : (
            "\u2014"
          )
        }
        caption={
          gainAvailable
            ? growthPct !== null
              ? t("insights.v2.growthPercent", { percent: growthPct })
              : undefined
            : t("yearSummary.noGainData")
        }
        data-testid="year-metric-gain"
      />
    </div>
  );
}
