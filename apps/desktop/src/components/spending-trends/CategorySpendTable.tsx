import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@nkbaz/shared";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import type { MonthlySpendByCategory } from "@/lib/types";

interface CategorySpendTableProps {
  data: MonthlySpendByCategory[];
  monthCount: number;
  isLoading?: boolean;
}

interface CategoryAverage {
  categoryName: string;
  avgCents: number;
}

function computeAverages(
  data: MonthlySpendByCategory[],
  monthCount: number,
): CategoryAverage[] {
  const totals = new Map<string, { name: string; total: number }>();

  for (const row of data) {
    const existing = totals.get(String(row.category_id));
    if (existing) {
      existing.total += row.spent_cents;
    } else {
      totals.set(String(row.category_id), {
        name: row.category_name,
        total: row.spent_cents,
      });
    }
  }

  const divisor = Math.max(monthCount, 1);
  return Array.from(totals.values())
    .map((c) => ({
      categoryName: c.name,
      avgCents: Math.round(c.total / divisor),
    }))
    .sort((a, b) => b.avgCents - a.avgCents);
}

export function CategorySpendTable({
  data,
  monthCount,
  isLoading,
}: CategorySpendTableProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();

  if (isLoading) {
    return (
      <Card className="shadow-sm rounded-lg">
        <CardContent className="p-6">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 bg-muted animate-pulse rounded" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const averages = computeAverages(data, monthCount);
  const maxAvg = averages.length > 0 ? averages[0].avgCents : 1;

  return (
    <Card className="shadow-sm rounded-lg">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">
          {t("spendingTrends.avgSpendByCategory")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("spendingTrends.last")} {monthCount} {t("spendingTrends.months")}
        </p>
      </CardHeader>
      <CardContent className="p-6 pt-2">
        {averages.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("spendingTrends.noDataShort")}</p>
        ) : (
          <div className="space-y-3">
            {averages.map((cat) => {
              const pct = maxAvg > 0 ? (cat.avgCents / maxAvg) * 100 : 0;
              return (
                <div key={cat.categoryName} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate">{cat.categoryName}</span>
                    <span className="font-mono text-muted-foreground ml-2 shrink-0">
                      {formatCurrency(cat.avgCents)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
