import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Layers } from "lucide-react";
import { Button, Card, CardContent, IconChip, Label } from "@nixus/shared";
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
    <div className="flex flex-col gap-3" data-testid="merchant-group">
      <Card flush>
        <CardContent className="py-4">
          <div className="mb-2.5 flex items-center gap-3">
            <IconChip icon={Layers} size="sm" />
            <Label htmlFor={selectId} className="min-w-0">
              {t("import.groupHeading", { count, merchant })}
            </Label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
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
              className="mt-2 text-caption text-good-ink"
              data-testid="group-applied-notice"
            >
              {t("import.groupApplied", { count })}
            </p>
          )}
          {groupCategory === null && (
            <p className="mt-2 text-caption text-ink-dim">{t("import.groupPickFirst")}</p>
          )}
        </CardContent>
      </Card>
      {children}
    </div>
  );
}
