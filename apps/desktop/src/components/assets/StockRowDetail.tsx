import { useTranslation } from "react-i18next";
import {
  formatQuantity,
  formatQuotePrice,
  microsToQuantity,
} from "@/lib/assetUtils";
import type { StockHolding } from "@/lib/types";

/** Symbol, share count and the last quote, on the line a plain asset uses for its type. */
export function StockRowDetail({ holding }: { holding: StockHolding }) {
  const { t, i18n } = useTranslation();

  return (
    <p className="text-caption text-ink-dim" data-testid="stock-row-detail">
      {holding.symbol} ·{" "}
      {t("assets.stockShares", {
        count: microsToQuantity(holding.quantity_micros),
        quantity: formatQuantity(holding.quantity_micros, i18n.language),
      })}
      {holding.last_price_cents !== null && (
        <>
          {" · "}
          {/* The quote is in the holding's OWN currency, so it is formatted in that currency
            * rather than rendered in the UI's default with a code bolted on the end. */}
          <span data-testid="stock-row-price">
            {formatQuotePrice(
              holding.last_price_cents,
              holding.currency,
              i18n.language
            )}
          </span>
        </>
      )}
    </p>
  );
}
