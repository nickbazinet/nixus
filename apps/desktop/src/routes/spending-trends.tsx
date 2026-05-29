import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, PillTabs } from "@nkbaz/shared";
import { SpendingTrendChart } from "@/components/spending-trends/SpendingTrendChart";
import { CategorySpendTable } from "@/components/spending-trends/CategorySpendTable";
import { useSpendingTrends } from "@/hooks/useSpendingTrends";

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

  const { data, isPending } = useSpendingTrends(WINDOW_MONTHS[selectedWindow]);

  const totals = data?.totals ?? [];
  const byCategory = data?.by_category ?? [];
  const isEmpty = totals.length === 0 && !isPending;

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
          <CategorySpendTable
            data={byCategory}
            monthCount={totals.length || WINDOW_MONTHS[selectedWindow]}
            isLoading={isPending}
          />
        </div>
      )}
    </div>
  );
}
