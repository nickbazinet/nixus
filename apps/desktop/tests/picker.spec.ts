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
  /** Makes `rename_dataset` reject, standing in for a label the registry refused. */
  renameDatasetFails?: boolean;
  /** Delays `rename_dataset` so the in-flight window — and the guarded panel — are assertable. */
  renameDatasetDelayMs?: number;
  /**
   * Which profile the backend reports as open, before any selection on this screen.
   *
   * `lib.rs`'s `.setup()` auto-selects Default before any UI renders, so `"default"` is the
   * realistic launch state and is what most cases here want. Omit for a run with nothing open, which
   * `get_active_dataset_id` answers as `null`.
   */
  activeDatasetId?: string;
  /**
   * Makes `get_active_dataset_id` reject, standing in for a backend that cannot say which profile is
   * open. The picker must fail closed on this, not fall back to offering deletion.
   */
  activeDatasetIdFails?: boolean;
  /** Delays `get_active_dataset_id` so the window before the answer arrives is assertable. */
  activeDatasetIdDelayMs?: number;
  /** Makes `delete_dataset` reject, standing in for a directory the OS would not remove. */
  deleteDatasetFails?: boolean;
  /** Delays `delete_dataset` so the in-flight window — and the guarded dialog — are assertable. */
  deleteDatasetDelayMs?: number;
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

    // Mirrors the Rust `local-label-sequence.json` high-water mark: a generated number, once issued,
    // is never issued again — not even after the profile holding it is deleted. Without this the mock
    // would re-derive labels from the survivors alone and the naming tests below would "pass" on
    // behaviour the product no longer has.
    let issuedLabelHighWater = 0;

    const labelSuffix = (label: string) => {
      const match = /^Local Profile (0|[1-9]\d*)$/.exec(label);
      return match === null ? 0 : Number(match[1]);
    };

    // The registry half of Rust's `effective_label_high_water`: what seeds a registry that predates
    // the sequence file, and what keeps a live profile's number from being handed out twice.
    const registryHighWater = () =>
      (registry ?? [])
        .filter((entry) => !entry.is_default && entry.kind === "local")
        .reduce((max, entry) => Math.max(max, labelSuffix(entry.label)), 0);

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
              // The real `reserve_local_label`: one past the max of the durable high-water mark and
              // the live registry, then recorded as issued. Never a count, and never re-derived from
              // the survivors alone — that is exactly what would hand a fresh profile a deleted
              // one's label. Default, cloud-linked entries and user-chosen names all contribute
              // nothing, matching Rust's `local_label_suffix`.
              const n = Math.max(issuedLabelHighWater, registryHighWater()) + 1;
              issuedLabelHighWater = n;
              const created: MockDataset = {
                id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
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

          // Auth-free by contract: the picker asks this for every local row it renders, so it must
          // never be the command that resolves a Cognito subject. A successful `select_dataset` moves
          // the answer, because selecting genuinely changes which profile is open.
          case "get_active_dataset_id": {
            const settle = () =>
              opts.activeDatasetIdFails === true
                ? Promise.reject({
                    type: "Database",
                    message: "the active dataset could not be read",
                  })
                : Promise.resolve(openDatasetId ?? opts.activeDatasetId ?? null);
            if (opts.activeDatasetIdDelayMs === undefined) return settle();
            return new Promise((resolve, reject) => {
              setTimeout(
                () => settle().then(resolve, reject),
                opts.activeDatasetIdDelayMs,
              );
            });
          }

          // Every restriction the Rust boundary enforces is enforced here too, against the same
          // mutable registry `list_datasets` reads. A stub that merely resolved would let the picker
          // pass on an optimistic render, and one that skipped the restrictions would let a test
          // "prove" a deletion the product would have refused.
          case "delete_dataset": {
            const requestedId = String(args?.dataset_id);
            const settle = () => {
              const target = registry?.find((entry) => entry.id === requestedId);
              const activeId = openDatasetId ?? opts.activeDatasetId ?? null;
              if (
                opts.deleteDatasetFails === true ||
                registry === undefined ||
                target === undefined ||
                target.is_default ||
                requestedId === "default" ||
                target.kind !== "local" ||
                requestedId === activeId
              ) {
                return Promise.reject({
                  type: "Validation",
                  message: `Unknown dataset: ${requestedId}`,
                  field: "dataset_id",
                });
              }
              // Rust raises the high-water mark before it removes anything, so the number the doomed
              // profile holds survives its own deletion.
              issuedLabelHighWater = Math.max(issuedLabelHighWater, registryHighWater());
              registry.splice(registry.indexOf(target), 1);
              return Promise.resolve(null);
            };
            if (opts.deleteDatasetDelayMs === undefined) return settle();
            return new Promise((resolve, reject) => {
              setTimeout(
                () => settle().then(resolve, reject),
                opts.deleteDatasetDelayMs,
              );
            });
          }

          // A genuine label edit against the same mutable registry `list_datasets` reads, so the row
          // can only show the new name if the mutation and its cache invalidation both landed. A
          // stub that merely echoed the label back would pass on an optimistic render alone.
          case "rename_dataset": {
            const requestedId = String(args?.dataset_id);
            const submitted = String(args?.label);
            const settle = () => {
              const target = registry?.find((entry) => entry.id === requestedId);
              if (
                opts.renameDatasetFails === true ||
                target === undefined ||
                target.kind !== "local"
              ) {
                return Promise.reject({
                  type: "Validation",
                  message: `Unknown dataset: ${requestedId}`,
                  field: "dataset_id",
                });
              }
              // Rust trims before it persists, so the mock has to as well or the assertions would be
              // measuring the mock's leniency rather than the product's contract.
              target.label = submitted.trim();
              return Promise.resolve({ ...target });
            };
            if (opts.renameDatasetDelayMs === undefined) return settle();
            return new Promise((resolve, reject) => {
              setTimeout(
                () => settle().then(resolve, reject),
                opts.renameDatasetDelayMs,
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

/**
 * Opens a local row's management menu, which is the single affordance now carrying both Rename and
 * Delete. Every rename flow below goes through here because the pencil that used to sit on the row
 * is gone — a destructive action must not be a visual peer of a harmless one, so both moved into the
 * overflow.
 *
 * Only one menu is open at a time, so the items inside it need no `.nth()`.
 */
async function openRowMenu(page: Page, index: number) {
  await page.getByTestId("picker-profile-menu").nth(index).click();
}

/** The confirmation word `datasets.deleteConfirmWord` carries in the default (English) locale. */
const CONFIRM_WORD = "DELETE";

/** Opens the row's menu, chooses Delete, and waits for the typed-confirmation dialog. */
async function openDeleteDialog(page: Page, index: number) {
  await openRowMenu(page, index);
  await page.getByTestId("picker-delete-button").click();
  await expect(page.getByTestId("picker-delete-dialog")).toBeVisible();
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
    // rendered as one, so the row is a single native focusable target. Counted by testid rather than
    // by every button in the list — each local row also carries its own management menu trigger,
    // which is a sibling of the row, never nested inside it.
    for (const row of await rows.all()) {
      expect(await row.evaluate((el) => el.tagName)).toBe("BUTTON");
      await expect(row).toBeEnabled();
    }

    // The anti-pattern this layout exists to avoid: a button inside a button.
    await expect(
      page.getByTestId("picker-dataset-row").getByRole("button"),
    ).toHaveCount(0);
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

test.describe("marking the profile already open", () => {
  test("the open profile's row says so in words, and no other row does", async ({
    page,
  }) => {
    // Work, not the first row: a badge painted on `entries[0]`, or on every row, would satisfy a
    // test that only ever asserted a badge was present somewhere.
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
      activeDatasetId: "work-1",
    });
    await page.goto("/picker");

    const rows = page.getByTestId("picker-dataset-row");
    await expect(rows).toHaveCount(2);

    // Text, not a tint or an icon: this is the only thing distinguishing two otherwise identical
    // rows, so it has to survive a user who cannot separate the brand colour from the card.
    const badge = page.getByTestId("picker-active-badge");
    await expect(badge).toHaveCount(1);
    await expect(badge).toHaveText("Current");
    await expect(rows.nth(1).getByTestId("picker-active-badge")).toHaveCount(1);
    await expect(rows.nth(0).getByTestId("picker-active-badge")).toHaveCount(0);

    // A label, never a control: the row stays one native focusable target — no button inside a
    // button — and the word joins that button's accessible name rather than being visual-only.
    await expect(rows.nth(1).getByRole("button")).toHaveCount(0);
    await expect(rows.nth(1)).toHaveAccessibleName(/Current/);

    // Everything the rows already carried is untouched: both still open their profile, and both
    // still have their management menu.
    await expect(rows.nth(0)).toBeEnabled();
    await expect(rows.nth(1)).toBeEnabled();
    await expect(page.getByTestId("picker-profile-menu")).toHaveCount(2);
  });

  test("a cloud-linked row is left exactly as it was, badge included", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [
        DEFAULT_ENTRY,
        {
          ...DEFAULT_ENTRY,
          id: "cloud-1",
          label: "user@example.com",
          kind: "cloud-linked",
          cognito_sub: "sub-1",
          is_default: false,
        },
      ],
      activeDatasetId: "default",
    });
    await page.goto("/picker");

    const rows = page.getByTestId("picker-dataset-row");
    await expect(rows).toHaveCount(2);

    // The mark follows the open profile, not the row kind: Default is open, the cloud row is not,
    // and the cloud row gains nothing at all from this change.
    await expect(rows.nth(0).getByTestId("picker-active-badge")).toHaveCount(1);
    await expect(rows.nth(1).getByTestId("picker-active-badge")).toHaveCount(0);
    await expect(rows.nth(1)).toHaveText("user@example.com");
  });

  test("no row is marked open until the backend says which one is", async ({ page }) => {
    // The same fail-closed rule the delete refusal already follows: while `get_active_dataset_id` is
    // unresolved, `data` is undefined, and a bare comparison would mark either no row or every row
    // on a guess. Nothing may claim to be open before the answer arrives.
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
      activeDatasetIdFails: true,
    });
    await page.goto("/picker");

    await expect(page.getByTestId("picker-dataset-row")).toHaveCount(2);
    await expect(page.getByTestId("picker-active-badge")).toHaveCount(0);

    // Proof the command really was attempted, so the absence above measures the fail-closed branch
    // rather than a query that never ran.
    expect(await readIpcCommands(page)).toContain("get_active_dataset_id");
  });

  test("a long name never pushes the badge under the row's own menu", async ({
    page,
  }) => {
    // 80 characters: exactly what the rename validator allows, so this is the widest label the
    // product can ever put in a row.
    const longLabel = "x".repeat(40) + " " + "y".repeat(39);
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [{ ...WORK_ENTRY, id: "long-1", label: longLabel }],
      activeDatasetId: "long-1",
    });
    await page.goto("/picker");

    const badge = page.getByTestId("picker-active-badge");
    await expect(badge).toBeVisible();
    // The name is shown in full — the badge crowds it onto another line rather than clipping it.
    await expect(page.getByTestId("picker-dataset-label")).toHaveText(longLabel);

    const badgeBox = await badge.boundingBox();
    const menuBox = await page.getByTestId("picker-profile-menu").boundingBox();
    if (badgeBox === null || menuBox === null) {
      throw new Error("The badge or the row menu has no bounding box, so it is not laid out.");
    }

    // The row reserves its right edge for the overflow menu, so the badge stays clear of it — it
    // wraps onto its own line when the name leaves no room, and never slides underneath.
    expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(menuBox.x);
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

  test("creating a profile never asks the user to name it", async ({ page }) => {
    // Naming on create is still an explicit non-goal: the label is auto-generated, so the create
    // control must mint a row outright rather than opening a form. Renaming afterwards is its own
    // affordance, tested below — which is why this is scoped to the create path instead of asserting
    // the whole screen has no input at all.
    await setupTauriMock(page, { needsPicker: true, datasets: [DEFAULT_ENTRY] });
    await page.goto("/picker");

    await page.getByTestId("picker-new-profile-button").click();
    await expect(page.getByTestId("picker-dataset-row")).toHaveCount(2);

    await expect(page.getByTestId("picker-rename-panel")).toHaveCount(0);
    await expect(page.locator("input")).toHaveCount(0);
    await expect(page.locator("textarea")).toHaveCount(0);
  });
});

