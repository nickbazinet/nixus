import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncStatusIndicator } from "@/components/sync/SyncStatusIndicator";
import { queryKeys } from "@/lib/constants";
import en from "@/locales/en.json";
import type { SyncState, SyncStatusPayload } from "@/lib/types";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const invokeMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

/* Keyed on the event name so a test can drive `sync:applied` without also standing in for the
 * status subscription the indicator owns. */
const emitters = new Map<string, (payload: unknown) => void>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: async (event: string, handler: (e: { payload: unknown }) => void) => {
    emitters.set(event, (value) => handler({ payload: value }));
    return () => emitters.delete(event);
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
  Link: ({ children }: { children?: React.ReactNode }) => <a>{children}</a>,
}));

/* The real locale file behind a `t` that also performs interpolation, so an assertion reads the
 * shipped copy rather than a key: a hardcoded English string in the component would still pass a
 * key-only assertion. */
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

/* Base UI primitives are replaced with plain DOM: this suite has no @testing-library and no
 * browser layout, and what is under test is which state produces which label, action and dialog —
 * not the shared package's focus trap, which Playwright covers in a real browser. */
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
    Dialog: ({
      open,
      children,
    }: {
      open: boolean;
      children?: React.ReactNode;
    }) => (open ? <div role="dialog">{children}</div> : null),
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

function payload(overrides: Partial<SyncStatusPayload> = {}): SyncStatusPayload {
  return {
    state: "idle",
    dataset_id: "default",
    enabled: true,
    last_sync_ms: 1_760_000_000_000,
    error_code: null,
    recoverable: true,
    prompt: null,
    ...overrides,
  };
}

const EVERY_STATE: readonly SyncState[] = [
  "idle",
  "syncing",
  "offline",
  "frozen",
  "update_needed",
  "clock_skew",
  "link_choice_required",
  "remote_changed",
  "error",
];

const EXPECTED_LABEL: Record<string, string> = {
  idle: EN["sync.stateIdle"],
  syncing: EN["sync.stateSyncing"],
  offline: EN["sync.stateOffline"],
  frozen: EN["sync.stateFrozen"],
  update_needed: EN["sync.stateUpdateNeeded"],
  clock_skew: EN["sync.stateClockSkew"],
  link_choice_required: EN["sync.stateActionNeeded"],
  remote_changed: EN["sync.stateActionNeeded"],
  error: EN["sync.stateError"],
};

