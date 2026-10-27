import { StrictMode, act } from "react";
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
  StockPricesListener,
  STOCK_PRICES_UPDATED_EVENT,
} from "@/components/shared/StockPricesListener";
import { queryKeys } from "@/lib/constants";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const listenMock = vi.fn();
const unlistenMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

function firedHandler() {
  const [event, handler] = listenMock.mock.calls[0] as [string, () => void];
  expect(event).toBe("stock-prices-updated");
  return handler;
}

describe("StockPricesListener", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let invalidate: MockInstance;

  async function mount() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <StockPricesListener />
        </QueryClientProvider>
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
    listenMock.mockReset();
    unlistenMock.mockReset();
    listenMock.mockResolvedValue(unlistenMock);
    queryClient = new QueryClient();
    invalidate = vi.spyOn(queryClient, "invalidateQueries");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it("subscribes to the event name the Rust side emits", async () => {
    await mount();

    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(STOCK_PRICES_UPDATED_EVENT).toBe("stock-prices-updated");
    expect(firedHandler()).toBeTypeOf("function");
  });

  it("invalidates assets and both net-worth keys when the event fires", async () => {
    await mount();

    act(() => firedHandler()());

    const keys = invalidatedKeys();
    expect(keys).toContain(JSON.stringify(queryKeys.assets));
    expect(keys).toContain(JSON.stringify(queryKeys.netWorthCurrent));
    expect(keys).toContain(JSON.stringify(queryKeys.netWorthSnapshotsRecent));
    expect(keys).toHaveLength(3);
  });

  it("invalidates nothing until the event actually fires", async () => {
    await mount();

    expect(invalidatedKeys()).toEqual([]);
  });

  it("unlistens on unmount", async () => {
    await mount();

    await act(async () => root.unmount());

    expect(unlistenMock).toHaveBeenCalledTimes(1);
  });

  // Without the `cleaned` flag the first mount's listener resolves after its cleanup and is never
  // torn down, leaving StrictMode with two live subscriptions that both invalidate on one event.
  it("keeps exactly one subscription across StrictMode's double mount", async () => {
    await act(async () => {
      root.render(
        <StrictMode>
          <QueryClientProvider client={queryClient}>
            <StockPricesListener />
          </QueryClientProvider>
        </StrictMode>
      );
    });

    expect(listenMock).toHaveBeenCalledTimes(2);
    expect(unlistenMock).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());

    expect(unlistenMock).toHaveBeenCalledTimes(2);
  });
});
