import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRightIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Money,
  Skeleton,
  SubStat,
  formatMoney,
} from "@nixus/shared";
import { cn } from "@/lib/utils";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { insightsLocale } from "@/components/spending-trends/insights-chart";
import type { YearlySummaryData } from "@/lib/types";

interface YearToDateCardProps {
  data?: YearlySummaryData;
  isLoading?: boolean;
}

/** Spent, gained, top categories. */
const YTD_SKELETON_ROWS = 3;

export function YearToDateCard({ data, isLoading }: YearToDateCardProps) {
  const { t, i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);
  const year = data?.year ?? new Date().getFullYear();

  if (isLoading) {
    return (
      <Card data-testid="ytd-card-skeleton">
        <CardHeader>
          <CardTitle>{t("yearSummary.ytd", { year })}</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton rows={YTD_SKELETON_ROWS} />
        </CardContent>
      </Card>
    );
  }

  const hasExpenses = (data?.total_spent_cents ?? 0) > 0;

  // The whole card is one focusable link with one accessible name — never a card with competing
  // inner click targets.
  if (!hasExpenses || !data) {
    return (
      <Card
        interactive
        render={<Link to="/insights/year-summary" />}
        data-testid="ytd-card-empty"
      >
        <CardHeader>
          <CardTitle>{t("yearSummary.ytd", { year })}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-caption text-ink-dim">{t("yearSummary.noData")}</p>
          <ViewFullLine label={t("yearSummary.viewFull")} className="mt-3" />
        </CardContent>
      </Card>
    );
  }

  const gainCents = data.net_worth_gain_cents;
  const gainAvailable = data.net_worth_gain_available;

  return (
    <Card
      interactive
      render={<Link to="/insights/year-summary" />}
      data-testid="ytd-card"
    >
      <CardHeader>
        <CardTitle>{t("yearSummary.ytd", { year })}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-grid-gap sm:grid-cols-3">
        <SubStat
          label={t("yearSummary.spent")}
          value={formatMoney({ cents: data.total_spent_cents, locale })}
          {...maskProps}
          data-testid="ytd-spent"
        />
        {gainAvailable && gainCents !== null ? (
          <SubStat
            label={t("yearSummary.gained")}
            value={formatMoney({ cents: gainCents, locale, sign: "always" })}
            {...maskProps}
            data-testid="ytd-gain"
          />
        ) : (
          <SubStat
            label={t("yearSummary.gained")}
            value={"\u2014"}
            caption={t("yearSummary.noGainData")}
            data-testid="ytd-gain-unavailable"
          />
        )}
        <div>
          <span className="text-caption text-ink-dim">
            {t("yearSummary.topCategories")}
          </span>
          <ul className="mt-1.5 space-y-1" data-testid="ytd-top-categories">
            {data.top_categories.map((category) => (
              <li
                key={category.category_id}
                className="flex justify-between gap-2 text-caption"
              >
                <span className="truncate text-ink">
                  {category.category_name}
                </span>
                <Money
                  cents={category.spent_cents}
                  locale={locale}
                  className="shrink-0 text-ink-dim"
                  {...maskProps}
                />
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
      <CardContent>
        <ViewFullLine label={t("yearSummary.viewFull")} />
      </CardContent>
    </Card>
  );
}

function ViewFullLine({ label, className }: { label: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-label text-brand-ink", className)}>
      {label}
      <ArrowRightIcon className="size-3.5" aria-hidden="true" />
    </span>
  );
}
