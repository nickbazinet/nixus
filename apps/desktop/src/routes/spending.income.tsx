import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  Calendar,
  ChartNoAxesColumn,
  Database,
  Landmark,
  Plus,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Money,
  Skeleton,
  SlideOver,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricTile } from "@/components/shared/MetricTile";
import { InsightCallout } from "@/components/shared/InsightCallout";
import { DonutBreakdown } from "@/components/charts/DonutBreakdown";
import { usePeriod } from "@/hooks/usePeriod";
import { IncomeSourceRow } from "@/components/income/IncomeSourceRow";
import { AddIncomeSourceForm } from "@/components/income/AddIncomeSourceForm";
import { AddIncomeEntryForm } from "@/components/income/AddIncomeEntryForm";
import { IncomeEntryList } from "@/components/income/IncomeEntryList";
import { IncomeByMonthChart } from "@/components/income/IncomeByMonthChart";
import { formatLongDate, nextOccurrence } from "@/components/expenses/recurringSchedule";
import {
  useIncomeEntries,
  useIncomeSources,
  useIncomeSourceYearTotals,
  useIncomeTotal,
  useIncomeEntriesByMonth,
} from "@/hooks/useIncome";
import { useRecurringIncomeTemplates } from "@/hooks/useRecurringIncome";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";
import { FREQUENCY_LABEL_KEYS } from "@/lib/recurrence";
import type { IncomeEntry } from "@/lib/types";

export const Route = createFileRoute("/spending/income")({
  component: IncomePage,
});

