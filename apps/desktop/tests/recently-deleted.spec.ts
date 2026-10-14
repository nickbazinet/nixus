import { test, expect, type Page } from "@playwright/test";

/**
 * The recently-deleted view in Settings -> Your data (Story 21, AD-5).
 *
 * The view is NOT always mounted: it reads `list_recently_deleted` only once the user asks for the
 * list, which is why no existing spec's mock needed a new case (project-context's always-mounted
 * rule). The always-mounted reads of the settings screen are answered below all the same, because
 * this spec mounts the whole shell to reach the section.
 */

interface DeletedItem {
  id: string;
  table_name: string;
  label: string;
  deleted_at: string;
  days_left: number;
  child_count: number;
}

interface MockOptions {
  syncAvailable?: boolean;
  items?: DeletedItem[];
  listError?: { type: string; message: string };
  restoreError?: {
    type: string;
    code: string;
    message: string;
    recoverable: boolean;
  };
}

interface MockWindow extends Record<string, unknown> {
  __MOCK_CALLS__?: { cmd: string; args: Record<string, unknown> }[];
}

const SALARY: DeletedItem = {
  id: "income_sources:0a1b2c3d4e5f60718293a4b5c6d7e8f9",
  table_name: "income_sources",
  label: "Salary",
  deleted_at: "2026-10-14 20:00:00",
  days_left: 29,
  child_count: 2,
};

const GROCERIES: DeletedItem = {
  id: "expenses:ffeeddccbbaa99887766554433221100",
  table_name: "expenses",
  label: "Metro · 42.50",
  deleted_at: "2026-10-13 09:30:00",
  days_left: 28,
  child_count: 0,
};

async function setupMock(page: Page, options: MockOptions = {}) {
  await page.addInitScript((opts: MockOptions) => {
    const w = window as unknown as MockWindow;
    const calls: { cmd: string; args: Record<string, unknown> }[] = [];
    w.__MOCK_CALLS__ = calls;

    const items = opts.items ?? [];
    const restored = new Set<string>();

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      transformCallback: (callback: unknown) => {
        void callback;
        return 1;
      },
      unregisterCallback: () => {},
      convertFileSrc: (path: string) => path,
      invoke: (cmd: string, args: Record<string, unknown>) => {
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);
        calls.push({ cmd, args: args ?? {} });

        switch (cmd) {
          case "list_recently_deleted":
            if (opts.listError !== undefined) {
              return Promise.reject(opts.listError);
            }
            return Promise.resolve({
              sync_available: opts.syncAvailable ?? true,
              items: items.filter((item) => !restored.has(item.id)),
            });
          case "restore_deleted": {
            if (opts.restoreError !== undefined) {
              return Promise.reject(opts.restoreError);
            }
            const id = args.id as string;
            restored.add(id);
            return Promise.resolve({
              table_name: id.split(":")[0],
              restored_rows: 1,
            });
          }

          case "sync_status":
            return Promise.resolve({
              state: "idle",
              dataset_id: "default",
              enabled: true,
              last_sync_ms: 1760000000000,
              error_code: null,
              recoverable: true,
              prompt: null,
            });
          case "get_active_profile":
            return Promise.resolve({
              dataset_id: "default",
              kind: "cloud-linked",
              label: "Nicolas",
              is_signed_in: true,
            });
          case "check_picker_gate":
            return Promise.resolve({ needs_picker: false });
          case "check_onboarding_status":
            return Promise.resolve({ needs_onboarding: false });
          case "get_auth_session":
            return Promise.resolve({ status: "signed_out" });
          case "get_user_avatar":
            return Promise.resolve(null);
          case "get_db_status":
            return Promise.resolve({
              db_path: "mock.db",
              wal_mode: true,
              schema_version: 34,
              migrations_applied: 34,
            });
          case "get_budget_summary":
            return Promise.resolve({
              total_target_cents: 0,
              total_spent_cents: 0,
              remaining_cents: 0,
              month: "2026-10",
            });
          case "get_current_net_worth":
            return Promise.resolve({
              total_cents: 0,
              cash_cents: 0,
              investments_cents: 0,
              assets_cents: 0,
            });
          case "get_net_worth_change":
            return Promise.resolve({
              absolute_change_cents: 0,
              percentage_change: 0,
              direction: "flat",
            });
          case "get_income_total":
            return Promise.resolve(0);
          case "get_savings_projects_summary":
            return Promise.resolve({
              active_project_count: 0,
              total_saved_cents: 0,
              total_target_cents: 0,
            });
          case "get_financial_health_summary":
            return Promise.resolve({
              data_sufficient: false,
              emergency_fund: null,
              savings: null,
              waterfall: {
                current_step: "build_emergency_fund",
                action_line_key: "build_emergency_fund",
              },
            });
          case "list_system_templates":
            return Promise.resolve([]);
          default:
            return Promise.resolve(null);
        }
      },
    };

    (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ =
      {
        unregisterListener: () => {},
      };
  }, options);
}

