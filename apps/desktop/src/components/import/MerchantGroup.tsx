import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Card,
  CardContent,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nixus/shared";

interface BudgetCategory {
  id: number;
  name: string;
}

interface MerchantGroupProps {
  merchant: string;
  count: number;
  categories: BudgetCategory[];
  onApplyToAll: (categoryId: number) => void;
  children: ReactNode;
}

// Identical merchants are categorized once. A real statement repeats the same coffee shop four
// times, and asking for the same answer four times is what makes review feel like data entry.
export function MerchantGroup({
  merchant,
  count,
  categories,
  onApplyToAll,
  children,
}: MerchantGroupProps) {
  const { t } = useTranslation();
  const [groupCategory, setGroupCategory] = useState("");
  const [applied, setApplied] = useState(false);
  const selectId = `group-category-${merchant.replace(/\W+/g, "-").toLowerCase()}`;

  return (
    <div className="space-y-2" data-testid="merchant-group">
      <Card flush>
        <CardContent className="flex flex-wrap items-end gap-2 py-3">
          <div className="min-w-0 flex-1">
            <Label htmlFor={selectId} className="mb-1">
              {t("import.groupHeading", { count, merchant })}
            </Label>
            <Select
              value={groupCategory}
              onValueChange={(val) => {
                setGroupCategory(val ?? "");
                setApplied(false);
              }}
              items={categories.map((cat) => ({
                value: String(cat.id),
                label: cat.name,
              }))}
            >
              <SelectTrigger id={selectId} data-testid="group-category-select">
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
          <div className="flex flex-col items-start gap-1">
            <Button
              variant="outline"
              disabled={groupCategory === ""}
              aria-disabled={groupCategory === "" || undefined}
              onClick={() => {
                onApplyToAll(Number(groupCategory));
                setApplied(true);
              }}
              data-testid="group-apply-button"
            >
              {t("import.groupApply", { count })}
            </Button>
          </div>
          {applied && (
            <p
              aria-live="polite"
              className="w-full text-caption text-good-ink"
              data-testid="group-applied-notice"
            >
              {t("import.groupApplied", { count })}
            </p>
          )}
          {groupCategory === "" && (
            <p className="w-full text-caption text-ink-dim">
              {t("import.groupPickFirst")}
            </p>
          )}
        </CardContent>
      </Card>
      {children}
    </div>
  );
}
