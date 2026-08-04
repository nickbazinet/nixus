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
  useApplySystemTemplate,
  useExportBudgetTemplate,
  useImportBudgetTemplate,
  useSystemTemplateDetail,
  useSystemTemplates,
} from "@/hooks/useBudgetTemplates";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// The mutation objects have to escape the tree: this suite drives them directly instead of
// clicking a UI, and @testing-library/react is not a dependency of @nixus/desktop.
let importTemplate: ReturnType<typeof useImportBudgetTemplate>;
let exportTemplate: ReturnType<typeof useExportBudgetTemplate>;
let applySystemTemplate: ReturnType<typeof useApplySystemTemplate>;
let systemTemplates: ReturnType<typeof useSystemTemplates>;
let templateDetail: ReturnType<typeof useSystemTemplateDetail>;

function Harness() {
  importTemplate = useImportBudgetTemplate();
  exportTemplate = useExportBudgetTemplate();
  applySystemTemplate = useApplySystemTemplate();
  return null;
}

// useSystemTemplates is a query, so it fetches on mount. Keeping it out of the shared
// Harness is what lets the mutation cases keep asserting on invokeMock.mock.calls[0].
function SystemTemplatesHarness() {
  systemTemplates = useSystemTemplates();
  return null;
}

function TemplateDetailHarness({ templateId }: { templateId: string }) {
  templateDetail = useSystemTemplateDetail(templateId);
  return null;
}

