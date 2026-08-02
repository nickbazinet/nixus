import { useTranslation } from "react-i18next";
import { InfoIcon } from "lucide-react";
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
    <Card flush>
      <CardHeader className="pt-card-pad">
        <CardTitle>{t("projection.cashFlowAssumptions")}</CardTitle>
      </CardHeader>

      <Alert variant="info" icon={<InfoIcon />} className="mt-3">
        <AlertDescription>
          {t("projection.assumptionsExplainer")}
        </AlertDescription>
      </Alert>

      <dl className="flex flex-col gap-2 p-card-pad text-body">
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
        <CardTitle>{t("projection.growthRateAssumptions")}</CardTitle>
      </CardHeader>
      <Table className="mt-2 [&_tbody_tr:last-child>td]:border-b-0">
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
      <CardContent className="pb-card-pad">
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
    <div className="flex items-baseline justify-between gap-4">
      <div className="min-w-0">
        <dt className={emphasis ? "text-label text-ink" : "text-body text-ink-dim"}>
          {term}
        </dt>
        {detail ? (
          <p className="text-caption text-ink-faint">{detail}</p>
        ) : null}
      </div>
      <dd className={emphasis ? "text-label text-ink" : "text-body text-ink"}>
        {children}
      </dd>
    </div>
  );
}
