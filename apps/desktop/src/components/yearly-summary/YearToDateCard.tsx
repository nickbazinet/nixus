import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@nixus/shared";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import type { YearlySummaryData } from "@/lib/types";

interface YearToDateCardProps {
  data?: YearlySummaryData;
  isLoading?: boolean;
}

export function YearToDateCard({ data, isLoading }: YearToDateCardProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const year = data?.year ?? new Date().getFullYear();

  if (isLoading) {
    return (
      <Card className="shadow-sm rounded-lg" data-testid="ytd-card-skeleton">
        <CardContent className="p-6">
          <div className="h-5 w-40 bg-muted animate-pulse rounded mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const hasExpenses = (data?.total_spent_cents ?? 0) > 0;

  if (!hasExpenses) {
    return (
      <Link to="/year-summary" className="block">
        <Card
          className="shadow-sm rounded-lg hover:ring-1 hover:ring-primary/20 transition-all cursor-pointer"
          data-testid="ytd-card-empty"
          role="link"
        >
          <CardContent className="p-6 text-center">
            <p className="text-sm font-medium text-muted-foreground mb-1">
              {t("yearSummary.ytd", { year })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("yearSummary.noData")}
            </p>
            <p className="text-xs text-primary mt-2">{t("yearSummary.viewFull")}</p>
          </CardContent>
        </Card>
      </Link>
    );
  }

  const gainCents = data?.net_worth_gain_cents ?? null;
  const gainAvailable = data?.net_worth_gain_available ?? false;
  const gainPositive = gainAvailable && gainCents !== null && gainCents >= 0;

  return (
    <Link to="/year-summary" className="block">
      <Card
        className="shadow-sm rounded-lg hover:ring-1 hover:ring-primary/20 transition-all cursor-pointer"
        data-testid="ytd-card"
        role="link"
      >
        <CardContent className="p-6">
          <p className="text-sm font-medium text-muted-foreground mb-4">
            {t("yearSummary.ytd", { year })}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <span className="text-xs text-muted-foreground">
                {t("yearSummary.spent")}
              </span>
              <p
                className="text-lg font-mono font-medium text-rose-500"
                data-testid="ytd-spent"
              >
                {formatCurrency(data!.total_spent_cents)}
              </p>
            </div>

            <div>
              <span className="text-xs text-muted-foreground">
                {t("yearSummary.gained")}
              </span>
              {gainAvailable && gainCents !== null ? (
                <p
                  className={`text-lg font-mono font-medium ${
                    gainPositive
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-500"
                  }`}
                  data-testid="ytd-gain"
                >
                  {gainPositive ? "+" : ""}
                  {formatCurrency(gainCents)}
                </p>
              ) : (
                <p
                  className="text-lg font-mono font-medium text-muted-foreground"
                  title={t("yearSummary.noGainData")}
                  data-testid="ytd-gain-unavailable"
                >
                  —
                </p>
              )}
            </div>

            <div>
              <span className="text-xs text-muted-foreground">
                {t("yearSummary.topCategories")}
              </span>
              <ul className="mt-1 space-y-0.5" data-testid="ytd-top-categories">
                {data!.top_categories.map((cat) => (
                  <li
                    key={cat.category_id}
                    className="text-sm flex justify-between gap-2"
                  >
                    <span className="truncate">{cat.category_name}</span>
                    <span className="font-mono text-muted-foreground shrink-0">
                      {formatCurrency(cat.spent_cents)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="text-xs text-primary mt-4">{t("yearSummary.viewFull")}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
