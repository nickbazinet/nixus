import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { Badge, Button, Meter, Money } from "@nixus/shared";
import { ExpenseList } from "@/components/expenses/ExpenseList";
import { InlineEditText, InlineEditMoney } from "@/components/shared/InlineEdit";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { useMaskProps, useValuesHidden } from "@/contexts/ValuesVisibilityContext";
import { cn } from "@/lib/utils";
import type { BudgetCategoryStatus, Expense } from "@/lib/types";

interface BudgetCategoryRowProps {
  category: BudgetCategoryStatus;
  expenses?: Expense[];
  striped?: boolean;
  archived?: boolean;
  onRename?: (name: string) => void;
  onUpdateTarget?: (cents: number) => void;
  onDelete?: () => void;
  onAddExpense?: () => void;
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

// Shape carries status alongside hue — `over` is filled, an unset target is a ring. Hue alone fails
// under deuteranopia and the dot column is the fastest scan path in a stacked list.
const dotClasses: Record<Pacing, string> = {
  over: "bg-over",
  met: "bg-ink-faint",
  under: "bg-good",
  "no-target": "border-[1.5px] border-line-strong bg-transparent",
};

export function BudgetCategoryRow({
  category,
  expenses = [],
  striped = false,
  archived = false,
  onRename,
  onUpdateTarget,
  onDelete,
  onAddExpense,
}: BudgetCategoryRowProps) {
  const { t, i18n } = useTranslation();
  const formatCurrency = useFormatCurrency();
  const maskProps = useMaskProps();
  const { hidden } = useValuesHidden();
  const [expanded, setExpanded] = useState(false);

  const pacing = getPacing(category.spent_cents, category.target_cents);
  const remainingCents = category.target_cents - category.spent_cents;

  const paceSentence = t("budget.categoryMeterValue", {
    spent: formatCurrency(category.spent_cents),
    target: formatCurrency(category.target_cents),
  });

  const badge = (() => {
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

  return (
    <div
      className={cn("rounded-md px-2 py-2", striped && "bg-hover")}
      data-testid="budget-status-row"
    >
      <div
        className="mb-1.5 flex items-center justify-between gap-3"
        data-testid="budget-category-row"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setExpanded(!expanded)}
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
          <span
            data-slot="status-dot"
            data-status={pacing}
            aria-hidden="true"
            className={cn("size-[7px] shrink-0 rounded-full", dotClasses[pacing])}
          />
          {onRename ? (
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
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn("text-label", archived ? "text-ink-dim" : "text-ink")}
            data-testid="spent-target"
          >
            <Money cents={category.spent_cents} locale={i18n.language} {...maskProps} />
            <span aria-hidden="true"> / </span>
            <span className="sr-only"> {t("budget.ofSeparator")} </span>
            {onUpdateTarget ? (
              <InlineEditMoney
                value={category.target_cents}
                onSave={onUpdateTarget}
                data-testid="category-target"
              />
            ) : (
              <span data-testid="category-target">
                <Money cents={category.target_cents} locale={i18n.language} {...maskProps} />
              </span>
            )}
          </span>
          <Badge variant={badge.variant} data-testid="status-badge">
            {badge.label}
          </Badge>
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
      {category.target_cents > 0 && (
        <Meter
          value={category.spent_cents}
          max={category.target_cents}
          label={t("budget.categoryMeterLabel", { name: category.name })}
          valueText={hidden ? t("common.amountHidden") : paceSentence}
          data-testid="progress-bar"
        />
      )}
      {expanded && (
        <div className="mt-2.5" data-testid="category-expenses">
          <ExpenseList expenses={expenses} onAddExpense={onAddExpense} />
        </div>
      )}
    </div>
  );
}
