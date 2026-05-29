import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, PillTabs } from "@nixus/shared";
import { SpendingTrendChart } from "@/components/spending-trends/SpendingTrendChart";
import { YearSummaryMetrics } from "@/components/yearly-summary/YearSummaryMetrics";
import { YearlyCategoryTable } from "@/components/yearly-summary/YearlyCategoryTable";
import { useYearlySummary } from "@/hooks/useYearlySummary";

export const Route = createFileRoute("/year-summary")({
  component: YearSummaryPage,
});

function YearSummaryPage() {
  const { t } = useTranslation();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const { data, isPending } = useYearlySummary(selectedYear);

  const yearOptions = useMemo(() => {
    const years = data?.available_years ?? [currentYear];
    return years.map(String);
  }, [data?.available_years, currentYear]);

  const yearLabels = useMemo(
    () =>
      Object.fromEntries(yearOptions.map((y) => [y, y])) as Record<string, string>,
    [yearOptions]
  );

  const isEmpty =
    !isPending &&
    data &&
    data.total_spent_cents === 0 &&
    data.total_income_cents === 0;

  const monthCountForAvg = data?.is_current_year
    ? new Date().getMonth() + 1
    : 12;

  return (
    <div>
      <PageHeader title={t("yearSummary.title")} />

      <div className="mb-4">
        <PillTabs
          options={yearOptions}
          labels={yearLabels}
          value={String(selectedYear)}
          onChange={(y) => setSelectedYear(Number(y))}
          data-testid="year-summary-tabs"
        />
      </div>

      {isEmpty ? (
        <Card className="shadow-sm rounded-lg" data-testid="year-summary-empty">
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">{t("yearSummary.noData")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {data && <YearSummaryMetrics data={data} />}
          <SpendingTrendChart
            data={data?.monthly_totals ?? []}
            isLoading={isPending}
            monthCount={monthCountForAvg}
            titleKey={
              data?.is_current_year
                ? "yearSummary.avgMonthlySpendYtd"
                : "yearSummary.avgMonthlySpend"
            }
          />
          <YearlyCategoryTable
            data={data?.all_categories ?? []}
            isLoading={isPending}
          />
        </div>
      )}
    </div>
  );
}
