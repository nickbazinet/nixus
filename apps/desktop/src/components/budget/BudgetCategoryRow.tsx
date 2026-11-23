import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ChevronDown, ChevronRight, GripVertical, PiggyBank, Trash2 } from "lucide-react";
import { Badge, Button, Meter, Money } from "@nixus/shared";
import { ExpenseList } from "@/components/expenses/ExpenseList";
import { MetricInfoTooltip } from "@/components/financial-health/MetricInfoTooltip";
import { InlineEditText, InlineEditMoney } from "@/components/shared/InlineEdit";
import { rampColor } from "@/components/spending-trends/insights-chart";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { useProjectSavedTotals, useProjects } from "@/hooks/useProjects";
import { useMaskProps, useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { cn } from "@/lib/utils";
import type { BudgetCategoryStatus, Expense } from "@/lib/types";

interface BudgetCategoryRowProps {
  category: BudgetCategoryStatus;
  expenses?: Expense[];
  /** Position in its group, which picks the row's chart colour (dot and meter). */
  colorRank?: number;
  archived?: boolean;
  onRename?: (name: string) => void;
  onUpdateTarget?: (cents: number) => void;
  onDelete?: () => void;
  onAddExpense?: () => void;
  showDragHandle?: boolean;
  onDragHandlePointerDown?: (event: React.PointerEvent) => void;
  isDragSource?: boolean;
  isDragOver?: boolean;
  rowRef?: (el: HTMLDivElement | null) => void;
  /** Holds the transactions open — set while the page's search is narrowing them. */
  forceExpanded?: boolean;
}

type Pacing = "over" | "met" | "under" | "no-target";

// No field on a category says whether it is a bill that cannot move or spending the user controls,
// so the app cannot know that a mortgage at 100% is on schedule while groceries at 100% is not.
// The old "≥75% = Warning" rule invented that knowledge and badged every on-schedule bill as a
// problem. Only what the data supports is stated: over target, exactly at target, or still under.
function getPacing(spentCents: number, targetCents: number): Pacing {
  if (targetCents <= 0) return "no-target";
  if (spentCents > targetCents) return "over";
  if (spentCents === targetCents) return "met";
  return "under";
}

export function BudgetCategoryRow({
  category,
  expenses = [],
  colorRank = 0,
  archived = false,
  onRename,
  onUpdateTarget,
  onDelete,
  onAddExpense,
  showDragHandle = false,
  onDragHandlePointerDown,
  isDragSource = false,
  isDragOver = false,
  rowRef,
  forceExpanded = false,
}: BudgetCategoryRowProps) {
  const { t, i18n } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const maskProps = useMaskProps();
  const { hidden } = useValuesHidden();
  const [expandedByUser, setExpanded] = useState(false);
  const expanded = forceExpanded || expandedByUser;

  // A savings-project line: its "spent" is money set aside for the project, its name follows the
  // project, and a dated project's target is calculated in Rust. The project queries only run for
  // such a line, so a budget with none makes no project reads.
  const linked = category.project_id != null;
  const { data: projects = [] } = useProjects(linked);
  const { data: savedTotals = [] } = useProjectSavedTotals(linked);
  const project = linked
    ? projects.find((entry) => entry.id === category.project_id)
    : undefined;
  const projectSavedCents =
    savedTotals.find((entry) => entry.project_id === category.project_id)?.saved_cents ?? 0;
  const goalReached =
    project !== undefined &&
    category.target_cents === 0 &&
    projectSavedCents >= project.target_cents;
  const targetIsCalculated = linked && project?.target_date != null;

  const pacing = getPacing(category.spent_cents, category.target_cents);
  const remainingCents = category.target_cents - category.spent_cents;

  const paceSentence = linked
    ? t("budget.linkedMeterValue", {
        setAside: formatCurrency(category.spent_cents),
        target: formatCurrency(category.target_cents),
      })
    : t("budget.categoryMeterValue", {
        spent: formatCurrency(category.spent_cents),
        target: formatCurrency(category.target_cents),
      });

  const linkedBadge = (() => {
    if (goalReached) {
      return { variant: "good" as const, label: t("budget.linkedGoalReached") };
    }
    if (remainingCents > 0) {
      return {
        variant: "neutral" as const,
        label: t("budget.linkedSetAsideLeft", { amount: formatCurrency(remainingCents) }),
      };
    }
    return { variant: "good" as const, label: t("budget.linkedFullySetAside") };
  })();

  // Setting aside more than planned is not overspending, so a linked line never reads as "over".
  const dotPacing: Pacing = linked && pacing === "over" ? "met" : pacing;

  const badge = linked ? linkedBadge : (() => {
    switch (pacing) {
      case "over":
        return {
          variant: "over" as const,
          label: t("budget.categoryOverBy", {
            amount: formatCurrency(Math.abs(remainingCents)),
          }),
        };
      case "met":
        return { variant: "neutral" as const, label: t("budget.categoryFullySpent") };
      case "under":
        return {
          variant: "good" as const,
          label: t("budget.categoryLeft", { amount: formatCurrency(remainingCents) }),
        };
      case "no-target":
        return { variant: "neutral" as const, label: t("budget.categoryNoTarget") };
    }
  })();

  // The charte's rule: a category's own chart colour identifies it, and the bar turns orange the
  // moment it goes over. Status never rides on hue alone — the figure beside the bar says it too.
  const categoryColor = rampColor(colorRank);
  const meterColor = dotPacing === "over" ? "var(--over)" : categoryColor;
  // Only the over state earns a pill; everything else is a quiet caption, so the one row that
  // needs attention is the only one shouting.
  const statusIsPill = badge.variant === "over";

  return (
    <div
      ref={rowRef}
      className={cn(
        "border-b border-line last:border-b-0",
        isDragSource && "opacity-40",
        isDragOver && "border-t-2 border-t-brand"
      )}
      data-testid="budget-status-row"
    >
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
        data-testid="budget-category-row"
      >
        <div className="flex min-w-0 basis-52 shrink-0 items-center gap-1.5">
          {showDragHandle && (
            <span
              onPointerDown={onDragHandlePointerDown}
              className="shrink-0 touch-none cursor-grab select-none text-ink-faint hover:text-ink-dim active:cursor-grabbing"
              aria-hidden="true"
              data-testid="category-drag-handle"
            >
              <GripVertical className="size-4" aria-hidden="true" />
            </span>
          )}
          {linked ? (
            <span className="inline-grid size-7 shrink-0 place-items-center">
              <PiggyBank
                className="icon-gradient size-4"
                aria-label={t("budget.linkedSavingsProject")}
                data-testid="linked-category-icon"
              />
            </span>
          ) : (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => setExpanded(!expandedByUser)}
              aria-label={expanded ? t("budget.collapseCategory") : t("budget.expandCategory")}
              aria-expanded={expanded}
              data-testid="category-expand-toggle"
            >
              {expanded ? (
                <ChevronDown className="text-ink-dim" aria-hidden="true" />
              ) : (
                <ChevronRight className="text-ink-dim" aria-hidden="true" />
              )}
            </Button>
          )}
          {/* A square, not a disc: the charte's chart key, in the same colour as the bar. `data-status`
            * stays because Windows High Contrast maps the over state from it. */}
          <span
            data-slot="status-dot"
            data-status={dotPacing}
            aria-hidden="true"
            className={cn(
              "size-2 shrink-0 rounded-[3px]",
              dotPacing === "no-target" && "border-[1.5px] border-line-strong"
            )}
            style={dotPacing === "no-target" ? undefined : { backgroundColor: categoryColor }}
          />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              {linked && project ? (
                <Link
                  to="/wealth/projects"
                  className="truncate text-label text-ink hover:underline"
                  aria-label={t("budget.linkedOpenProject", { name: category.name })}
                  data-testid="category-name"
                >
                  {category.name}
                </Link>
              ) : onRename && !linked ? (
                <InlineEditText
                  value={category.name}
                  onSave={onRename}
                  className="text-label"
                  data-testid="category-name"
                />
              ) : (
                <span className="truncate text-label text-ink-dim" data-testid="category-name">
                  {category.name}
                </span>
              )}
              {archived && (
                <Badge variant="neutral" data-testid="archived-category-badge">
                  {t("budget.archivedCategory")}
                </Badge>
              )}
            </div>
            {!linked && (
              <p className="text-caption text-ink-dim">
                {t("budget.v3.transactionCount", { count: expenses.length })}
              </p>
            )}
          </div>
        </div>

        <div className="min-w-32 flex-1">
          {category.target_cents > 0 && (
            <Meter
              value={category.spent_cents}
              max={category.target_cents}
              color={meterColor}
              label={
                linked
                  ? t("budget.linkedMeterLabel", { name: category.name })
                  : t("budget.categoryMeterLabel", { name: category.name })
              }
              valueText={hidden ? t("common.amountHidden") : paceSentence}
              data-testid="progress-bar"
            />
          )}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <span
            className={cn("text-label whitespace-nowrap", archived ? "text-ink-dim" : "text-ink")}
            data-testid="spent-target"
          >
            <Money
              cents={category.spent_cents}
              locale={i18n.language}
              className="font-bold"
              {...maskProps}
            />
            <span className="text-caption font-normal text-ink-dim">
              {" "}
              {t("budget.ofSeparator")}{" "}
            </span>
            {onUpdateTarget && !targetIsCalculated ? (
              <InlineEditMoney
                value={category.target_cents}
                onSave={onUpdateTarget}
                className="text-caption text-ink-dim"
                data-testid="category-target"
              />
            ) : (
              <span className="text-caption text-ink-dim" data-testid="category-target">
                <Money cents={category.target_cents} locale={i18n.language} {...maskProps} />
              </span>
            )}
          </span>
          {targetIsCalculated && (
            <MetricInfoTooltip
              ariaLabel={t("budget.linkedTargetCalculatedAria")}
              content={t("budget.linkedTargetCalculated")}
              testId="linked-target-info"
            />
          )}
          <span className="flex w-32 shrink-0 justify-end">
            {statusIsPill ? (
              <Badge variant="over" data-testid="status-badge">
                {badge.label}
              </Badge>
            ) : (
              <span
                className="money text-right text-caption whitespace-nowrap text-ink-dim"
                data-variant={badge.variant}
                data-testid="status-badge"
              >
                {badge.label}
              </span>
            )}
          </span>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onDelete}
              className="text-ink-faint hover:text-over"
              data-testid="delete-category-button"
              aria-label={t("budget.deleteCategory")}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      {expanded && !linked && (
        <div className="pb-4 pl-9" data-testid="category-expenses">
          <ExpenseList expenses={expenses} onAddExpense={onAddExpense} variant="nested" />
          {expenses.length > 0 && (
            <Link
              to="/spending/transactions"
              className="mt-2 inline-flex items-center gap-1 text-caption font-bold text-brand-ink no-underline hover:underline"
              data-testid="category-see-all-transactions"
            >
              {t("budget.v3.seeAllTransactions")}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
