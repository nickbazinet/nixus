import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Card, CardContent, Label } from "@nixus/shared";
import {
  ImportCategorySelect,
  type ImportSelectCategory,
  type ImportSelectGroup,
} from "@/components/import/ImportCategorySelect";

interface MerchantGroupProps {
  merchant: string;
  count: number;
  categories: ImportSelectCategory[];
  groups: ImportSelectGroup[];
  onApplyToAll: (categoryId: number) => void;
  children: ReactNode;
}

// Identical merchants are categorized once. A real statement repeats the same coffee shop four
// times, and asking for the same answer four times is what makes review feel like data entry.
export function MerchantGroup({
  merchant,
  count,
  categories,
  groups,
  onApplyToAll,
  children,
}: MerchantGroupProps) {
  const { t } = useTranslation();
  const [groupCategory, setGroupCategory] = useState<number | null>(null);
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
            <ImportCategorySelect
              id={selectId}
              value={groupCategory}
              onChange={(catId) => {
                setGroupCategory(catId);
                setApplied(false);
              }}
              categories={categories}
              groups={groups}
              placeholder={t("import.selectCategory")}
              testId="group-category-select"
            />
          </div>
          <div className="flex flex-col items-start gap-1">
            <Button
              variant="outline"
              disabled={groupCategory === null}
              aria-disabled={groupCategory === null || undefined}
              onClick={() => {
                if (groupCategory === null) return;
                onApplyToAll(groupCategory);
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
          {groupCategory === null && (
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
