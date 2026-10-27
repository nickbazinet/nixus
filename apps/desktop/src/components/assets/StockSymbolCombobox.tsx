import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  Input,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
  focusRing,
} from "@nixus/shared";
import { cn } from "@/lib/utils";
import { MIN_STOCK_SEARCH_CHARS, useSearchStocks } from "@/hooks/useAssets";
import type { StockSearchResult } from "@/lib/types";

/** Suppress OS/browser autofill on a field that looks like a search box to a password manager. */
const disableBrowserAutocomplete = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  "data-1p-ignore": true,
  "data-lpignore": "true",
} as const;

interface StockSymbolComboboxProps {
  labelFor: string;
  selected: StockSearchResult | null;
  onSelect: (result: StockSearchResult) => void;
  invalid?: boolean;
  errorMessage?: string;
}

export function StockSymbolCombobox({
  labelFor,
  selected,
  onSelect,
  invalid,
  errorMessage,
}: StockSymbolComboboxProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const hintId = useId();
  const errorId = useId();

  const {
    data: results,
    isLoading,
    isError,
    debouncedQuery,
  } = useSearchStocks(query);

  const trimmedQuery = query.trim();
  const tooShort = trimmedQuery.length < MIN_STOCK_SEARCH_CHARS;
  // The query the results actually describe. While the debounce is pending these differ, and
  // reporting "No matching stock" for a query that has not been asked yet is a lie that flickers
  // on every keystroke.
  const settled = debouncedQuery === trimmedQuery;

  const message = useMemo(() => {
    if (tooShort) return t("assets.stockSearchHint");
    // `isLoading`, not `isFetching`: a background refetch of a query that already has results must
    // not replace them with a spinner.
    if (!settled || isLoading) return t("assets.stockSearching");
    if (isError) return t("assets.stockSearchFailed");
    if (!results || results.length === 0) return t("assets.stockSearchEmpty");
    return null;
  }, [isError, isLoading, results, settled, t, tooShort]);

  const displayValue = selected
    ? `${selected.symbol} — ${selected.name}`
    : t("assets.stockSymbolPlaceholder");

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={labelFor} required>
        {t("assets.stockSymbol")}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={labelFor}
              type="button"
              variant="outline"
              aria-invalid={!!invalid}
              aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
              data-testid="stock-symbol-trigger"
              className="w-full justify-start text-body"
            />
          }
        >
          <span className={selected ? "" : "text-ink-faint"}>{displayValue}</span>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--anchor-width)] p-2">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            // Enter in a search box means "search", not "submit the asset form". The popover is
            // rendered inside the form, so without this the first Enter saves a half-filled asset.
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
            placeholder={t("assets.stockSearchPlaceholder")}
            className="mb-2"
            autoFocus
            name="stock-symbol-search"
            data-testid="stock-symbol-search"
            {...disableBrowserAutocomplete}
          />
          <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
            {message && (
              <p
                className="px-2 py-1.5 text-caption text-ink-dim"
                data-testid="stock-symbol-message"
              >
                {message}
              </p>
            )}
            {!message &&
              results?.map((result) => (
                <button
                  key={`${result.symbol}-${result.exchange}`}
                  type="button"
                  className={cn(
                    // shrink-0: inside the height-capped flex column, items would otherwise
                    // shrink below their two-line height and overlap instead of scrolling.
                    "min-h-target-min w-full shrink-0 rounded-md px-2 py-1.5 text-left hover:bg-hover",
                    focusRing
                  )}
                  data-testid="stock-symbol-option"
                  onClick={() => {
                    onSelect(result);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <span className="block text-label text-ink">{result.symbol}</span>
                  <span className="block text-caption text-ink-dim">
                    {result.name}
                    {result.exchange ? ` · ${result.exchange}` : ""}
                  </span>
                </button>
              ))}
          </div>
        </PopoverContent>
      </Popover>
      {/* The reason sits beside the control rather than inside the popover, which a user who has
          not opened it cannot read. */}
      <p id={hintId} className="text-caption text-ink-dim">
        {t("assets.stockSymbolNote")}
      </p>
      {/* `role="alert"` so the refusal is announced: the message appears after a submit the user
          has already stopped looking at the field for. */}
      {invalid && errorMessage && (
        <p
          id={errorId}
          role="alert"
          className="text-caption text-over-ink"
          data-testid="stock-symbol-error"
        >
          {errorMessage}
        </p>
      )}
    </div>
  );
}
