import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APPLIED_INVALIDATE_MS,
  useEnableSync,
  useResolveRemoteChanged,
  useSyncApplied,
  useSyncDiagnostics,
  useSyncStatus,
  useSyncStatusValue,
} from "@/hooks/useSync";
import { queryKeys } from "@/lib/constants";
import type { SyncStatusPayload } from "@/lib/types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const invokeMock = vi.fn();
const unlistenMock = vi.fn();
const listenMock = vi.fn();
const recordedQueryOptions: Record<string, unknown>[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  const realUseQuery = actual.useQuery as unknown as (
    options: Record<string, unknown>
  ) => unknown;
  return {
    ...actual,
    useQuery: (options: Record<string, unknown>) => {
      recordedQueryOptions.push(options);
      return realUseQuery(options);
    },
  };
});

function payload(overrides: Partial<SyncStatusPayload> = {}): SyncStatusPayload {
  return {
    state: "idle",
    dataset_id: "default",
    enabled: true,
    paused: false,
    last_sync_ms: 1_760_000_000_000,
    error_code: null,
    recoverable: true,
    prompt: null,
    ...overrides,
  };
}

function callsOf(command: string): Record<string, unknown>[] {
  return invokeMock.mock.calls
    .filter((call) => call[0] === command)
    .map((call) => (call[1] ?? {}) as Record<string, unknown>);
}

