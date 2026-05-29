import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@nixus/shared";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import type { YearlyCategorySpend } from "@/lib/types";

interface YearlyCategoryTableProps {
  data: YearlyCategorySpend[];
  isLoading?: boolean;
}

export function YearlyCategoryTable({ data, isLoading }: YearlyCategoryTableProps) {
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

  const maxSpent = data.length > 0 ? data[0].spent_cents : 1;

  return (
    <Card className="shadow-sm rounded-lg" data-testid="yearly-category-table">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">
          {t("yearSummary.categories")}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 pt-2">
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("yearSummary.noData")}</p>
        ) : (
          <div className="space-y-3">
            {data.map((cat) => {
              const pct = maxSpent > 0 ? (cat.spent_cents / maxSpent) * 100 : 0;
              return (
                <div key={cat.category_id} className="space-y-1" data-testid="yearly-category-row">
                  <div className="flex items-center justify-between text-sm">
                    <span className="truncate">{cat.category_name}</span>
                    <span className="font-mono text-muted-foreground ml-2 shrink-0">
                      {formatCurrency(cat.spent_cents)}
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
