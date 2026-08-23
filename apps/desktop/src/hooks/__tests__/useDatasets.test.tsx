import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MutationObserver,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDatasetMutationOptions,
  deleteDatasetMutationOptions,
  renameDatasetMutationOptions,
  selectDatasetMutationOptions,
  useSelectDataset,
} from "@/hooks/useDatasets";
import { PROFILE_SCOPED_STORAGE_KEYS } from "@/lib/datasetSwitch";
import { installLocalStorageMock } from "@/test/localStorageMock";

installLocalStorageMock();

const GLOBAL_PREFERENCE_KEYS = [
  "theme",
  "i18nextLng",
  "rail-collapsed",
  "values-hidden",
  "nixus:last_used_agent_id",
];

function seedPreviousProfileStorage() {
  localStorage.clear();
  for (const key of PROFILE_SCOPED_STORAGE_KEYS) {
    localStorage.setItem(key, "previous-profile");
  }
  for (const key of GLOBAL_PREFERENCE_KEYS) {
    localStorage.setItem(key, "mine");
  }
}

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

const RENAME_REJECTED = {
  type: "Validation",
  message: "A profile name must be between 1 and 80 characters",
  field: "label",
} as const;

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

const CREATED = {
  id: "0f9a1d3c-2b4e-4a6f-8c1d-5e7a9b0c2d4e",
  label: "Local Profile 1",
  kind: "local",
  cognito_sub: null,
  linked_from: null,
  is_default: false,
  created_at: "2026-08-19T00:00:00+00:00",
} as const;

/** Same seam as `runSelection`: the cache decision is the contract, not markup. */
function runCreate(queryClient: QueryClient) {
  return new MutationObserver(
    queryClient,
    createDatasetMutationOptions(queryClient),
  ).mutate();
}

describe("createDatasetMutationOptions", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(CREATED);
  });

  it("invalidates the datasets list while every other cached entry survives", async () => {
    const queryClient = newClient();
    seedPreviousDataset(queryClient);

    await runCreate(queryClient);

    expect(invokeMock.mock.calls).toEqual([["create_dataset"]]);
    expect(queryClient.getQueryState(["datasets"])?.isInvalidated).toBe(true);

    // The half that fails under `clear()`, and the reason this test exists: creating adds a row and
    // leaves the active dataset alone, so unrelated cached data must not be dropped. E2E cannot see
    // this — under `clear()` the list query just refetches and the new row appears anyway.
    expect(queryClient.getQueryData(["budget", "summary"])).toEqual({
      total_spent_cents: 999,
    });
  });
});

const RENAMED = { ...CREATED, label: "Work" } as const;

/** Same seam again: which cache keys move is the contract, not markup. */
function runRename(queryClient: QueryClient, label: string) {
  return new MutationObserver(
    queryClient,
    renameDatasetMutationOptions(queryClient),
  ).mutate({ datasetId: CREATED.id, label });
}

describe("renameDatasetMutationOptions", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(RENAMED);
  });

  it("sends the id and label snake_case on the wire, in one invoke", async () => {
    await runRename(newClient(), "Work");

    expect(invokeMock.mock.calls).toEqual([
      ["rename_dataset", { dataset_id: CREATED.id, label: "Work" }],
    ]);
  });

  it("invalidates the list and the active profile while unrelated cached data survives", async () => {
    const queryClient = newClient();
    seedPreviousDataset(queryClient);
    queryClient.setQueryData(["active-profile"], { label: "Local Profile 1" });

    await runRename(queryClient, "Work");

    // Both keys: the picker list renders `label`, and `get_active_profile` carries its own copy for
    // the header — refreshing only the first leaves the open profile's name stale on screen.
    expect(queryClient.getQueryState(["datasets"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["active-profile"])?.isInvalidated).toBe(true);

    // The half that fails under `clear()`: a label edit moves no money, so nothing else may be
    // dropped. E2E cannot see this — a cleared cache simply refetches and looks identical.
    expect(queryClient.getQueryData(["budget", "summary"])).toEqual({
      total_spent_cents: 999,
    });
  });

  it("invalidates nothing when the rename is rejected", async () => {
    const queryClient = newClient();
    seedPreviousDataset(queryClient);
    queryClient.setQueryData(["active-profile"], { label: "Local Profile 1" });
    invokeMock.mockRejectedValueOnce(RENAME_REJECTED);

    // The exact rejected value, so the caller's field-level error handling is what this pins rather
    // than "something threw".
    await expect(runRename(queryClient, "   ")).rejects.toEqual(RENAME_REJECTED);

    expect(queryClient.getQueryState(["datasets"])?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(["active-profile"])?.isInvalidated).toBe(false);
  });
});

