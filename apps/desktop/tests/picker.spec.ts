import { test, expect, type Page } from "@playwright/test";

/**
 * One entry of the Rust dataset registry as `list_datasets` serialises it. Redeclared locally rather
 * than imported: `apps/desktop/tests/` has no shared helper module and a spec must not reach into
 * `src/`.
 */
interface MockDataset {
  id: string;
  label: string;
  kind: "local" | "cloud-linked";
  cognito_sub: string | null;
  linked_from: string | null;
  is_default: boolean;
  created_at: string;
}

interface PickerOptions {
  /**
   * What `check_picker_gate` answers. Omit to leave the command unstubbed so it falls through to the
   * reject fallback — the state every pre-existing spec in this directory runs in.
   */
  needsPicker?: boolean;
  /** What `list_datasets` answers. Omit for the reject fallback. */
  datasets?: MockDataset[];
  /** What `get_auth_session` answers. `LoggedOut` is what makes AccountPromptDialog try to open. */
  loggedOut?: boolean;
}

const DEFAULT_ENTRY: MockDataset = {
  id: "default",
  label: "Default",
  kind: "local",
  cognito_sub: null,
  linked_from: null,
  is_default: true,
  created_at: "2026-01-01T00:00:00+00:00",
};

/**
 * Boots the real app shell against a mocked Tauri IPC layer.
 *
 * Two omissions here would take the whole page down rather than fail one assertion, so both guards
 * are copied verbatim from the established in-repo shape:
 *
 * - Every `plugin:` command MUST resolve null. A truthy `plugin:updater` response makes
 *   `UpdateChecker` render an always-open Dialog, and Base UI's focus trap then puts
 *   `aria-hidden="true"` on the whole app — every getByRole/getByTestId elsewhere finds nothing.
 * - `transformCallback` and `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener` MUST exist.
 *   `RecurringApplyListener` and `useAuthSession` both call `event.listen()` on mount, which throws
 *   without them and takes the surface with it.
 */
async function setupTauriMock(page: Page, options: PickerOptions = {}) {
  await page.addInitScript((opts: PickerOptions) => {
    const ipcCalls: string[] = [];
    (window as unknown as Record<string, unknown>).__IPC_CALLS = ipcCalls;

    (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: (cmd: string) => {
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);

        ipcCalls.push(cmd);

        switch (cmd) {
          case "check_picker_gate":
            return opts.needsPicker === undefined
              ? Promise.reject(`Unknown command: ${cmd}`)
              : Promise.resolve({ needs_picker: opts.needsPicker });

          case "list_datasets":
            return opts.datasets === undefined
              ? Promise.reject(`Unknown command: ${cmd}`)
              : Promise.resolve(opts.datasets);

          case "get_auth_session":
            return opts.loggedOut === true
              ? Promise.resolve({ status: "LoggedOut" })
              : Promise.reject(`Unknown command: ${cmd}`);

          // The dashboard's own surface, so a gate that fails to fire lands somewhere assertable
          // rather than on an error card.
          case "check_onboarding_status":
            return Promise.resolve({ needs_onboarding: false, setup_incomplete: false });
          case "get_budget_groups":
            return Promise.resolve([]);
          case "get_budget_summary":
            return Promise.resolve({
              total_target_cents: 0,
              total_spent_cents: 0,
              remaining_cents: 0,
              month: "2026-08",
            });
          case "get_top_budget_categories":
            return Promise.resolve([]);
          case "get_current_net_worth":
            return Promise.resolve({
              total_cents: 0,
              cash_cents: 0,
              investments_cents: 0,
              assets_cents: 0,
            });
          case "get_recent_net_worth_snapshots":
            return Promise.resolve([]);
          case "get_spending_breakdown":
            return Promise.resolve([]);
          case "get_latest_expense":
            return Promise.resolve(null);
          case "get_income_total":
            return Promise.resolve({ total_cents: 0, month: "2026-08" });
          case "get_yearly_summary":
            return Promise.resolve({
              year: 2026,
              is_current_year: true,
              total_spent_cents: 0,
              total_income_cents: 0,
              cash_flow_net_cents: 0,
              net_worth_gain_cents: null,
              net_worth_gain_available: false,
              top_categories: [],
              monthly_totals: [],
              all_categories: [],
              available_years: [2026],
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
          case "get_savings_projects_summary":
            return Promise.resolve({
              active_project_count: 0,
              total_saved_cents: 0,
              total_target_cents: 0,
            });
          case "get_db_status":
            return Promise.resolve({
              db_path: "mock.db",
              wal_mode: true,
              schema_version: 10,
              migrations_applied: 10,
            });
          default:
            return Promise.reject(`Unknown command: ${cmd}`);
        }
      },
      convertFileSrc: (path: string) => path,
    };
  }, options);
}

function readIpcCommands(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __IPC_CALLS?: string[] }).__IPC_CALLS ?? [],
  );
}

