import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import {
  Badge,
  Card,
  Checkbox,
  DatePicker,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { cn } from "@/lib/utils";
import { focusRing } from "@nixus/shared";
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
  onSelectAll: (selected: boolean) => void;
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
  onSelectAll,
  onFieldChange,
  fieldOverrides,
  globalIndices,
  duplicateIndices,
}: AutoCategorizedSummaryProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (transactions.length === 0) return null;

  const selectedCount = globalIndices.filter((gi) => selectedSet.has(gi)).length;
  const allSelected = selectedCount === globalIndices.length;
  const someSelected = selectedCount > 0 && !allSelected;
  const categoryItems = categories.map((cat) => ({
    value: String(cat.id),
    label: cat.name,
  }));

  return (
    <Card flush data-testid="auto-categorized-summary">
      <div className="flex items-center gap-2 px-card-pad py-3">
        <Checkbox
          checked={allSelected}
          indeterminate={someSelected}
          onCheckedChange={(next) => onSelectAll(next)}
          aria-label={t("import.autoSelectAll")}
          className="-ml-1"
          data-testid="auto-select-all"
        />
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls="auto-categorized-list"
          className={cn(
            "flex min-h-target-min flex-1 items-center gap-2 rounded-md text-left transition-colors hover:text-brand-ink",
            focusRing
          )}
          data-testid="auto-categorized-toggle"
        >
          <Check className="size-4 shrink-0 text-good" aria-hidden="true" />
          <span className="flex-1 text-label text-ink">
            {t("import.autoCategorizedToggle", {
              selected: selectedCount,
              total: transactions.length,
            })}
          </span>
          {expanded ? (
            <ChevronUp className="size-4 text-ink-dim" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-4 text-ink-dim" aria-hidden="true" />
          )}
        </button>
      </div>

      {!expanded && (
        <p className="border-t border-line px-card-pad py-2.5 text-caption text-ink-dim">
          {t("import.autoCategorizedHint")}
        </p>
      )}

      {expanded && (
        <div id="auto-categorized-list" data-testid="auto-categorized-list">
          {transactions.map((tx, index) => {
            const gi = globalIndices[index];
            const isSelected = selectedSet.has(gi);
            const overrides = fieldOverrides[gi];
            const isDup = duplicateIndices?.has(gi) ?? false;
            const merchantValue = overrides?.merchant ?? tx.merchant;
            const merchantId = `auto-merchant-${gi}`;
            const amountId = `auto-amount-${gi}`;
            const dateId = `auto-date-${gi}`;
            const categoryId = `auto-category-${gi}`;

            return (
              <div
                key={gi}
                className="flex items-start gap-2 border-t border-line px-card-pad py-2.5"
                data-testid="auto-categorized-row"
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggleSelect(index)}
                  aria-label={merchantValue}
                  className="mt-1 -ml-1"
                  data-testid="auto-transaction-checkbox"
                />
                <div
                  className={cn(
                    "min-w-0 flex-1 space-y-2",
                    !isSelected && "text-ink-dim"
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <Label htmlFor={merchantId} className="sr-only">
                        {t("expenses.merchant")}
                      </Label>
                      <Input
                        id={merchantId}
                        type="text"
                        value={merchantValue}
                        onChange={(e) =>
                          onFieldChange(index, "merchant", e.target.value)
                        }
                        data-testid="auto-merchant-input"
                      />
                    </div>
                    <div className="w-28 shrink-0" data-testid="auto-amount-input-field">
                      <Label htmlFor={amountId} className="sr-only">
                        {t("common.amount")}
                      </Label>
                      <MoneyInput
                        id={amountId}
                        value={overrides?.amount_cents ?? tx.amount_cents}
                        onChange={(cents) =>
                          onFieldChange(index, "amount_cents", cents)
                        }
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="shrink-0" data-testid="auto-date-input">
                      <Label htmlFor={dateId} className="sr-only">
                        {t("common.date")}
                      </Label>
                      <DatePicker
                        id={dateId}
                        value={overrides?.date ?? tx.date}
                        onChange={(value) => onFieldChange(index, "date", value)}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <Label htmlFor={categoryId} className="sr-only">
                        {t("common.category")}
                      </Label>
                      <Select
                        value={String(
                          overrides?.suggested_category_id ??
                            tx.suggested_category_id ??
                            ""
                        )}
                        onValueChange={(val) => onCategoryChange(index, Number(val))}
                        items={categoryItems}
                      >
                        <SelectTrigger
                          id={categoryId}
                          data-testid="auto-category-select"
                          className="w-full"
                        >
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
                    {isDup && (
                      <Badge variant="caution" data-testid="duplicate-badge">
                        {t("import.possibleDuplicate")}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
