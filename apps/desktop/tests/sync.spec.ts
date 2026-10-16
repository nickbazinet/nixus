import { test, expect, type Page } from "@playwright/test";

/**
 * The sync surfaces (Story 11) against a mocked Tauri IPC layer.
 *
 * This spec needs a REAL event registry rather than the blanket `plugin:` passthrough most specs
 * use: the status indicator reads `sync_status` once and is then driven exclusively by the
 * `sync:status` event, so a test that cannot emit that event cannot exercise a single transition.
 * The registry shape is the established one from `chat.spec.ts` / `import.spec.ts`.
 */

type SyncState =
  | "unlinked"
  | "idle"
  | "syncing"
  | "offline"
  | "frozen"
  | "update_needed"
  | "clock_skew"
  | "link_choice_required"
  | "remote_changed"
  | "error";

interface SyncPayload {
  state: SyncState;
  dataset_id: string;
  enabled: boolean;
  last_sync_ms: number | null;
  error_code: string | null;
  recoverable: boolean;
  prompt: unknown | null;
}

interface SyncMockOptions {
  status?: Partial<SyncPayload>;
  profileKind?: "local" | "cloud-linked";
  signedIn?: boolean;
  /** Queued `sync_enable` answers, consumed in order; the last one repeats. */
  enableOutcomes?: unknown[];
  enableError?: { type: string; code: string; message: string; recoverable: boolean };
  resolveError?: { type: string; code: string; message: string; recoverable: boolean };
  /** `null` stands in for a cancelled save dialog, which the Rust command answers with. */
  diagnosticsExport?: { path: string } | null;
  diagnosticsExportError?: { type: string; message: string };
}

const UNLINKED: SyncPayload = {
  state: "unlinked",
  dataset_id: "default",
  enabled: false,
  paused: false,
  last_sync_ms: null,
  error_code: null,
  recoverable: true,
  prompt: null,
};

interface MockWindow extends Record<string, unknown> {
  __MOCK_EMIT_SYNC__?: (payload: SyncPayload) => void;
  __MOCK_EMIT_APPLIED__?: (applied: number) => void;
  __MOCK_SYNC_CALLS__?: { cmd: string; args: Record<string, unknown> }[];
}

