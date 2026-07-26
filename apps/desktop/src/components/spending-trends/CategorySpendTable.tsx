import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle, Badge } from "@nixus/shared";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import type { CategoryCompareRow } from "@/lib/types";

interface CategorySpendTableProps {
  categoryCompare: CategoryCompareRow[];
  monthCount: number;
  isLoading?: boolean;
}

function statusBadge(
  status: CategoryCompareRow["status"],
  t: (key: string) => string,
): { label: string; className: string } {
  switch (status) {
    case "under":
      return {
        label: t("spendingTrends.statusUnder"),
        className: "bg-emerald-500/10 text-emerald-600 border-transparent",
      };
    case "on_track":
      return {
        label: t("spendingTrends.statusOnTrack"),
        className: "bg-sky-500/10 text-sky-600 border-transparent",
      };
    case "over":
      return {
        label: t("spendingTrends.statusOver"),
        className: "bg-rose-500/10 text-rose-600 border-transparent",
      };
    default:
      return {
        label: t("spendingTrends.statusNoTarget"),
        className: "bg-muted text-muted-foreground border-transparent",
      };
  }
}

function formatDelta(deltaPct: number | null): string {
  if (deltaPct === null) return "—";
  const sign = deltaPct > 0 ? "+" : "";
  return `${sign}${deltaPct}%`;
}

export function CategorySpendTable({
  categoryCompare,
  monthCount,
  isLoading,
}: CategorySpendTableProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();

  if (isLoading) {
    return (
      <Card className="shadow-sm rounded-lg" data-testid="category-spend-table">
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

  return (
    <Card className="shadow-sm rounded-lg" data-testid="category-spend-table">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">
          {t("spendingTrends.avgSpendByCategory")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("spendingTrends.last")} {monthCount} {t("spendingTrends.months")}
        </p>
      </CardHeader>
      <CardContent className="p-6 pt-2">
        {categoryCompare.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("spendingTrends.noDataShort")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">{t("spendingTrends.colCategory")}</th>
                  <th className="pb-2 pr-4 font-medium text-right">{t("spendingTrends.colAvg")}</th>
                  <th className="pb-2 pr-4 font-medium text-right">{t("spendingTrends.colTarget")}</th>
                  <th className="pb-2 pr-4 font-medium text-right">{t("spendingTrends.colDelta")}</th>
                  <th className="pb-2 font-medium text-right">{t("spendingTrends.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {categoryCompare.map((row) => {
                  const badge = statusBadge(row.status, t);
                  return (
                    <tr
                      key={row.category_id}
                      className="border-b last:border-0"
                      data-testid="category-compare-row"
                    >
                      <td className="py-2 pr-4">{row.category_name}</td>
                      <td className="py-2 pr-4 text-right font-mono">
                        {formatCurrency(row.avg_cents)}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono">
                        {row.target_cents != null && row.target_cents > 0
                          ? formatCurrency(row.target_cents)
                          : "—"}
                      </td>
                      <td
                        className="py-2 pr-4 text-right font-mono"
                        data-testid="category-delta"
                      >
                        {formatDelta(row.delta_pct)}
                      </td>
                      <td className="py-2 text-right">
                        <Badge className={badge.className} data-testid="category-status-badge">
                          {badge.label}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
