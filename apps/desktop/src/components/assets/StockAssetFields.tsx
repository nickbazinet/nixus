import { useTranslation } from "react-i18next";
import { Input, Label } from "@nixus/shared";
import type { FieldError, UseFormRegisterReturn } from "react-hook-form";
import { StockSymbolCombobox } from "@/components/assets/StockSymbolCombobox";
import type { StockSearchResult } from "@/lib/types";

interface StockAssetFieldsProps {
  idPrefix: string;
  symbol: {
    selected: StockSearchResult | null;
    missing: boolean;
    onSelect: (result: StockSearchResult) => void;
  };
  quantity: UseFormRegisterReturn;
  quantityError?: FieldError;
}

/** A decimal comma is what the FR placeholder asks for, so the field has to admit one. */
const QUANTITY_PATTERN = "[0-9]*[.,]?[0-9]*";

/**
 * The symbol + quantity pair, shared shape for both asset forms. There is deliberately NO price or
 * value input: the value is `quantity x price x FX`, derived in Rust, and an editable field here
 * would be silently overwritten by the next refresh.
 */
export function StockAssetFields({
  idPrefix,
  symbol,
  quantity,
  quantityError,
}: StockAssetFieldsProps) {
  const { t } = useTranslation();
  const quantityId = `${idPrefix}-quantity`;
  const errorId = `${quantityId}-error`;

  return (
    <>
      <StockSymbolCombobox
        labelFor={`${idPrefix}-symbol`}
        selected={symbol.selected}
        invalid={symbol.missing}
        errorMessage={t("assets.stockSymbolRequired")}
        onSelect={symbol.onSelect}
      />

      <div className="space-y-1.5">
        <Label htmlFor={quantityId} required>
          {t("assets.stockQuantity")}
        </Label>
        {/* `type="text"` and not `number`: a number input silently discards a decimal COMMA in
            several locales, so the FR user's "2,5" would arrive as an empty value. The parsing and
            the bounds live in `quantityProblem`, against the scaled micros the backend stores. */}
        <Input
          id={quantityId}
          type="text"
          inputMode="decimal"
          pattern={QUANTITY_PATTERN}
          placeholder={t("assets.stockQuantityPlaceholder")}
          aria-required="true"
          aria-invalid={!!quantityError}
          aria-describedby={quantityError ? errorId : undefined}
          {...quantity}
        />
        {quantityError && (
          <p
            id={errorId}
            className="text-caption text-over-ink"
            data-testid="stock-quantity-error"
          >
            {quantityError.message}
          </p>
        )}
        <p className="text-caption text-ink-dim">
          {t("assets.stockQuantityNote")}
        </p>
      </div>
    </>
  );
}
