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
  useArchiveProject,
  useConfirmProjectAllocations,
  useCreateProject,
  useCreateProjectContribution,
  useDeleteProjectContribution,
  useReorderProjects,
  useClearSuggestedAllocationSkip,
  useSkipSuggestedAllocation,
  useSuggestedAllocation,
  useUpdateProject,
} from "@/hooks/useProjects";
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
let createProject: ReturnType<typeof useCreateProject>;
let updateProject: ReturnType<typeof useUpdateProject>;
let archiveProject: ReturnType<typeof useArchiveProject>;
let createContribution: ReturnType<typeof useCreateProjectContribution>;
let deleteContribution: ReturnType<typeof useDeleteProjectContribution>;
let reorderProjects: ReturnType<typeof useReorderProjects>;
let confirmAllocations: ReturnType<typeof useConfirmProjectAllocations>;

function Harness() {
  createProject = useCreateProject();
  updateProject = useUpdateProject();
  archiveProject = useArchiveProject();
  createContribution = useCreateProjectContribution();
  deleteContribution = useDeleteProjectContribution();
  reorderProjects = useReorderProjects();
  confirmAllocations = useConfirmProjectAllocations();
  return null;
}

const projectInput = {
  name: "Kitchen",
  target_cents: 1_500_000,
  target_date: null,
  priority: null,
  icon: null,
  color: null,
};

const contributionRow = {
  id: 7,
  project_id: 3,
  account_id: 2,
  amount_cents: 25_000,
  source: "manual",
  date: "2026-08-01",
  created_at: "2026-08-01T00:00:00Z",
};

describe("useProjects dashboard summary invalidation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let invalidateSpy: MockInstance<QueryClient["invalidateQueries"]>;

  function render(node: ReactNode) {
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
      );
    });
  }

  function invalidatedKeys(): unknown[] {
    return invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
  }

  function invalidatedSummary(): boolean {
    return invalidatedKeys().some(
      (key) =>
        Array.isArray(key) && key[0] === queryKeys.savingsProjectsSummary[0],
    );
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    render(<Harness />);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
    invalidateSpy.mockRestore();
  });

  it("invalidates the dashboard summary after logging a contribution", async () => {
    // Given the backend accepts the contribution
    invokeMock.mockResolvedValue(contributionRow);

    // When the user logs it
    await act(async () => {
      await createContribution.mutateAsync({
        project_id: contributionRow.project_id,
        account_id: contributionRow.account_id,
        amount_cents: contributionRow.amount_cents,
        date: contributionRow.date,
      });
    });

    // Then the dashboard card's figure is stale and must refetch without a page reload
    expect(invalidatedSummary()).toBe(true);
  });

  it("invalidates the dashboard summary after deleting a contribution", async () => {
    invokeMock.mockResolvedValue(contributionRow);

    await act(async () => {
      await deleteContribution.mutateAsync(contributionRow.id);
    });

    expect(invalidatedSummary()).toBe(true);
  });

  it("invalidates the dashboard summary after creating a project", async () => {
    invokeMock.mockResolvedValue({ id: 3, ...projectInput });

    await act(async () => {
      await createProject.mutateAsync(projectInput);
    });

    expect(invalidatedSummary()).toBe(true);
  });

  it("invalidates the dashboard summary after updating a project", async () => {
    invokeMock.mockResolvedValue({ id: 3, ...projectInput });

    await act(async () => {
      await updateProject.mutateAsync({ id: 3, ...projectInput });
    });

    expect(invalidatedSummary()).toBe(true);
  });

  it("invalidates the dashboard summary after archiving a project", async () => {
    invokeMock.mockResolvedValue({ id: 3, ...projectInput });

    await act(async () => {
      await archiveProject.mutateAsync(3);
    });

    expect(invalidatedSummary()).toBe(true);
  });
});

