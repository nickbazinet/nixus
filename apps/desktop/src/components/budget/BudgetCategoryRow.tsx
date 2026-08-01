import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { Badge, Button } from "@nixus/shared";
import { ExpenseList } from "@/components/expenses/ExpenseList";
import { InlineEditText, InlineEditMoney } from "@/components/shared/InlineEdit";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import type { BudgetCategoryStatus, Expense } from "@/lib/types";

interface BudgetCategoryRowProps {
  category: BudgetCategoryStatus;
  expenses?: Expense[];
  striped?: boolean;
  archived?: boolean;
  onRename?: (name: string) => void;
  onUpdateTarget?: (cents: number) => void;
  onDelete?: () => void;
}

function getSpentRatio(spent: number, target: number): number {
  if (target <= 0) return 0;
  return spent / target;
}

function getStatusColor(ratio: number): string {
  if (ratio > 1.0) return "bg-rose-500";
  if (ratio >= 0.75) return "bg-amber-500";
  return "bg-primary";
}

function getStatusBadge(ratio: number, t: (key: string) => string): { label: string; className: string } {
  if (ratio > 1.0) {
    return {
      label: t("budget.overBudget"),
      className: "bg-rose-500/10 text-rose-600 border-transparent",
    };
  }
  if (ratio >= 0.75) {
    return {
      label: t("budget.budgetWarning"),
      className: "bg-amber-500/10 text-amber-600 border-transparent",
    };
  }
  return {
    label: t("budget.budgetOnTrack"),
    className: "bg-emerald-500/10 text-emerald-600 border-transparent",
  };
}

export function BudgetCategoryRow({
  category,
  expenses = [],
  striped = false,
  archived = false,
  onRename,
  onUpdateTarget,
  onDelete,
}: BudgetCategoryRowProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const [expanded, setExpanded] = useState(false);
  const ratio = getSpentRatio(category.spent_cents, category.target_cents);
  const progressPercent = Math.min(ratio * 100, 100);
  const barColor = getStatusColor(ratio);
  const badge = getStatusBadge(ratio, t);

  return (
    <div
      className={`py-2 px-2 rounded-md ${striped ? "bg-muted/30" : ""}`}
      data-testid="budget-status-row"
    >
      <div
        className="group flex items-center justify-between mb-1"
        data-testid="budget-category-row"
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="p-0.5 rounded hover:bg-muted/50 transition-colors"
            aria-label={expanded ? t("budget.collapseCategory") : t("budget.expandCategory")}
            aria-expanded={expanded}
            data-testid="category-expand-toggle"
          >
            {expanded ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 text-muted-foreground" />
            )}
          </button>
          {onRename ? (
            <InlineEditText
              value={category.name}
              onSave={onRename}
              className="text-sm font-medium"
              data-testid="category-name"
            />
          ) : (
            <span className="text-sm text-muted-foreground" data-testid="category-name">
              {category.name}
            </span>
          )}
          {archived && (
            <Badge variant="outline" className="text-xs" data-testid="archived-category-badge">
              {t("budget.archivedCategory")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`font-mono text-sm ${archived ? "text-muted-foreground" : ""}`}
            data-testid="spent-target"
          >
            {`${formatCurrency(category.spent_cents)} / `}
            {onUpdateTarget ? (
              <InlineEditMoney
                value={category.target_cents}
                onSave={onUpdateTarget}
                data-testid="category-target"
              />
            ) : (
              <span data-testid="category-target">{formatCurrency(category.target_cents)}</span>
            )}
          </span>
          <Badge className={badge.className} data-testid="status-badge">
            {badge.label}
          </Badge>
          {onDelete && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onDelete}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
              data-testid="delete-category-button"
              aria-label={t("budget.deleteCategory")}
            >
              <Trash2 className="size-3.5 text-muted-foreground" />
            </Button>
          )}
        </div>
      </div>
      <div
        className="h-2 w-full rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={category.spent_cents}
        aria-valuemin={0}
        aria-valuemax={category.target_cents}
        data-testid="progress-bar"
      >
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${progressPercent}%` }}
          data-testid="progress-bar-fill"
        />
      </div>
      {expanded && (
        <div className="mt-2 ml-5" data-testid="category-expenses">
          <ExpenseList expenses={expenses} />
        </div>
      )}
    </div>
  );
}
