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
   *
   * Latching, not static: `mark_picker_passed` flips this to `false` for the rest of the run, the
   * same way the real `AtomicBool` does. Without that, navigating to `/` after a selection would be
   * bounced straight back to `/picker` by the root gate and no click test could ever pass.
   */
  needsPicker?: boolean;
  /** What `list_datasets` answers. Omit for the reject fallback. */
  datasets?: MockDataset[];
  /** What `get_auth_session` answers. */
  loggedOut?: boolean;
  /** Makes `start_login` reject, standing in for a browser that could not be opened. */
  startLoginFails?: boolean;
  /** Makes `select_dataset` reject, standing in for an unknown id or a failed open/migrate. */
  selectDatasetFails?: boolean;
  /** Delays `select_dataset` so the in-flight window — and the disabled rows — are assertable. */
  selectDatasetDelayMs?: number;
  /** Makes `create_dataset` reject, standing in for a failed directory create or migrate. */
  createDatasetFails?: boolean;
  /** Delays `create_dataset` so the in-flight window — and the disabled rows — are assertable. */
  createDatasetDelayMs?: number;
  /** What the freshly-selected dataset's `check_onboarding_status` reports. */
  needsOnboarding?: boolean;
  /**
   * What `get_budget_summary` answers, keyed by the dataset id `select_dataset` was last given.
   * Nothing else on the dashboard is seeded — the summary is the only surface these tests read.
   *
   * Scoping the figures to the id is what makes them evidence: a dataset absent from this map, and
   * the pre-selection state, both answer the zeroed default, so a click routed to the wrong entry
   * cannot render the money. Omit it entirely to keep the all-zero answers every other describe
   * here was written against.
   */
  budgetByDataset?: Record<string, MockBudgetSummary>;
}

/** `get_budget_summary`'s wire shape, as `routes/index.tsx` consumes it. */
interface MockBudgetSummary {
  total_target_cents: number;
  total_spent_cents: number;
  remaining_cents: number;
  month: string;
}

interface IpcCall {
  cmd: string;
  args: unknown;
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
    const ipcCalls: IpcCall[] = [];
    (window as unknown as Record<string, unknown>).__IPC_CALLS = ipcCalls;

    // Mirrors the real `PICKER_PASSED` AtomicBool: in-memory, latching, and only ever set by the
    // picker's own click path.
    let needsPicker = opts.needsPicker;

    // Which dataset the app is pointed at. Only a *successful* `select_dataset` moves it, so a
    // budget read before any selection — or after a click that opened a different entry — cannot
    // answer with another dataset's figures.
    let openDatasetId: string | null = null;

    // The registry `list_datasets` reads, mutable because `create_dataset` genuinely appends to it.
    // A stubbed create that returned an entry without growing this list would let the picker pass
    // on nothing but an optimistic render.
    const registry = opts.datasets === undefined ? undefined : [...opts.datasets];