async function setupSyncMock(page: Page, options: SyncMockOptions = {}) {
  await page.addInitScript((opts: SyncMockOptions) => {
    type EventCallback = (event: {
      event: string;
      payload: unknown;
      id: number;
    }) => void;

    const eventListeners: Record<string, EventCallback[]> = {};
    const callbacks: Record<number, EventCallback> = {};
    let nextCallbackId = 1;

    const w = window as unknown as MockWindow;
    const syncCalls: { cmd: string; args: Record<string, unknown> }[] = [];
    w.__MOCK_SYNC_CALLS__ = syncCalls;

    const initialStatus = {
      state: "unlinked",
      dataset_id: "default",
      enabled: false,
      paused: false,
      last_sync_ms: null,
      error_code: null,
      recoverable: true,
      prompt: null,
      ...(opts.status ?? {}),
    };

    w.__MOCK_EMIT_SYNC__ = (payload) => {
      for (const cb of eventListeners["sync:status"] ?? []) {
        cb({ event: "sync:status", payload, id: 1 });
      }
    };

    w.__MOCK_EMIT_APPLIED__ = (applied) => {
      for (const cb of eventListeners["sync:applied"] ?? []) {
        cb({ event: "sync:applied", payload: applied, id: 2 });
      }
    };

    const enableQueue = [...(opts.enableOutcomes ?? [])];

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      transformCallback: (callback: EventCallback) => {
        const id = nextCallbackId++;
        callbacks[id] = callback;
        return id;
      },
      unregisterCallback: () => {},
      convertFileSrc: (path: string) => path,
      invoke: (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "plugin:event|listen") {
          const event = args.event as string;
          const handlerId = args.handler as number;
          if (!eventListeners[event]) eventListeners[event] = [];
          const cb = callbacks[handlerId];
          if (cb) eventListeners[event].push(cb);
          return Promise.resolve(handlerId);
        }
        if (cmd === "plugin:event|unlisten") return Promise.resolve(null);
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);

        if (cmd.startsWith("sync_")) {
          syncCalls.push({ cmd, args: args ?? {} });
        }

        switch (cmd) {
          case "sync_status":
            return Promise.resolve(initialStatus);
          case "sync_enable": {
            if (opts.enableError !== undefined) {
              return Promise.reject(opts.enableError);
            }
            const next =
              enableQueue.length > 1 ? enableQueue.shift() : enableQueue[0];
            return Promise.resolve(next ?? { outcome: "enabled", state: "syncing" });
          }
          case "sync_disable":
            return Promise.resolve(null);
          case "sync_now":
            return Promise.resolve({
              ...initialStatus,
              state: "syncing",
              enabled: true,
            });
          case "sync_resolve_remote_changed":
            if (opts.resolveError !== undefined) {
              return Promise.reject(opts.resolveError);
            }
            return Promise.resolve({
              ...initialStatus,
              state: "syncing",
              prompt: null,
            });
          case "sync_diagnostics":
            return Promise.resolve({
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
              last_sync_ms: 1760000000000,
              last_build_ms: 719,
              last_object_bytes: 2131153,
              last_payload_bytes: 14950400,
              local_rows: 6000,
              schema_version: 30,
              frozen_reason: null,
              backoff_ms: null,
              settle_window_ms: 5000,
              min_upload_interval_ms: 60000,
              poll_interval_ms: 2000,
            });

          case "sync_export_diagnostics":
            if (opts.diagnosticsExportError !== undefined) {
              return Promise.reject(opts.diagnosticsExportError);
            }
            return Promise.resolve(opts.diagnosticsExport ?? null);

          case "get_active_profile":
            return Promise.resolve({
              dataset_id: "default",
              kind: opts.profileKind ?? "cloud-linked",
              label: "Nicolas",
              is_signed_in: opts.signedIn ?? true,
            });

          case "check_picker_gate":
            return Promise.resolve({ needs_picker: false });
          case "check_onboarding_status":
            return Promise.resolve({ needs_onboarding: false });
          case "get_budget_summary":
            return Promise.resolve({ total_target_cents: 0, total_spent_cents: 0, remaining_cents: 0, month: "2026-10" });
          case "get_current_net_worth":
            return Promise.resolve({ total_cents: 0, cash_cents: 0, investments_cents: 0, assets_cents: 0 });
          case "get_income_total":
            return Promise.resolve(0);
          case "get_savings_projects_summary":
            return Promise.resolve({ active_project_count: 0, total_saved_cents: 0, total_target_cents: 0 });
          case "get_financial_health_summary":
            return Promise.resolve({ data_sufficient: false, emergency_fund: null, savings: null, waterfall: { current_step: "build_emergency_fund", action_line_key: "build_emergency_fund" } });
          case "get_net_worth_change":
            return Promise.resolve({ absolute_change_cents: 0, percentage_change: 0, direction: "flat" });
          case "get_db_status":
            return Promise.resolve({ db_path: "mock.db", wal_mode: true, schema_version: 30, migrations_applied: 30 });
          case "list_system_templates":
            return Promise.resolve([]);
          case "get_auth_session":
            return Promise.resolve({ status: "signed_out" });
          // The account trigger is mounted on every screen, so this read must be answered even
          // where the surface under test has nothing to do with an account.
          case "get_user_avatar":
            return Promise.resolve(null);
          case "get_top_budget_categories":
          case "get_spending_breakdown":
          case "get_recent_net_worth_snapshots":
          case "get_net_worth_history":
          case "get_expenses":
          case "get_budget_groups":
          case "get_all_budget_categories":
          case "get_accounts":
          case "get_assets":
            return Promise.resolve([]);
          default:
            return Promise.resolve(null);
        }
      },
    };

    (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (event: string, eventId: number) => {
        const cb = callbacks[eventId];
        const listeners = eventListeners[event];
        if (!cb || !listeners) return;
        const index = listeners.indexOf(cb);
        if (index !== -1) listeners.splice(index, 1);
      },
    };
  }, options);
}

const emitSync = (page: Page, payload: SyncPayload) =>
  page.evaluate((next) => {
    (window as unknown as MockWindow).__MOCK_EMIT_SYNC__?.(next as SyncPayload);
  }, payload);

const emitApplied = (page: Page, applied: number) =>
  page.evaluate((count) => {
    (window as unknown as MockWindow).__MOCK_EMIT_APPLIED__?.(count as number);
  }, applied);

