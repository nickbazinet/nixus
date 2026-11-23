import { useTranslation } from "react-i18next";
import { InfoIcon, PercentIcon, SlidersHorizontalIcon } from "lucide-react";
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Money,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { insightsLocale } from "@/components/spending-trends/insights-chart";
import { EXPENSE_GROWTH_RATE, INCOME_GROWTH_RATE } from "@/lib/projection";

interface AssumptionsPanelProps {
  avgMonthlyIncomeCents: number;
  avgMonthlyExpenseCents: number;
  incomeMonthCount: number;
  expenseMonthCount: number;
}

/** Scroll target for the "See all assumptions" pill in the summary card above. */
export const ASSUMPTIONS_PANEL_ID = "projection-assumptions";

const GROWTH_RATE_KEYS = [
  {
    categoryKey: "projection.tfsaRrspFhsa",
    rateKey: "projection.tfsaRrspFhsaRate",
  },
  { categoryKey: "projection.realEstate", rateKey: "projection.realEstateRate" },
  { categoryKey: "projection.vehicles", rateKey: "projection.vehiclesRate" },
  {
    categoryKey: "projection.cashBusinessOther",
    rateKey: "projection.cashBusinessOtherRate",
  },
];

export function AssumptionsPanel({
  avgMonthlyIncomeCents,
  avgMonthlyExpenseCents,
  incomeMonthCount,
  expenseMonthCount,
}: AssumptionsPanelProps) {
  const { t, i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);
  const leftOverCents = avgMonthlyIncomeCents - avgMonthlyExpenseCents;

  return (
    <Card
      flush
      id={ASSUMPTIONS_PANEL_ID}
      tabIndex={-1}
      className="scroll-mt-6"
      data-testid="projection-assumptions"
    >
      <CardHeader className="pt-card-pad">
        <CardTitle icon={SlidersHorizontalIcon}>
          {t("projection.cashFlowAssumptions")}
        </CardTitle>
      </CardHeader>

      <Alert variant="info" icon={<InfoIcon />} className="mx-card-pad mt-4">
        <AlertDescription>
          {t("projection.assumptionsExplainer")}
        </AlertDescription>
      </Alert>

      <dl className="flex flex-col p-card-pad text-body">
        <AssumptionRow
          term={t("projection.avgMonthlyIncome")}
          detail={
            incomeMonthCount > 0
              ? t("projection.monthsCounted", { months: incomeMonthCount })
              : undefined
          }
        >
          {incomeMonthCount > 0 ? (
            <Money
              cents={avgMonthlyIncomeCents}
              locale={locale}
              {...maskProps}
            />
          ) : (
            <span className="text-ink-dim">
              {t("projection.noIncomeHistory")}
            </span>
          )}
        </AssumptionRow>

        <AssumptionRow
          term={t("projection.avgMonthlyExpenses")}
          detail={
            expenseMonthCount > 0
              ? t("projection.monthsCounted", { months: expenseMonthCount })
              : undefined
          }
        >
          {expenseMonthCount > 0 ? (
            <Money
              cents={avgMonthlyExpenseCents}
              locale={locale}
              {...maskProps}
            />
          ) : (
            <span className="text-ink-dim">
              {t("projection.noExpenseHistory")}
            </span>
          )}
        </AssumptionRow>

        <AssumptionRow
          term={t("projection.netMonthlyCashFlow")}
          detail={t("projection.netMonthlyCashFlowCaption")}
          emphasis
        >
          <Money
            cents={leftOverCents}
            locale={locale}
            sign="always"
            {...maskProps}
          />
        </AssumptionRow>

        <AssumptionRow term={t("projection.incomeGrowth")}>
          {t("projection.perYearWages", {
            percent: (INCOME_GROWTH_RATE * 100).toFixed(1),
          })}
        </AssumptionRow>

        <AssumptionRow term={t("projection.expenseGrowth")}>
          {t("projection.perYearInflation", {
            percent: (EXPENSE_GROWTH_RATE * 100).toFixed(1),
          })}
        </AssumptionRow>
      </dl>

      <CardHeader>
        <CardTitle icon={PercentIcon}>
          {t("projection.growthRateAssumptions")}
        </CardTitle>
      </CardHeader>
      <Table className="mt-2 [&_tbody_tr:last-child>td]:border-b-0 [&_td:first-child]:pl-card-pad [&_td:last-child]:pr-card-pad [&_th:first-child]:pl-card-pad [&_th:last-child]:pr-card-pad">
        <TableHeader>
          <TableRow>
            <TableHead>{t("common.category")}</TableHead>
            <TableHead numeric>{t("projection.annualRate")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {GROWTH_RATE_KEYS.map((row) => (
            <TableRow key={row.categoryKey}>
              <TableCell>{t(row.categoryKey)}</TableCell>
              <TableCell numeric>{t(row.rateKey)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <CardContent className="pb-card-pad pt-4">
        <p className="text-caption text-ink-faint">
          {t("projection.growthRateBasis")}
        </p>
      </CardContent>
    </Card>
  );
}

function AssumptionRow({
  term,
  detail,
  emphasis = false,
  children,
}: {
  term: string;
  detail?: string;
  emphasis?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-b-0">
      <div className="min-w-0">
        <dt className={emphasis ? "text-label text-ink" : "text-body text-ink-dim"}>
          {term}
        </dt>
        {detail ? (
          <p className="text-caption text-ink-faint">{detail}</p>
        ) : null}
      </div>
      <dd className="money text-label font-bold text-ink">{children}</dd>
    </div>
  );
}
