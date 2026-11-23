import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CalendarRangeIcon, TagIcon } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PillTabs,
} from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { DonutBreakdown } from "@/components/charts/DonutBreakdown";
import { YearInOutChart } from "@/components/yearly-summary/YearInOutChart";
import { GrowthSourcesCard } from "@/components/yearly-summary/GrowthSourcesCard";
import { YearSummaryMetrics } from "@/components/yearly-summary/YearSummaryMetrics";
import { YearlyCategoryTable } from "@/components/yearly-summary/YearlyCategoryTable";
import { useYearlySummary } from "@/hooks/useYearlySummary";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useCurrentNetWorth } from "@/hooks/useNetWorth";

export const Route = createFileRoute("/insights/year-summary")({
  component: YearSummaryPage,
});

/** Legend rows before "everything else" folds the tail into one line. */
const DONUT_LEGEND_ITEMS = 6;

function YearSummaryPage() {
  const { t } = useTranslation();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);

  const { data, isPending } = useYearlySummary(selectedYear);
  // Month-by-month money in is not in the yearly payload — only its total is — so the "in and out"
  // line sums the entries themselves. Shared query, so the Income surface pays for it only once.
  const { data: incomeEntries } = useIncomeEntries();
  const { data: netWorth } = useCurrentNetWorth();

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

  const donutItems = useMemo(
    () =>
      (data?.all_categories ?? []).map((row) => ({
        key: row.category_id,
        label: row.category_name,
        cents: row.spent_cents,
      })),
    [data?.all_categories],
  );

  return (
    <div>
      <PageHeader
        title={t("nav.yearSummary")}
        subtitle={
          data && !data.is_current_year
            ? t("surface.subtitle.yearSummaryPast", { year: selectedYear })
            : t("surface.subtitle.yearSummary", { year: selectedYear })
        }
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
        <div className="flex flex-col gap-grid-gap">
          {data && (
            <YearSummaryMetrics
              data={data}
              netWorthTotalCents={
                data.is_current_year ? netWorth?.total_cents : undefined
              }
            />
          )}

          <div className="grid items-start gap-grid-gap lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            <YearInOutChart
              monthlyTotals={data?.monthly_totals ?? []}
              incomeEntries={incomeEntries ?? []}
              year={selectedYear}
              isLoading={isPending}
              titleKey={
                data?.is_current_year
                  ? "yearSummary.avgMonthlySpendYtd"
                  : "yearSummary.avgMonthlySpend"
              }
            />

            <Card>
              <CardHeader>
                <CardTitle icon={TagIcon}>
                  {t("insights.v2.whereYearWent", { year: selectedYear })}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {donutItems.length === 0 ? (
                  <p className="text-caption text-ink-dim">
                    {t("yearSummary.noData")}
                  </p>
                ) : (
                  <DonutBreakdown
                    items={donutItems}
                    centerLabel={t("insights.v2.spentLower")}
                    listLabel={t("insights.v2.whereYearWent", {
                      year: selectedYear,
                    })}
                    maxLegendItems={DONUT_LEGEND_ITEMS}
                    data-testid="year-donut"
                  />
                )}
              </CardContent>
            </Card>
          </div>

          {data && <GrowthSourcesCard data={data} />}

          <YearlyCategoryTable
            data={data?.all_categories ?? []}
            isLoading={isPending}
          />
        </div>
      )}
    </div>
  );
}