describe("useSync", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let emit: ((payload: SyncStatusPayload) => void) | undefined;
  let emitApplied: ((applied: number) => void) | undefined;

  const render = (ui: React.ReactNode) => {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
      );
    });
  };

  const tick = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  /* react-query resolves a read in a promise chain and only re-renders afterwards, so a single
   * macrotask tick is not a settling point on a loaded machine (CI): flush until nothing is in
   * flight, with a cap so a genuine hang still fails instead of spinning. */
  const settle = async () => {
    const deadline = Date.now() + 2_000;
    do {
      await tick();
    } while (
      (queryClient.isFetching() > 0 || queryClient.isMutating() > 0) &&
      Date.now() < deadline
    );
    await tick();
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    listenMock.mockReset();
    unlistenMock.mockReset();
    recordedQueryOptions.length = 0;
    emit = undefined;
    emitApplied = undefined;
    listenMock.mockImplementation(
      async (
        event: string,
        handler: (event: { payload: unknown }) => void
      ) => {
        // Keyed on the event name: two always-mounted hooks subscribe now, and a single shared
        // emitter would make whichever registered last the only one a test could drive.
        if (event === "sync:applied") {
          emitApplied = (applied) => handler({ payload: applied });
        } else {
          emit = (next) => handler({ payload: next });
        }
        return unlistenMock;
      }
    );
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      root = createRoot(container);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
  });

  it("reads the status through the shared query key and never polls", async () => {
    invokeMock.mockResolvedValue(payload());

    function Probe() {
      useSyncStatus();
      return null;
    }
    render(<Probe />);
    await settle();

    expect(callsOf("sync_status")).toHaveLength(1);
    expect(queryClient.getQueryData(queryKeys.syncStatus)).toEqual(payload());

    const options = recordedQueryOptions.find(
      (o) => JSON.stringify(o.queryKey) === JSON.stringify(queryKeys.syncStatus)
    );
    expect(options?.staleTime).toBe(Infinity);
    expect(options?.refetchInterval).toBeUndefined();
  });

  it("applies a sync:status event without a second invoke", async () => {
    invokeMock.mockResolvedValue(payload());

    function Probe() {
      useSyncStatus();
      return null;
    }
    render(<Probe />);
    await settle();

    const next = payload({ state: "syncing", last_sync_ms: null });
    await act(async () => {
      emit?.(next);
    });

    expect(queryClient.getQueryData(queryKeys.syncStatus)).toEqual(next);
    expect(callsOf("sync_status")).toHaveLength(1);
  });

  it("detaches the sync:status listener on unmount", async () => {
    invokeMock.mockResolvedValue(payload());

    function Probe() {
      useSyncStatus();
      return null;
    }
    render(<Probe />);
    await settle();

    expect(unlistenMock).not.toHaveBeenCalled();
    act(() => root.render(<QueryClientProvider client={queryClient} />));
    await settle();
    expect(unlistenMock).toHaveBeenCalled();
  });

  /* A second subscriber would apply every transition twice, which is why a non-owning reader takes
   * `useSyncStatusValue`. It must still share the indicator's cache entry rather than open a
   * second one, so neither a duplicate listener nor a duplicate read is acceptable. */
  it("reads the shared entry from a second surface without a second listener", async () => {
    invokeMock.mockResolvedValue(payload());

    function Probe() {
      useSyncStatus();
      const reader = useSyncStatusValue();
      return <span>{reader.data?.state ?? "pending"}</span>;
    }
    render(<Probe />);
    await settle();

    expect(listenMock.mock.calls.filter((call) => call[0] === "sync:status"))
      .toHaveLength(1);
    expect(callsOf("sync_status")).toHaveLength(1);
    expect(container.textContent).toBe("idle");

    const next = payload({ state: "offline" });
    await act(async () => {
      emit?.(next);
    });
    await settle();
    expect(container.textContent).toBe("offline");
  });

  it("survives a webview with no event plugin", async () => {
    invokeMock.mockResolvedValue(payload());
    listenMock.mockRejectedValue(new Error("no event plugin"));

    function Probe() {
      const status = useSyncStatus();
      return <span>{status.data?.state ?? "pending"}</span>;
    }
    render(<Probe />);
    await settle();
    await settle();

    expect(container.textContent).toBe("idle");
  });

  it("sends the link choice as a snake_case argument", async () => {
    invokeMock.mockResolvedValue({ outcome: "enabled", state: "syncing" });

    let enable: ReturnType<typeof useEnableSync>;
    function Probe() {
      enable = useEnableSync();
      return null;
    }
    render(<Probe />);
    await act(async () => {
      await enable!.mutateAsync("replace");
    });

    expect(callsOf("sync_enable")).toEqual([{ link_choice: "replace" }]);
  });

  it("asks without a choice when none is given", async () => {
    invokeMock.mockResolvedValue({ outcome: "enabled", state: "syncing" });

    let enable: ReturnType<typeof useEnableSync>;
    function Probe() {
      enable = useEnableSync();
      return null;
    }
    render(<Probe />);
    await act(async () => {
      await enable!.mutateAsync(undefined);
    });

    expect(callsOf("sync_enable")).toEqual([{ link_choice: null }]);
  });

  it("re-reads the status only when enable did not finish the job", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "sync_status") return Promise.resolve(payload());
      return Promise.resolve({
        outcome: "link_choice_required",
        local_rows: 12,
        remote_created_ms: 1,
        remote_schema_version: 30,
      });
    });

    let enable: ReturnType<typeof useEnableSync>;
    function Probe() {
      useSyncStatus();
      enable = useEnableSync();
      return null;
    }
    render(<Probe />);
    await settle();
    expect(callsOf("sync_status")).toHaveLength(1);

    await act(async () => {
      await enable!.mutateAsync(undefined);
    });
    await settle();

    expect(callsOf("sync_status")).toHaveLength(2);
  });

  it("publishes the prompt answer's returned payload", async () => {
    const resolved = payload({ state: "idle", last_sync_ms: 42 });
    invokeMock.mockResolvedValue(resolved);

    let resolveRemote: ReturnType<typeof useResolveRemoteChanged>;
    function Probe() {
      resolveRemote = useResolveRemoteChanged();
      return null;
    }
    render(<Probe />);

    queryClient.setQueryData(queryKeys.syncStatus, payload({ state: "error" }));
    await act(async () => {
      await resolveRemote!.mutateAsync("load_remote");
    });

    expect(callsOf("sync_resolve_remote_changed")).toEqual([
      { action: "load_remote" },
    ]);
    expect(queryClient.getQueryData(queryKeys.syncStatus)).toEqual(resolved);
  });

  it("raises the applied cue on a sync:applied event and dismisses it by hand", async () => {
    let cue: { visible: boolean; dismiss: () => void } | undefined;

    function Probe() {
      cue = useSyncApplied();
      return null;
    }
    render(<Probe />);
    await settle();

    expect(listenMock.mock.calls.map((call) => call[0])).toContain("sync:applied");
    expect(cue?.visible).toBe(false);

    await act(async () => {
      emitApplied?.(3);
    });
    await settle();
    expect(cue?.visible).toBe(true);

    await act(async () => {
      cue?.dismiss();
    });
    await settle();
    expect(cue?.visible).toBe(false);
  });

  it("ignores a sync:applied event that applied nothing", async () => {
    let cue: { visible: boolean } | undefined;

    function Probe() {
      cue = useSyncApplied();
      return null;
    }
    render(<Probe />);
    await settle();

    await act(async () => {
      emitApplied?.(0);
    });
    await settle();

    expect(cue?.visible).toBe(false);
  });

  it("detaches the applied listener on unmount", async () => {
    function Probe() {
      useSyncApplied();
      return null;
    }
    render(<Probe />);
    await settle();

    act(() => root.render(<div />));
    await settle();

    expect(unlistenMock).toHaveBeenCalled();
  });

  it("refreshes every non-sync query once per applied burst", async () => {
    invokeMock.mockResolvedValue(payload());
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    function Probe() {
      useSyncStatus();
      return null;
    }
    render(<Probe />);
    await settle();
    spy.mockClear();

    await act(async () => {
      emitApplied?.(2);
      emitApplied?.(3);
    });
    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, APPLIED_INVALIDATE_MS + 50)
      );
    });
    await settle();

    expect(spy).toHaveBeenCalledTimes(1);
    const predicate = (
      spy.mock.calls[0][0] as {
        predicate: (query: { queryKey: readonly unknown[] }) => boolean;
      }
    ).predicate;
    expect(predicate({ queryKey: ["expenses"] })).toBe(true);
    expect(predicate({ queryKey: queryKeys.accounts })).toBe(true);
    expect(predicate({ queryKey: queryKeys.syncStatus })).toBe(false);
    expect(predicate({ queryKey: queryKeys.syncDiagnostics })).toBe(false);
  });

  it("ignores an applied event that applied nothing", async () => {
    invokeMock.mockResolvedValue(payload());
    const spy = vi.spyOn(queryClient, "invalidateQueries");

    function Probe() {
      useSyncStatus();
      return null;
    }
    render(<Probe />);
    await settle();
    spy.mockClear();

    await act(async () => {
      emitApplied?.(0);
    });
    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, APPLIED_INVALIDATE_MS + 50)
      );
    });
    await settle();

    expect(spy).not.toHaveBeenCalled();
  });

  it("reads diagnostics only once asked", async () => {
    invokeMock.mockResolvedValue({ state: "idle", uploads: 1 });

    function Probe({ enabled }: { enabled: boolean }) {
      useSyncDiagnostics({ enabled });
      return null;
    }
    render(<Probe enabled={false} />);
    await settle();
    expect(callsOf("sync_diagnostics")).toHaveLength(0);

    render(<Probe enabled />);
    await settle();
    expect(callsOf("sync_diagnostics")).toHaveLength(1);

    const diagnosticsOptions = recordedQueryOptions.filter(
      (o) =>
        JSON.stringify(o.queryKey) === JSON.stringify(queryKeys.syncDiagnostics)
    );
    expect(diagnosticsOptions.length).toBeGreaterThan(0);
    expect(diagnosticsOptions[diagnosticsOptions.length - 1].queryKey).toEqual(
      queryKeys.syncDiagnostics
    );
  });
});
