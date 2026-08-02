import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Money,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@nixus/shared";
import type { SortDirection } from "@nixus/shared";
import { useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import {
  filterByCostGroup,
  insightsLocale,
  type CostGroup,
} from "./insights-chart";
import { CostGroupTabs } from "./CostGroupTabs";
import type { CategoryCompareRow } from "@/lib/types";

interface CategorySpendTableProps {
  categoryCompare: CategoryCompareRow[];
  monthCount: number;
  isLoading?: boolean;
}

type SortColumn = "category" | "avg" | "target" | "delta";

const STATUS_VARIANT: Record<
  CategoryCompareRow["status"],
  "good" | "over" | "neutral"
> = {
  // `brand` is not "on track", so on_track joins under in the `good` family. A category with no
  // target is not a verdict at all and stays neutral. The label always renders beside the colour.
  under: "good",
  on_track: "good",
  over: "over",
  no_target: "neutral",
};

const STATUS_LABEL_KEYS: Record<CategoryCompareRow["status"], string> = {
  under: "spendingTrends.statusUnder",
  on_track: "spendingTrends.statusOnTrack",
  over: "spendingTrends.statusOver",
  no_target: "spendingTrends.statusNoTarget",
};

/** Rows shown while loading when there is no previous count to match. */
const FALLBACK_SKELETON_ROWS = 5;

function compareRows(
  a: CategoryCompareRow,
  b: CategoryCompareRow,
  column: SortColumn,
): number {
  switch (column) {
    case "category":
      return a.category_name.localeCompare(b.category_name);
    case "target":
      return (a.target_cents ?? -1) - (b.target_cents ?? -1);
    case "delta":
      // A category with no target has no delta; park those at one end rather than treating a
      // missing value as zero, which would read as "exactly on target".
      return (
        (a.delta_pct ?? Number.NEGATIVE_INFINITY) -
        (b.delta_pct ?? Number.NEGATIVE_INFINITY)
      );
    default:
      return a.avg_cents - b.avg_cents;
  }
}

export function CategorySpendTable({
  categoryCompare,
  monthCount,
  isLoading,
}: CategorySpendTableProps) {
  const { t, i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);
  const [costGroup, setCostGroup] = useState<CostGroup>("all");
  const [sortColumn, setSortColumn] = useState<SortColumn>("avg");
  const [sortDirection, setSortDirection] =
    useState<Exclude<SortDirection, "none">>("descending");

  const rows = useMemo(() => {
    const filtered = filterByCostGroup(categoryCompare, costGroup);
    filtered.sort((a, b) => compareRows(a, b, sortColumn));
    return sortDirection === "descending" ? filtered.reverse() : filtered;
  }, [categoryCompare, costGroup, sortColumn, sortDirection]);

  function sortBy(column: SortColumn) {
    if (column === sortColumn) {
      setSortDirection((current) =>
        current === "ascending" ? "descending" : "ascending",
      );
      return;
    }
    setSortColumn(column);
    setSortDirection(column === "category" ? "ascending" : "descending");
  }

  function directionFor(column: SortColumn): SortDirection {
    return column === sortColumn ? sortDirection : "none";
  }

  if (isLoading) {
    return (
      <Card data-testid="category-spend-table">
        <CardHeader>
          <CardTitle>{t("spendingTrends.avgSpendByCategory")}</CardTitle>
        </CardHeader>
        <div className="px-card-pad">
          <Skeleton rows={categoryCompare.length || FALLBACK_SKELETON_ROWS} />
        </div>
      </Card>
    );
  }

  return (
    <Card flush data-testid="category-spend-table">
      <CardHeader className="pt-card-pad">
        <CardTitle>{t("spendingTrends.avgSpendByCategory")}</CardTitle>
        <CardDescription>
          {t("insights.avgOverMonths", { months: monthCount })}
        </CardDescription>
      </CardHeader>
      <div className="px-card-pad pt-3">
        <CostGroupTabs
          value={costGroup}
          onChange={setCostGroup}
          testId="category-cost-group"
        />
        {costGroup === "all" ? null : (
          <p className="mt-2 text-caption text-ink-faint">
            {t("insights.costGroupBasis")}
          </p>
        )}
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title={t("insights.noCategoriesTitle")}
          description={
            costGroup === "all"
              ? t("spendingTrends.noData")
              : t("insights.noCategoriesInGroup")
          }
        />
      ) : (
        <Table className="mt-3 [&_tbody_tr:last-child>td]:border-b-0">
          <TableHeader>
            <TableRow>
              <TableHead
                sortable
                sortDirection={directionFor("category")}
                onSort={() => sortBy("category")}
              >
                {t("spendingTrends.colCategory")}
              </TableHead>
              <TableHead
                numeric
                sortable
                sortDirection={directionFor("avg")}
                onSort={() => sortBy("avg")}
              >
                {t("spendingTrends.colAvg")}
              </TableHead>
              <TableHead
                numeric
                sortable
                sortDirection={directionFor("target")}
                onSort={() => sortBy("target")}
              >
                {t("spendingTrends.colTarget")}
              </TableHead>
              <TableHead
                numeric
                sortable
                sortDirection={directionFor("delta")}
                onSort={() => sortBy("delta")}
              >
                {t("spendingTrends.colDelta")}
              </TableHead>
              <TableHead>{t("spendingTrends.colStatus")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.category_id}
                data-testid="category-compare-row"
              >
                <TableCell>{row.category_name}</TableCell>
                <TableCell numeric>
                  <Money cents={row.avg_cents} locale={locale} {...maskProps} />
                </TableCell>
                <TableCell numeric>
                  {row.target_cents != null && row.target_cents > 0 ? (
                    <Money
                      cents={row.target_cents}
                      locale={locale}
                      {...maskProps}
                    />
                  ) : (
                    <span className="text-ink-dim">{"\u2014"}</span>
                  )}
                </TableCell>
                <TableCell numeric dim data-testid="category-delta">
                  {row.delta_pct === null
                    ? "\u2014"
                    : t("insights.deltaPercent", {
                        sign: row.delta_pct > 0 ? "+" : "",
                        percent: row.delta_pct,
                      })}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={STATUS_VARIANT[row.status]}
                    data-testid="category-status-badge"
                  >
                    {t(STATUS_LABEL_KEYS[row.status])}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
