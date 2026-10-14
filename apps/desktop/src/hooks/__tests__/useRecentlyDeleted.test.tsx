import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useRecentlyDeleted,
  useRestoreDeleted,
} from "@/hooks/useRecentlyDeleted";
import { queryKeys } from "@/lib/constants";
import type { RecentlyDeletedView } from "@/lib/types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function view(overrides: Partial<RecentlyDeletedView> = {}): RecentlyDeletedView {
  return {
    sync_available: true,
    items: [
      {
        id: "income_sources:0a1b2c3d4e5f60718293a4b5c6d7e8f9",
        table_name: "income_sources",
        label: "Salary",
        deleted_at: "2026-10-14 20:00:00",
        days_left: 29,
        child_count: 2,
      },
    ],
    ...overrides,
  };
}

function callsOf(command: string): Record<string, unknown>[] {
  return invokeMock.mock.calls
    .filter((call) => call[0] === command)
    .map((call) => (call[1] ?? {}) as Record<string, unknown>);
}

describe("useRecentlyDeleted", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  const render = (ui: React.ReactNode) => {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
      );
    });
  };

  const settle = async () => {
    const deadline = Date.now() + 2_000;
    do {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    } while (
      (queryClient.isFetching() > 0 || queryClient.isMutating() > 0) &&
      Date.now() < deadline
    );
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
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

  it("reads the list only once it is asked for, under the shared query key", async () => {
    invokeMock.mockResolvedValue(view());
    let hook: ReturnType<typeof useRecentlyDeleted> | undefined;
    function Probe({ enabled }: { enabled: boolean }) {
      hook = useRecentlyDeleted({ enabled });
      return null;
    }

    render(<Probe enabled={false} />);
    await settle();
    expect(callsOf("list_recently_deleted")).toEqual([]);

    render(<Probe enabled />);
    await settle();

    expect(callsOf("list_recently_deleted")).toHaveLength(1);
    expect(hook?.data?.items[0]?.label).toBe("Salary");
    expect(queryClient.getQueryData(queryKeys.recentlyDeleted)).toEqual(view());
  });

  it("reports a local-only profile as having nothing retained", async () => {
    invokeMock.mockResolvedValue(view({ sync_available: false, items: [] }));
    let hook: ReturnType<typeof useRecentlyDeleted> | undefined;
    function Probe() {
      hook = useRecentlyDeleted({ enabled: true });
      return null;
    }

    render(<Probe />);
    await settle();

    expect(hook?.data?.sync_available).toBe(false);
    expect(hook?.data?.items).toEqual([]);
  });

  it("restores by the handle the backend gave it and invalidates the list", async () => {
    invokeMock.mockResolvedValue({ table_name: "income_sources", restored_rows: 3 });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    let restore: ReturnType<typeof useRestoreDeleted> | undefined;
    function Probe() {
      restore = useRestoreDeleted();
      return null;
    }

    render(<Probe />);
    await act(async () => {
      await restore!.mutateAsync("income_sources:0a1b");
    });
    await settle();

    expect(callsOf("restore_deleted")).toEqual([{ id: "income_sources:0a1b" }]);
    expect(
      invalidate.mock.calls.some(
        (call) =>
          JSON.stringify((call[0] as { queryKey?: unknown })?.queryKey) ===
          JSON.stringify(queryKeys.recentlyDeleted)
      )
    ).toBe(true);
  });

  it("surfaces a refused restore as the rejection it is", async () => {
    invokeMock.mockRejectedValue({
      type: "sync",
      code: "restore_conflict",
      message: "Something with the same key exists again.",
      recoverable: false,
    });
    let restore: ReturnType<typeof useRestoreDeleted> | undefined;
    function Probe() {
      restore = useRestoreDeleted();
      return null;
    }

    render(<Probe />);
    await act(async () => {
      await expect(restore!.mutateAsync("income_sources:0a1b")).rejects.toMatchObject({
        code: "restore_conflict",
      });
    });
  });
});