const syncCalls = (page: Page) =>
  page.evaluate(
    () => (window as unknown as MockWindow).__MOCK_SYNC_CALLS__ ?? []
  );

const SETTINGS_URL = "/settings/ai-provider?section=data";

const indicator = (page: Page) => page.getByTestId("sync-status-indicator");

test.describe("sync settings", () => {
  // Sync is automatic now (no user-facing switch): the settings section carries only the
  // explainer and diagnostics, and a problem is surfaced through an alert. Current state lives
  // in the sidebar indicator instead.
  test("explains what is synced and does not render the removed controls", async ({ page }) => {
    await setupSyncMock(page, { status: { paused: true } });
    await page.goto(SETTINGS_URL);

    const section = page.getByTestId("settings-sync");
    await expect(section).toBeVisible();
    await expect(page.getByTestId("setting-sync-explainer")).toContainText(
      "Pictures are not downloaded up front"
    );
    await expect(page.getByTestId("setting-sync-explainer")).toContainText(
      "never sent"
    );

    await expect(page.getByTestId("sync-switch")).toHaveCount(0);
    await expect(page.getByTestId("setting-sync-status")).toHaveCount(0);
    await expect(page.getByTestId("setting-sync-account")).toHaveCount(0);
  });

  test("an errored status renders a problem alert", async ({ page }) => {
    await setupSyncMock(page, {
      status: {
        state: "error",
        enabled: true,
        error_code: "snapshot_build",
        recoverable: true,
      },
    });
    await page.goto(SETTINGS_URL);

    await expect(page.getByTestId("sync-status-error")).toContainText(
      "could not be prepared"
    );
  });

  test("renders an unknown error code rather than dropping it", async ({ page }) => {
    await setupSyncMock(page, {
      status: {
        state: "error",
        enabled: true,
        error_code: "a_code_from_a_newer_build",
      },
    });
    await page.goto(SETTINGS_URL);

    await expect(page.getByTestId("sync-status-error")).toContainText(
      "Sync could not finish"
    );
  });

  test("diagnostics show counts on demand and never a stored value", async ({ page }) => {
    await setupSyncMock(page, { status: { state: "idle", enabled: true } });
    await page.goto(SETTINGS_URL);

    await expect(page.getByTestId("sync-diagnostics-output")).toHaveCount(0);
    await page.getByTestId("sync-diagnostics-button").click();

    const output = page.getByTestId("sync-diagnostics-output");
    await expect(output).toContainText("Uploads 3");
    await expect(output).toContainText("Conflicts 1");
  });

  test("the diagnostics report is saved through the same command the app uses for exports", async ({
    page,
  }) => {
    await setupSyncMock(page, {
      status: { state: "idle", enabled: true },
      diagnosticsExport: { path: "/tmp/nixus-sync-diagnostics-2026-10-14.json" },
    });
    await page.goto(SETTINGS_URL);

    await expect(page.getByTestId("sync-diagnostics-export-path")).toHaveCount(0);
    await page.getByTestId("sync-diagnostics-export-button").click();

    await expect(page.getByTestId("sync-diagnostics-export-path")).toContainText(
      "/tmp/nixus-sync-diagnostics-2026-10-14.json"
    );
    expect((await syncCalls(page)).map((c) => c.cmd)).toContain(
      "sync_export_diagnostics"
    );
  });

  test("a cancelled save dialog leaves no path and no error", async ({ page }) => {
    await setupSyncMock(page, {
      status: { state: "idle", enabled: true },
      diagnosticsExport: null,
    });
    await page.goto(SETTINGS_URL);

    await page.getByTestId("sync-diagnostics-export-button").click();

    expect((await syncCalls(page)).map((c) => c.cmd)).toContain(
      "sync_export_diagnostics"
    );
    await expect(page.getByTestId("sync-diagnostics-export-path")).toHaveCount(0);
    await expect(page.getByTestId("sync-action-error")).toHaveCount(0);
  });

  test("a failed export reports a problem instead of claiming a file", async ({ page }) => {
    await setupSyncMock(page, {
      status: { state: "idle", enabled: true },
      diagnosticsExportError: { type: "file", message: "disk full" },
    });
    await page.goto(SETTINGS_URL);

    await page.getByTestId("sync-diagnostics-export-button").click();

    await expect(page.getByTestId("sync-action-error")).toBeVisible();
    await expect(page.getByTestId("sync-diagnostics-export-path")).toHaveCount(0);
  });
});