test.describe("renaming a local profile", () => {
  test("a submitted name updates the row in place, without navigating", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
    });
    await page.goto("/picker");

    const rows = page.getByTestId("picker-dataset-row");
    await expect(rows.nth(1)).toHaveText("Work");

    await openRowMenu(page, 1);
    await page.getByTestId("picker-rename-button").click();
    const input = page.getByTestId("picker-rename-input");
    // Seeded from the row that was picked, not the first row: opening on the wrong entry is the
    // failure a shared, always-mounted form would produce.
    await expect(input).toHaveValue("Work");

    // Padded on purpose: the trim is part of the contract, and the row must show neither the padding
    // nor a name that kept it.
    await input.fill("  Client work  ");
    await page.getByTestId("picker-rename-save").click();

    await expect(page.getByTestId("picker-rename-panel")).toHaveCount(0);
    await expect(rows.nth(1)).toHaveText("Client work");
    await expect(rows.nth(0)).toHaveText("Default", { timeout: 5_000 });

    const renames = await callsTo(page, "rename_dataset");
    expect(renames).toHaveLength(1);
    // The clicked row's id and the raw submitted label, snake_case on the wire — the trim belongs to
    // the registry, so the frontend must not silently pre-normalise it away.
    expect(renames[0].args).toEqual({
      dataset_id: "work-1",
      label: "  Client work  ",
    });

    // A rename is not an open: still on the picker, nothing selected, nothing latched.
    await expect(page).toHaveURL(/\/picker$/);
    const commands = await readIpcCommands(page);
    expect(commands).not.toContain("select_dataset");
    expect(commands).not.toContain("mark_picker_passed");
  });

  test("the row's new name comes from a fresh registry read, not an optimistic write", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
    });
    await page.goto("/picker");

    await openRowMenu(page, 1);
    await page.getByTestId("picker-rename-button").click();
    await page.getByTestId("picker-rename-input").fill("Client work");
    await page.getByTestId("picker-rename-save").click();

    await expect(page.getByTestId("picker-dataset-row").nth(1)).toHaveText(
      "Client work",
    );

    // The mock's `rename_dataset` mutates the same array `list_datasets` reads, so a `list_datasets`
    // call issued *after* the rename is what proves the label on screen was read back rather than
    // painted optimistically — i.e. that the mutation invalidated the list. Durability across an
    // actual process restart is not reachable here (a reload re-seeds the mock registry); the Rust
    // `a_rename_survives_a_registry_reload` test owns that half.
    const commands = await readIpcCommands(page);
    const renameAt = commands.indexOf("rename_dataset");
    expect(renameAt).toBeGreaterThan(-1);
    expect(commands.slice(renameAt + 1)).toContain("list_datasets");
  });

  test("Default is renameable, being a local profile like any other", async ({
    page,
  }) => {
    await setupTauriMock(page, { needsPicker: true, datasets: [DEFAULT_ENTRY] });
    await page.goto("/picker");

    const menu = page.getByTestId("picker-profile-menu");
    await expect(menu).toHaveCount(1);
    await menu.click();
    await page.getByTestId("picker-rename-button").click();
    await page.getByTestId("picker-rename-input").fill("Personal");
    await page.getByTestId("picker-rename-save").click();

    await expect(page.getByTestId("picker-dataset-row")).toHaveText("Personal");
    expect((await callsTo(page, "rename_dataset"))[0].args).toEqual({
      dataset_id: "default",
      label: "Personal",
    });
  });

  test("a blank name is refused inline, and the previous label stands", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
    });
    await page.goto("/picker");

    await openRowMenu(page, 1);
    await page.getByTestId("picker-rename-button").click();
    await page.getByTestId("picker-rename-input").fill("   ");
    await page.getByTestId("picker-rename-save").click();

    // Translated copy, not a raw key, and attached to the field rather than thrown as a toast.
    await expect(page.getByTestId("picker-rename-error")).toHaveText(
      "Enter a name for this profile.",
    );
    await expect(page.getByTestId("picker-rename-input")).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    // Refused before the wire, and the row is untouched.
    expect(await readIpcCommands(page)).not.toContain("rename_dataset");
    await expect(page.getByTestId("picker-dataset-row").nth(1)).toHaveText("Work");
  });

  test("an over-long name is refused inline and names the limit", async ({ page }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
    });
    await page.goto("/picker");

    await openRowMenu(page, 1);
    await page.getByTestId("picker-rename-button").click();
    await page.getByTestId("picker-rename-input").fill("x".repeat(81));
    await page.getByTestId("picker-rename-save").click();

    await expect(page.getByTestId("picker-rename-error")).toHaveText(
      "A profile name can be at most 80 characters.",
    );
    expect(await readIpcCommands(page)).not.toContain("rename_dataset");
    await expect(page.getByTestId("picker-dataset-row").nth(1)).toHaveText("Work");
  });

  test("a rejected rename is reported and leaves the panel open for another try", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
      renameDatasetFails: true,
    });
    await page.goto("/picker");

    await openRowMenu(page, 1);
    await page.getByTestId("picker-rename-button").click();
    await page.getByTestId("picker-rename-input").fill("Client work");
    await page.getByTestId("picker-rename-save").click();

    await expect(page.locator("[data-sonner-toast]")).toContainText(
      "That profile could not be renamed. Please try again.",
    );

    // Not a dead end and not a silent loss: the panel stays open holding what was typed, and the row
    // still shows the label the registry still has.
    await expect(page.getByTestId("picker-rename-panel")).toBeVisible();
    await expect(page.getByTestId("picker-rename-input")).toHaveValue("Client work");
    await expect(page.getByTestId("picker-dataset-row").nth(1)).toHaveText("Work");
  });

  test("cancelling changes nothing at all", async ({ page }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
    });
    await page.goto("/picker");

    await openRowMenu(page, 1);
    await page.getByTestId("picker-rename-button").click();
    await page.getByTestId("picker-rename-input").fill("Client work");
    await page.getByTestId("picker-rename-cancel").click();

    await expect(page.getByTestId("picker-rename-panel")).toHaveCount(0);
    await expect(page.getByTestId("picker-dataset-row").nth(1)).toHaveText("Work");
    expect(await readIpcCommands(page)).not.toContain("rename_dataset");
  });

  test("a rename in flight cannot be abandoned, and nothing behind it is reachable", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
      renameDatasetDelayMs: 2000,
    });
    await page.goto("/picker");

    await openRowMenu(page, 1);
    await page.getByTestId("picker-rename-button").click();
    await page.getByTestId("picker-rename-input").fill("Client work");
    await page.getByTestId("picker-rename-save").click();

    const panel = page.getByTestId("picker-rename-panel");

    // Both spellings on both controls, so a dim is never the only signal — and Playwright's click()
    // waits for enabled, so a disabled Save cannot be double-submitted at all.
    for (const control of [
      page.getByTestId("picker-rename-save"),
      page.getByTestId("picker-rename-cancel"),
    ]) {
      await expect(control).toBeDisabled();
      await expect(control).toHaveAttribute("aria-disabled", "true");
    }

    // The registry write is in flight, so nothing behind the panel may start a second one.
    for (const control of [
      page.getByTestId("picker-dataset-row").nth(0),
      page.getByTestId("picker-dataset-row").nth(1),
      page.getByTestId("picker-profile-menu").nth(0),
      page.getByTestId("picker-new-profile-button"),
      page.getByTestId("picker-login-cloud-button"),
    ]) {
      await expect(control).toBeDisabled();
      await expect(control).toHaveAttribute("aria-disabled", "true");
    }

    // The three exits no `disabled` attribute can cover, driven for real: they are SlideOver's own,
    // so only the panel refusing the close request keeps them from unmounting the surface that
    // reports the rename's outcome.
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();
    await page.getByTestId("slide-over-close").click();
    await expect(panel).toBeVisible();
    await page.getByTestId("picker-rename-panel-backdrop").click({ position: { x: 40, y: 40 } });
    await expect(panel).toBeVisible();

    // And then the ordinary success path still runs to completion, exactly once.
    await expect(panel).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId("picker-dataset-row").nth(1)).toHaveText("Client work");
    expect(await callsTo(page, "rename_dataset")).toHaveLength(1);

    // The background is live again, so the guard was scoped to the panel's lifetime.
    await expect(page.getByTestId("picker-dataset-row").nth(0)).toBeEnabled();
    await expect(page.getByTestId("picker-new-profile-button")).toBeEnabled();
  });

  test("a cloud-linked profile is offered no rename at all", async ({ page }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [
        DEFAULT_ENTRY,
        {
          ...DEFAULT_ENTRY,
          id: "cloud-1",
          label: "user@example.com",
          kind: "cloud-linked",
          cognito_sub: "sub-1",
          is_default: false,
        },
      ],
    });
    await page.goto("/picker");

    await expect(page.getByTestId("picker-dataset-row")).toHaveCount(2);

    // One menu for the one local row: a cloud-linked label is its account's and its deletion is out
    // of scope, so the whole affordance is absent rather than present-and-refused.
    const menu = page.getByTestId("picker-profile-menu");
    await expect(menu).toHaveCount(1);
    await expect(menu).toHaveAttribute("aria-label", "Manage Default");
  });

  test("a selection in flight makes the row management controls unreachable", async ({
    page,
  }) => {
    // Both mutations rewrite the same registry, so they must not interleave — the same guard the
    // rows and the create control already carry.
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
      selectDatasetDelayMs: 2000,
    });
    await page.goto("/picker");

    const menu = page.getByTestId("picker-profile-menu").nth(0);
    await page.getByTestId("picker-dataset-row").nth(0).click();

    await expect(menu).toBeDisabled();
    await expect(menu).toHaveAttribute("aria-disabled", "true");

    await expect(page).toHaveURL(/localhost:1420\/$/, { timeout: 20_000 });
    const commands = await readIpcCommands(page);
    expect(commands).not.toContain("rename_dataset");
    expect(commands).not.toContain("delete_dataset");
  });
});

