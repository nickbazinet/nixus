import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { queryKeys } from "@/lib/constants";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type {
  PassiveAsset,
  CreateAssetInput,
  CreateStockAssetInput,
  StockQuotePreview,
  StockRefreshResult,
  StockSearchResult,
  UpdateAssetInput,
  UpdateAssetValueInput,
  UpdateStockAccountInput,
  UpdateStockQuantityInput,
} from "@/lib/types";

/** The backend answers a shorter query with an empty list, so asking at all is wasted IPC. */
export const MIN_STOCK_SEARCH_CHARS = 2;

const STOCK_SEARCH_DEBOUNCE_MS = 400;

/** Yahoo is rate-limited; re-running the same query on a re-render is the fastest way to a 429. */
const STOCK_SEARCH_STALE_MS = 5 * 60_000;

export function useAssets() {
  return useQuery({
    queryKey: queryKeys.assets,
    queryFn: () => invoke<PassiveAsset[]>("get_assets"),
  });
}

/**
 * Debounced symbol search. The gate is evaluated on the DEBOUNCED query, not the live one, so the
 * first keystroke past the threshold cannot fire a request for the still-pending value.
 */
export function useSearchStocks(query: string) {
  const debouncedQuery = useDebouncedValue(query.trim(), STOCK_SEARCH_DEBOUNCE_MS);
  const enabled = debouncedQuery.length >= MIN_STOCK_SEARCH_CHARS;

  const query_ = useQuery({
    queryKey: queryKeys.stockSearch(debouncedQuery),
    queryFn: () =>
      invoke<StockSearchResult[]>("search_stocks", { query: debouncedQuery }),
    enabled,
    staleTime: STOCK_SEARCH_STALE_MS,
    retry: false,
  });

  // Returned so the caller can tell "results for what you typed" from "results for what you had
  // typed a moment ago", which is the difference between an empty state and a pending one.
  return { ...query_, debouncedQuery };
}

export function useCreateAsset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateAssetInput) =>
      invoke<PassiveAsset>("create_asset", {
        name: input.name,
        asset_type: input.asset_type,
        value_cents: input.value_cents,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assets });
      queryClient.invalidateQueries({ queryKey: queryKeys.netWorthCurrent });
      queryClient.invalidateQueries({ queryKey: queryKeys.netWorthSnapshotsRecent });
    },
  });
}

export function useUpdateAssetValue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateAssetValueInput) =>
      invoke<PassiveAsset>("update_asset_value", {
        id: input.id,
        value_cents: input.value_cents,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assets });
      queryClient.invalidateQueries({ queryKey: queryKeys.netWorthCurrent });
      queryClient.invalidateQueries({ queryKey: queryKeys.netWorthSnapshotsRecent });
    },
  });
}

export function useUpdateAsset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateAssetInput) =>
      invoke<PassiveAsset>("update_asset", {
        id: input.id,
        name: input.name,
        asset_type: input.asset_type,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assets });
    },
  });
}

export function useDeleteAsset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => invoke<void>("delete_asset", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assets });
      queryClient.invalidateQueries({ queryKey: queryKeys.netWorthCurrent });
      queryClient.invalidateQueries({ queryKey: queryKeys.netWorthSnapshotsRecent });
    },
  });
}

/**
 * The keys a change to any asset value invalidates. Exported so the `stock-prices-updated`
 * listener invalidates the SAME set as the mutations do — a second hand-written list is how a
 * background refresh ends up updating the table but not the net-worth figure above it.
 */
export function invalidateAssetsAndNetWorth(
  queryClient: ReturnType<typeof useQueryClient>
) {
  queryClient.invalidateQueries({ queryKey: queryKeys.assets });
  queryClient.invalidateQueries({ queryKey: queryKeys.netWorthCurrent });
  queryClient.invalidateQueries({ queryKey: queryKeys.netWorthSnapshotsRecent });
}

/** The live quote behind the add form's readonly price. Disabled until a listing is picked. */
export function useStockQuote(symbol: string | null) {
  return useQuery({
    queryKey: queryKeys.stockQuote(symbol ?? ""),
    queryFn: () =>
      invoke<StockQuotePreview | null>("get_stock_quote", { symbol }),
    enabled: !!symbol,
    staleTime: 60_000,
    retry: false,
  });
}

export function useCreateStockAsset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateStockAssetInput) =>
      invoke<PassiveAsset>("create_stock_asset", {
        symbol: input.symbol,
        name: input.name,
        exchange: input.exchange,
        quantity_micros: input.quantity_micros,
        account_id: input.account_id,
      }),
    onSuccess: () => invalidateAssetsAndNetWorth(queryClient),
  });
}

/**
 * Moves which account row displays the holding. Net worth is deliberately not invalidated: the
 * link changes no value, and the Accounts page reads the link out of the assets query.
 */
export function useUpdateStockAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateStockAccountInput) =>
      invoke<PassiveAsset>("update_stock_account", {
        id: input.id,
        account_id: input.account_id,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.assets });
    },
  });
}

export function useUpdateStockQuantity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateStockQuantityInput) =>
      invoke<PassiveAsset>("update_stock_quantity", {
        id: input.id,
        quantity_micros: input.quantity_micros,
      }),
    onSuccess: () => invalidateAssetsAndNetWorth(queryClient),
  });
}

export function useRefreshStockPrices() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => invoke<StockRefreshResult[]>("refresh_stock_prices"),
    onSuccess: () => invalidateAssetsAndNetWorth(queryClient),
  });
}