test.describe("sync status indicator", () => {
  test("shows nothing while sync has never been turned on", async ({ page }) => {
    await setupSyncMock(page);
    await page.goto("/");

    await expect(page.getByTestId("settings-link")).toBeVisible();
    await expect(indicator(page)).toHaveCount(0);
  });

  const STATES: { state: SyncState; label: string }[] = [
    { state: "idle", label: "Synced" },
    { state: "syncing", label: "Syncing" },
    { state: "offline", label: "Offline" },
    { state: "frozen", label: "Sync paused" },
    { state: "update_needed", label: "Update needed" },
    { state: "clock_skew", label: "Check the clock" },
    { state: "error", label: "Sync problem" },
  ];

  for (const { state, label } of STATES) {
    test(`renders and names the ${state} state`, async ({ page }) => {
      await setupSyncMock(page, { status: { state, enabled: true } });
      await page.goto("/");

      const button = indicator(page);
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute("data-sync-state", state);
      await expect(button).toHaveAccessibleName(`Sync: ${label}`);
    });
  }

  test("is reachable and operable from the keyboard", async ({ page }) => {
    await setupSyncMock(page, { status: { state: "offline", enabled: true } });
    await page.goto("/");

    await expect(indicator(page)).toBeVisible();
    await indicator(page).focus();
    await expect(indicator(page)).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.getByTestId("settings-sync")).toBeVisible();
  });

  test("follows the sync:status event with no further status read", async ({ page }) => {
    await setupSyncMock(page, { status: { state: "idle", enabled: true } });
    await page.goto("/");

    await expect(indicator(page)).toHaveAttribute("data-sync-state", "idle");
    const before = (await syncCalls(page)).filter((c) => c.cmd === "sync_status");

    await emitSync(page, { ...UNLINKED, state: "syncing", enabled: true });
    await expect(indicator(page)).toHaveAttribute("data-sync-state", "syncing");

    await emitSync(page, { ...UNLINKED, state: "offline", enabled: true });
    await expect(indicator(page)).toHaveAttribute("data-sync-state", "offline");

    const after = (await syncCalls(page)).filter((c) => c.cmd === "sync_status");
    expect(after.length).toBe(before.length);
  });
});

