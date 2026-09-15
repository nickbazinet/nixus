import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { useDeleteIncomeSource } from "@/hooks/useIncome";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

let deleteIncomeSource: ReturnType<typeof useDeleteIncomeSource>;

function Harness() {
  deleteIncomeSource = useDeleteIncomeSource();
  return null;
}

describe("useIncome", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let invalidateSpy: MockInstance<QueryClient["invalidateQueries"]>;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
    invalidateSpy.mockRestore();
  });

  it("invalidates the budget summary after deleting a source and its income entries", async () => {
    await act(async () => {
      await deleteIncomeSource.mutateAsync(7);
    });

    expect(invokeMock).toHaveBeenCalledWith("delete_income_source", { id: 7 });
    expect(invalidateSpy.mock.calls.map((call) => call[0]?.queryKey)).toContainEqual([
      "budget-summary",
    ]);
  });
});
