import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Money,
  Skeleton,
  SubStat,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  formatMoney,
} from "@nixus/shared";
import { useFinancialHealthDetail } from "@/hooks/useFinancialHealth";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { cn } from "@/lib/utils";
import type { MonthlySurplusPoint } from "@/lib/types";
import { MetricInfoTooltip } from "@/components/financial-health/MetricInfoTooltip";

const DISCRETIONARY_SKELETON_ROWS = 3;

function SavingsCapacityPanelSkeleton() {
  return (
    <Card data-testid="savings-capacity-panel-loading">
      <CardContent>
        {/* Title, rate, caption, chart, three category rows. */}
        <Skeleton rows={4 + DISCRETIONARY_SKELETON_ROWS} />
      </CardContent>
    </Card>
  );
}

// `Jun '26`, never `Jun 26` — the latter parses as a date.
function formatMonthLabel(monthStr: string, locale: string): string {
  const [year, month] = monthStr.split("-");
  const date = new Date(Number(year), Number(month) - 1);
  const monthName = date.toLocaleString(locale, { month: "short" });
  return `${monthName} '${year.slice(-2)}`;
}

function SurplusTrendChart({
  data,
  locale,
  hidden,
  amountHidden,
}: {
  data: MonthlySurplusPoint[];
  locale: string;
  hidden: boolean;
  amountHidden: string;
}) {
  const { t } = useTranslation();

  if (data.length === 0) return null;

  const maxAbs = Math.max(...data.map((p) => Math.abs(p.surplus_cents)), 1);
  const lastMonth = data[data.length - 1].month;
  const shortfallMonths = data.filter((p) => p.surplus_cents < 0);

  return (
    <div className="flex flex-col gap-2" data-testid="savings-capacity-trend">
      <div className="flex items-stretch gap-1.5" aria-hidden="true">
        {data.map((point) => {
          const heightPercent = Math.max((Math.abs(point.surplus_cents) / maxAbs) * 100, 6);
          const isShortfall = point.surplus_cents < 0;
          const isCurrent = point.month === lastMonth;

          return (
            <div key={point.month} className="flex flex-1 flex-col items-center gap-1">
              {/* A zero baseline carries the sign by direction. A status colour is never a chart
                  fill, so a shortfall cannot be signalled by turning the bar red. */}
              <div className="flex h-14 w-full flex-col justify-end">
                {!isShortfall && (
                  <div
                    className={cn(
                      "w-full rounded-t-sm",
                      isCurrent ? "bg-brand" : "bg-chart-2",
                    )}
                    style={{ height: `${heightPercent}%` }}
                  />
                )}
              </div>
              <div className="h-px w-full bg-line-strong" />
              <div className="flex h-6 w-full flex-col justify-start">
                {isShortfall && (
                  <div
                    className={cn(
                      "w-full rounded-b-sm",
                      isCurrent ? "bg-brand" : "bg-chart-2",
                    )}
                    style={{ height: `${Math.min(heightPercent, 100)}%` }}
                  />
                )}
              </div>
              <span className="text-caption text-ink-faint">
                {formatMonthLabel(point.month, locale)}
              </span>
            </div>
          );
        })}
      </div>

      {shortfallMonths.length > 0 && (
        <p className="text-caption text-ink-dim" data-testid="savings-capacity-shortfall-note">
          {t("financialHealth.savings.shortfallCaption", {
            count: shortfallMonths.length,
            months: shortfallMonths
              .map((p) => formatMonthLabel(p.month, locale))
              .join(", "),
          })}
        </p>
      )}

      <div className="sr-only">
        <Table>
          <caption>{t("financialHealth.savings.chartTableCaption")}</caption>
          <TableHeader>
            <TableRow>
              <TableHead>{t("financialHealth.savings.chartColMonth")}</TableHead>
              <TableHead>{t("financialHealth.savings.chartColLeftOver")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((point) => (
              <TableRow key={point.month}>
                <TableCell>{formatMonthLabel(point.month, locale)}</TableCell>
                <TableCell>
                  <Money
                    cents={point.surplus_cents}
                    locale={locale}
                    sign="always"
                    masked={hidden}
                    maskedLabel={amountHidden}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// Rank order, largest first — never pinned to a category identity.
const rankDotColor = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-3",
  "bg-chart-4",
  "bg-chart-5",
  "bg-chart-6",
  "bg-chart-7",
  "bg-chart-8",
] as const;

export function SavingsCapacityPanel() {
  const { t, i18n } = useTranslation();
  const { hidden } = useValuesHidden();
  const { data, isPending } = useFinancialHealthDetail();

  if (isPending) {
    return <SavingsCapacityPanelSkeleton />;
  }

  if (!data?.data_sufficient) {
    return null;
  }

  const savings = data.savings;
  const figures = data.figures;
  const savingsRatePercent = savings?.savings_rate_percent;
  const hasIncome = savingsRatePercent != null;
  const surplusCents = savings?.avg_monthly_surplus_cents ?? 0;
  const isDeficit = hasIncome && surplusCents < 0;
  const hasTrendData =
    figures.expense_month_count >= 1 && data.monthly_surplus_trend.length > 0;
  const categories = data.top_discretionary_categories;

  const amountHidden = t("common.amountHidden");
  const money = (cents: number) =>
    hidden ? amountHidden : formatMoney({ cents, locale: i18n.language });

  return (
    <Card data-testid="savings-capacity-panel">
      <CardHeader>
        <CardTitle>{t("financialHealth.savings.title")}</CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {hasIncome ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <span className="text-caption text-ink-dim">
                {t("financialHealth.savings.rateLabel")}
              </span>
              <MetricInfoTooltip
                ariaLabel={t("financialHealth.panel.savingsCapacity.rateInfoAria")}
                content={t("financialHealth.savings.rateInfoPlain")}
                testId="savings-rate-info"
              />
            </div>
            <SubStat
              value={`${Math.round(savingsRatePercent)}%`}
              caption={
                isDeficit
                  ? t("financialHealth.savings.deficitCaption", {
                      surplus: money(Math.abs(surplusCents)),
                    })
                  : t("financialHealth.savings.rateCaption", {
                      surplus: money(surplusCents),
                    })
              }
              data-testid="savings-capacity-rate"
            />
          </div>
        ) : (
          <p className="text-body text-ink-dim" data-testid="savings-capacity-no-income">
            {t("financialHealth.panel.savingsCapacity.noIncome")}
          </p>
        )}

        {hasTrendData ? (
          <SurplusTrendChart
            data={data.monthly_surplus_trend}
            locale={i18n.language}
            hidden={hidden}
            amountHidden={amountHidden}
          />
        ) : (
          <p className="text-body text-ink-dim" data-testid="savings-capacity-trend-empty">
            {t("financialHealth.panel.savingsCapacity.trendEmpty")}
          </p>
        )}

        <div className="flex flex-col gap-2">
          <h3 className="text-h3 text-ink">
            {t("financialHealth.savings.findMoneyTitle")}
          </h3>
          <p className="text-caption text-ink-dim">
            {t("financialHealth.savings.findMoneySubtitle", {
              months: figures.expense_month_count,
            })}
          </p>

          {categories.length > 0 ? (
            <ul className="flex flex-col" data-testid="savings-capacity-categories">
              {categories.map((cat, index) => (
                <li
                  key={cat.category_id}
                  className="flex items-center gap-2.5 border-b border-line py-2 last:border-b-0"
                  data-testid={`savings-capacity-category-${cat.category_id}`}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-[7px] shrink-0 rounded-full",
                      rankDotColor[index % rankDotColor.length],
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-caption text-ink">
                    {cat.category_name}
                  </span>
                  <span className="money text-caption text-ink-dim">
                    {t("financialHealth.savings.amountPerMonth", {
                      amount: money(cat.avg_monthly_spend_cents),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p
              className="text-body text-ink-dim"
              data-testid="savings-capacity-categories-empty"
            >
              {t("financialHealth.panel.savingsCapacity.discretionaryEmpty")}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
