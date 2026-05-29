import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@nixus/shared";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import { DatePicker } from "@nixus/shared";

interface BudgetCategory {
  id: number;
  name: string;
}

interface TransactionReviewCardProps {
  merchant: string;
  amountCents: number;
  date: string;
  suggestedCategoryId: number | null;
  categories: BudgetCategory[];
  selectedCategoryId: number | null;
  onCategoryChange: (categoryId: number) => void;
  isResolved: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onMerchantChange: (value: string) => void;
  onAmountChange: (value: number) => void;
  onDateChange: (value: string) => void;
  isDuplicate?: boolean;
}

export function TransactionReviewCard({
  merchant,
  amountCents,
  date,
  suggestedCategoryId,
  categories,
  selectedCategoryId,
  onCategoryChange,
  isResolved,
  selected,
  onToggleSelect,
  onMerchantChange,
  onAmountChange,
  onDateChange,
  isDuplicate,
}: TransactionReviewCardProps) {
  const { t } = useTranslation();
  const formatCurrency = useFormatCurrency();
  return (
    <div
      data-testid="transaction-review-card"
      aria-label={`${merchant} ${formatCurrency(amountCents)} - ${isResolved ? "resolved" : "needs review"}`}
      className={cn(
        "rounded-lg border-2 p-4 transition-colors",
        isResolved
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-amber-500/30 bg-amber-500/5"
      )}
    >
      {isDuplicate && (
        <div className="mb-2 rounded bg-amber-500/20 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400" data-testid="duplicate-badge">
          {t("import.possibleDuplicateWarning")}
        </div>
      )}
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="mt-1"
          data-testid="transaction-checkbox"
        />
        <div className={cn("flex-1", !selected && "opacity-50")}>
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <input
                type="text"
                value={merchant}
                onChange={(e) => onMerchantChange(e.target.value)}
                className="rounded-md border bg-background px-2 py-1 text-sm font-medium"
                data-testid="merchant-input"
              />
              <div className="ml-2 inline-block" data-testid="date-input">
                <DatePicker
                  value={date}
                  onChange={onDateChange}
                />
              </div>
            </div>
            <input
              type="number"
              value={amountCents / 100}
              step="0.01"
              onChange={(e) => {
                const val = e.target.valueAsNumber;
                if (!isNaN(val)) onAmountChange(Math.round(val * 100));
              }}
              className="w-24 rounded-md border bg-background px-2 py-1 text-right font-mono text-sm font-medium"
              data-testid="amount-input"
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("import.aiSuggests")}</span>
            <Select
              value={String(selectedCategoryId ?? suggestedCategoryId ?? "")}
              onValueChange={(val) => onCategoryChange(Number(val))}
              items={categories.map((cat) => ({ value: String(cat.id), label: cat.name }))}
            >
              <SelectTrigger data-testid="category-select" className="flex-1">
                <SelectValue placeholder={t("import.selectCategory")} />
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
      </div>
    </div>
  );
}
