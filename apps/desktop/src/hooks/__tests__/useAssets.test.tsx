import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  useCreateStockAsset,
  useRefreshStockPrices,
  useUpdateStockQuantity,
} from "@/hooks/useAssets";
import { queryKeys } from "@/lib/constants";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// The mutation objects have to escape the tree: this suite drives them directly instead of
// clicking a UI, and @testing-library/react is not a dependency of @nixus/desktop.
let createStockAsset: ReturnType<typeof useCreateStockAsset>;
let updateStockQuantity: ReturnType<typeof useUpdateStockQuantity>;
let refreshStockPrices: ReturnType<typeof useRefreshStockPrices>;

function Harness() {
  createStockAsset = useCreateStockAsset();
  updateStockQuantity = useUpdateStockQuantity();
  refreshStockPrices = useRefreshStockPrices();
  return null;
}

const stockAsset = {
  id: 4,
  name: "Shopify",
  asset_type: "stock",
  value_cents: 30_863,
  created_at: "2026-10-27 12:00:00",
  updated_at: "2026-10-27 12:00:00",
  stock: {
    passive_asset_id: 4,
    symbol: "SHOP.TO",
    exchange: "TOR",
    currency: "CAD",
    quantity_micros: 2_500_000,
    last_price_cents: 12_345,
    last_price_at: "2026-10-27 12:00:00",
    fx_rate_to_base_micros: 1_000_000,
    created_at: "2026-10-27 12:00:00",
    updated_at: "2026-10-27 12:00:00",
  },
};

let queryClient: QueryClient;
let container: HTMLDivElement;
let root: Root;
let invalidate: MockInstance;

function render(children: ReactNode) {
  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  });
}

function invalidatedKeys(): string[] {
  return invalidate.mock.calls.map(([options]) =>
    JSON.stringify((options as { queryKey: unknown }).queryKey)
  );
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  invokeMock.mockReset();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  invalidate = vi.spyOn(queryClient, "invalidateQueries");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  render(<Harness />);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  queryClient.clear();
  vi.restoreAllMocks();
});

describe("useCreateStockAsset", () => {
  it("sends snake_case arguments the Rust command declares", async () => {
    invokeMock.mockResolvedValue(stockAsset);

    await act(async () => {
      await createStockAsset.mutateAsync({
        symbol: "SHOP.TO",
        name: "Shopify",
        exchange: "TOR",
        quantity_micros: 2_500_000,
      });
    });

    expect(invokeMock).toHaveBeenCalledWith("create_stock_asset", {
      symbol: "SHOP.TO",
      name: "Shopify",
      exchange: "TOR",
      quantity_micros: 2_500_000,
    });
  });

  it("invalidates the assets and both net-worth keys", async () => {
    invokeMock.mockResolvedValue(stockAsset);

    await act(async () => {
      await createStockAsset.mutateAsync({
        symbol: "SHOP.TO",
        name: "Shopify",
        exchange: "TOR",
        quantity_micros: 2_500_000,
      });
    });

    const keys = invalidatedKeys();
    expect(keys).toContain(JSON.stringify(queryKeys.assets));
    expect(keys).toContain(JSON.stringify(queryKeys.netWorthCurrent));
    expect(keys).toContain(JSON.stringify(queryKeys.netWorthSnapshotsRecent));
  });
});

describe("useUpdateStockQuantity", () => {
  it("sends the id and the scaled quantity, and invalidates net worth", async () => {
    invokeMock.mockResolvedValue(stockAsset);

    await act(async () => {
      await updateStockQuantity.mutateAsync({ id: 4, quantity_micros: 5_000_000 });
    });

    expect(invokeMock).toHaveBeenCalledWith("update_stock_quantity", {
      id: 4,
      quantity_micros: 5_000_000,
    });
    expect(invalidatedKeys()).toContain(
      JSON.stringify(queryKeys.netWorthCurrent)
    );
  });
});

describe("useRefreshStockPrices", () => {
  it("returns the per-symbol results and invalidates assets and net worth", async () => {
    invokeMock.mockResolvedValue([
      { asset_id: 4, symbol: "SHOP.TO", ok: true },
      { asset_id: 5, symbol: "DEAD.TO", ok: false },
    ]);

    let results: Awaited<ReturnType<typeof refreshStockPrices.mutateAsync>> = [];
    await act(async () => {
      results = await refreshStockPrices.mutateAsync();
    });

    expect(invokeMock).toHaveBeenCalledWith("refresh_stock_prices");
    expect(results.filter((result) => !result.ok).map((r) => r.symbol)).toEqual([
      "DEAD.TO",
    ]);
    const keys = invalidatedKeys();
    expect(keys).toContain(JSON.stringify(queryKeys.assets));
    expect(keys).toContain(JSON.stringify(queryKeys.netWorthSnapshotsRecent));
  });

  it("surfaces a provider failure as a rejected mutation rather than an empty success", async () => {
    invokeMock.mockRejectedValue({
      type: "market_data",
      message: "The price service could not be reached",
    });

    await act(async () => {
      await expect(refreshStockPrices.mutateAsync()).rejects.toMatchObject({
        type: "market_data",
      });
    });

    expect(invalidatedKeys()).not.toContain(JSON.stringify(queryKeys.assets));
  });
});