const DELETE_REFUSED = {
  type: "Validation",
  message: "The profile you are using cannot be deleted",
  field: "dataset_id",
} as const;

/** Same seam again: which cache keys move is the contract, not markup. */
function runDelete(queryClient: QueryClient) {
  return new MutationObserver(
    queryClient,
    deleteDatasetMutationOptions(queryClient),
  ).mutate(CREATED.id);
}

describe("deleteDatasetMutationOptions", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("sends the id snake_case on the wire, in one invoke", async () => {
    await runDelete(newClient());

    expect(invokeMock.mock.calls).toEqual([
      ["delete_dataset", { dataset_id: CREATED.id }],
    ]);
  });

  it("invalidates the list and the active profile while unrelated cached data survives", async () => {
    const queryClient = newClient();
    seedPreviousDataset(queryClient);
    queryClient.setQueryData(["active-profile"], { label: "Local Profile 1" });

    await runDelete(queryClient);

    expect(queryClient.getQueryState(["datasets"])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["active-profile"])?.isInvalidated).toBe(true);

    // The half that fails under `clear()`: removing one profile moves no other profile's money, so
    // nothing else may be dropped. E2E cannot see this — a cleared cache simply refetches.
    expect(queryClient.getQueryData(["budget", "summary"])).toEqual({
      total_spent_cents: 999,
    });
  });

  it("leaves the open-profile id alone, because a deletion cannot change it", async () => {
    const queryClient = newClient();
    queryClient.setQueryData(["active-dataset-id"], "default");

    await runDelete(queryClient);

    // Rust refuses to delete the open profile outright, so which profile is open provably did not
    // move — invalidating it would be a round-trip for an unchanged answer.
    expect(queryClient.getQueryState(["active-dataset-id"])?.isInvalidated).toBe(
      false,
    );
    expect(queryClient.getQueryData(["active-dataset-id"])).toBe("default");
  });

  it("invalidates nothing when the deletion is refused", async () => {
    const queryClient = newClient();
    seedPreviousDataset(queryClient);
    queryClient.setQueryData(["active-profile"], { label: "Local Profile 1" });
    invokeMock.mockRejectedValueOnce(DELETE_REFUSED);

    // The exact rejected value, so the caller's inline failure handling is what this pins rather
    // than "something threw".
    await expect(runDelete(queryClient)).rejects.toEqual(DELETE_REFUSED);

    expect(queryClient.getQueryState(["datasets"])?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(["active-profile"])?.isInvalidated).toBe(false);
    // The refused profile has to still be listed, or the row the user must retry from is gone.
    expect(queryClient.getQueryData(["datasets"])).toEqual([{ id: "previous" }]);
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
    localStorage.clear();
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

  // Why the sweep is duplicated here and in the `dataset:switched` listener: the listener is
  // asynchronous, and the caller navigates the moment `mutateAsync` resolves.
  it("removes the previous profile's storage before mutateAsync resolves, and keeps global preferences", async () => {
    seedPreviousProfileStorage();
    render(<SelectHarness />);

    await act(async () => {
      await selectDataset.mutateAsync("work-1");
    });

    for (const key of PROFILE_SCOPED_STORAGE_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
    }
    for (const key of GLOBAL_PREFERENCE_KEYS) {
      expect(localStorage.getItem(key)).toBe("mine");
    }
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