test.describe("sync prompts", () => {
  const LINK_CHOICE_STATUS: Partial<SyncPayload> = {
    state: "link_choice_required",
    enabled: false,
    paused: false,
    prompt: {
      kind: "link_choice",
      local_rows: 1234,
      remote_created_ms: 1760000000000,
      remote_schema_version: 30,
    },
  };

  const REMOTE_CHANGED_STATUS: Partial<SyncPayload> = {
    state: "remote_changed",
    enabled: true,
    prompt: {
      kind: "remote_changed",
      remote_created_ms: 1760000000000,
      remote_schema_version: 30,
    },
  };

  test("the link choice states the dated backup and answers with replace", async ({
    page,
  }) => {
    await setupSyncMock(page, { status: LINK_CHOICE_STATUS });
    await page.goto("/");

    const dialog = page.getByTestId("sync-link-choice-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("1234");
    await expect(dialog).toContainText("dated backup");
    await expect(page.getByTestId("sync-link-choice-separate")).toBeFocused();

    await page.getByTestId("sync-link-choice-replace").click();

    const calls = await syncCalls(page);
    expect(calls.filter((c) => c.cmd === "sync_enable").at(-1)?.args).toEqual({
      link_choice: "replace",
    });
  });

  test("the link choice answers with separate and leaves local data alone", async ({
    page,
  }) => {
    await setupSyncMock(page, {
      status: LINK_CHOICE_STATUS,
      enableOutcomes: [
        { outcome: "separate_profile_created", dataset_id: "second" },
      ],
    });
    await page.goto("/");

    await page.getByTestId("sync-link-choice-separate").click();

    const calls = await syncCalls(page);
    expect(calls.filter((c) => c.cmd === "sync_enable").at(-1)?.args).toEqual({
      link_choice: "separate",
    });
  });

  test("a link choice can be deferred and reopened from the indicator", async ({
    page,
  }) => {
    await setupSyncMock(page, { status: LINK_CHOICE_STATUS });
    await page.goto("/");

    await page.getByTestId("sync-link-choice-later").click();
    await expect(page.getByTestId("sync-link-choice-dialog")).toHaveCount(0);

    await indicator(page).click();
    await expect(page.getByTestId("sync-link-choice-dialog")).toBeVisible();
  });

  test("the remote-changed prompt loads the cloud copy", async ({ page }) => {
    await setupSyncMock(page, { status: REMOTE_CHANGED_STATUS });
    await page.goto("/");

    const dialog = page.getByTestId("sync-remote-changed-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("dated backup");

    await page.getByTestId("sync-remote-changed-load").click();

    const calls = await syncCalls(page);
    expect(
      calls.filter((c) => c.cmd === "sync_resolve_remote_changed").at(-1)?.args
    ).toEqual({ action: "load_remote" });
  });

  test("the remote-changed prompt keeps this computer's copy", async ({ page }) => {
    await setupSyncMock(page, { status: REMOTE_CHANGED_STATUS });
    await page.goto("/");

    await page.getByTestId("sync-remote-changed-keep").click();

    const calls = await syncCalls(page);
    expect(
      calls.filter((c) => c.cmd === "sync_resolve_remote_changed").at(-1)?.args
    ).toEqual({ action: "keep_local" });
  });

  test("a failed answer is reported with the copy for its code", async ({ page }) => {
    await setupSyncMock(page, {
      status: REMOTE_CHANGED_STATUS,
      resolveError: {
        type: "sync",
        code: "restore_failed",
        message: "restoring the snapshot failed",
        recoverable: true,
      },
    });
    await page.goto("/");

    await page.getByTestId("sync-remote-changed-load").click();
    await expect(page.getByTestId("sync-remote-changed-error")).toContainText(
      "put back the way they were"
    );
  });

  test("a prompt that arrives over the event is answerable on any screen", async ({
    page,
  }) => {
    await setupSyncMock(page, { status: { state: "idle", enabled: true } });
    await page.goto("/wealth/accounts");

    await expect(indicator(page)).toHaveAttribute("data-sync-state", "idle");
    await emitSync(page, {
      ...UNLINKED,
      ...REMOTE_CHANGED_STATUS,
    } as SyncPayload);

    await expect(page.getByTestId("sync-remote-changed-dialog")).toBeVisible();
  });
});

test.describe("version skew, clock skew and the applied cue", () => {
  test("the clock skew state tells the user to check the computer's date and time", async ({
    page,
  }) => {
    await setupSyncMock(page, {
      status: {
        state: "clock_skew",
        enabled: true,
        error_code: "clock_skew",
        recoverable: true,
      },
    });
    await page.goto("/");

    await expect(indicator(page)).toHaveAttribute(
      "data-sync-state",
      "clock_skew"
    );
    await expect(indicator(page)).toContainText("Check the clock");
    /* The shell is intact: a state this build renders must never take the window down, and a
     * wrong clock must never block local use (AD-16). */
    await expect(page.getByTestId("settings-link")).toBeVisible();
  });

  test("the update needed state keeps the app usable and names the action", async ({
    page,
  }) => {
    await setupSyncMock(page, { status: { state: "idle", enabled: true } });
    await page.goto("/");

    await emitSync(page, {
      ...UNLINKED,
      state: "update_needed",
      enabled: true,
      error_code: "update_needed",
    });

    await expect(indicator(page)).toHaveAttribute(
      "data-sync-state",
      "update_needed"
    );
    await expect(indicator(page)).toContainText("Update needed");
    await expect(page.getByTestId("settings-link")).toBeVisible();
  });

  test("remote changes raise a dismissible cue that steals no focus", async ({
    page,
  }) => {
    await setupSyncMock(page, { status: { state: "idle", enabled: true } });
    await page.goto("/");

    await expect(indicator(page)).toHaveAttribute("data-sync-state", "idle");
    await expect(page.getByTestId("sync-applied-cue")).toHaveCount(0);

    const focusedBefore = await page.evaluate(
      () => document.activeElement?.tagName ?? null
    );

    await emitApplied(page, 3);

    const cue = page.getByTestId("sync-applied-cue");
    await expect(cue).toBeVisible();
    await expect(cue).toContainText("Changed on another computer");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await page.evaluate(() => document.activeElement?.tagName ?? null)
    ).toBe(focusedBefore);

    await cue.getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByTestId("sync-applied-cue")).toHaveCount(0);
  });
});