const callsOf = async (page: Page, command: string) =>
  (await page.evaluate(() => (window as unknown as MockWindow).__MOCK_CALLS__ ?? [])).filter(
    (call) => call.cmd === command
  );

const SETTINGS_URL = "/settings/ai-provider?section=data";

test.describe("recently deleted", () => {
  test("reads nothing until the list is asked for, then lists the deletes by type", async ({
    page,
  }) => {
    await setupMock(page, { items: [SALARY, GROCERIES] });
    await page.goto(SETTINGS_URL);

    const section = page.getByTestId("setting-recently-deleted");
    await expect(section).toBeVisible();
    expect(await callsOf(page, "list_recently_deleted")).toHaveLength(0);

    await page.getByTestId("recently-deleted-toggle").click();

    await expect(page.getByTestId("recently-deleted-list")).toBeVisible();
    await expect(page.getByTestId(`recently-deleted-item-${SALARY.id}`)).toContainText(
      "Salary"
    );
    await expect(page.getByTestId(`recently-deleted-item-${SALARY.id}`)).toContainText(
      "29"
    );
    await expect(
      page.getByTestId("recently-deleted-group-income_sources")
    ).toBeVisible();
    await expect(page.getByTestId("recently-deleted-group-expenses")).toBeVisible();
    expect(await callsOf(page, "list_recently_deleted")).toHaveLength(1);
  });

  test("restores an item by its handle and drops it from the list", async ({ page }) => {
    await setupMock(page, { items: [SALARY, GROCERIES] });
    await page.goto(SETTINGS_URL);
    await page.getByTestId("recently-deleted-toggle").click();
    await expect(page.getByTestId(`recently-deleted-item-${SALARY.id}`)).toBeVisible();

    await page.getByTestId(`recently-deleted-restore-${SALARY.id}`).click();

    await expect(
      page.getByTestId(`recently-deleted-item-${SALARY.id}`)
    ).toBeHidden();
    await expect(page.getByTestId(`recently-deleted-item-${GROCERIES.id}`)).toBeVisible();
    expect(await callsOf(page, "restore_deleted")).toEqual([
      { cmd: "restore_deleted", args: { id: SALARY.id } },
    ]);
  });

  test("explains a refused restore in the user's language and restores nothing", async ({
    page,
  }) => {
    await setupMock(page, {
      items: [SALARY],
      restoreError: {
        type: "sync",
        code: "restore_conflict",
        message: "Something with the same key exists again.",
        recoverable: false,
      },
    });
    await page.goto(SETTINGS_URL);
    await page.getByTestId("recently-deleted-toggle").click();

    await page.getByTestId(`recently-deleted-restore-${SALARY.id}`).click();

    const error = page.getByTestId("recently-deleted-restore-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("same name");
    await expect(page.getByTestId(`recently-deleted-item-${SALARY.id}`)).toBeVisible();
  });

  test("tells a local-only profile that nothing is retained", async ({ page }) => {
    await setupMock(page, { syncAvailable: false, items: [] });
    await page.goto(SETTINGS_URL);

    await page.getByTestId("recently-deleted-toggle").click();

    await expect(page.getByTestId("recently-deleted-local-only")).toBeVisible();
    await expect(page.getByTestId("recently-deleted-empty")).toBeHidden();
  });

  test("shows an empty state when a synced profile has deleted nothing", async ({
    page,
  }) => {
    await setupMock(page, { items: [] });
    await page.goto(SETTINGS_URL);

    await page.getByTestId("recently-deleted-toggle").click();

    await expect(page.getByTestId("recently-deleted-empty")).toBeVisible();
  });

  test("offers a retry when the list cannot be read", async ({ page }) => {
    await setupMock(page, {
      listError: { type: "database", message: "the dataset is busy" },
    });
    await page.goto(SETTINGS_URL);

    await page.getByTestId("recently-deleted-toggle").click();

    await expect(page.getByTestId("recently-deleted-error")).toBeVisible();
  });
});
