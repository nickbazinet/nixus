import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
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
  CHART_RAMP_LENGTH,
  SEGMENT_DIVIDER,
  filterByCostGroup,
  insightsLocale,
  rampColor,
  type CostGroup,
} from "@/components/spending-trends/insights-chart";
import { CostGroupTabs } from "@/components/spending-trends/CostGroupTabs";
import type { YearlyCategorySpend } from "@/lib/types";

interface YearlyCategoryTableProps {
  data: YearlyCategorySpend[];
  isLoading?: boolean;
}

interface Segment {
  key: string;
  name: string;
  cents: number;
  sharePct: number;
  color: string;
  isRemainder: boolean;
}

type SortColumn = "category" | "spent";

const FALLBACK_SKELETON_ROWS = 5;

/** Ranks beyond this collapse into one final segment, so the ramp never wraps past eight steps. */
const NAMED_SEGMENT_LIMIT = CHART_RAMP_LENGTH - 1;

export function YearlyCategoryTable({
  data,
  isLoading,
}: YearlyCategoryTableProps) {
  const { t, i18n } = useTranslation();
  const { maskProps } = useValuesHidden();
  const locale = insightsLocale(i18n.language);
  const [costGroup, setCostGroup] = useState<CostGroup>("all");
  const [sortColumn, setSortColumn] = useState<SortColumn>("spent");
  const [sortDirection, setSortDirection] =
    useState<Exclude<SortDirection, "none">>("descending");

  const segments = useMemo(
    () => buildSegments(filterByCostGroup(data, costGroup), t("insights.everythingElse")),
    [data, costGroup, t],
  );

  const rows = useMemo(() => {
    const sorted = [...segments];
    sorted.sort((a, b) =>
      sortColumn === "category"
        ? a.name.localeCompare(b.name)
        : a.cents - b.cents,
    );
    return sortDirection === "descending" ? sorted.reverse() : sorted;
  }, [segments, sortColumn, sortDirection]);

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
      <Card data-testid="yearly-category-table">
        <CardHeader>
          <CardTitle>{t("yearSummary.categories")}</CardTitle>
        </CardHeader>
        <div className="px-card-pad">
          <Skeleton rows={data.length || FALLBACK_SKELETON_ROWS} />
        </div>
      </Card>
    );
  }

  return (
    <Card flush data-testid="yearly-category-table">
      <CardHeader className="pt-card-pad">
        <CardTitle>{t("yearSummary.categories")}</CardTitle>
        <CardDescription>{t("insights.shareOfSpendingHint")}</CardDescription>
      </CardHeader>
      <div className="px-card-pad pt-3">
        <CostGroupTabs
          value={costGroup}
          onChange={setCostGroup}
          testId="yearly-cost-group"
        />
        {costGroup === "all" ? null : (
          <p className="mt-2 text-caption text-ink-faint">
            {t("insights.costGroupBasis")}
          </p>
        )}
      </div>

      {segments.length === 0 ? (
        <EmptyState
          title={t("insights.noCategoriesTitle")}
          description={
            costGroup === "all"
              ? t("yearSummary.noData")
              : t("insights.noCategoriesInGroup")
          }
        />
      ) : (
        <>
          <AllocationBar segments={segments} />
          <Table className="mt-4 [&_tbody_tr:last-child>td]:border-b-0">
            <TableHeader>
              <TableRow>
                <TableHead
                  sortable
                  sortDirection={directionFor("category")}
                  onSort={() => sortBy("category")}
                >
                  {t("spendingTrends.colCategory")}
                </TableHead>
                <TableHead numeric>{t("insights.colShare")}</TableHead>
                <TableHead
                  numeric
                  sortable
                  sortDirection={directionFor("spent")}
                  onSort={() => sortBy("spent")}
                >
                  {t("insights.chartColSpent")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((segment) => (
                <TableRow key={segment.key} data-testid="yearly-category-row">
                  <TableCell>
                    <span className="flex items-center gap-2">
                      {/* The swatch is the direct label that replaces a legend: above five
                       * segments a legend the user has to cross-reference is a failure. */}
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ background: segment.color }}
                      />
                      {segment.name}
                    </span>
                  </TableCell>
                  <TableCell numeric dim>
                    {t("insights.percentOfSpending", {
                      percent: segment.sharePct,
                    })}
                  </TableCell>
                  <TableCell numeric>
                    <Money
                      cents={segment.cents}
                      locale={locale}
                      {...maskProps}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {segments.some((segment) => segment.isRemainder) ? (
            <p className="px-card-pad pb-card-pad pt-3 text-caption text-ink-faint">
              {t("insights.everythingElseNote")}
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}

/**
 * Rank-ordered allocation bar. The 1px `--card` gap between segments is what guarantees a
 * perceivable boundary: `--chart-3` and `--chart-7` sit at exactly 1.00:1 to each other, so hue
 * alone cannot be relied on when they land side by side.
 */
function AllocationBar({ segments }: { segments: readonly Segment[] }) {
  return (
    <div
      aria-hidden="true"
      className="mx-card-pad mt-4 flex h-[26px] overflow-hidden rounded-sm"
      style={{ gap: "1px", background: SEGMENT_DIVIDER }}
    >
      {segments.map((segment) => (
        <span
          key={segment.key}
          data-chart-segment=""
          className="block"
          style={{
            flexGrow: Math.max(segment.cents, 1),
            flexBasis: 0,
            background: segment.color,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Colours follow RANK, largest first — never a category's identity, so a category does not keep
 * "its" colour when its rank changes between years. Everything past the seventh rank collapses into
 * the eighth segment rather than wrapping the ramp.
 */
function buildSegments(
  categories: readonly YearlyCategorySpend[],
  remainderLabel: string,
): Segment[] {
  const spending = categories.filter((row) => row.spent_cents > 0);
  if (spending.length === 0) return [];

  const ranked = [...spending].sort((a, b) => b.spent_cents - a.spent_cents);
  const total = ranked.reduce((sum, row) => sum + row.spent_cents, 0);
  const share = (cents: number) =>
    total > 0 ? Math.round((cents / total) * 100) : 0;

  const named = ranked.slice(0, NAMED_SEGMENT_LIMIT).map((row, rank) => ({
    key: String(row.category_id),
    name: row.category_name,
    cents: row.spent_cents,
    sharePct: share(row.spent_cents),
    color: rampColor(rank),
    isRemainder: false,
  }));

  const rest = ranked.slice(NAMED_SEGMENT_LIMIT);
  if (rest.length === 0) return named;

  const restCents = rest.reduce((sum, row) => sum + row.spent_cents, 0);
  return [
    ...named,
    {
      key: "remainder",
      name: remainderLabel,
      cents: restCents,
      sharePct: share(restCents),
      color: rampColor(NAMED_SEGMENT_LIMIT),
      isRemainder: true,
    },
  ];
}
