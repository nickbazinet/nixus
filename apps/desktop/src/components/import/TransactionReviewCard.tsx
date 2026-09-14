import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  DatePicker,
  Input,
  Label,
} from "@nixus/shared";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { cn } from "@/lib/utils";
import { useFormatCurrency } from "@/hooks/useFormatCurrency";
import {
  ImportCategorySelect,
  type ImportSelectCategory,
  type ImportSelectGroup,
} from "@/components/import/ImportCategorySelect";
import type { ProposedCategory } from "@/hooks/useImport";

/** Mirrors the create path in `import.tsx`: a usable group id is reused, anything else means a
 *  new group named after the proposal. A stated id that is not in the loaded groups falls back to
 *  the group-less line, so the copy never names a group it cannot confirm. */
function proposalMessage(
  proposal: ProposedCategory,
  groups: ImportSelectGroup[],
  t: TFunction
): string {
  if (proposal.group_id !== null && proposal.group_id > 0) {
    const existing = groups.find((group) => group.id === proposal.group_id);
    return existing
      ? t("import.proposedCategoryInGroup", { name: proposal.name, group: existing.name })
      : t("import.proposedCategory", { name: proposal.name });
  }
  return t("import.proposedCategoryNewGroup", {
    name: proposal.name,
    group: proposal.group_name?.trim() || proposal.name,
  });
}

interface TransactionReviewCardProps {
  /** Stable per-row suffix so every label in the row can carry a real `htmlFor`. */
  rowId: string;
  merchant: string;
  amountCents: number;
  date: string;
  suggestedCategoryId: number | null;
  categories: ImportSelectCategory[];
  groups: ImportSelectGroup[];
  selectedCategoryId: number | null;
  onCategoryChange: (categoryId: number) => void;
  isResolved: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onMerchantChange: (value: string) => void;
  onAmountChange: (value: number) => void;
  onDateChange: (value: string) => void;
  isDuplicate?: boolean;
  proposedCategory?: ProposedCategory | null;
  onCreateProposedCategory?: () => void;
  creatingProposedCategory?: boolean;
}

export function TransactionReviewCard({
  rowId,
  merchant,
  amountCents,
  date,
  suggestedCategoryId,
  categories,
  groups,
  selectedCategoryId,
  onCategoryChange,
  isResolved,
  selected,
  onToggleSelect,
  onMerchantChange,
  onAmountChange,
  onDateChange,
  isDuplicate,
  proposedCategory,
  onCreateProposedCategory,
  creatingProposedCategory,
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
                <ImportCategorySelect
                  id={categoryId}
                  value={selectedCategoryId ?? suggestedCategoryId}
                  onChange={onCategoryChange}
                  categories={categories}
                  groups={groups}
                  placeholder={t("import.selectCategory")}
                  testId="category-select"
                  className="w-full"
                />
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

            {!isResolved && proposedCategory && (
              <Alert
                variant="caution"
                className="mt-2"
                data-testid="propose-category-alert"
              >
                <div className="flex items-center justify-between gap-2">
                  <span>{proposalMessage(proposedCategory, groups, t)}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onCreateProposedCategory}
                    disabled={creatingProposedCategory || !onCreateProposedCategory}
                    data-testid="create-category-button"
                  >
                    {t("import.createCategoryButton")}
                  </Button>
                </div>
              </Alert>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