/** The month before the selected one, for the "last month" comparison. */
function previousPeriod(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

const TYPE_LABEL_KEYS: Record<string, string> = {
  employment: "income.typeEmployment",
  freelance: "income.typeFreelance",
  investment: "income.typeInvestment",
  other: "income.typeOther",
};

/** A pay cheque is employment income; everything else is grouped as other. */function splitByKind(entries: readonly IncomeEntry[]) {
  const pay = entries.filter((entry) => entry.income_type === "employment");
  const other = entries.filter((entry) => entry.income_type !== "employment");
  const sum = (rows: readonly IncomeEntry[]) =>
    rows.reduce((total, entry) => total + entry.amount_cents, 0);
  return { pay, other, payCents: sum(pay), otherCents: sum(other) };
}

function IncomePage() {
  const { t, i18n } = useTranslation();
  const maskProps = useMaskProps();
  const formatCurrency = useFormatCurrency();
  const [showAddSource, setShowAddSource] = useState(false);
  const [showAddEntry, setShowAddEntry] = useState(false);

  const { year: selectedYear, month: selectedMonth } = usePeriod();
  const previous = previousPeriod(selectedYear, selectedMonth);

  const { data: sources, isLoading: sourcesLoading } = useIncomeSources();
  const { data: total } = useIncomeTotal(selectedYear, selectedMonth);
  const { data: previousTotal } = useIncomeTotal(previous.year, previous.month);
  const { data: entries, isLoading: entriesLoading } = useIncomeEntriesByMonth(
    selectedYear,
    selectedMonth
  );
  // Every entry on record: the monthly chart is summed from them, because no command answers
  // "income per month".
  const { data: allEntries } = useIncomeEntries();
  const { data: recurringIncomeData } = useRecurringIncomeTemplates();
  const recurringIncome = recurringIncomeData ?? [];
  const {
    data: yearTotals,
    isLoading: yearTotalsLoading,
    isError: yearTotalsError,
    refetch: refetchYearTotals,
  } = useIncomeSourceYearTotals(selectedYear);

  const hasSources = sources && sources.length > 0;
  const monthEntries = entries ?? [];

  // Gating on sources alone would flash $0.00 in every row until the aggregate lands.
  const tableLoading = sourcesLoading || yearTotalsLoading;

  const yearTotalsBySourceId = new Map(
    (yearTotals ?? []).map((yearTotal) => [
      yearTotal.source_id,
      yearTotal.total_cents,
    ])
  );

  const { pay, other, payCents, otherCents } = splitByKind(monthEntries);

  // The schedule is only quoted when every pay cheque that repeats shares one cadence; two
  // different rhythms have no single sentence, so the count stands alone.
  const paySchedule = useMemo(() => {
    const paySourceIds = new Set(pay.map((entry) => entry.source_id));
    const cadences = new Set(
      recurringIncome
        .filter((template) => template.is_active && paySourceIds.has(template.source_id))
        .map((template) => template.frequency)
    );
    if (cadences.size !== 1) return null;
    const [frequency] = [...cadences];
    return t(FREQUENCY_LABEL_KEYS[frequency]).toLocaleLowerCase(i18n.language);
  }, [pay, recurringIncome, t, i18n.language]);

  const otherKinds = useMemo(() => {
    const labels = new Map<string, string>();
    for (const entry of other) {
      labels.set(
        entry.income_type,
        t(TYPE_LABEL_KEYS[entry.income_type] ?? TYPE_LABEL_KEYS.other)
      );
    }
    return [...labels.values()];
  }, [other, t]);

  const bySource = useMemo(() => {
    const totals = new Map<number, { label: string; cents: number }>();
    for (const entry of monthEntries) {
      const current = totals.get(entry.source_id);
      totals.set(entry.source_id, {
        label: entry.source_name,
        cents: (current?.cents ?? 0) + entry.amount_cents,
      });
    }
    return [...totals.entries()].map(([sourceId, row]) => ({
      key: sourceId,
      label: row.label,
      cents: row.cents,
    }));
  }, [monthEntries]);

  // The soonest scheduled deposit, from the recurring templates the user already set up.
  const nextExpected = useMemo(() => {
    const upcoming = recurringIncome
      .filter((template) => template.is_active)
      .map((template) => ({ template, date: nextOccurrence(template) }))
      .filter((row): row is { template: typeof row.template; date: Date } => row.date !== null)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    return upcoming[0] ?? null;
  }, [recurringIncome]);

  const monthlyHistory = allEntries ?? [];
  const hasMonthlyHistory = monthlyHistory.length > 0;
  const hasBreakdown = bySource.some((row) => row.cents > 0);

  return (
    <div>
      <PageHeader title={t("nav.income")} subtitle={t("surface.subtitle.income")} />

      <div className="flex flex-col gap-grid-gap">
        <div className="grid gap-grid-gap md:grid-cols-3">
          {/* Labelled against what it is not: a spreadsheet user's most practised habit is reading
            * a running balance, so an unqualified figure gets read as one. */}
          <MetricTile
            featured
            icon={Wallet}
            label={t("income.v2.moneyInThisMonth")}
            value={
              <Money cents={total?.total_cents ?? 0} locale={i18n.language} {...maskProps} />
            }
            caption={t("income.v2.lastMonth", {
              amount: formatCurrency(previousTotal?.total_cents ?? 0),
            })}
            data-testid="income-month-total"
          />
          <MetricTile
            icon={Landmark}
            label={t("income.v2.payCheques")}
            value={<Money cents={payCents} locale={i18n.language} {...maskProps} />}
            caption={
              paySchedule
                ? t("income.v2.payChequeCountSchedule", {
                    count: pay.length,
                    schedule: paySchedule,
                  })
                : t("transactions.v2.depositCount", { count: pay.length })
            }
            data-testid="income-pay-total"
          />
          <MetricTile
            icon={Database}
            label={t("income.v2.otherIncome")}
            value={<Money cents={otherCents} locale={i18n.language} {...maskProps} />}
            caption={
              otherKinds.length > 0
                ? otherKinds.join(", ")
                : t("income.v2.noOtherIncome")
            }
            data-testid="income-other-total"
          />
        </div>

        {(hasMonthlyHistory || hasBreakdown) && (
          <div className="grid gap-grid-gap lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
            {hasMonthlyHistory && (
              <Card>
                <CardHeader>
                  <CardTitle icon={ChartNoAxesColumn}>
                    {t("income.v2.byMonthTitle", { year: selectedYear })}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <IncomeByMonthChart entries={monthlyHistory} year={selectedYear} />
                </CardContent>
              </Card>
            )}
            {hasBreakdown && (
              <Card>
                <CardHeader>
                  <CardTitle icon={Database}>{t("income.v2.whereItComesFrom")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <DonutBreakdown
                    items={bySource}
                    centerLabel={t("income.v2.inCenterLabel")}
                    listLabel={t("income.v2.bySourceListLabel")}
                    maxLegendItems={6}
                    data-testid="income-source-breakdown"
                  />
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <Card flush>
          <CardHeader className="border-b border-line pt-card-pad pb-4">
            <CardTitle icon={Wallet}>{t("income.v2.deposits")}</CardTitle>
            <CardAction>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddEntry(true)}
                disabled={!hasSources}
                data-testid="income-add-entry"
              >
                <Plus aria-hidden="true" />
                {t("income.addEntry")}
              </Button>
            </CardAction>
          </CardHeader>
          <IncomeEntryList
            entries={monthEntries}
            isLoading={entriesLoading}
            onAddEntry={hasSources ? () => setShowAddEntry(true) : undefined}
          />
        </Card>

        {nextExpected && (
          <InsightCallout
            layout="row"
            icon={Calendar}
            eyebrow={t("income.v2.nextExpectedEyebrow")}
            title={t("income.v2.nextExpectedTitle", {
              source: nextExpected.template.source_name,
              amount: formatCurrency(nextExpected.template.amount_cents),
              date: formatLongDate(nextExpected.date, i18n.language),
            })}
            data-testid="income-next-expected"
          />
        )}

        <Card flush>
          <CardHeader className="border-b border-line pt-card-pad pb-4">
            <CardTitle icon={Database}>{t("income.sources")}</CardTitle>
            <CardAction>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddSource(true)}
                data-testid="income-add-source"
              >
                <Plus aria-hidden="true" />
                {t("income.addSource")}
              </Button>
            </CardAction>
          </CardHeader>

          {tableLoading && (
            <div className="px-card-pad py-4">
              <Skeleton rows={3} data-testid="income-sources-skeleton" />
            </div>
          )}

          {!tableLoading && yearTotalsError && (
            <EmptyState
              icon={<TriangleAlert />}
              title={t("income.yearTotalsUnavailable")}
              description={t("income.yearTotalsUnavailableDescription", {
                year: String(selectedYear),
              })}
              action={
                <Button size="sm" onClick={() => void refetchYearTotals()}>
                  {t("income.retryYearTotals")}
                </Button>
              }
              className="py-6"
              data-testid="income-year-totals-error"
            />
          )}

          {!tableLoading && !yearTotalsError && !hasSources && (
            <EmptyState
              icon={<Wallet />}
              title={t("income.noSourcesTitle")}
              description={t("income.noSourcesDescription")}
              action={
                <Button size="sm" onClick={() => setShowAddSource(true)}>
                  <Plus aria-hidden="true" />
                  {t("income.addASource")}
                </Button>
              }
              className="py-6"
              data-testid="income-sources-empty"
            />
          )}

          {!tableLoading && !yearTotalsError && hasSources && (
            <Table className="[&_td:first-child]:pl-card-pad [&_td:last-child]:pr-card-pad [&_th:first-child]:pl-card-pad [&_th:last-child]:pr-card-pad">
              <caption className="sr-only">{t("income.sourcesTableCaption")}</caption>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("common.type")}</TableHead>
                  <TableHead>{t("income.lastRecorded")}</TableHead>
                  <TableHead numeric>
                    {t("income.yearTotal", { year: String(selectedYear) })}
                  </TableHead>
                  <TableHead>
                    <span className="sr-only">{t("common.delete")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.map((source) => (
                  <IncomeSourceRow
                    key={source.id}
                    source={source}
                    yearTotalCents={yearTotalsBySourceId.get(source.id) ?? 0}
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>

      <SlideOver
        open={showAddSource}
        onClose={() => setShowAddSource(false)}
        title={t("income.addIncomeSource")}
        description={t("income.addIncomeSourceDescription")}
        data-testid="income-source-slide-over"
      >
        <AddIncomeSourceForm onClose={() => setShowAddSource(false)} />
      </SlideOver>

      <SlideOver
        open={showAddEntry}
        onClose={() => setShowAddEntry(false)}
        title={t("income.addIncomeEntry")}
        description={t("income.addIncomeEntryDescription")}
        data-testid="income-entry-slide-over"
      >
        <AddIncomeEntryForm onClose={() => setShowAddEntry(false)} />
      </SlideOver>
    </div>
  );
}
