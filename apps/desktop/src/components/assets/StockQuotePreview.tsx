import { useTranslation } from "react-i18next";
import { useStockQuote } from "@/hooks/useAssets";
import { parseQuantityToMicros } from "@/lib/assetUtils";
import { currencyLocale, formatCurrency } from "@/lib/formatCurrency";

interface StockQuotePreviewProps {
  symbol: string | null;
  quantity: string;
}

const MICROS = 1_000_000;

/** The quote in its own currency (e.g. "US$10.00"), since that is the number the exchange shows. */
function formatQuotePrice(cents: number, currency: string, language: string) {
  return (cents / 100).toLocaleString(currencyLocale(language), {
    style: "currency",
    currency,
  });
}

/**
 * Readonly price and resulting total for the add form. Display only: the saved holding is valued
 * by the backend refresh, so nothing here is submitted.
 */
export function StockQuotePreview({ symbol, quantity }: StockQuotePreviewProps) {
  const { t, i18n } = useTranslation();
  const { data: quote, isPending, isError } = useStockQuote(symbol);

  if (!symbol) return null;

  if (isPending) {
    return (
      <p className="text-caption text-ink-dim" data-testid="stock-quote-loading">
        {t("assets.stockQuoteLoading")}
      </p>
    );
  }

  if (isError || !quote) {
    return (
      <p className="text-caption text-ink-dim" data-testid="stock-quote-unavailable">
        {t("assets.stockQuoteUnavailable")}
      </p>
    );
  }

  const quantityMicros = parseQuantityToMicros(quantity);
  const totalCents =
    quantityMicros !== null && quantityMicros > 0
      ? Math.round(
          (quantityMicros * quote.price_cents * quote.fx_rate_to_base_micros) /
            (MICROS * MICROS)
        )
      : null;
  const convertsToBase = quote.fx_rate_to_base_micros !== MICROS;

  return (
    <div className="space-y-1" data-testid="stock-quote-preview">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-body">
        <dt className="text-ink-dim">{t("assets.stockCurrentPrice")}</dt>
        <dd className="text-right" data-testid="stock-quote-price">
          {formatQuotePrice(quote.price_cents, quote.currency, i18n.language)}
        </dd>
        <dt className="text-ink-dim">{t("assets.stockTotalToAdd")}</dt>
        <dd className="text-right font-medium" data-testid="stock-quote-total">
          {totalCents === null ? "—" : formatCurrency(totalCents, i18n.language)}
        </dd>
      </dl>
      {convertsToBase && (
        <p className="text-caption text-ink-dim">
          {t("assets.stockFxNote", {
            rate: (quote.fx_rate_to_base_micros / MICROS).toFixed(4),
          })}
        </p>
      )}
    </div>
  );
}
