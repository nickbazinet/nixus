import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  ChartNoAxesColumnIcon,
  CheckIcon,
  TrendingUpIcon,
} from "lucide-react";
import { Button, Card, EmptyState, Money, PillTabs } from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricTile } from "@/components/shared/MetricTile";
import { SpendingTrendChart } from "@/components/spending-trends/SpendingTrendChart";
import { CategorySpendTable } from "@/components/spending-trends/CategorySpendTable";
import { TrendsInsightPanel } from "@/components/spending-trends/TrendsInsightPanel";
import { insightsLocale } from "@/components/spending-trends/insights-chart";
import {
  lowestCompletedMonth,
  monthlySpendView,
  trailingAverage,
} from "@/components/spending-trends/monthly-spend";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { useSpendingTrends } from "@/hooks/useSpendingTrends";
import { useInsightGate, useTrendsInsight } from "@/hooks/useTrendsInsight";
import { useAiAvailability } from "@/hooks/useAiConfig";

export const Route = createFileRoute("/insights/trends")({
  component: SpendingTrendsPage,
});

const WINDOW_OPTIONS = ["3m", "6m", "12m"] as const;
const WINDOW_LABEL_KEYS: Record<string, string> = {
  "3m": "spending.period3M",
  "6m": "spending.period6M",
  "12m": "spending.period12M",
};
const WINDOW_MONTHS: Record<string, number> = {
  "3m": 3,
  "6m": 6,
  "12m": 12,
};

/** The reference window the "is this month unusual?" tile averages over. */
const TRAILING_MONTHS = 3;

function SpendingTrendsPage() {
  const { t, i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);
  const [selectedWindow, setSelectedWindow] = useState<string>("6m");

  const windowLabels = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(WINDOW_LABEL_KEYS).map(([key, value]) => [key, t(value)]),
      ) as Record<string, string>,
    [t],
  );

  const months = WINDOW_MONTHS[selectedWindow];
  const { data, isPending } = useSpendingTrends(months);
  const availability = useAiAvailability();

  const totals = data?.totals ?? [];
  const categoryCompare = data?.category_compare ?? [];
  const isEmpty = totals.length === 0 && !isPending;
  const gatePassed = useInsightGate(categoryCompare);

  const insightQuery = useTrendsInsight({
    months,
    windowLabel: windowLabels[selectedWindow],
    categoryCompare,
    availability,
    gatePassed,
  });

  // The two side tiles are the chart's reading aids: what a normal recent month costs, and the
  // cheapest month you have actually had. Both come from finished months only.
  const { trailing, lowest } = useMemo(() => {
    const view = monthlySpendView(totals, locale);
    return {
      trailing: trailingAverage(view, TRAILING_MONTHS),
      lowest: lowestCompletedMonth(view),
    };
  }, [totals, locale]);

  const hasSideTiles = trailing !== null || lowest !== null;

  return (
    <div>
      <PageHeader
        title={t("nav.trends")}
        subtitle={t("surface.subtitle.trends")}
        actions={
          <PillTabs
            options={WINDOW_OPTIONS}
            labels={windowLabels}
            value={selectedWindow}
            onChange={setSelectedWindow}
            data-testid="spending-trends-window"
          />
        }
      />

      {isEmpty ? (
        <Card data-testid="spending-trends-empty">
          <EmptyState
            icon={<ChartNoAxesColumnIcon />}
            title={t("insights.trendsEmptyTitle")}
            description={t("spendingTrends.noData")}
            action={
              <Button render={<Link to="/import" />}>
                {t("dashboard.importStatement")}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-grid-gap">
          <div
            className={
              hasSideTiles
                ? "grid gap-grid-gap lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
                : "grid gap-grid-gap"
            }
          >
            <SpendingTrendChart data={totals} isLoading={isPending} />
            {hasSideTiles && (
              <div className="flex flex-col gap-grid-gap">
                {trailing && (
                  <MetricTile
                    icon={TrendingUpIcon}
                    label={t("insights.v2.trailingAverage", {
                      months: trailing.months,
                    })}
                    value={
                      <Money
                        cents={trailing.cents}
                        locale={locale}
                        {...maskProps}
                      />
                    }
                    caption={t("insights.v2.monthRange", {
                      first: trailing.first,
                      last: trailing.last,
                    })}
                    isLoading={isPending}
                    data-testid="trends-trailing-average"
                  />
                )}
                {lowest && (
                  <MetricTile
                    icon={CheckIcon}
                    label={t("insights.v2.bestMonth")}
                    value={
                      <Money
                        cents={lowest.cents}
                        locale={locale}
                        {...maskProps}
                      />
                    }
                    caption={lowest.monthName}
                    isLoading={isPending}
                    data-testid="trends-best-month"
                  />
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-grid-gap">
            <TrendsInsightPanel
              gatePassed={gatePassed}
              availability={availability}
              insightQuery={insightQuery}
            />
            <CategorySpendTable
              categoryCompare={categoryCompare}
              monthCount={months}
              isLoading={isPending}
            />
          </div>
        </div>
      )}
    </div>
  );
}
