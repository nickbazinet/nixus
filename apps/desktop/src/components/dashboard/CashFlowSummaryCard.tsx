import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@nkbaz/shared";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";

interface CashFlowSummaryCardProps {
  incomeCents: number;
  expensesCents: number;
  isLoading?: boolean;
}

export function CashFlowSummaryCard({
  incomeCents,
  expensesCents,
  isLoading,
}: CashFlowSummaryCardProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const netCents = incomeCents - expensesCents;
  const ratio = incomeCents > 0 ? (expensesCents / incomeCents) * 100 : 0;

  if (isLoading) {
    return (
      <Card className="shadow-sm rounded-lg col-span-full">
        <CardContent className="p-6">
          <div className="h-5 w-24 bg-muted animate-pulse rounded mb-3" />
          <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        </CardContent>
      </Card>
    );
  }

  if (incomeCents === 0) {
    return (
      <Link to="/income" className="col-span-full">
        <Card
          className="shadow-sm rounded-lg hover:ring-1 hover:ring-primary/20 transition-all cursor-pointer"
          role="link"
          aria-label="No income recorded this month. Go to Income page to record income."
        >
          <CardContent className="p-6 text-center">
            <p className="text-sm text-muted-foreground">
              {t("dashboard.noIncomeThisMonth")}
            </p>
            <p className="text-xs text-primary mt-1">
              {t("dashboard.recordIncome")}
            </p>
          </CardContent>
        </Card>
      </Link>
    );
  }

  const progressColor =
    ratio > 100 ? "bg-rose-500" : ratio >= 90 ? "bg-amber-500" : "bg-emerald-500";

  const ariaLabel = `Cash Flow: ${formatCurrency(incomeCents)} income, ${formatCurrency(expensesCents)} expenses, net ${netCents >= 0 ? "positive" : "negative"} ${formatCurrency(Math.abs(netCents))}`;

  return (
    <Link to="/income" className="col-span-full">
      <Card
        className="shadow-sm rounded-lg hover:ring-1 hover:ring-primary/20 transition-all cursor-pointer"
        role="link"
        aria-label={ariaLabel}
      >
        <CardContent className="p-6">
          <p className="text-sm font-medium text-muted-foreground mb-3">
            {t("dashboard.cashFlow")}
          </p>
          <div className="flex items-baseline gap-6">
            <div>
              <span className="text-xs text-muted-foreground">{t("dashboard.income")}</span>
              <p className="text-lg font-mono font-medium text-emerald-600 dark:text-emerald-400">
                {formatCurrency(incomeCents)}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">{t("dashboard.expenses")}</span>
              <p className="text-lg font-mono font-medium text-rose-500">
                {formatCurrency(expensesCents)}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">{t("dashboard.net")}</span>
              <p
                className={`text-lg font-mono font-medium ${
                  netCents >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-rose-500"
                }`}
              >
                {formatCurrency(netCents)}
              </p>
            </div>
          </div>
          <div
            className="h-2 w-full rounded-full bg-muted mt-3"
            role="progressbar"
            aria-valuenow={Math.min(ratio, 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`h-full rounded-full transition-all ${progressColor}`}
              style={{ width: `${Math.min(ratio, 100)}%` }}
            />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
