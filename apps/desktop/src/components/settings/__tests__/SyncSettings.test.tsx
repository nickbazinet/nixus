import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncSettings } from "@/components/settings/SyncSettings";
import { queryKeys } from "@/lib/constants";
import en from "@/locales/en.json";
import type { SyncStatusPayload } from "@/lib/types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
}));

const EN = en as Record<string, string>;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      const template = EN[key] ?? key;
      if (vars === undefined) return template;
      return Object.entries(vars).reduce(
        (acc, [name, value]) => acc.split(`{{${name}}}`).join(String(value)),
        template
      );
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("@nixus/shared", () => {
  const passthrough =
    (tag: "div" | "p" | "span") =>
    ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => {
      const Tag = tag;
      return <Tag {...props}>{children}</Tag>;
    };

  return {
    cn: (...parts: unknown[]) => parts.filter(Boolean).join(" "),
    focusRing: "focus-ring",
    Alert: passthrough("div"),
    AlertTitle: passthrough("p"),
    AlertDescription: passthrough("p"),
    Card: passthrough("div"),
    Button: ({
      children,
      render: _render,
      variant: _variant,
      ...props
    }: Record<string, unknown> & { children?: React.ReactNode }) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
  };
});

function status(overrides: Partial<SyncStatusPayload> = {}): SyncStatusPayload {
  return {
    state: "unlinked",
    dataset_id: "default",
    enabled: false,
    paused: false,
    last_sync_ms: null,
    error_code: null,
    recoverable: true,
    prompt: null,
    ...overrides,
  };
}

describe("SyncSettings", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  const mount = (seeded: { status?: SyncStatusPayload }) => {
    queryClient.setQueryData(queryKeys.syncStatus, seeded.status ?? status());
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SyncSettings />
        </QueryClientProvider>
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

  const at = (testId: string) =>
    container.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

  const click = async (testId: string) => {
    await act(async () => {
      container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
    });
    await settle();
  };

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(status());
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
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

  // Sync is automatic now (no user switch), so the only surfaced status is a problem alert — the
  // settings page carries no status row, account row or switch at all; the sidebar indicator is
  // the discovery path for current state.
  it("does not render the removed account, switch, or status controls", async () => {
    mount({});
    await settle();

    expect(at("sync-switch")).toBeNull();
    expect(at("setting-sync-status")).toBeNull();
    expect(at("setting-sync-account")).toBeNull();
  });

  it("renders a status-error alert for an errored status", async () => {
    mount({
      status: status({
        state: "error",
        enabled: true,
        error_code: "snapshot_build",
        recoverable: true,
      }),
    });
    await settle();

    expect(at("sync-status-error")?.textContent).toContain(
      EN["sync.errorSnapshotBuild"]
    );
  });

  it("renders an unknown error code rather than dropping it", async () => {
    mount({
      status: status({
        state: "error",
        enabled: true,
        error_code: "a_code_from_a_newer_build",
      }),
    });
    await settle();

    expect(at("sync-status-error")?.textContent).toContain(EN["sync.errorTransport"]);
  });

  it("reads diagnostics only when asked and shows counts, never values", async () => {
    mount({ status: status({ state: "idle", enabled: true }) });
    await settle();

    expect(
      invokeMock.mock.calls.filter((c) => c[0] === "sync_diagnostics")
    ).toHaveLength(0);

    invokeMock.mockResolvedValue({
      dataset_id: "default",
      capability: "multi_device_sync",
      state: "idle",
      transitions: [],
      enabled: true,
      has_pulled_latest: true,
      pending_prompt: null,
      uploads: 3,
      conflicts: 1,
      restores: 0,
      failures: 2,
      blocked: 0,
      last_error_code: null,
      last_sync_ms: 1_760_000_000_000,
      last_build_ms: 700,
      last_object_bytes: 2_131_153,
      last_payload_bytes: 14_950_400,
      local_rows: 6000,
      schema_version: 30,
      frozen_reason: null,
      backoff_ms: null,
      settle_window_ms: 5000,
      min_upload_interval_ms: 60000,
      poll_interval_ms: 2000,
    });
    await click("sync-diagnostics-button");

    const output = at("sync-diagnostics-output")?.textContent ?? "";
    expect(output).toContain("3");
    expect(output).toContain(EN["sync.stateIdle"]);
  });

  it("saves a diagnostics report and names the file it wrote", async () => {
    mount({});
    await settle();

    invokeMock.mockResolvedValue({ path: "/tmp/nixus-sync-diagnostics-2026-10-14.json" });
    await click("sync-diagnostics-export-button");

    expect(invokeMock).toHaveBeenCalledWith("sync_export_diagnostics");
    expect(at("sync-diagnostics-export-path")?.textContent).toContain(
      "/tmp/nixus-sync-diagnostics-2026-10-14.json"
    );
    expect(at("sync-action-error")).toBeNull();
  });

  it("treats a cancelled save dialog as neither a path nor an error", async () => {
    mount({});
    await settle();

    invokeMock.mockResolvedValue(null);
    await click("sync-diagnostics-export-button");

    expect(invokeMock).toHaveBeenCalledWith("sync_export_diagnostics");
    expect(at("sync-diagnostics-export-path")).toBeNull();
    expect(at("sync-action-error")).toBeNull();
    expect(at("setting-sync-diagnostics-export")?.textContent).toContain(
      EN["sync.diagnosticsExportBody"]
    );
  });

  it("reports a failed export without claiming a file was written", async () => {
    mount({});
    await settle();

    invokeMock.mockRejectedValue({ type: "file", message: "disk full" });
    await click("sync-diagnostics-export-button");

    expect(at("sync-diagnostics-export-path")).toBeNull();
    expect(at("sync-action-error")).not.toBeNull();
  });
});