describe("useReorderProjects", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let invalidateSpy: MockInstance<QueryClient["invalidateQueries"]>;

  function invalidatedKeys(): unknown[] {
    return invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
  }

  function invalidated(key: readonly unknown[]): boolean {
    return invalidatedKeys().some(
      (candidate) =>
        Array.isArray(candidate) &&
        candidate.length === key.length &&
        candidate.every((part, index) => part === key[index]),
    );
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
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

  it("sends the submitted order as a snake_case project_ids array", async () => {
    // Given the backend accepts the reorder
    invokeMock.mockResolvedValue([]);

    // When the user reorders three projects
    await act(async () => {
      await reorderProjects.mutateAsync([3, 1, 2]);
    });

    // Then the wire contract matches the Rust command signature exactly
    expect(invokeMock.mock.calls[0]).toEqual([
      "reorder_projects",
      { project_ids: [3, 1, 2] },
    ]);
  });

  it("invalidates the projects list and the suggested allocation", async () => {
    invokeMock.mockResolvedValue([]);

    await act(async () => {
      await reorderProjects.mutateAsync([2, 1]);
    });

    expect(invalidated(queryKeys.projects)).toBe(true);
    expect(invalidated(queryKeys.suggestedAllocation)).toBe(true);
  });

  it("leaves the saved-total and earmark keys alone, because a reorder moves no money", async () => {
    invokeMock.mockResolvedValue([]);

    await act(async () => {
      await reorderProjects.mutateAsync([2, 1]);
    });

    expect(invalidated(queryKeys.projectSavedTotals)).toBe(false);
    expect(invalidated(queryKeys.savingsProjectsSummary)).toBe(false);
    expect(invalidated(queryKeys.financialHealth)).toBe(false);
  });
});

