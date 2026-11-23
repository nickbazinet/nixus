import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { TagIcon } from "lucide-react";
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
  rampColor,
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

  // Swatch colours follow each category's rank by spend across the WHOLE window, so re-sorting the
  // table or switching cost group never repaints a category a different colour.
  const colorByCategoryId = useMemo(() => {
    const ranked = [...categoryCompare].sort((a, b) => b.avg_cents - a.avg_cents);
    return new Map(
      ranked.map((row, rank) => [row.category_id, rampColor(rank)] as const),
    );
  }, [categoryCompare]);

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
          <CardTitle icon={TagIcon}>
            {t("spendingTrends.avgSpendByCategory")}
          </CardTitle>
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
        <CardTitle icon={TagIcon}>
          {t("spendingTrends.avgSpendByCategory")}
        </CardTitle>
        <CardDescription className="pl-13">
          {t("insights.avgOverMonths", { months: monthCount })}
        </CardDescription>
      </CardHeader>
      <div className="px-card-pad pt-4">
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
        <Table className="mt-4 [&_tbody_tr:last-child>td]:border-b-0 [&_td:first-child]:pl-card-pad [&_td:last-child]:pr-card-pad [&_th:first-child]:pl-card-pad [&_th:last-child]:pr-card-pad">
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
                <TableCell>
                  <span className="flex items-center gap-2.5">
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full"
                      style={{
                        background:
                          colorByCategoryId.get(row.category_id) ?? rampColor(0),
                      }}
                    />
                    <span className="font-semibold text-ink">
                      {row.category_name}
                    </span>
                  </span>
                </TableCell>
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
                <TableCell numeric>
                  <DeltaCell deltaPct={row.delta_pct} />
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

/**
 * Over target is the charte's `over` ink with a ▲, under it the `good` ink with a ▼ — and the
 * glyph sits OUTSIDE the figure so the percentage reads as a percentage on its own.
 */
function DeltaCell({ deltaPct }: { deltaPct: number | null }) {
  const { t } = useTranslation();

  if (deltaPct === null) {
    return <span className="text-ink-dim">{"\u2014"}</span>;
  }

  const tone =
    deltaPct > 0 ? "text-over-ink" : deltaPct < 0 ? "text-good-ink" : "text-ink-dim";
  const glyph = deltaPct > 0 ? "\u25B2" : deltaPct < 0 ? "\u25BC" : "\u2022";

  return (
    <span className={`inline-flex items-baseline gap-1 ${tone}`}>
      <span aria-hidden="true" className="text-[10px] leading-none">
        {glyph}
      </span>
      <span data-testid="category-delta">
        {t("insights.deltaPercent", {
          sign: deltaPct > 0 ? "+" : "",
          percent: deltaPct,
        })}
      </span>
    </span>
  );
}
