import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, PillTabs } from "@nixus/shared";
import { SpendingTrendChart } from "@/components/spending-trends/SpendingTrendChart";
import { CategorySpendTable } from "@/components/spending-trends/CategorySpendTable";
import { TrendsInsightPanel } from "@/components/spending-trends/TrendsInsightPanel";
import { useSpendingTrends } from "@/hooks/useSpendingTrends";
import { useTrendsInsight, useInsightGate } from "@/hooks/useTrendsInsight";
import { useAiConfig } from "@/hooks/useAiConfig";

export const Route = createFileRoute("/spending-trends")({
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

function SpendingTrendsPage() {
  const { t } = useTranslation();
  const [selectedWindow, setSelectedWindow] = useState<string>("6m");

  const windowLabels = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(WINDOW_LABEL_KEYS).map(([k, v]) => [k, t(v)])
      ) as Record<string, string>,
    [t]
  );

  const months = WINDOW_MONTHS[selectedWindow];
  const { data, isPending } = useSpendingTrends(months);
  const { data: aiConfig } = useAiConfig();

  const totals = data?.totals ?? [];
  const categoryCompare = data?.category_compare ?? [];
  const isEmpty = totals.length === 0 && !isPending;
  const gatePassed = useInsightGate(categoryCompare);
  const aiConfigured = aiConfig?.configured ?? false;

  const insightQuery = useTrendsInsight({
    months,
    windowLabel: windowLabels[selectedWindow],
    categoryCompare,
    aiConfigured,
    gatePassed,
  });

  return (
    <div>
      <PageHeader title={t("nav.trends")} />

      {isEmpty ? (
        <Card className="shadow-sm rounded-lg">
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">
              {t("spendingTrends.noData")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="mb-4">
            <PillTabs
              options={WINDOW_OPTIONS}
              labels={windowLabels}
              value={selectedWindow}
              onChange={setSelectedWindow}
            />
          </div>
          <SpendingTrendChart data={totals} isLoading={isPending} />
          <TrendsInsightPanel
            gatePassed={gatePassed}
            aiConfigured={aiConfigured}
            insightQuery={insightQuery}
          />
          <CategorySpendTable
            categoryCompare={categoryCompare}
            monthCount={months}
            isLoading={isPending}
          />
        </div>
      )}
    </div>
  );
}