test.describe("launch-time picker gate", () => {
  test("a launch with the gate unset lands on the picker, not the dashboard", async ({
    page,
  }) => {
    await setupTauriMock(page, { needsPicker: true, datasets: [DEFAULT_ENTRY] });
    await page.goto("/");

    await expect(page).toHaveURL(/\/picker$/);
    await expect(page.getByTestId("dataset-picker")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose a profile");

    // The dashboard is what the gate has to have beaten, so its absence is the assertion.
    await expect(page.getByTestId("import-statement-btn")).toHaveCount(0);
  });

  test("a launch with the gate already passed routes normally", async ({ page }) => {
    await setupTauriMock(page, { needsPicker: false, datasets: [DEFAULT_ENTRY] });
    await page.goto("/");

    await expect(page).toHaveURL(/localhost:1420\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
    await expect(page.getByTestId("dataset-picker")).toHaveCount(0);
  });

  test("an unmocked gate degrades to no redirect at all", async ({ page }) => {
    // The contract every pre-existing spec in this directory depends on: none of them stub
    // `check_picker_gate`, the invoke rejects, the root beforeLoad swallows it, and the app renders
    // exactly as it did before this story shipped.
    await setupTauriMock(page);
    await page.goto("/");

    await expect(page).toHaveURL(/localhost:1420\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
    await expect(page.getByTestId("dataset-picker")).toHaveCount(0);

    // Proof the command really was attempted, so the assertion above measures the degradation
    // rather than a gate that silently never ran.
    expect(await readIpcCommands(page)).toContain("check_picker_gate");
  });

  test("the gate keeps holding on a direct visit and never self-redirects", async ({
    page,
  }) => {
    await setupTauriMock(page, { needsPicker: true, datasets: [DEFAULT_ENTRY] });
    await page.goto("/picker");

    await expect(page.getByTestId("dataset-picker")).toBeVisible();
    await expect(page).toHaveURL(/\/picker$/);

    // Asking the gate again from the picker itself would be a redundant round-trip on a screen
    // whose whole job is to be the answer.
    expect(await readIpcCommands(page)).not.toContain("check_picker_gate");
  });
});

test.describe("picker chrome", () => {
  test("no shell chrome is rendered around the picker", async ({ page }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY],
      loggedOut: true,
    });
    await page.goto("/picker");

    await expect(page.getByTestId("dataset-picker")).toBeVisible();

    // AppSidebar is the only <aside>, and both it and DestinationNav own a <nav>.
    await expect(page.locator("aside")).toHaveCount(0);
    await expect(page.locator("nav")).toHaveCount(0);
    await expect(page.locator("header")).toHaveCount(0);
    await expect(page.getByTestId("topbar-search-trigger")).toHaveCount(0);
    await expect(page.getByTestId("profile-menu-trigger")).toHaveCount(0);

    // A LoggedOut session is exactly what opens this dialog on every other surface, and its focus
    // trap would aria-hide the picker underneath it.
    await expect(page.getByTestId("account-prompt-dialog")).toHaveCount(0);
  });

  test("the chat bar is unreachable from the picker", async ({ page }) => {
    await setupTauriMock(page, { needsPicker: true, datasets: [DEFAULT_ENTRY] });
    await page.goto("/picker");

    await expect(page.getByTestId("dataset-picker")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+k");

    await expect(page.getByTestId("floating-chat-bar")).toHaveCount(0);
  });
});

test.describe("picker contents", () => {
  test("every registry entry is listed by its label", async ({ page }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [
        DEFAULT_ENTRY,
        { ...DEFAULT_ENTRY, id: "work-1", label: "Work", is_default: false },
      ],
    });
    await page.goto("/picker");

    const rows = page.getByTestId("picker-dataset-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveText("Default");
    await expect(rows.nth(1)).toHaveText("Work");

    // Story 33.5 turns the rows into buttons. Until then they must not advertise an interaction
    // they do not have.
    await expect(page.getByTestId("picker-dataset-list").getByRole("button")).toHaveCount(0);
  });

  test("an empty registry is not an error state", async ({ page }) => {
    await setupTauriMock(page, { needsPicker: true, datasets: [] });
    await page.goto("/picker");

    await expect(page.getByTestId("dataset-picker")).toBeVisible();
    await expect(page.getByTestId("picker-dataset-row")).toHaveCount(0);
    await expect(page.getByTestId("picker-login-cloud-button")).toBeVisible();
    await expect(page.getByTestId("picker-load-error")).toHaveCount(0);
    await expect(page.getByText(/error|failed|something went wrong/i)).toHaveCount(0);
  });

  test("a failed registry read says so instead of looking empty", async ({ page }) => {
    // `datasets` omitted, so `list_datasets` falls through to the mock's reject fallback.
    await setupTauriMock(page, { needsPicker: true });
    await page.goto("/picker");

    // react-query retries three times with exponential backoff (1s + 2s + 4s) before a query reports
    // an error, so this state is ~7s out — well past the default 5s expect window.
    const failure = page.getByTestId("picker-load-error");
    await expect(failure).toBeVisible({ timeout: 20_000 });
    await expect(failure).toContainText("Your profiles could not be read.");

    // The whole point of the branch: a failed read must not render as the empty-registry case.
    await expect(page.getByTestId("picker-dataset-list")).toHaveCount(0);
    await expect(page.getByTestId("picker-dataset-row")).toHaveCount(0);

    // Stated, but still not a dead end.
    await expect(page.getByTestId("picker-login-cloud-button")).toBeVisible();
  });

  test("the Nixus Cloud action is present and inert", async ({ page }) => {
    await setupTauriMock(page, { needsPicker: true, datasets: [DEFAULT_ENTRY] });
    await page.goto("/picker");

    const cloud = page.getByTestId("picker-login-cloud-button");
    await expect(cloud).toBeVisible();
    await expect(cloud).toHaveText("Log in with Nixus Cloud");
    await expect(cloud).toBeDisabled();
    await expect(cloud).toHaveAttribute("aria-disabled", "true");
  });

  test("no i18n key leaks into the rendered screen", async ({ page }) => {
    await setupTauriMock(page, { needsPicker: true, datasets: [DEFAULT_ENTRY] });
    await page.goto("/picker");

    const picker = page.getByTestId("dataset-picker");
    await expect(picker).toBeVisible();
    // Both prefixes: `datasets.` is the live namespace, `picker.` the one these keys shipped under
    // first, so a half-finished rename shows up here rather than as raw key text in the product.
    await expect(picker).not.toContainText("datasets.");
    await expect(picker).not.toContainText("picker.");
  });
});
