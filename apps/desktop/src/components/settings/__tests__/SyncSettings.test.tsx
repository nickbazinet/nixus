import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncSettings } from "@/components/settings/SyncSettings";
import { queryKeys } from "@/lib/constants";
import en from "@/locales/en.json";
import type { ActiveProfile } from "@/hooks/useDatasets";
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

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
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
    Dialog: ({ open, children }: { open: boolean; children?: React.ReactNode }) =>
      open ? <div role="dialog">{children}</div> : null,
    DialogContent: passthrough("div"),
    DialogHeader: passthrough("div"),
    DialogTitle: passthrough("p"),
    DialogDescription: passthrough("p"),
    DialogFooter: passthrough("div"),
    StepProgress: ({ label, valueText }: { label: string; valueText?: string }) => (
      <div role="progressbar" aria-label={label} aria-valuetext={valueText} />
    ),
    TooltipProvider: passthrough("div"),
    Tooltip: passthrough("div"),
    TooltipContent: passthrough("div"),
    TooltipTrigger: ({
      children,
      ...props
    }: Record<string, unknown> & { children?: React.ReactNode }) => (
      <button {...props}>{children}</button>
    ),
  };
});

function status(overrides: Partial<SyncStatusPayload> = {}): SyncStatusPayload {
  return {
    state: "unlinked",
    dataset_id: "default",
    enabled: false,
    last_sync_ms: null,
    error_code: null,
    recoverable: true,
    prompt: null,
    ...overrides,
  };
}

function profile(overrides: Partial<ActiveProfile> = {}): ActiveProfile {
  return {
    dataset_id: "default",
    kind: "cloud-linked",
    label: "Nicolas",
    is_signed_in: true,
    ...overrides,
  };
}

describe("SyncSettings", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  const mount = (seeded: {
    status?: SyncStatusPayload;
    profile?: ActiveProfile;
  }) => {
    queryClient.setQueryData(queryKeys.syncStatus, seeded.status ?? status());
    queryClient.setQueryData(queryKeys.activeProfile, seeded.profile ?? profile());
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SyncSettings />
        </QueryClientProvider>
      );
    });
  };

  const settle = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
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

  it("explains what is synced and what is not", async () => {
    mount({});
    await settle();

    const explainer = at("setting-sync-explainer");
    expect(explainer?.textContent).toContain(EN["sync.whatIsSyncedBody"]);
    expect(explainer?.textContent).toContain(EN["sync.whatIsNotSyncedBody"]);
    expect(explainer?.textContent).toContain(EN["sync.whereItLivesBody"]);
  });

  it("offers the enable button for a signed-in cloud profile", async () => {
    mount({});
    await settle();

    expect(at("setting-sync-unavailable")).toBeNull();
    const button = at("sync-enable-button") as HTMLButtonElement | null;
    expect(button?.hasAttribute("disabled")).toBe(false);

    invokeMock.mockResolvedValue({ outcome: "enabled", state: "syncing" });
    await click("sync-enable-button");

    expect(invokeMock).toHaveBeenCalledWith("sync_enable", { link_choice: null });
    expect(at("sync-first-sync-dialog")).not.toBeNull();
  });

  it("disables enabling for a local-only profile and says why", async () => {
    mount({ profile: profile({ kind: "local", is_signed_in: false }) });
    await settle();

    const row = at("setting-sync-unavailable");
    expect(row?.textContent).toContain(EN["sync.unavailableLocalOnlyTitle"]);
    expect(row?.textContent).toContain(EN["sync.unavailableLocalOnlyBody"]);
    expect(
      (at("sync-enable-button") as HTMLButtonElement | null)?.hasAttribute("disabled")
    ).toBe(true);
    expect(at("sync-sign-in-link")).toBeNull();
  });

  it("disables enabling for a signed-out cloud profile and offers sign-in", async () => {
    mount({ profile: profile({ is_signed_in: false }) });
    await settle();

    const row = at("setting-sync-unavailable");
    expect(row?.textContent).toContain(EN["sync.unavailableSignedOutTitle"]);
    expect(
      (at("sync-enable-button") as HTMLButtonElement | null)?.hasAttribute("disabled")
    ).toBe(true);
    expect(at("sync-sign-in-link")).not.toBeNull();
  });

  it("renders an account without access from the failure code, naming no tier", async () => {
    mount({});
    await settle();

    invokeMock.mockRejectedValue({
      type: "sync",
      code: "not_entitled",
      message: "this account is not entitled to multi-computer sync",
      recoverable: false,
    });
    await click("sync-enable-button");

    expect(at("sync-action-error")?.textContent).toBe(EN["sync.errorNotEntitled"]);
  });

  it("shows the last sync time and the disable action once sync is on", async () => {
    mount({
      status: status({
        state: "idle",
        enabled: true,
        last_sync_ms: 1_760_000_000_000,
      }),
    });
    await settle();

    expect(at("setting-sync-last-sync")?.textContent).not.toContain(
      EN["sync.lastSyncNever"]
    );
    expect(at("setting-sync-status")?.textContent).toContain(EN["sync.stateIdle"]);

    invokeMock.mockResolvedValue(undefined);
    await click("sync-disable-button");
    expect(invokeMock).toHaveBeenCalledWith("sync_disable");
  });

  it("reports an errored status and retries through sync_now", async () => {
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

    invokeMock.mockResolvedValue(status({ state: "syncing", enabled: true }));
    await click("sync-retry-button");
    expect(invokeMock).toHaveBeenCalledWith("sync_now");
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

  it("closes the first-sync dialog when the link choice takes over", async () => {
    mount({});
    await settle();

    invokeMock.mockResolvedValue({
      outcome: "link_choice_required",
      local_rows: 42,
      remote_created_ms: 1_760_000_000_000,
      remote_schema_version: 30,
    });
    await click("sync-enable-button");

    expect(at("sync-first-sync-dialog")).toBeNull();
    expect(at("sync-action-error")).toBeNull();
  });

  it("explains the separate profile it just created", async () => {
    mount({});
    await settle();

    invokeMock.mockResolvedValue({
      outcome: "separate_profile_created",
      dataset_id: "second",
    });
    await click("sync-enable-button");

    expect(at("sync-separate-profile-notice")?.textContent).toContain(
      EN["sync.separateProfileBody"]
    );
  });
});
