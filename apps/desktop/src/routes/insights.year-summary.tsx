import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CalendarRangeIcon } from "lucide-react";
import { Button, Card, EmptyState, PillTabs } from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { SpendingTrendChart } from "@/components/spending-trends/SpendingTrendChart";
import { YearSummaryMetrics } from "@/components/yearly-summary/YearSummaryMetrics";
import { YearlyCategoryTable } from "@/components/yearly-summary/YearlyCategoryTable";
import { useYearlySummary } from "@/hooks/useYearlySummary";

export const Route = createFileRoute("/insights/year-summary")({
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
      Object.fromEntries(yearOptions.map((year) => [year, year])) as Record<
        string,
        string
      >,
    [yearOptions],
  );

  const isEmpty =
    !isPending &&
    data &&
    data.total_spent_cents === 0 &&
    data.total_income_cents === 0;

  return (
    <div>
      <PageHeader
        title={t("nav.yearSummary")}
        actions={
          <PillTabs
            options={yearOptions}
            labels={yearLabels}
            value={String(selectedYear)}
            onChange={(year) => setSelectedYear(Number(year))}
            data-testid="year-summary-tabs"
          />
        }
      />

      {isEmpty ? (
        <Card data-testid="year-summary-empty">
          <EmptyState
            icon={<CalendarRangeIcon />}
            title={t("insights.yearEmptyTitle")}
            description={t("yearSummary.noData")}
            action={
              <Button render={<Link to="/import" />}>
                {t("dashboard.importStatement")}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-section-gap">
          {data && <YearSummaryMetrics data={data} />}
          <SpendingTrendChart
            data={data?.monthly_totals ?? []}
            isLoading={isPending}
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