    (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => {},
    };

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);

        ipcCalls.push({ cmd, args: args ?? null });

        switch (cmd) {
          case "check_picker_gate":
            return needsPicker === undefined
              ? Promise.reject(`Unknown command: ${cmd}`)
              : Promise.resolve({ needs_picker: needsPicker });

          case "list_datasets":
            return registry === undefined
              ? Promise.reject(`Unknown command: ${cmd}`)
              // A copy, not the array itself: react-query's structural sharing compares the new
              // payload against the stored one, and handing back the same mutated reference twice
              // would make the appended entry invisible to it.
              : Promise.resolve(registry.slice());

          case "create_dataset": {
            const settle = () => {
              if (opts.createDatasetFails === true || registry === undefined) {
                return Promise.reject({
                  type: "File",
                  message: "Failed to create dataset directory",
                });
              }
              // The real `next_local_label`: a count of the existing local, non-default entries,
              // so Default and any cloud-linked entry are excluded exactly as Rust excludes them.
              const n =
                registry.filter((entry) => !entry.is_default && entry.kind === "local")
                  .length + 1;
              const created: MockDataset = {
                id: `00000000-0000-4000-8000-00000000000${n}`,
                label: `Local Profile ${n}`,
                kind: "local",
                cognito_sub: null,
                linked_from: null,
                is_default: false,
                created_at: "2026-08-19T00:00:00+00:00",
              };
              registry.push(created);
              return Promise.resolve(created);
            };
            if (opts.createDatasetDelayMs === undefined) return settle();
            return new Promise((resolve, reject) => {
              setTimeout(
                () => settle().then(resolve, reject),
                opts.createDatasetDelayMs,
              );
            });
          }

          case "select_dataset": {
            const requestedId = String(args?.dataset_id);
            const settle = () => {
              if (opts.selectDatasetFails === true) {
                return Promise.reject({
                  type: "Validation",
                  message: `Unknown dataset: ${requestedId}`,
                });
              }
              openDatasetId = requestedId;
              return Promise.resolve(null);
            };
            if (opts.selectDatasetDelayMs === undefined) return settle();
            return new Promise((resolve, reject) => {
              setTimeout(
                () => settle().then(resolve, reject),
                opts.selectDatasetDelayMs,
              );
            });
          }

          // Everything past this command — the Hosted UI, the identity provider, the loopback
          // callback, the token exchange, and the Rust-side branch that resolves and selects the
          // cloud-linked dataset — is deliberately out of E2E scope: external services are never
          // mocked through in this suite. What the picker owns is starting the flow with the right
          // intent, which is exactly what these calls record.
          case "start_login":
            return opts.startLoginFails === true
              ? Promise.reject({
                  type: "Auth",
                  message: "Could not open your browser to sign in. Please try again.",
                  recoverable: true,
                })
              : Promise.resolve(null);

          case "mark_picker_passed":
            needsPicker = false;
            return Promise.resolve(null);

          case "get_auth_session":
            return opts.loggedOut === true
              ? Promise.resolve({ status: "LoggedOut" })
              : Promise.reject(`Unknown command: ${cmd}`);

          // The dashboard's own surface, so a gate that fails to fire lands somewhere assertable
          // rather than on an error card.
          case "check_onboarding_status":
            return Promise.resolve({
              needs_onboarding: opts.needsOnboarding === true,
              setup_incomplete: false,
            });
          case "get_budget_groups":
            return Promise.resolve([]);
          case "get_budget_summary": {
            const seeded =
              openDatasetId === null ? undefined : opts.budgetByDataset?.[openDatasetId];
            return Promise.resolve(
              seeded ?? {
                total_target_cents: 0,
                total_spent_cents: 0,
                remaining_cents: 0,
                month: "2026-08",
              },
            );
          }
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

function readIpcCalls(page: Page): Promise<IpcCall[]> {
  return page.evaluate(
    () => (window as unknown as { __IPC_CALLS?: IpcCall[] }).__IPC_CALLS ?? [],
  );
}

async function readIpcCommands(page: Page): Promise<string[]> {
  return (await readIpcCalls(page)).map((call) => call.cmd);
}

async function callsTo(page: Page, command: string): Promise<IpcCall[]> {
  return (await readIpcCalls(page)).filter((call) => call.cmd === command);
}

test.describe("launch-time picker gate", () => {
  test("a launch with the gate unset lands on the picker, not the dashboard", async ({
    page,
  }) => {
    await setupTauriMock(page, { needsPicker: true, datasets: [DEFAULT_ENTRY] });
    await page.goto("/");

    await expect(page).toHaveURL(/\/picker$/);
    await expect(page.getByTestId("dataset-picker")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome to Nixus");

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
  test("the welcome screen leads with the shared Nixus mark, not a blank box", async ({
    page,
  }) => {
    await setupTauriMock(page, { needsPicker: true, datasets: [DEFAULT_ENTRY] });
    await page.goto("/picker");

    const mark = page.getByTestId("picker-brand-mark");
    await expect(mark).toBeVisible();

    // A rendered `<svg>` in the slot is the whole contract: the canonical `NixusLogo`, not a
    // coloured rectangle. Nothing about the geometry inside it is asserted — that lives in
    // `packages/shared` and is free to change — only that the mark slot draws one.
    await expect(mark.locator("svg")).toHaveCount(1);

    // The footprint the placeholder already occupied, so swapping the mark in cannot quietly
    // resize the header block.
    const box = await mark.boundingBox();
    if (box === null) {
      throw new Error("The brand mark has no bounding box, so it is not laid out.");
    }
    expect(box.width).toBeCloseTo(40, 0);
    expect(box.height).toBeCloseTo(40, 0);
  });

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

    // Every row is a real button, not a div with a click handler: the Card's own root element is
    // rendered as one, so the row is a single native focusable target.
    await expect(page.getByTestId("picker-dataset-list").getByRole("button")).toHaveCount(
      2,
    );
    for (const row of await rows.all()) {
      expect(await row.evaluate((el) => el.tagName)).toBe("BUTTON");
      await expect(row).toBeEnabled();
    }
  });

  test("every choice on the screen is laid out at the same full width", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [
        DEFAULT_ENTRY,
        {
          ...DEFAULT_ENTRY,
          id: "long-1",
          label: "Local Profile 12",
          is_default: false,
        },
      ],
    });
    await page.goto("/picker");

    const rows = page.getByTestId("picker-dataset-row");
    await expect(rows).toHaveCount(2);

    const widths: number[] = [];
    for (const target of [
      rows.nth(0),
      rows.nth(1),
      page.getByTestId("picker-new-profile-button"),
      page.getByTestId("picker-login-cloud-button"),
    ]) {
      const box = await target.boundingBox();
      if (box === null) {
        throw new Error("Element has no bounding box, so it is not laid out.");
      }
      widths.push(box.width);
    }

    // Label length must never decide a control's width: the column stretches every child, so a
    // "Default" row, a "Local Profile 12" row and both buttons are one shared measure.
    for (const width of widths) {
      expect(width).toBeCloseTo(widths[0], 0);
    }
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

  test("the Nixus Cloud action starts the plain Login flow and nothing else", async ({
    page,
  }) => {
    await setupTauriMock(page, { needsPicker: true, datasets: [DEFAULT_ENTRY] });
    await page.goto("/picker");

    const cloud = page.getByTestId("picker-login-cloud-button");
    await expect(cloud).toBeVisible();
    await expect(cloud).toHaveText("Log in with Nixus Cloud");
    await expect(cloud).toBeEnabled();

    await cloud.click();

    // The intent is the whole payload: no dataset, no profile, no financial data leaves the webview
    // on this click (NFR1).
    const logins = await callsTo(page, "start_login");
    expect(logins).toHaveLength(1);
    expect(logins[0].args).toEqual({ intent: { kind: "Login" } });

    // The picker never selects a dataset for a cloud sign-in — the callback's own branch does, after
    // the browser round-trip — and the user stays here until it resolves.
    expect(await readIpcCommands(page)).not.toContain("select_dataset");
    expect(await readIpcCommands(page)).not.toContain("mark_picker_passed");
    await expect(page).toHaveURL(/\/picker$/);
    await expect(page.getByTestId("dataset-picker")).toBeVisible();
  });

  test("a browser that will not open is reported instead of failing silently", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY],
      startLoginFails: true,
    });
    await page.goto("/picker");

    await page.getByTestId("picker-login-cloud-button").click();

    // Without the toast the rejection is an unhandled promise and the button just looks dead.
    await expect(page.locator("[data-sonner-toast]")).toContainText(
      "Nixus Cloud could not be reached. Please try again.",
    );
    await expect(page.getByTestId("dataset-picker")).toBeVisible();
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

const WORK_ENTRY: MockDataset = {
  ...DEFAULT_ENTRY,
  id: "work-1",
  label: "Work",
  is_default: false,
};

test.describe("choosing a profile", () => {
  test("clicking a profile opens it, latches the gate, and lands on the dashboard", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
    });
    await page.goto("/picker");

    await page.getByTestId("picker-dataset-row").nth(1).click();

    // Client-side navigation, never a reload: `/` resolving to the dashboard is what proves the
    // root gate re-asked and got `needs_picker: false` from the latch.
    await expect(page).toHaveURL(/localhost:1420\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
    await expect(page.getByTestId("dataset-picker")).toHaveCount(0);

    // The clicked row's id, snake_case on the wire — not the first entry's, and not camelCase.
    const selections = await callsTo(page, "select_dataset");
    expect(selections).toHaveLength(1);
    expect(selections[0].args).toEqual({ dataset_id: "work-1" });

    // Order is the contract: the gate may only be latched once the open has actually succeeded.
    const commands = await readIpcCommands(page);
    expect(commands).toContain("mark_picker_passed");
    expect(commands.indexOf("select_dataset")).toBeLessThan(
      commands.indexOf("mark_picker_passed"),
    );
  });

  test("a failed selection keeps the user on the picker and never latches the gate", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY],
      selectDatasetFails: true,
    });
    await page.goto("/picker");

    await page.getByTestId("picker-dataset-row").click();

    await expect(page.locator("[data-sonner-toast]")).toContainText(
      "That profile could not be opened. Please try again.",
    );

    // Still here, and the gate is still up: the flow stopped at the rejection.
    await expect(page).toHaveURL(/\/picker$/);
    await expect(page.getByTestId("dataset-picker")).toBeVisible();

    const commands = await readIpcCommands(page);
    expect(commands).toContain("select_dataset");
    expect(commands).not.toContain("mark_picker_passed");
  });

  test("a failed selection leaves the rows usable for a second attempt", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY],
      selectDatasetFails: true,
    });
    await page.goto("/picker");

    const row = page.getByTestId("picker-dataset-row");
    await row.click();
    await expect(page.locator("[data-sonner-toast]")).toBeVisible();

    // A row left permanently disabled by a failure would be a dead end on a screen with no other
    // way forward.
    await expect(row).toBeEnabled();
    await row.click();
    expect(await callsTo(page, "select_dataset")).toHaveLength(2);
  });

  test("an unonboarded profile lands on the wizard, not the dashboard", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY],
      needsOnboarding: true,
    });
    await page.goto("/picker");

    await page.getByTestId("picker-dataset-row").click();

    // The existing, unmodified `check_onboarding_status` gate on `/` makes this call — the picker
    // knows nothing about onboarding.
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByTestId("onboarding-wizard")).toBeVisible();
    await expect(page.getByTestId("dataset-picker")).toHaveCount(0);
  });

  test("every row is disabled while a selection is in flight, so a second click cannot race", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
      selectDatasetDelayMs: 2000,
    });
    await page.goto("/picker");

    const rows = page.getByTestId("picker-dataset-row");
    await rows.nth(0).click();

    // Both rows, not just the clicked one: a second selection must be unreachable, and Playwright's
    // own click() waits for enabled, so a disabled row cannot be clicked at all. Both spellings of
    // disabled, so a dim is never the only signal.
    await expect(rows.nth(0)).toBeDisabled();
    await expect(rows.nth(1)).toBeDisabled();
    await expect(rows.nth(0)).toHaveAttribute("aria-disabled", "true");
    await expect(rows.nth(1)).toHaveAttribute("aria-disabled", "true");

    await expect(page).toHaveURL(/localhost:1420\/$/, { timeout: 20_000 });
    expect(await callsTo(page, "select_dataset")).toHaveLength(1);
  });

  test("reaching the picker in-app, with the gate already passed, still opens a profile", async ({
    page,
  }) => {
    // `needsPicker: false` is the in-app entry point — the header's and the `/profile` guard's Switch
    // profile action navigate straight here — as opposed to the launch-time gate that redirects. It
    // is the same screen either way, so a selection has to work with the gate already latched.
    await setupTauriMock(page, {
      needsPicker: false,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
    });
    await page.goto("/picker");

    await expect(page.getByTestId("dataset-picker")).toBeVisible();
    const rows = page.getByTestId("picker-dataset-row");
    await expect(rows).toHaveCount(2);
    await rows.nth(1).click();

    await expect(page).toHaveURL(/localhost:1420\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");

    const selections = await callsTo(page, "select_dataset");
    expect(selections).toHaveLength(1);
    expect(selections[0].args).toEqual({ dataset_id: "work-1" });
    // Latched anyway: the flag is idempotent, and the picker's click path is the only thing allowed
    // to set it whether or not the gate was what brought the user here.
    expect(await readIpcCommands(page)).toContain("mark_picker_passed");
  });
});