describe("SyncStatusIndicator", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  const mount = (seeded: SyncStatusPayload) => {
    queryClient.setQueryData(queryKeys.syncStatus, seeded);
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SyncStatusIndicator expanded itemClassName="rail-item" />
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

  const indicator = () =>
    container.querySelector<HTMLButtonElement>(
      '[data-testid="sync-status-indicator"]'
    );

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    navigateMock.mockReset();
    emitters.clear();
    invokeMock.mockResolvedValue(payload());
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

  it("renders nothing at all while sync is off", async () => {
    mount(payload({ state: "unlinked", enabled: false }));
    await settle();

    expect(indicator()).toBeNull();
    expect(container.textContent).toBe("");
  });

  it.each(EVERY_STATE)("names the %s state in its accessible label", async (state) => {
    mount(payload({ state }));
    await settle();

    const button = indicator();
    expect(button).not.toBeNull();
    expect(button?.dataset.syncState).toBe(state);
    expect(button?.getAttribute("aria-label")).toBe(
      EN["sync.indicatorLabel"].replace("{{status}}", EXPECTED_LABEL[state])
    );
  });

  it("is a focusable button, not a decorative dot", async () => {
    mount(payload({ state: "error" }));
    await settle();

    const button = indicator();
    expect(button?.tagName).toBe("BUTTON");
    expect(button?.hasAttribute("disabled")).toBe(false);
  });

  it("sends a non-prompt state to the sync settings surface", async () => {
    mount(payload({ state: "offline" }));
    await settle();

    await act(async () => {
      indicator()?.click();
    });

    expect(navigateMock).toHaveBeenCalledWith({
      to: "/settings/ai-provider",
      search: { section: "data" },
    });
  });

  it("opens the link-choice question with its counts and answers it", async () => {
    mount(
      payload({
        state: "link_choice_required",
        prompt: {
          kind: "link_choice",
          local_rows: 1234,
          remote_created_ms: 1_760_000_000_000,
          remote_schema_version: 30,
        },
      })
    );
    await settle();

    const dialog = container.querySelector('[data-testid="sync-link-choice-dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("1234");
    expect(dialog?.textContent).toContain(EN["sync.linkChoiceReplaceBackup"]);

    invokeMock.mockResolvedValue({ outcome: "enabled", state: "syncing" });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="sync-link-choice-replace"]')
        ?.click();
    });

    expect(invokeMock).toHaveBeenCalledWith("sync_enable", {
      link_choice: "replace",
    });
  });

  it("answers the link choice with separate when that option is taken", async () => {
    mount(
      payload({
        state: "link_choice_required",
        prompt: {
          kind: "link_choice",
          local_rows: 7,
          remote_created_ms: 1_760_000_000_000,
          remote_schema_version: 30,
        },
      })
    );
    await settle();

    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "sync_status"
          ? payload({ state: "idle", prompt: null })
          : { outcome: "separate_profile_created", dataset_id: "second" }
      )
    );
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="sync-link-choice-separate"]')
        ?.click();
    });

    expect(invokeMock).toHaveBeenCalledWith("sync_enable", {
      link_choice: "separate",
    });
  });

  /* The shell mounts this on every screen, so a status payload that leaves an optional field out
   * rather than sending `null` must not be able to blank the whole window. */
  it("tolerates a payload that omits the optional fields", async () => {
    mount({ state: "idle" } as SyncStatusPayload);
    await settle();

    expect(indicator()).not.toBeNull();
    expect(
      container.querySelector('[data-testid="sync-link-choice-dialog"]')
    ).toBeNull();
  });

  /* AD-16: a sync fault never degrades the UI. A state this build has never heard of used to miss
   * every arm of the icon table and render `undefined` as an element type, which took the entire
   * app shell down — the one failure mode an always-mounted component must not have. */
  it.each([
    ["an unknown state", { state: "something_new" }],
    ["no state at all", {}],
    ["the wrong shape entirely", []],
  ])("renders nothing for %s", async (_name, data) => {
    mount(data as unknown as SyncStatusPayload);
    await settle();

    expect(indicator()).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders a failed answer as sync copy keyed on the code", async () => {
    mount(
      payload({
        state: "remote_changed",
        prompt: {
          kind: "remote_changed",
          remote_created_ms: 1_760_000_000_000,
          remote_schema_version: 30,
        },
      })
    );
    await settle();

    invokeMock.mockRejectedValue({
      type: "sync",
      code: "restore_failed",
      message: "restore failed",
      recoverable: true,
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="sync-remote-changed-load"]')
        ?.click();
    });
    await settle();

    expect(
      container.querySelector('[data-testid="sync-remote-changed-error"]')?.textContent
    ).toBe(EN["sync.errorRestoreFailed"]);
  });

  it("answers the remote-changed question with keep_local", async () => {
    mount(
      payload({
        state: "remote_changed",
        prompt: {
          kind: "remote_changed",
          remote_created_ms: 1_760_000_000_000,
          remote_schema_version: 30,
        },
      })
    );
    await settle();

    invokeMock.mockResolvedValue(payload({ state: "syncing" }));
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="sync-remote-changed-keep"]')
        ?.click();
    });

    expect(invokeMock).toHaveBeenCalledWith("sync_resolve_remote_changed", {
      action: "keep_local",
    });
  });

  it("lets a question be dismissed and reopened from the indicator", async () => {
    mount(
      payload({
        state: "remote_changed",
        prompt: {
          kind: "remote_changed",
          remote_created_ms: 1_760_000_000_000,
          remote_schema_version: 30,
        },
      })
    );
    await settle();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="sync-remote-changed-later"]')
        ?.click();
    });
    expect(
      container.querySelector('[data-testid="sync-remote-changed-dialog"]')
    ).toBeNull();

    await act(async () => {
      indicator()?.click();
    });
    expect(
      container.querySelector('[data-testid="sync-remote-changed-dialog"]')
    ).not.toBeNull();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe("SyncStatusIndicator applied cue", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  const mount = (seeded: SyncStatusPayload) => {
    queryClient.setQueryData(queryKeys.syncStatus, seeded);
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SyncStatusIndicator expanded itemClassName="rail-item" />
        </QueryClientProvider>
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };

  const cue = () =>
    container.querySelector<HTMLElement>('[data-testid="sync-applied-cue"]');

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    invokeMock.mockReset();
    navigateMock.mockReset();
    emitters.clear();
    invokeMock.mockResolvedValue(payload());
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

  it("shows the changed-on-another-computer cue after remote changes are applied", async () => {
    mount(payload());
    await settle();
    expect(cue()).toBeNull();

    await act(async () => {
      emitters.get("sync:applied")?.(4);
    });
    await settle();

    const shown = cue();
    expect(shown).not.toBeNull();
    expect(shown?.textContent).toContain(EN["sync.appliedCue"]);
    expect(shown?.getAttribute("role")).toBe("status");
    expect(shown?.getAttribute("aria-live")).toBe("polite");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("dismisses the cue without touching the status", async () => {
    mount(payload());
    await settle();

    await act(async () => {
      emitters.get("sync:applied")?.(1);
    });
    await settle();

    const dismiss = cue()?.querySelector<HTMLButtonElement>(
      `[aria-label="${EN["sync.appliedCueDismiss"]}"]`
    );
    expect(dismiss).not.toBeNull();

    await act(async () => {
      dismiss?.click();
    });
    await settle();

    expect(cue()).toBeNull();
    expect(
      (queryClient.getQueryData(queryKeys.syncStatus) as SyncStatusPayload).state
    ).toBe("idle");
  });
});
