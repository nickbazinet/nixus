import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Plus, Wallet } from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Skeleton,
  SlideOver,
  Stat,
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  formatMoney,
} from "@nixus/shared";
import { PageHeader } from "@/components/shared/PageHeader";
import { usePeriod } from "@/hooks/usePeriod";
import { IncomeSourceRow } from "@/components/income/IncomeSourceRow";
import { AddIncomeSourceForm } from "@/components/income/AddIncomeSourceForm";
import { AddIncomeEntryForm } from "@/components/income/AddIncomeEntryForm";
import { IncomeEntryList } from "@/components/income/IncomeEntryList";
import {
  useIncomeSources,
  useIncomeTotal,
  useIncomeEntriesByMonth,
} from "@/hooks/useIncome";
import { useMaskProps } from "@/contexts/ValuesVisibilityContext";

export const Route = createFileRoute("/spending/income")({
  component: IncomePage,
});

function IncomePage() {
  const { t, i18n } = useTranslation();
  const maskProps = useMaskProps();
  const [showAddSource, setShowAddSource] = useState(false);
  const [showAddEntry, setShowAddEntry] = useState(false);

  const { year: selectedYear, month: selectedMonth } = usePeriod();

  const { data: sources, isLoading: sourcesLoading } = useIncomeSources();
  const { data: total } = useIncomeTotal(selectedYear, selectedMonth);
  const { data: entries, isLoading: entriesLoading } = useIncomeEntriesByMonth(
    selectedYear,
    selectedMonth
  );

  const hasSources = sources && sources.length > 0;


  return (
    <div>
      <PageHeader
        title={t("nav.income")}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAddSource(true)}
            >
              <Plus aria-hidden="true" />
              {t("income.addSource")}
            </Button>
            {hasSources && (
              <Button size="sm" onClick={() => setShowAddEntry(true)}>
                <Plus aria-hidden="true" />
                {t("income.addEntry")}
              </Button>
            )}
          </div>
        }
      />

      <Card className="mb-section-gap">
        <CardContent className="flex flex-wrap items-start justify-between gap-4">
          {/* Labelled against what it is not: a spreadsheet user's most practised habit is reading
            * a running balance, so an unqualified figure gets read as one. */}
          <Stat
            label={t("income.moneyInLabel")}
            value={formatMoney({
              cents: total?.total_cents ?? 0,
              locale: i18n.language,
            })}
            caption={t("income.moneyInCaption")}
            {...maskProps}
            data-testid="income-month-total"
          />
        </CardContent>
      </Card>

      <Card flush className="mb-section-gap">
        <div className="border-b border-line px-card-pad py-3">
          <h2 className="text-h2 text-ink">{t("income.entries")}</h2>
        </div>
        <IncomeEntryList
          entries={entries ?? []}
          isLoading={entriesLoading}
          onAddEntry={hasSources ? () => setShowAddEntry(true) : undefined}
        />
      </Card>

      <Card flush>
        <div className="border-b border-line px-card-pad py-3">
          <h2 className="text-h2 text-ink">{t("income.sources")}</h2>
        </div>

        {sourcesLoading && (
          <div className="px-card-pad py-3">
            <Skeleton rows={3} data-testid="income-sources-skeleton" />
          </div>
        )}

        {!sourcesLoading && !hasSources && (
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
            data-testid="income-sources-empty"
          />
        )}

        {!sourcesLoading && hasSources && (
          <Table>
            <caption className="sr-only">{t("income.sourcesTableCaption")}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("common.type")}</TableHead>
                <TableHead>{t("income.lastRecorded")}</TableHead>
                <TableHead numeric>{t("common.amount")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("common.delete")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((source) => (
                <IncomeSourceRow key={source.id} source={source} />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

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
