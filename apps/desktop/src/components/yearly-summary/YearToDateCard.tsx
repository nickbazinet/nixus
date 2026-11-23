import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRightIcon, CalendarRange } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  MaskedFigure,
  Money,
  Skeleton,
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

/** A label over a figure. Two of these side by side is the whole year in one glance. */
function YearFigure({
  label,
  value,
  tone,
  caption,
  "data-testid": testId,
}: {
  label: string;
  value: string;
  tone?: "good";
  caption?: string;
  "data-testid"?: string;
}) {
  const { maskProps } = useValuesHidden();

  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid={testId}>
      <span className="text-caption text-ink-dim">{label}</span>
      {maskProps.masked ? (
        <MaskedFigure
          value={value}
          label={maskProps.maskedLabel}
          className="text-stat text-ink"
        />
      ) : (
        <span className={cn("money text-stat", tone === "good" ? "text-good-ink" : "text-ink")}>
          {value}
        </span>
      )}
      {caption && <span className="text-caption text-ink-dim">{caption}</span>}
    </div>
  );
}

export function YearToDateCard({ data, isLoading }: YearToDateCardProps) {
  const { t, i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);
  const year = data?.year ?? new Date().getFullYear();

  if (isLoading) {
    return (
      <Card data-testid="ytd-card-skeleton">
        <CardHeader>
          <CardTitle icon={CalendarRange}>{t("yearSummary.v2.soFar", { year })}</CardTitle>
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
          <CardTitle icon={CalendarRange}>{t("yearSummary.v2.soFar", { year })}</CardTitle>
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
        <CardTitle icon={CalendarRange}>{t("yearSummary.v2.soFar", { year })}</CardTitle>
      </CardHeader>

      <CardContent className="grid grid-cols-1 gap-grid-gap sm:grid-cols-2">
        <YearFigure
          label={t("yearSummary.spent")}
          value={formatMoney({ cents: data.total_spent_cents, locale })}
          data-testid="ytd-spent"
        />
        {gainAvailable && gainCents !== null ? (
          <YearFigure
            label={t("yearSummary.gained")}
            value={formatMoney({ cents: gainCents, locale, sign: "always" })}
            tone={gainCents >= 0 ? "good" : undefined}
            data-testid="ytd-gain"
          />
        ) : (
          <YearFigure
            label={t("yearSummary.gained")}
            value={"\u2014"}
            caption={t("yearSummary.noGainData")}
            data-testid="ytd-gain-unavailable"
          />
        )}
      </CardContent>

      <CardContent className="border-t border-line pt-4">
        <span className="text-caption text-ink-dim">{t("yearSummary.topCategories")}</span>
        <ul className="mt-2" data-testid="ytd-top-categories">
          {data.top_categories.slice(0, 5).map((category) => (
            <li
              key={category.category_id}
              className="flex items-baseline justify-between gap-3 border-b border-line py-2 text-caption last:border-b-0"
            >
              <span className="min-w-0 truncate text-ink">{category.category_name}</span>
              <Money
                cents={category.spent_cents}
                locale={locale}
                className="shrink-0 font-bold text-ink"
                {...maskProps}
              />
            </li>
          ))}
        </ul>
        <ViewFullLine label={t("yearSummary.viewFull")} className="mt-4" />
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