/**
 * Two generated labels, so the post-delete naming case can remove the lower one and prove the next
 * create advances past the survivor instead of colliding with it.
 */
const LOCAL_ONE: MockDataset = {
  ...DEFAULT_ENTRY,
  id: "00000000-0000-4000-8000-000000000001",
  label: "Local Profile 1",
  is_default: false,
};

const LOCAL_TWO: MockDataset = {
  ...DEFAULT_ENTRY,
  id: "00000000-0000-4000-8000-000000000002",
  label: "Local Profile 2",
  is_default: false,
};

test.describe("deleting a local profile", () => {
  test("a typed confirmation removes the row without navigating", async ({ page }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
      activeDatasetId: "default",
    });
    await page.goto("/picker");

    const rows = page.getByTestId("picker-dataset-row");
    await expect(rows).toHaveCount(2);

    await openDeleteDialog(page, 1);

    // The dialog names the profile it is about to remove and says the removal is final: without both
    // the user is confirming an unrecoverable action against an unnamed target.
    const dialog = page.getByTestId("picker-delete-dialog");
    await expect(dialog).toContainText("Work");
    await expect(dialog).toContainText("cannot be undone");

    await page.getByTestId("picker-delete-confirm-input").fill(CONFIRM_WORD);
    await page.getByTestId("picker-delete-confirm-button").click();

    await expect(dialog).toHaveCount(0);
    await expect(rows).toHaveCount(1);
    // The label element, not the whole row: Default is the open profile here, so its row also
    // carries the open-profile mark, and what this asserts is which profile survived.
    await expect(rows.nth(0).getByTestId("picker-dataset-label")).toHaveText("Default");

    const deletions = await callsTo(page, "delete_dataset");
    expect(deletions).toHaveLength(1);
    // The clicked row's id, snake_case on the wire — not the first entry's, and not camelCase.
    expect(deletions[0].args).toEqual({ dataset_id: "work-1" });

    // An irreversible action that only makes a row vanish gives the user nothing to read.
    await expect(page.locator("[data-sonner-toast]")).toContainText("Work was deleted.");

    // A deletion is not an open: still on the picker, nothing selected, nothing latched.
    await expect(page).toHaveURL(/\/picker$/);
    const commands = await readIpcCommands(page);
    expect(commands).not.toContain("select_dataset");
    expect(commands).not.toContain("mark_picker_passed");
  });

  test("the row disappears because of a fresh registry read, not an optimistic write", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
      activeDatasetId: "default",
    });
    await page.goto("/picker");

    await openDeleteDialog(page, 1);
    await page.getByTestId("picker-delete-confirm-input").fill(CONFIRM_WORD);
    await page.getByTestId("picker-delete-confirm-button").click();

    await expect(page.getByTestId("picker-dataset-row")).toHaveCount(1);

    // The mock's `delete_dataset` mutates the same array `list_datasets` reads, so a `list_datasets`
    // call issued *after* the deletion is what proves the list on screen was read back rather than
    // filtered optimistically — i.e. that the mutation invalidated the list. Durability across a
    // process restart is not reachable here; the Rust `a_delete_survives_a_registry_reload` test owns
    // that half.
    const commands = await readIpcCommands(page);
    const deleteAt = commands.indexOf("delete_dataset");
    expect(deleteAt).toBeGreaterThan(-1);
    expect(commands.slice(deleteAt + 1)).toContain("list_datasets");
  });

  test("Default is offered no delete at all, while it is still renameable", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
      activeDatasetId: "default",
    });
    await page.goto("/picker");

    await openRowMenu(page, 0);

    // Omitted, not disabled: Default's directory *is* the app data root, so this is not a
    // restriction the user could ever lift, and an item that can never become available is noise.
    await expect(page.getByTestId("picker-delete-button")).toHaveCount(0);
    await expect(page.getByTestId("picker-rename-button")).toBeVisible();

    // The whole menu is still useful, and the backend was never asked.
    expect(await readIpcCommands(page)).not.toContain("delete_dataset");
  });

  test("the open profile's delete is disabled and says why", async ({ page }) => {
    // Work is the open profile here, so its own row is the one that must refuse.
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
      activeDatasetId: "work-1",
    });
    await page.goto("/picker");

    await openRowMenu(page, 1);

    const remove = page.getByTestId("picker-delete-button");
    await expect(remove).toBeVisible();
    await expect(remove).toHaveAttribute("aria-disabled", "true");

    // The reason, not just the dim: this is the one restriction the user can actually lift, by
    // opening another profile first. `data-reason` is the machine-readable variant, so the assertion
    // pins which refusal fired rather than matching its wording.
    const hint = page.getByTestId("picker-delete-refusal-hint");
    await expect(hint).toHaveAttribute("data-reason", "refused-active");
    await expect(hint).toContainText("You cannot delete the profile you are using.");

    // Present-and-refused only in the UI; nothing reached the wire and no dialog opened.
    await expect(page.getByTestId("picker-delete-dialog")).toHaveCount(0);
    expect(await readIpcCommands(page)).not.toContain("delete_dataset");
  });

  test("an inactive sibling stays deletable while another profile is open", async ({
    page,
  }) => {
    // The control for the test above: the guard must be scoped to the open profile, not applied to
    // every row the moment anything is open.
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY, LOCAL_ONE],
      activeDatasetId: "work-1",
    });
    await page.goto("/picker");

    await openRowMenu(page, 2);

    const remove = page.getByTestId("picker-delete-button");
    await expect(remove).toBeEnabled();
    await expect(page.getByTestId("picker-delete-active-hint")).toHaveCount(0);
  });

  test("a cloud-linked profile is offered no management menu, so no delete either", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [
        DEFAULT_ENTRY,
        {
          ...DEFAULT_ENTRY,
          id: "cloud-1",
          label: "user@example.com",
          kind: "cloud-linked",
          cognito_sub: "sub-1",
          is_default: false,
        },
      ],
      activeDatasetId: "default",
    });
    await page.goto("/picker");

    await expect(page.getByTestId("picker-dataset-row")).toHaveCount(2);
    await expect(page.getByTestId("picker-profile-menu")).toHaveCount(1);
    await expect(page.getByTestId("picker-profile-menu")).toHaveAttribute(
      "aria-label",
      "Manage Default",
    );
  });

  test("the confirm button stays inert until the exact word is typed", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
      activeDatasetId: "default",
    });
    await page.goto("/picker");

    await openDeleteDialog(page, 1);
    const input = page.getByTestId("picker-delete-confirm-input");
    const confirm = page.getByTestId("picker-delete-confirm-button");

    // Empty, partial, wrong, and the right letters in the wrong case: none of these may arm an
    // irreversible action, which is the entire reason this dialog is typed rather than a plain OK.
    await expect(confirm).toBeDisabled();
    for (const attempt of ["DELET", "delete", "Delete", "REMOVE", "DELETE!"]) {
      await input.fill(attempt);
      await expect(confirm).toBeDisabled();
      await expect(confirm).toHaveAttribute("aria-disabled", "true");
    }

    // Surrounding whitespace is trimmed, so a trailing space from a paste is not a dead end.
    await input.fill(`  ${CONFIRM_WORD}  `);
    await expect(confirm).toBeEnabled();

    // Playwright's click() waits for enabled, so a disabled confirm cannot be clicked at all — and
    // nothing reached the wire while it was.
    expect(await readIpcCommands(page)).not.toContain("delete_dataset");
  });

  test("a refused deletion is reported inline and leaves the row listed for a retry", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
      activeDatasetId: "default",
      deleteDatasetFails: true,
    });
    await page.goto("/picker");

    await openDeleteDialog(page, 1);
    await page.getByTestId("picker-delete-confirm-input").fill(CONFIRM_WORD);
    await page.getByTestId("picker-delete-confirm-button").click();

    // Inline, not a toast: the dialog stays open, so the failure belongs beside the action that was
    // refused rather than in a corner that can be dismissed while the dialog looks untouched.
    await expect(page.getByTestId("picker-delete-error")).toHaveText(
      "That profile could not be deleted. Please try again.",
    );
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);

    // Not a dead end and not a silent loss: the dialog holds what was typed, and the row is still
    // there — which is exactly what makes the documented retry possible.
    await expect(page.getByTestId("picker-delete-dialog")).toBeVisible();
    await expect(page.getByTestId("picker-delete-confirm-input")).toHaveValue(
      CONFIRM_WORD,
    );
    await expect(page.getByTestId("picker-delete-confirm-button")).toBeEnabled();
    await expect(page.getByTestId("picker-dataset-row")).toHaveCount(2);
    await expect(page.getByTestId("picker-dataset-row").nth(1)).toHaveText("Work");
  });

  test("cancelling changes nothing at all", async ({ page }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
      activeDatasetId: "default",
    });
    await page.goto("/picker");

    await openDeleteDialog(page, 1);
    await page.getByTestId("picker-delete-confirm-input").fill(CONFIRM_WORD);
    await page.getByTestId("picker-delete-cancel").click();

    await expect(page.getByTestId("picker-delete-dialog")).toHaveCount(0);
    await expect(page.getByTestId("picker-dataset-row")).toHaveCount(2);
    await expect(page.getByTestId("picker-dataset-row").nth(1)).toHaveText("Work");
    expect(await readIpcCommands(page)).not.toContain("delete_dataset");

    // The background is live again, so the guard was scoped to the dialog's lifetime.
    await expect(page.getByTestId("picker-dataset-row").nth(0)).toBeEnabled();
    await expect(page.getByTestId("picker-new-profile-button")).toBeEnabled();
  });

  test("a deletion in flight cannot be abandoned, and nothing behind it is reachable", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
      activeDatasetId: "default",
      deleteDatasetDelayMs: 2000,
    });
    await page.goto("/picker");

    await openDeleteDialog(page, 1);
    await page.getByTestId("picker-delete-confirm-input").fill(CONFIRM_WORD);
    await page.getByTestId("picker-delete-confirm-button").click();

    const dialog = page.getByTestId("picker-delete-dialog");

    // Both spellings on both controls, so a dim is never the only signal — and Playwright's click()
    // waits for enabled, so a disabled Confirm cannot be double-submitted at all.
    for (const control of [
      page.getByTestId("picker-delete-confirm-button"),
      page.getByTestId("picker-delete-cancel"),
    ]) {
      await expect(control).toBeDisabled();
      await expect(control).toHaveAttribute("aria-disabled", "true");
    }

    // A directory removal is in flight, so nothing behind the dialog may start a second registry
    // write.
    for (const control of [
      page.getByTestId("picker-dataset-row").nth(0),
      page.getByTestId("picker-dataset-row").nth(1),
      page.getByTestId("picker-profile-menu").nth(0),
      page.getByTestId("picker-new-profile-button"),
      page.getByTestId("picker-login-cloud-button"),
    ]) {
      await expect(control).toBeDisabled();
      await expect(control).toHaveAttribute("aria-disabled", "true");
    }

    // The three exits no `disabled` attribute can cover, driven for real: they are Base UI's own, so
    // only the controlled dialog refusing the close request keeps them from unmounting the surface
    // that reports the deletion's outcome.
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await page.locator('[data-slot="dialog-close"]').click();
    await expect(dialog).toBeVisible();
    await page
      .locator('[data-slot="dialog-overlay"]')
      .click({ position: { x: 8, y: 8 } });
    await expect(dialog).toBeVisible();

    // And then the ordinary success path still runs to completion, exactly once.
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId("picker-dataset-row")).toHaveCount(1);
    expect(await callsTo(page, "delete_dataset")).toHaveLength(1);

    // The background is live again, so the guard was scoped to the dialog's lifetime.
    await expect(page.getByTestId("picker-dataset-row").nth(0)).toBeEnabled();
    await expect(page.getByTestId("picker-new-profile-button")).toBeEnabled();
  });

  test("a created profile never reuses a deleted profile's label", async ({ page }) => {
    // The acceptance criterion max-plus-one naming exists for. Under the old count-based rule this
    // create would be labelled "Local Profile 2" and collide with the row still on screen.
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, LOCAL_ONE, LOCAL_TWO],
      activeDatasetId: "default",
    });
    await page.goto("/picker");

    const rows = page.getByTestId("picker-dataset-row");
    await expect(rows).toHaveCount(3);

    await openDeleteDialog(page, 1);
    await page.getByTestId("picker-delete-confirm-input").fill(CONFIRM_WORD);
    await page.getByTestId("picker-delete-confirm-button").click();

    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toHaveText("Local Profile 2");

    await page.getByTestId("picker-new-profile-button").click();

    await expect(rows).toHaveCount(3);
    await expect(rows.nth(2)).toHaveText("Local Profile 3");

    // The surviving profile's name is not reused, and no two rows share one. Read off the label
    // elements rather than the rows: Default is the open profile here, so its row also carries the
    // open-profile mark, and this assertion is about names.
    const labels = await page.getByTestId("picker-dataset-label").allTextContents();
    expect(labels).toEqual(["Default", "Local Profile 2", "Local Profile 3"]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("a deletion in flight disables the rows, so the two mutations cannot interleave", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
      activeDatasetId: "default",
      deleteDatasetDelayMs: 2000,
    });
    await page.goto("/picker");

    await openDeleteDialog(page, 1);

    // Opening the dialog is already enough: it is modal, so a click that reached a row through the
    // backdrop would open the very profile being deleted.
    const row = page.getByTestId("picker-dataset-row").nth(0);
    await expect(row).toBeDisabled();
    await expect(row).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("picker-new-profile-button")).toBeDisabled();

    expect(await readIpcCommands(page)).not.toContain("select_dataset");
  });

  test("no i18n key leaks into the delete dialog", async ({ page }) => {
    await setupTauriMock(page, {
      needsPicker: true,
      datasets: [DEFAULT_ENTRY, WORK_ENTRY],
      activeDatasetId: "default",
    });
    await page.goto("/picker");

    await openDeleteDialog(page, 1);

    const dialog = page.getByTestId("picker-delete-dialog");
    await expect(dialog).not.toContainText("datasets.");
    await expect(dialog).not.toContainText("picker.");
    // The internal noun must never surface in user-facing copy on this screen.
    await expect(dialog).not.toContainText(/dataset/i);
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
