import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { Button } from "@nixus/shared";
import { Card, CardContent } from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { MonthNavigator } from "@/components/budget/MonthNavigator";
import { IncomeSourceRow } from "@/components/income/IncomeSourceRow";
import { AddIncomeSourceForm } from "@/components/income/AddIncomeSourceForm";
import { AddIncomeEntryForm } from "@/components/income/AddIncomeEntryForm";
import { IncomeEntryList } from "@/components/income/IncomeEntryList";
import {
  useIncomeSources,
  useIncomeTotal,
  useIncomeEntriesByMonth,
} from "@/hooks/useIncome";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { SlideOver } from "@nixus/shared";

export const Route = createFileRoute("/income")({
  component: IncomePage,
});

function IncomePage() {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const [showAddSource, setShowAddSource] = useState(false);
  const [showAddEntry, setShowAddEntry] = useState(false);

  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);

  const { data: sources, isLoading: sourcesLoading } = useIncomeSources();
  const { data: total } = useIncomeTotal(selectedYear, selectedMonth);
  const { data: entries, isLoading: entriesLoading } = useIncomeEntriesByMonth(
    selectedYear,
    selectedMonth
  );

  const hasSources = sources && sources.length > 0;

  const handleMonthChange = (year: number, month: number) => {
    setSelectedYear(year);
    setSelectedMonth(month);
  };

  return (
    <div>
      <PageHeader
        title={t("nav.income")}
        actions={
          <div className="flex items-center gap-3">
            {total && total.total_cents > 0 && (
              <span className="text-sm font-mono font-medium text-emerald-600 dark:text-emerald-400">
                {formatCurrency(total.total_cents)}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAddSource(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              {t("income.addSource")}
            </Button>
            {hasSources && (
              <Button size="sm" onClick={() => setShowAddEntry(true)}>
                <Plus className="h-4 w-4 mr-1" />
                {t("income.addEntry")}
              </Button>
            )}
          </div>
        }
      />
      <MonthNavigator
        selectedYear={selectedYear}
        selectedMonth={selectedMonth}
        onChange={handleMonthChange}
      />

      {/* Income Entries */}
      <Card className="shadow-sm rounded-lg mb-4">
        <CardContent className="p-4">
          <p className="text-sm font-medium text-muted-foreground mb-3">
            {t("income.entries")}
          </p>

          {entriesLoading && (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-10 bg-muted animate-pulse rounded" />
              ))}
            </div>
          )}

          {!entriesLoading && (
            <IncomeEntryList entries={entries ?? []} />
          )}
        </CardContent>
      </Card>

      {/* Income Sources */}
      <Card className="shadow-sm rounded-lg">
        <CardContent className="p-4">
          <p className="text-sm font-medium text-muted-foreground mb-3">
            {t("income.sources")}
          </p>

          {sourcesLoading && (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-10 bg-muted animate-pulse rounded" />
              ))}
            </div>
          )}

          {!sourcesLoading && !hasSources && !showAddSource && (
            <div className="py-8 text-center">
              <p className="text-muted-foreground">
                {t("income.addFirstSource")}
              </p>
              <Button
                className="mt-3"
                onClick={() => setShowAddSource(true)}
              >
                <Plus className="h-4 w-4 mr-1" />
                {t("income.addSource")}
              </Button>
            </div>
          )}

          {hasSources && (
            <div className="space-y-0.5">
              {sources.map((source) => (
                <IncomeSourceRow key={source.id} source={source} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <SlideOver
        open={showAddSource}
        onClose={() => setShowAddSource(false)}
        title={t("income.addIncomeSource")}
        data-testid="income-source-slide-over"
      >
        <AddIncomeSourceForm onClose={() => setShowAddSource(false)} />
      </SlideOver>

      <SlideOver
        open={showAddEntry}
        onClose={() => setShowAddEntry(false)}
        title={t("income.addIncomeEntry")}
        data-testid="income-entry-slide-over"
      >
        <AddIncomeEntryForm onClose={() => setShowAddEntry(false)} />
      </SlideOver>
    </div>
  );
}
