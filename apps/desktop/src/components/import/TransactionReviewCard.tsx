import { useTranslation } from "react-i18next";
import {
  Alert,
  Badge,
  Card,
  CardContent,
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
import { useFormatCurrency } from "@/hooks/useFormatCurrency";

interface BudgetCategory {
  id: number;
  name: string;
}

interface TransactionReviewCardProps {
  /** Stable per-row suffix so every label in the row can carry a real `htmlFor`. */
  rowId: string;
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
  rowId,
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
  const merchantId = `review-merchant-${rowId}`;
  const amountId = `review-amount-${rowId}`;
  const dateId = `review-date-${rowId}`;
  const categoryId = `review-category-${rowId}`;

  return (
    <Card
      flush
      data-testid="transaction-review-card"
      aria-label={`${merchant} ${formatCurrency(amountCents)} — ${
        isResolved ? t("import.rowSorted") : t("import.rowNeedsCategory")
      }`}
    >
      {isDuplicate && (
        <Alert variant="caution" data-testid="duplicate-badge">
          {t("import.possibleDuplicateWarning")}
        </Alert>
      )}
      <CardContent className="py-card-pad">
        <div className="flex items-start gap-2">
          <Checkbox
            checked={selected}
            onCheckedChange={onToggleSelect}
            aria-label={`${merchant} ${formatCurrency(amountCents)}`}
            className="mt-1 -ml-1"
            data-testid="transaction-checkbox"
          />
          <div
            className={cn("min-w-0 flex-1", !selected && "text-ink-dim")}
            data-testid="review-row-content"
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Label htmlFor={merchantId} className="sr-only">
                  {t("expenses.merchant")}
                </Label>
                <Input
                  id={merchantId}
                  type="text"
                  value={merchant}
                  onChange={(e) => onMerchantChange(e.target.value)}
                  data-testid="merchant-input"
                />
              </div>
              <div className="w-28 shrink-0" data-testid="amount-input-field">
                <Label htmlFor={amountId} className="sr-only">
                  {t("common.amount")}
                </Label>
                <MoneyInput
                  id={amountId}
                  value={amountCents}
                  onChange={onAmountChange}
                />
              </div>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <div className="shrink-0" data-testid="date-input">
                <Label htmlFor={dateId} className="sr-only">
                  {t("common.date")}
                </Label>
                <DatePicker id={dateId} value={date} onChange={onDateChange} />
              </div>
              <div className="min-w-0 flex-1">
                <Label htmlFor={categoryId} className="sr-only">
                  {t("common.category")}
                </Label>
                <Select
                  value={String(selectedCategoryId ?? suggestedCategoryId ?? "")}
                  onValueChange={(val) => onCategoryChange(Number(val))}
                  items={categories.map((cat) => ({
                    value: String(cat.id),
                    label: cat.name,
                  }))}
                >
                  <SelectTrigger
                    id={categoryId}
                    data-testid="category-select"
                    className="w-full"
                  >
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
              <Badge
                variant={isResolved ? "good" : "caution"}
                data-testid="review-row-status"
              >
                {isResolved
                  ? t("import.rowSorted")
                  : t("import.rowNeedsCategory")}
              </Badge>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