test.describe("creating a local profile", () => {
  test("creating adds a row without navigating or opening it", async ({ page }) => {
    await setupTauriMock(page, { needsPicker: true, datasets: [DEFAULT_ENTRY] });
    await page.goto("/picker");

    const rows = page.getByTestId("picker-dataset-row");
    await expect(rows).toHaveCount(1);

    await page.getByTestId("picker-new-profile-button").click();

    // The list genuinely grew, and the label is the one the Rust label rule derives.
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toHaveText("Local Profile 1");

    // Creating and opening are separate actions: still on the picker, and nothing was selected or
    // latched, so the active dataset is exactly what it was.
    await expect(page).toHaveURL(/\/picker$/);
    await expect(page.getByTestId("dataset-picker")).toBeVisible();
    const commands = await readIpcCommands(page);
    expect(commands).toContain("create_dataset");
    expect(commands).not.toContain("select_dataset");
    expect(commands).not.toContain("mark_picker_passed");
  });

  test("a freshly created profile opens into the onboarding wizard", async ({ page }) => {
    // `needs_onboarding: true` stands in for what a genuinely empty dataset reports: the wizard is
    // reached through the existing, unmodified `check_onboarding_status` gate on `/`.
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY],
      needsOnboarding: true,
    });
    await page.goto("/picker");

    await page.getByTestId("picker-new-profile-button").click();
    const rows = page.getByTestId("picker-dataset-row");
    await expect(rows).toHaveCount(2);
    await rows.nth(1).click();

    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByTestId("onboarding-wizard")).toBeVisible();
    await expect(page.getByTestId("dataset-picker")).toHaveCount(0);

    // The new entry's own id, not Default's — the row the user actually clicked.
    const selections = await callsTo(page, "select_dataset");
    expect(selections).toHaveLength(1);
    expect(selections[0].args).toEqual({
      dataset_id: "00000000-0000-4000-8000-000000000001",
    });
  });

  test("labels keep advancing across repeated creates", async ({ page }) => {
    await setupTauriMock(page, { needsPicker: true, datasets: [DEFAULT_ENTRY] });
    await page.goto("/picker");

    const create = page.getByTestId("picker-new-profile-button");
    const rows = page.getByTestId("picker-dataset-row");

    await create.click();
    await expect(rows).toHaveCount(2);
    await create.click();
    await expect(rows).toHaveCount(3);

    await expect(rows.nth(1)).toHaveText("Local Profile 1");
    await expect(rows.nth(2)).toHaveText("Local Profile 2");
  });

  test("a failed create says so and leaves the list alone", async ({ page }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY],
      createDatasetFails: true,
    });
    await page.goto("/picker");

    const create = page.getByTestId("picker-new-profile-button");
    await create.click();

    await expect(page.locator("[data-sonner-toast]")).toContainText(
      "That profile could not be created. Please try again.",
    );
    await expect(page).toHaveURL(/\/picker$/);
    await expect(page.getByTestId("picker-dataset-row")).toHaveCount(1);

    // Not a dead end: a failure must leave the only actionable control on this screen usable.
    await expect(create).toBeEnabled();
  });

  test("the create control disables itself while its own create is in flight", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY],
      createDatasetDelayMs: 2000,
    });
    await page.goto("/picker");

    const create = page.getByTestId("picker-new-profile-button");
    await create.click();

    // Both spellings, so a dim is never the only signal.
    await expect(create).toBeDisabled();
    await expect(create).toHaveAttribute("aria-disabled", "true");

    await expect(page.getByTestId("picker-dataset-row")).toHaveCount(2, {
      timeout: 20_000,
    });

    // The point of the guard: Playwright's click() waits for enabled, so a disabled control cannot
    // be clicked at all — and with no delete affordance, a double-click would permanently mint a
    // second profile the user cannot remove.
    expect(await callsTo(page, "create_dataset")).toHaveLength(1);
  });

  test("a create in flight disables the rows, so the two mutations cannot interleave", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY],
      createDatasetDelayMs: 2000,
    });
    await page.goto("/picker");

    const row = page.getByTestId("picker-dataset-row");
    await page.getByTestId("picker-new-profile-button").click();

    // Both spellings, matching the rows' own in-flight treatment, so a dim is never the only signal.
    await expect(row).toBeDisabled();
    await expect(row).toHaveAttribute("aria-disabled", "true");

    await expect(page.getByTestId("picker-dataset-row")).toHaveCount(2, {
      timeout: 20_000,
    });
    expect(await readIpcCommands(page)).not.toContain("select_dataset");
  });

  test("a selection in flight disables the create control", async ({ page }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY],
      selectDatasetDelayMs: 2000,
    });
    await page.goto("/picker");

    const create = page.getByTestId("picker-new-profile-button");
    await page.getByTestId("picker-dataset-row").click();

    await expect(create).toBeDisabled();
    await expect(create).toHaveAttribute("aria-disabled", "true");

    await expect(page).toHaveURL(/localhost:1420\/$/, { timeout: 20_000 });
    expect(await readIpcCommands(page)).not.toContain("create_dataset");
  });

  test("no free-text label input exists anywhere on the picker", async ({ page }) => {
    // Naming and renaming are explicit non-goals: the label is auto-generated, so an input here
    // would be the affordance the epic forbids.
    await setupTauriMock(page, { needsPicker: true, datasets: [DEFAULT_ENTRY] });
    await page.goto("/picker");

    await page.getByTestId("picker-new-profile-button").click();
    await expect(page.getByTestId("picker-dataset-row")).toHaveCount(2);

    await expect(page.locator("input")).toHaveCount(0);
    await expect(page.locator("textarea")).toHaveCount(0);
  });
});

