import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MutationObserver,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  selectDatasetMutationOptions,
  useSelectDataset,
} from "@/hooks/useDatasets";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

const OPEN_FAILED = {
  type: "Validation",
  message: "Unknown dataset: missing",
} as const;

const LATCH_FAILED = { type: "Internal", message: "ipc gone" } as const;

/** A client holding entries that demonstrably belong to the previously-open dataset. */
function seedPreviousDataset(queryClient: QueryClient) {
  queryClient.setQueryData(["datasets"], [{ id: "previous" }]);
  queryClient.setQueryData(["budget", "summary"], { total_spent_cents: 999 });
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/**
 * Drives the mutation options directly, with no component. The ordering and the cache clear are
 * the contract here, not markup — and MutationObserver is the seam react-query itself uses.
 */
function runSelection(queryClient: QueryClient, datasetId: string) {
  return new MutationObserver(
    queryClient,
    selectDatasetMutationOptions(queryClient),
  ).mutate(datasetId);
}

describe("selectDatasetMutationOptions", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("opens the dataset before latching the gate, and latches it exactly once", async () => {
    await runSelection(newClient(), "work-1");

    expect(invokeMock.mock.calls).toEqual([
      ["select_dataset", { dataset_id: "work-1" }],
      ["mark_picker_passed"],
    ]);
  });

  it("drops every cached entry once the selection succeeds", async () => {
    const queryClient = newClient();
    seedPreviousDataset(queryClient);

    await runSelection(queryClient, "work-1");

    // AD-7: nothing read from the previous dataset may survive the switch, so the assertion is on
    // the whole cache being empty rather than on named keys being stale.
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getQueryData(["datasets"])).toBeUndefined();
    expect(queryClient.getQueryData(["budget", "summary"])).toBeUndefined();
  });

  it("never latches the gate or clears the cache when the open fails", async () => {
    const queryClient = newClient();
    seedPreviousDataset(queryClient);
    invokeMock.mockRejectedValueOnce(OPEN_FAILED);

    // The exact rejected value, not merely "something threw": an unrelated TypeError from a
    // refactored mutationFn would otherwise satisfy this test while breaking the caller's toast.
    await expect(runSelection(queryClient, "missing")).rejects.toEqual(OPEN_FAILED);

    // The whole point of latching second: a failed open must leave the gate up so the picker is
    // still the next screen, and must not drop the cache it never invalidated.
    expect(invokeMock.mock.calls).toEqual([
      ["select_dataset", { dataset_id: "missing" }],
    ]);
    expect(queryClient.getQueryData(["budget", "summary"])).toEqual({
      total_spent_cents: 999,
    });
  });

  it("surfaces a failed latch as a failed selection instead of navigating anyway", async () => {
    const queryClient = newClient();
    seedPreviousDataset(queryClient);
    invokeMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(LATCH_FAILED);

    await expect(runSelection(queryClient, "work-1")).rejects.toEqual(LATCH_FAILED);

    // The dataset did open, but the gate never latched, so navigating to `/` would be bounced
    // straight back to the picker. Rejecting keeps the user on a screen that still works, and
    // onSuccess never runs, so the cache is left alone too.
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryCache().getAll()).not.toHaveLength(0);
  });
});

// The hook results have to escape the tree: this suite drives them directly instead of clicking a
// UI, and @testing-library/react is not a dependency of @nixus/desktop.
let selectDataset: ReturnType<typeof useSelectDataset>;

function SelectHarness() {
  selectDataset = useSelectDataset();
  return null;
}

describe("useSelectDataset", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  function render(node: ReactNode) {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
      );
    });
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    queryClient = newClient();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
  });

  // The factory cases above all hand the options a client they built themselves, so they stay green
  // even if the hook stopped reading useQueryClient() and cleared a throwaway client instead — a
  // change that clears nothing the app is actually using. Only asserting on the *provider's* client
  // catches that, which is why this case exists alongside them.
  it("clears the client it was given by the provider, not one of its own", async () => {
    seedPreviousDataset(queryClient);
    render(<SelectHarness />);

    await act(async () => {
      await selectDataset.mutateAsync("work-1");
    });

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getQueryData(["datasets"])).toBeUndefined();
    expect(queryClient.getQueryData(["budget", "summary"])).toBeUndefined();
  });

  it("issues the two invokes in order through the hook as well", async () => {
    render(<SelectHarness />);

    await act(async () => {
      await selectDataset.mutateAsync("work-1");
    });

    expect(invokeMock.mock.calls).toEqual([
      ["select_dataset", { dataset_id: "work-1" }],
      ["mark_picker_passed"],
    ]);
  });

  it("leaves the provider's cache intact when the open fails", async () => {
    seedPreviousDataset(queryClient);
    invokeMock.mockRejectedValueOnce(OPEN_FAILED);
    render(<SelectHarness />);

    await act(async () => {
      await expect(selectDataset.mutateAsync("missing")).rejects.toEqual(
        OPEN_FAILED,
      );
    });

    expect(queryClient.getQueryData(["budget", "summary"])).toEqual({
      total_spent_cents: 999,
    });
  });
});