describe("useConfirmProjectAllocations", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let invalidateSpy: MockInstance<QueryClient["invalidateQueries"]>;

  const createdRows = [
    {
      id: 11,
      project_id: 3,
      account_id: 2,
      amount_cents: 30_000,
      source: "suggested",
      date: "2026-08-11",
      created_at: "2026-08-11T00:00:00Z",
    },
    {
      id: 12,
      project_id: 4,
      account_id: 5,
      amount_cents: 20_000,
      source: "suggested",
      date: "2026-08-11",
      created_at: "2026-08-11T00:00:00Z",
    },
  ];

  const payload = createdRows.map((row) => ({
    project_id: row.project_id,
    account_id: row.account_id,
    amount_cents: row.amount_cents,
    date: row.date,
  }));

  function invalidatedKeys(): unknown[] {
    return invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
  }

  function invalidated(key: readonly unknown[]): boolean {
    return invalidatedKeys().some(
      (candidate) =>
        Array.isArray(candidate) &&
        candidate.length === key.length &&
        candidate.every((part, index) => part === key[index]),
    );
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
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

  it("sends the batch as a single snake_case allocations array with no source field", async () => {
    // Given the backend accepts the confirmation
    invokeMock.mockResolvedValue(createdRows);

    // When the user confirms a two-project split
    await act(async () => {
      await confirmAllocations.mutateAsync(payload);
    });

    // Then the wire contract matches the Rust command signature exactly
    expect(invokeMock.mock.calls[0]).toEqual([
      "confirm_project_allocations",
      { allocations: payload },
    ]);
    expect(JSON.stringify(invokeMock.mock.calls[0])).not.toContain("source");
  });

  it("invalidates the same keys as a manual contribution, plus the suggested allocation", async () => {
    invokeMock.mockResolvedValue(createdRows);

    await act(async () => {
      await confirmAllocations.mutateAsync(payload);
    });

    expect(invalidated(queryKeys.projects)).toBe(true);
    expect(invalidated(queryKeys.projectSavedTotals)).toBe(true);
    expect(invalidated(queryKeys.savingsProjectsSummary)).toBe(true);
    expect(invalidated(queryKeys.suggestedAllocation)).toBe(true);
  });

  it("invalidates one earmark and one contributions key per distinct id in the batch", async () => {
    invokeMock.mockResolvedValue(createdRows);

    await act(async () => {
      await confirmAllocations.mutateAsync(payload);
    });

    expect(invalidated(queryKeys.accountEarmarks(2))).toBe(true);
    expect(invalidated(queryKeys.accountEarmarks(5))).toBe(true);
    expect(invalidated(queryKeys.projectContributions(3))).toBe(true);
    expect(invalidated(queryKeys.projectContributions(4))).toBe(true);
  });

  it("leaves the financial-health keys alone, because a contribution moves no money", async () => {
    invokeMock.mockResolvedValue(createdRows);

    await act(async () => {
      await confirmAllocations.mutateAsync(payload);
    });

    expect(invalidated(queryKeys.financialHealth)).toBe(false);
  });

  it("invalidates nothing when the confirmation is rejected", async () => {
    invokeMock.mockRejectedValue({
      type: "validation",
      message: "over the cap",
      field: "amount_cents",
    });

    await act(async () => {
      await expect(confirmAllocations.mutateAsync(payload)).rejects.toBeTruthy();
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("useSuggestedAllocation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let invalidateSpy: MockInstance<QueryClient["invalidateQueries"]>;

  function QueryHarness() {
    useSuggestedAllocation();
    return null;
  }

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
    invalidateSpy.mockRestore();
  });

  it("invokes the read command with no arguments", async () => {
    // Given the backend is gated out and returns an empty split
    invokeMock.mockResolvedValue([]);

    // When the hook mounts
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <QueryHarness />
        </QueryClientProvider>,
      );
    });

    // Then the wire contract matches the parameterless Rust command signature exactly
    expect(invokeMock.mock.calls[0]).toEqual(["get_suggested_allocation"]);
  });

  it("invalidates nothing, because reading a suggestion changes no server state", async () => {
    invokeMock.mockResolvedValue([]);

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <QueryHarness />
        </QueryClientProvider>,
      );
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("settling the suggested split for a month", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let invalidateSpy: MockInstance<QueryClient["invalidateQueries"]>;
  let skipSuggestion: ReturnType<typeof useSkipSuggestedAllocation>;
  let clearSkip: ReturnType<typeof useClearSuggestedAllocationSkip>;

  function SettleHarness() {
    skipSuggestion = useSkipSuggestedAllocation();
    clearSkip = useClearSuggestedAllocationSkip();
    return null;
  }

  function invalidatedKey(
    spy: MockInstance<QueryClient["invalidateQueries"]>,
    key: readonly unknown[]
  ) {
    return spy.mock.calls.some(
      ([arg]) => JSON.stringify(arg) === JSON.stringify({ queryKey: key })
    );
  }

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SettleHarness />
        </QueryClientProvider>,
      );
    });
    invalidateSpy.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    queryClient.clear();
    invalidateSpy.mockRestore();
  });

  it("sends the parameterless skip command and invalidates only the suggestion", async () => {
    // Given the backend accepts the skip and echoes the month it stored
    invokeMock.mockResolvedValue("2026-08");

    // When the user skips this month's split
    await act(async () => {
      await skipSuggestion.mutateAsync();
    });

    // Then one command went out, and no money-shaped query key was invalidated
    expect(invokeMock.mock.calls).toEqual([
      ["skip_suggested_allocation_for_month"],
    ]);
    expect(invalidatedKey(invalidateSpy, queryKeys.suggestedAllocation)).toBe(
      true
    );
    expect(invalidatedKey(invalidateSpy, queryKeys.projectSavedTotals)).toBe(
      false
    );
    expect(invalidatedKey(invalidateSpy, queryKeys.projects)).toBe(false);
  });

  // The frontend twin of the ledger-level Rust regression test: no path may turn a skip into a
  // contribution write.
  it("never sends a contribution command when skipping", async () => {
    invokeMock.mockResolvedValue("2026-08");

    await act(async () => {
      await skipSuggestion.mutateAsync();
    });

    const commands = invokeMock.mock.calls.map(([command]) => command);
    expect(commands).not.toContain("confirm_project_allocations");
    expect(commands).not.toContain("create_project_contribution");
  });

  it("sends the parameterless clear command and refreshes the suggestion", async () => {
    invokeMock.mockResolvedValue(null);

    await act(async () => {
      await clearSkip.mutateAsync();
    });

    expect(invokeMock.mock.calls).toEqual([
      ["clear_suggested_allocation_skip"],
    ]);
    expect(invalidatedKey(invalidateSpy, queryKeys.suggestedAllocation)).toBe(
      true
    );
  });
});