/**
 * Only Default holds money. Work is deliberately absent from the map, so it answers the mock's
 * zeroed default — and that asymmetry is the whole instrument: the two tests below can only both
 * pass if each click opened the entry it named. The literal expectation in the first test is
 * `total_spent_cents`/`total_target_cents` below as `routes/index.tsx` formats them.
 */
const BUDGET_BY_DATASET: Record<string, MockBudgetSummary> = {
  default: {
    total_target_cents: 250000,
    total_spent_cents: 118350,
    remaining_cents: 131650,
    month: "2026-08",
  },
};

test.describe("selecting a profile opens that profile's own data", () => {
  test("choosing Default lands on the dashboard showing Default's own figures", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
      budgetByDataset: BUDGET_BY_DATASET,
    });
    await page.goto("/picker");

    await expect(page.getByTestId("dataset-picker")).toBeVisible();
    const rows = page.getByTestId("picker-dataset-row");
    await expect(rows.nth(0)).toHaveText("Default");
    await rows.nth(0).click();

    await expect(page).toHaveURL(/localhost:1420\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");

    // Names the id on the wire, so the figures below are attributable to the row that was clicked
    // rather than to whichever entry the picker happened to send.
    const selections = await callsTo(page, "select_dataset");
    expect(selections).toHaveLength(1);
    expect(selections[0].args).toEqual({ dataset_id: "default" });

    // `routes/index.tsx` builds this valuetext straight from the summary's spent/target, and the
    // mock answers with these figures for `default` only — so the assertion is that the dashboard
    // rendered the *selected* dataset's money. A click that opened `work-1` reads $0.00 here.
    await expect(page.getByTestId("budget-overall-progress")).toHaveAttribute(
      "aria-valuetext",
      "$1,183.50 spent of $2,500.00",
    );

    // A zeroed target renders `empty-budget` in this hero slot instead of the meter, so its absence
    // confirms the hero resolved to the seeded branch rather than the empty one.
    await expect(page.getByTestId("empty-budget")).toHaveCount(0);
  });

  test("choosing Work lands on Work's own empty budget, never Default's figures", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
      budgetByDataset: BUDGET_BY_DATASET,
    });
    await page.goto("/picker");

    const rows = page.getByTestId("picker-dataset-row");
    await expect(rows.nth(1)).toHaveText("Work");
    await rows.nth(1).click();

    await expect(page).toHaveURL(/localhost:1420\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");

    const selections = await callsTo(page, "select_dataset");
    expect(selections).toHaveLength(1);
    expect(selections[0].args).toEqual({ dataset_id: "work-1" });

    // The control for the test above: Default's money must not appear under a profile that has
    // none. Without this half, a mock — or a picker — that ignored the clicked id would still pass.
    await expect(page.getByTestId("empty-budget")).toBeVisible();
    await expect(page.getByTestId("budget-overall-progress")).toHaveCount(0);
  });
});
