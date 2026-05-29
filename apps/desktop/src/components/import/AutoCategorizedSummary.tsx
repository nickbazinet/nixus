import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { DatePicker } from "@nkbaz/shared";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@nkbaz/shared";
import type { ParsedTransaction } from "@/hooks/useImport";

interface BudgetCategory {
  id: number;
  name: string;
}

interface AutoCategorizedSummaryProps {
  transactions: ParsedTransaction[];
  categories: BudgetCategory[];
  onCategoryChange: (index: number, categoryId: number) => void;
  selectedSet: Set<number>;
  onToggleSelect: (index: number) => void;
  onFieldChange: (index: number, field: keyof ParsedTransaction, value: string | number) => void;
  fieldOverrides: Record<number, Partial<ParsedTransaction>>;
  globalIndices: number[];
  duplicateIndices?: Set<number>;
}

export function AutoCategorizedSummary({
  transactions,
  categories,
  onCategoryChange,
  selectedSet,
  onToggleSelect,
  onFieldChange,
  fieldOverrides,
  globalIndices,
  duplicateIndices,
}: AutoCategorizedSummaryProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (transactions.length === 0) return null;

  const selectedCount = globalIndices.filter((gi) => selectedSet.has(gi)).length;

  return (
    <div data-testid="auto-categorized-summary">
      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50"
        data-testid="auto-categorized-toggle"
      >
        <Check className="h-5 w-5 text-emerald-500" />
        <span className="flex-1 text-sm font-medium">
          {selectedCount} {t("import.of")} {transactions.length} {t("import.transactionsAutoCategorized")}
        </span>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2" data-testid="auto-categorized-list">
          {transactions.map((tx, index) => {
            const gi = globalIndices[index];
            const isSelected = selectedSet.has(gi);
            const overrides = fieldOverrides[gi];
            const isDup = duplicateIndices?.has(gi) ?? false;
            return (
              <div
                key={index}
                className={cn(
                  "flex items-center gap-3 rounded-md border px-4 py-2",
                  isDup ? "border-amber-500/50 bg-amber-500/5" : "bg-card"
                )}
                data-testid="auto-categorized-row"
              >
                {isDup && (
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400" data-testid="duplicate-badge">
                    {t("import.possibleDuplicate")}
                  </span>
                )}
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleSelect(index)}
                  data-testid="auto-transaction-checkbox"
                />
                <div className={cn("flex flex-1 items-center gap-3", !isSelected && "opacity-50")}>
                  <div className="flex-1">
                    <input
                      type="text"
                      value={overrides?.merchant ?? tx.merchant}
                      onChange={(e) => onFieldChange(index, "merchant", e.target.value)}
                      className="rounded-md border bg-background px-2 py-1 text-sm"
                      data-testid="auto-merchant-input"
                    />
                    <div className="ml-2 inline-block" data-testid="auto-date-input">
                      <DatePicker
                        value={overrides?.date ?? tx.date}
                        onChange={(value) => onFieldChange(index, "date", value)}
                      />
                    </div>
                  </div>
                  <input
                    type="number"
                    value={(overrides?.amount_cents ?? tx.amount_cents) / 100}
                    step="0.01"
                    onChange={(e) => {
                      const val = e.target.valueAsNumber;
                      if (!isNaN(val)) onFieldChange(index, "amount_cents", Math.round(val * 100));
                    }}
                    className="w-24 rounded-md border bg-background px-2 py-1 text-right font-mono text-sm"
                    data-testid="auto-amount-input"
                  />
                  <Select
                    value={String(overrides?.suggested_category_id ?? tx.suggested_category_id ?? "")}
                    onValueChange={(val) => onCategoryChange(index, Number(val))}
                    items={categories.map((cat) => ({ value: String(cat.id), label: cat.name }))}
                  >
                    <SelectTrigger data-testid="auto-category-select" className="w-40">
                      <SelectValue placeholder={t("import.select")} />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={String(cat.id)}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
