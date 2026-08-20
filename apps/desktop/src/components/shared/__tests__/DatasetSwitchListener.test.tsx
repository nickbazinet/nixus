import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatasetSwitchListener } from "@/components/shared/DatasetSwitchListener";
import { installLocalStorageMock } from "@/test/localStorageMock";

installLocalStorageMock();

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const listenMock = vi.fn();
const unlistenMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

function firedHandler() {
  const [event, handler] = listenMock.mock.calls[0] as [
    string,
    () => void,
  ];
  expect(event).toBe("dataset:switched");
  return handler;
}

describe("DatasetSwitchListener", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  async function mount() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <DatasetSwitchListener />
        </QueryClientProvider>,
      );
    });
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    listenMock.mockReset();
    unlistenMock.mockReset();
    listenMock.mockResolvedValue(unlistenMock);
    queryClient = new QueryClient();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    container.remove();
    localStorage.clear();
  });

  it("subscribes to dataset:switched", async () => {
    await mount();

    expect(listenMock).toHaveBeenCalledTimes(1);
    expect(firedHandler()).toBeTypeOf("function");
  });

  it("sweeps the profile's cache and storage when the event fires", async () => {
    localStorage.setItem("nixus:import-draft.v1", "previous-profile");
    localStorage.setItem("theme", "dark");
    queryClient.setQueryData(["budget", "summary"], { total_spent_cents: 999 });
    await mount();

    act(() => firedHandler()());

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(localStorage.getItem("nixus:import-draft.v1")).toBeNull();
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("unlistens on unmount", async () => {
    await mount();

    await act(async () => root.unmount());

    expect(unlistenMock).toHaveBeenCalledTimes(1);
  });

  // Without the `cleaned` flag the first mount's listener resolves after its cleanup and is never
  // torn down, leaving StrictMode with two live subscriptions that both sweep on one event.
  it("keeps exactly one subscription across StrictMode's double mount", async () => {
    await act(async () => {
      root.render(
        <StrictMode>
          <QueryClientProvider client={queryClient}>
            <DatasetSwitchListener />
          </QueryClientProvider>
        </StrictMode>,
      );
    });

    expect(listenMock).toHaveBeenCalledTimes(2);
    expect(unlistenMock).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());

    expect(unlistenMock).toHaveBeenCalledTimes(2);
  });
});