describe("useBudgetTemplates", () => {
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

  // React's scheduler can defer the re-render triggered by a resolved query across more
  // than one macrotask turn, so a single setTimeout(0) flush is not reliable (measured
  // ~50-65% failure rate). Poll the render-derived hook result, not the mock (a mocked
  // async fn returns its Promise, and thus records mock.results "return", synchronously —
  // long before that Promise settles).
  async function settleQueries(
    isSettled: () => boolean = () =>
      systemTemplates !== undefined && !systemTemplates.isLoading,
  ) {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (isSettled()) {
        return;
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
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

  it("invokes the import command with no arguments", async () => {
    // Given the backend applies a template cleanly
    invokeMock.mockResolvedValue({
      groups_created: 2,
      categories_created: 7,
      skipped_groups: [],
    });

    // When the user opens a shared template
    await act(async () => {
      await importTemplate.mutateAsync();
    });

    // Then the command carries no payload — the file picker lives in Rust
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]).toEqual(["import_budget_template"]);
  });

  it("invalidates every budget-facing query key after an import", async () => {
    invokeMock.mockResolvedValue({
      groups_created: 2,
      categories_created: 7,
      skipped_groups: [],
    });

    await act(async () => {
      await importTemplate.mutateAsync();
    });

    expect(invalidatedKeys()).toEqual([
      ["budget-groups"],
      ["budget-categories"],
      ["budget-status"],
      ["spending-trends"],
      ["trends-insight"],
      ["all-budget-categories"],
    ]);
  });

  it("invalidates nothing when the user cancels the import", async () => {
    // Given the user closes the native picker without choosing a file
    invokeMock.mockResolvedValue(null);

    await act(async () => {
      await importTemplate.mutateAsync();
    });

    // Then no row changed, so refetching every budget query would be pure waste
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("invalidates nothing on a successful export", async () => {
    invokeMock.mockResolvedValue({ path: "/tmp/t.json" });

    await act(async () => {
      await exportTemplate.mutateAsync();
    });

    expect(invokeMock.mock.calls[0]).toEqual(["export_budget_template"]);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("lists system templates with no arguments", async () => {
    // Given the compiled-const catalogue ships one starter template
    const summaries = [
      {
        id: "canadian-starter",
        name: "Canadian Starter Budget",
        description: "A balanced starting point for a Canadian household.",
      },
    ];
    invokeMock.mockResolvedValue(summaries);

    // When the picker mounts
    render(<SystemTemplatesHarness />);
    await settleQueries();

    // Then the zero-arg command is called once and its payload reaches the caller
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]).toEqual(["list_system_templates"]);
    expect(systemTemplates.data).toEqual(summaries);
  });

  it("applies a system template by snake_case id", async () => {
    // Given the backend seeds the Canadian starter cleanly
    invokeMock.mockResolvedValue({
      groups_created: 4,
      categories_created: 12,
      skipped_groups: [],
    });

    // When the user picks the starter template
    await act(async () => {
      await applySystemTemplate.mutateAsync({ templateId: "canadian-starter" });
    });

    // Then the id crosses IPC under its snake_case name
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock.mock.calls[0]).toEqual([
      "apply_system_template",
      { template_id: "canadian-starter" },
    ]);
  });

  it("sends no overrides argument when the caller passes none", async () => {
    invokeMock.mockResolvedValue({
      groups_created: 4,
      categories_created: 12,
      skipped_groups: [],
    });

    await act(async () => {
      await applySystemTemplate.mutateAsync({ templateId: "canadian-starter" });
    });

    // Rust defaults the parameter to None, so an explicit empty array would be a
    // different request than "apply the authored defaults".
    const payload = invokeMock.mock.calls[0][1] as { overrides?: unknown };
    expect(payload.overrides).toBeUndefined();
  });

  it("maps camelCase overrides to the Rust struct's snake_case fields", async () => {
    invokeMock.mockResolvedValue({
      groups_created: 4,
      categories_created: 12,
      skipped_groups: [],
    });

    // When the user edited two targets before confirming
    await act(async () => {
      await applySystemTemplate.mutateAsync({
        templateId: "canadian-starter",
        overrides: [
          {
            groupName: "Housing",
            categoryName: "Rent / Mortgage",
            targetCents: 275_000,
          },
          {
            groupName: "Living",
            categoryName: "Groceries",
            targetCents: 75_000,
          },
        ],
      });
    });

    // Then every field arrives snake_case, in the order the caller supplied
    expect(invokeMock.mock.calls[0]).toEqual([
      "apply_system_template",
      {
        template_id: "canadian-starter",
        overrides: [
          {
            group_name: "Housing",
            category_name: "Rent / Mortgage",
            target_cents: 275_000,
          },
          {
            group_name: "Living",
            category_name: "Groceries",
            target_cents: 75_000,
          },
        ],
      },
    ]);
  });

  it("exposes the template id through mutation variables while pending", async () => {
    // YourDataSettings reads variables.templateId while isPending to label the row it is
    // applying, and a widened variables shape breaks that silently rather than at compile
    // time. Asserted mid-flight because that is the only window the UI reads it in.
    let releaseInvoke: (value: unknown) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise((resolve) => {
        releaseInvoke = resolve;
      }),
    );

    act(() => {
      applySystemTemplate.mutate({ templateId: "canadian-starter" });
    });
    await settleQueries(() => applySystemTemplate.isPending);

    expect(applySystemTemplate.variables?.templateId).toBe("canadian-starter");

    await act(async () => {
      releaseInvoke({
        groups_created: 4,
        categories_created: 12,
        skipped_groups: [],
      });
    });
  });

  it("invalidates every budget-facing query key after an apply", async () => {
    invokeMock.mockResolvedValue({
      groups_created: 4,
      categories_created: 12,
      skipped_groups: [],
    });

    await act(async () => {
      await applySystemTemplate.mutateAsync({ templateId: "canadian-starter" });
    });

    expect(invalidatedKeys()).toEqual([
      ["budget-groups"],
      ["budget-categories"],
      ["budget-status"],
      ["spending-trends"],
      ["trends-insight"],
      ["all-budget-categories"],
    ]);
  });

  it("does not invalidate onboarding status after an apply", async () => {
    // Story 25.2's boundary: the onboarding component owns that invalidation, so the
    // hook staying out of it is the contract, not an omission.
    invokeMock.mockResolvedValue({
      groups_created: 4,
      categories_created: 12,
      skipped_groups: [],
    });

    await act(async () => {
      await applySystemTemplate.mutateAsync({
        templateId: "canadian-starter",
        overrides: [
          {
            groupName: "Housing",
            categoryName: "Rent / Mortgage",
            targetCents: 1_000,
          },
        ],
      });
    });

    expect(
      invalidateSpy.mock.calls.every(
        (call) => call[0]?.queryKey?.[0] !== "onboarding-status",
      ),
    ).toBe(true);
  });

  it("does not refetch the immutable system-template list after an apply", async () => {
    invokeMock.mockResolvedValue({
      groups_created: 4,
      categories_created: 12,
      skipped_groups: [],
    });

    await act(async () => {
      await applySystemTemplate.mutateAsync({ templateId: "canadian-starter" });
    });

    // Then the catalogue is left alone — it is a compiled Rust const that cannot change
    expect(
      invalidateSpy.mock.calls.every(
        (call) => call[0]?.queryKey?.[0] !== "system-budget-templates",
      ),
    ).toBe(true);
  });

  it("surfaces a rejected apply instead of swallowing it", async () => {
    // Given an unknown id, which Rust rejects with AppError::Validation
    invokeMock.mockRejectedValue({
      type: "validation",
      message: "That starter template is not available.",
      field: "template_id",
    });

    let rejection: unknown;
    await act(async () => {
      rejection = await applySystemTemplate
        .mutateAsync({ templateId: "nope" })
        .then(() => undefined)
        .catch((error: unknown) => error);
    });

    // Then the caller sees the error object, so no null-guard branch can hide it
    expect(rejection).toMatchObject({
      type: "validation",
      message: "That starter template is not available.",
      field: "template_id",
    });
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("fetches a template's full detail by snake_case id", async () => {
    // Given a starter whose targets the list command deliberately omits
    const detail = {
      id: "canadian-starter",
      name: "Canadian Starter Budget",
      description: "A balanced starting point for a Canadian household.",
      groups: [
        {
          name: "Housing",
          categories: [{ name: "Rent / Mortgage", target_cents: 180_000 }],
        },
      ],
    };
    invokeMock.mockResolvedValue(detail);

    // When the preview mounts
    render(<TemplateDetailHarness templateId="canadian-starter" />);
    await settleQueries(
      () => templateDetail !== undefined && !templateDetail.isLoading,
    );

    // Then the id crosses IPC snake_case and the targets reach the caller
    expect(invokeMock.mock.calls[0]).toEqual([
      "get_system_template_detail",
      { template_id: "canadian-starter" },
    ]);
    expect(templateDetail.data).toEqual(detail);
  });

  it("keys the detail query per template id", async () => {
    invokeMock.mockResolvedValue({
      id: "canadian-starter",
      name: "Canadian Starter Budget",
      description: null,
      groups: [],
    });

    render(<TemplateDetailHarness templateId="canadian-starter" />);
    await settleQueries(
      () => templateDetail !== undefined && !templateDetail.isLoading,
    );

    // A shared key would serve one template's targets for another id.
    expect(
      queryClient.getQueryData(["system-budget-templates", "canadian-starter"]),
    ).toBeDefined();
  });

  it("does not fetch detail for an empty template id", async () => {
    // The list query resolves after mount, so the preview renders one pass with no id
    // to ask about — firing that request would hit Rust's unknown-id rejection.
    render(<TemplateDetailHarness templateId="" />);
    await settleQueries(() => true);

    expect(invokeMock).not.toHaveBeenCalled();
    expect(templateDetail.fetchStatus).toBe("idle");
  });
});
