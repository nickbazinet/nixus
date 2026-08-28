import { test, expect, type Page } from "@playwright/test";

/**
 * Epic 34's deliverable is isolation, and isolation is the one thing a per-test global fixture
 * cannot demonstrate: a mock that answers the same figures no matter which profile is open passes
 * whether the app isolates anything or not.
 *
 * So the mock here is a keyed store. Every read command answers out of the seed bucket belonging to
 * the dataset id that the last *successful* `select_dataset` named, and the two buckets are
 * deliberately disjoint — different money, different vehicle ids, different vehicle names, opposite
 * AI-configured states. Each assertion below therefore fails in two directions: it fails if the
 * profile's own value is missing, and it fails if the other profile's value is present.
 *
 * Switching is in-session. `mark_picker_passed` latches the gate, so returning to the picker means
 * re-latching it and letting the root `beforeLoad` redirect on a real client-side navigation — never
 * `page.goto("/picker")`, which would reload the page and destroy the QueryClient before the switch
 * had any chance to prove it clears it. That surviving cache is the whole point of
 * `switchProfileAndExpectCacheCleared` below.
 *
 * The store still has to outlive the page loads the secondary surfaces cost, so it lives in
 * `sessionStorage` — the same trick `maintenance.spec.ts` already uses.
 */

/** One entry of the Rust dataset registry as `list_datasets` serialises it. */
interface MockDataset {
  id: string;
  label: string;
  kind: "local" | "cloud-linked";
  cognito_sub: string | null;
  linked_from: string | null;
  is_default: boolean;
  created_at: string;
}

/** `get_budget_summary`'s wire shape, as `routes/index.tsx` consumes it. */
interface MockBudgetSummary {
  total_target_cents: number;
  total_spent_cents: number;
  remaining_cents: number;
  month: string;
}

/** `get_vehicles`' wire shape (`Vehicle` in `lib/types.ts`). */
interface MockVehicle {
  id: number;
  nickname: string;
  make: string | null;
  model: string | null;
  year: number | null;
  odometer_km: number;
  created_at: string;
  updated_at: string;
}

/** `get_ai_config`'s wire shape (`AiConfig` in `lib/types.ts`). */
interface MockAiConfig {
  provider: "bedrock" | "openai" | null;
  configured: boolean;
  region: string;
}

/** `check_onboarding_status`'s wire shape. */
interface MockOnboardingStatus {
  needs_onboarding: boolean;
  setup_incomplete: boolean;
}

/**
 * Everything one profile's dataset directory would answer. Every field is optional and every
 * omission falls back to the zeroed/empty/unconfigured answer, so a dataset that was never seeded —
 * and the pre-selection state, where no dataset is open at all — cannot produce another profile's
 * values by accident.
 */
interface DatasetSeed {
  budget?: MockBudgetSummary;
  vehicles?: MockVehicle[];
  ai?: MockAiConfig;
  onboarding?: MockOnboardingStatus;
}

interface IsolationOptions {
  /** The registry `list_datasets` starts with. The second profile is created through the UI. */
  datasets: MockDataset[];
  /** Per-dataset-id answers. Keyed by the id `select_dataset` was last given. */
  seeds: Record<string, DatasetSeed>;
}

/** `IsolationOptions` plus the wiring the init script needs but no caller should have to supply. */
interface MockInitPayload extends IsolationOptions {
  stateKey: string;
  controlsKey: string;
}

/** The slice of mock state that has to outlive a page load. */
interface PersistedMockState {
  /** Mirrors the real `PICKER_PASSED` AtomicBool: latching, and only the picker ever sets it. */
  needsPicker: boolean;
  /** Which dataset the app is pointed at. Only a successful `select_dataset` moves it. */
  openDatasetId: string | null;
  /** Mutable because `create_dataset` genuinely appends to it. */
  registry: MockDataset[];
  /** Every id handed to `select_dataset`, in order — the switch log the final assertion reads. */
  selections: string[];
}

/**
 * The mock's own controls, driven from the test rather than from the app.
 *
 * `relatchPickerGate` stands in for what the real backend has no command for: the gate is one-way,
 * so a second visit to the picker is the test's decision, not the product's.
 *
 * The budget gate holds `get_budget_summary` unresolved. Without it the replacement read lands in
 * the same frame as the navigation and there is no observable window in which a *surviving* cache
 * entry would still be painted — which would leave the cache-clearing assertion unable to fail.
 */
interface MockControls {
  relatchPickerGate: () => void;
  armBudgetGate: () => void;
  releaseBudgetGate: () => void;
}

const MOCK_STATE_KEY = "__nixus_isolation_mock_state__";
const MOCK_CONTROLS_KEY = "__nixus_isolation_mock_controls__";

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
 * The id the mock's `create_dataset` mints for the first non-default local profile, matching the
 * shape `picker.spec.ts` established. Known up front so the profile the test is about to create can
 * be seeded with data that is unambiguously its own.
 */
const CREATED_ID = "00000000-0000-4000-8000-000000000001";
const CREATED_LABEL = "Local Profile 1";

/** Profile-scoped `localStorage` keys, from `src/lib/datasetSwitch.ts`. */
const IMPORT_DRAFT_KEY = "nixus:import-draft.v1";
const FINANCE_DISMISSED_KEY = "finance.onboarding.dismissed";
const CAR_DISMISSED_KEY = "car.onboarding.dismissed";

/** `AppSidebar`'s module link to `/car`, by its `aria-label`. Present on every non-full-bleed route. */
const SIDEBAR_CAR_LINK = "Car";

function vehicle(overrides: Partial<MockVehicle> & Pick<MockVehicle, "id">): MockVehicle {
  return {
    nickname: "",
    make: null,
    model: null,
    year: null,
    odometer_km: 0,
    created_at: "2026-01-01T00:00:00+00:00",
    updated_at: "2026-01-01T00:00:00+00:00",
    ...overrides,
  };
}

/**
 * Boots the real app shell against a dataset-keyed Tauri IPC mock.
 *
 * The two load-bearing guards are copied verbatim from the established in-repo shape, because
 * omitting either takes the whole page down rather than failing one assertion:
 *
 * - Every `plugin:` command MUST resolve null. A truthy `plugin:updater` response makes
 *   `UpdateChecker` render an always-open Dialog, and Base UI's focus trap then puts
 *   `aria-hidden="true"` on the whole app — every locator elsewhere finds nothing.
 * - `transformCallback` and `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener` MUST exist.
 *   `RecurringApplyListener`, `DatasetSwitchListener`, and `useAuthSession` all call
 *   `event.listen()` on mount, which throws without them and takes the surface with it.
 */
async function setupIsolationMock(page: Page, options: IsolationOptions) {
  await page.addInitScript(
    (opts: MockInitPayload) => {
      const freshState = (): PersistedMockState => ({
        needsPicker: true,
        openDatasetId: null,
        registry: opts.datasets.map((entry) => ({ ...entry })),
        selections: [],
      });

      // The secondary surfaces are reached with `page.goto`, so this script runs again on each one.
      // Rehydrating is what makes the run one continuous session rather than a series of launches.
      const loadState = (): PersistedMockState => {
        try {
          const raw = sessionStorage.getItem(opts.stateKey);
          if (raw !== null) return JSON.parse(raw) as PersistedMockState;
        } catch {
          // Storage unavailable: a fresh store is still a coherent one.
        }
        return freshState();
      };

      const state = loadState();

      const persist = () => {
        try {
          sessionStorage.setItem(opts.stateKey, JSON.stringify(state));
        } catch {
          // Nothing to do: the in-memory store still serves this page load.
        }
      };
      persist();

      /**
       * The whole instrument. No read command may answer from anywhere but the open dataset's own
       * bucket, and with nothing open there is no bucket at all.
       */
      const seed = (): DatasetSeed =>
        (state.openDatasetId === null ? undefined : opts.seeds[state.openDatasetId]) ?? {};

      let budgetGateArmed = false;
      const heldBudgetReads: (() => void)[] = [];

      const controls: MockControls = {
        relatchPickerGate: () => {
          state.needsPicker = true;
          persist();
        },
        armBudgetGate: () => {
          budgetGateArmed = true;
        },
        releaseBudgetGate: () => {
          budgetGateArmed = false;
          while (heldBudgetReads.length > 0) {
            heldBudgetReads.shift()?.();
          }
        },
      };
      (window as unknown as Record<string, unknown>)[opts.controlsKey] = controls;

      (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: () => {},
      };

      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        transformCallback: () => 1,
        invoke: (cmd: string, args?: Record<string, unknown>) => {
          if (cmd.startsWith("plugin:")) return Promise.resolve(null);

          switch (cmd) {
            // ---- dataset registry and switching --------------------------------------------
            case "check_picker_gate":
              return Promise.resolve({ needs_picker: state.needsPicker });

            case "list_datasets":
              // A copy, not the array itself: react-query's structural sharing compares the new
              // payload against the stored one, and handing back the same mutated reference twice
              // would make an appended entry invisible to it.
              return Promise.resolve(state.registry.map((entry) => ({ ...entry })));

            case "create_dataset": {
              // The real `next_local_label`: a count of existing local, non-default entries, so
              // Default and any cloud-linked entry are excluded exactly as Rust excludes them.
              const n =
                state.registry.filter((entry) => !entry.is_default && entry.kind === "local")
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
              state.registry.push(created);
              persist();
              return Promise.resolve(created);
            }

            case "select_dataset": {
              const requestedId = String(args?.dataset_id);
              if (!state.registry.some((entry) => entry.id === requestedId)) {
                return Promise.reject({
                  type: "Validation",
                  message: `Unknown dataset: ${requestedId}`,
                });
              }
              state.openDatasetId = requestedId;
              state.selections.push(requestedId);
              persist();
              return Promise.resolve(null);
            }

            case "mark_picker_passed":
              state.needsPicker = false;
              persist();
              return Promise.resolve(null);

            // Every profile in this spec is local, so there is no account to continue as — but the
            // launch picker resolves the machine-wide session on render to decide whether it can
            // offer Continue, and leaving this unstubbed would put its cloud primary behind
            // react-query's retry backoff on every visit.
            case "get_auth_session":
              return Promise.resolve({ status: "LoggedOut" });

            // ---- per-profile surfaces ------------------------------------------------------
            case "check_onboarding_status":
              return Promise.resolve(
                seed().onboarding ?? { needs_onboarding: false, setup_incomplete: false },
              );

            case "get_budget_summary": {
              // Resolved lazily, so a held read answers with whichever dataset is open when it is
              // finally released rather than the one that was open when it was asked.
              const answer = () =>
                seed().budget ?? {
                  total_target_cents: 0,
                  total_spent_cents: 0,
                  remaining_cents: 0,
                  month: "2026-08",
                };
              if (!budgetGateArmed) return Promise.resolve(answer());
              return new Promise((resolve) => {
                heldBudgetReads.push(() => resolve(answer()));
              });
            }

            case "get_vehicles":
              return Promise.resolve((seed().vehicles ?? []).map((entry) => ({ ...entry })));

            case "get_vehicle": {
              // Scoped to the open profile's own list, so asking for another profile's vehicle id —
              // which only a leaked cache entry would do — errors instead of rendering.
              const found = (seed().vehicles ?? []).find((entry) => entry.id === args?.id);
              return found === undefined
                ? Promise.reject({ type: "not_found", message: "Vehicle not found" })
                : Promise.resolve({ vehicle: { ...found }, tasks: [] });
            }

            case "get_ai_config":
              return Promise.resolve(
                seed().ai ?? { provider: null, configured: false, region: "us-east-1" },
              );

            // ---- the rest of the surfaces these routes touch, all profile-neutral ----------
            case "get_budget_groups":
            case "get_budget_categories":
            case "get_all_budget_categories":
            case "get_budget_status":
            case "get_top_budget_categories":
            case "get_recent_net_worth_snapshots":
            case "get_spending_breakdown":
            case "get_accounts":
            case "get_assets":
            case "list_system_templates":
            case "get_maintenance_task_baselines":
              return Promise.resolve([]);
            case "get_latest_expense":
              return Promise.resolve(null);
            case "get_current_net_worth":
              return Promise.resolve({
                total_cents: 0,
                cash_cents: 0,
                investments_cents: 0,
                assets_cents: 0,
              });
            case "get_income_total":
              return Promise.resolve({ total_cents: 0, month: "2026-08" });
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
    },
    { ...options, stateKey: MOCK_STATE_KEY, controlsKey: MOCK_CONTROLS_KEY },
  );
}

async function callMockControl(page: Page, control: keyof MockControls) {
  await page.evaluate(
    ({ key, name }: { key: string; name: string }) => {
      const controls = (window as unknown as Record<string, Record<string, () => void>>)[key];
      if (controls === undefined) throw new Error("Isolation mock controls are not installed");
      controls[name]();
    },
    { key: MOCK_CONTROLS_KEY, name: control },
  );
}

/** The ids handed to `select_dataset` across the whole run, in order. */
async function readSelections(page: Page): Promise<string[]> {
  return page.evaluate((key: string) => {
    const raw = sessionStorage.getItem(key);
    if (raw === null) return [];
    return (JSON.parse(raw) as { selections: string[] }).selections;
  }, MOCK_STATE_KEY);
}

async function readStorage(page: Page, keys: string[]): Promise<(string | null)[]> {
  return page.evaluate(
    (storageKeys: string[]) => storageKeys.map((key) => localStorage.getItem(key)),
    keys,
  );
}

/**
 * Opens the local-profile disclosure the launch screen keeps collapsed by default. Nixus Cloud is the
 * picker's primary action, so nothing local is in the DOM until this runs. Idempotent, because the
 * switching helpers below land on the picker repeatedly within one session.
 */
async function expandLocalProfiles(page: Page) {
  const panel = page.getByTestId("picker-local-panel");
  if ((await panel.count()) === 0) {
    await page.getByTestId("picker-local-disclosure").click();
  }
  await expect(panel).toBeVisible();
}

/** Opens the picker and creates the second profile through the real "+ New local profile" action. */
async function launchAndCreateSecondProfile(page: Page) {
  await page.goto("/picker");
  await expect(page.getByTestId("dataset-picker")).toBeVisible();
  await expandLocalProfiles(page);

  const rows = page.getByTestId("picker-dataset-row");
  await expect(rows).toHaveCount(1);
  await page.getByTestId("picker-new-profile-button").click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toHaveText(CREATED_LABEL);
}

/** Clicks a row on the picker that is already on screen. */
async function selectProfileRow(page: Page, label: string, landing: RegExp) {
  await expect(page.getByTestId("dataset-picker")).toBeVisible();
  await expandLocalProfiles(page);

  const row = page.getByTestId("picker-dataset-row").filter({ hasText: label });
  await expect(row).toHaveCount(1);
  await row.click();

  await expect(page).toHaveURL(landing);
}

/**
 * One switch, entirely in-session.
 *
 * Re-latching the gate and then clicking a real sidebar link is what puts the picker back on screen
 * without a reload: the root `beforeLoad` re-asks `check_picker_gate` on every client-side
 * navigation and throws the redirect itself. The QueryClient — and therefore the outgoing profile's
 * cached rows — survives all the way into `select_dataset`, which is the only arrangement under
 * which the cache sweep can be observed at all.
 */
async function switchProfile(page: Page, label: string, landing: RegExp) {
  await callMockControl(page, "relatchPickerGate");

  await page.getByRole("link", { name: SIDEBAR_CAR_LINK, exact: true }).click();
  await expect(page).toHaveURL(/\/picker$/);

  await selectProfileRow(page, label, landing);
}

/** Everything one profile is expected to show — and, read as the other profile's fixture, must not. */
interface ProfileExpectation {
  label: string;
  /** `routes/index.tsx` builds this straight from the budget summary's spent/target. */
  budgetMeterValue: string;
  vehicleId: number;
  vehicleName: string;
  odometer: string;
  aiConfigured: boolean;
  aiProvider: string;
}

const DEFAULT_PROFILE: ProfileExpectation = {
  label: "Default",
  budgetMeterValue: "$1,183.50 spent of $2,500.00",
  vehicleId: 11,
  vehicleName: "2020 Toyota Camry",
  odometer: "42,000 km",
  aiConfigured: true,
  aiProvider: "bedrock",
};

const CREATED_PROFILE: ProfileExpectation = {
  label: CREATED_LABEL,
  budgetMeterValue: "$125.00 spent of $900.00",
  vehicleId: 21,
  vehicleName: "2011 Honda Civic",
  odometer: "305,000 km",
  aiConfigured: false,
  aiProvider: "openai",
};

const POPULATED_SEEDS: Record<string, DatasetSeed> = {
  default: {
    budget: {
      total_target_cents: 250000,
      total_spent_cents: 118350,
      remaining_cents: 131650,
      month: "2026-08",
    },
    vehicles: [
      vehicle({ id: 11, year: 2020, make: "Toyota", model: "Camry", odometer_km: 42000 }),
    ],
    ai: { provider: "bedrock", configured: true, region: "us-east-1" },
    onboarding: { needs_onboarding: false, setup_incomplete: false },
  },
  [CREATED_ID]: {
    budget: {
      total_target_cents: 90000,
      total_spent_cents: 12500,
      remaining_cents: 77500,
      month: "2026-08",
    },
    vehicles: [
      vehicle({ id: 21, year: 2011, make: "Honda", model: "Civic", odometer_km: 305000 }),
    ],
    ai: { provider: "openai", configured: false, region: "us-east-1" },
    onboarding: { needs_onboarding: false, setup_incomplete: false },
  },
};

/** Asserts the money on the dashboard. Assumes the caller is on `/`. */
async function expectFinanceIsolated(page: Page, self: ProfileExpectation) {
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");

  await expect(page.getByTestId("budget-overall-progress")).toHaveAttribute(
    "aria-valuetext",
    self.budgetMeterValue,
  );
  // A zeroed target renders `empty-budget` in this slot instead of the meter, so its absence
  // confirms the hero resolved to the seeded branch rather than the unseeded one.
  await expect(page.getByTestId("empty-budget")).toHaveCount(0);
}

/**
 * Switches profiles and proves the outgoing profile's cached figures did not survive it.
 *
 * The precondition is the reason this cannot be done from a fresh page load: the outgoing profile's
 * summary has to be live in *this* session's query cache when `select_dataset` fires, or there is
 * nothing for `clearProfileScopedState` to clear and the assertion below can never fail.
 *
 * The incoming profile's own read is then held, so the dashboard is asserted in the window where an
 * un-swept cache would still be painting the previous profile's money. Removing `queryClient.clear()`
 * from `src/lib/datasetSwitch.ts` fails exactly this assertion.
 */
async function switchProfileAndExpectCacheCleared(
  page: Page,
  outgoing: ProfileExpectation,
  incoming: ProfileExpectation,
) {
  await page.goto("/");
  await expectFinanceIsolated(page, outgoing);

  await callMockControl(page, "armBudgetGate");
  await switchProfile(page, incoming.label, /localhost:1420\/$/);

  await expect(page.locator(`[aria-valuetext="${outgoing.budgetMeterValue}"]`)).toHaveCount(0);
  // Nothing at all in the hero slot, not merely different figures: the incoming read is still in
  // flight, so any meter rendered here could only have come from the cache the switch was meant to
  // drop.
  await expect(page.getByTestId("budget-overall-progress")).toHaveCount(0);

  await callMockControl(page, "releaseBudgetGate");
  await expectFinanceIsolated(page, incoming);
}

async function expectCarIsolated(
  page: Page,
  self: ProfileExpectation,
  other: ProfileExpectation,
) {
  await page.goto("/car/garage");

  const list = page.getByTestId("garage-vehicle-list");
  await expect(list).toBeVisible();
  await expect(page.getByTestId(/^garage-vehicle-row-/)).toHaveCount(1);

  const row = page.getByTestId(`garage-vehicle-row-${self.vehicleId}`);
  await expect(row).toContainText(self.vehicleName);
  // Scoped to the row: `OdometerUpdateForm` is reused by the detail panel, so the same testid
  // legitimately appears twice on this screen.
  await expect(row.getByTestId(`odometer-display-${self.vehicleId}`)).toHaveText(self.odometer);

  // By id and by name: an id-only check would pass on a row that rendered the wrong car's badge.
  await expect(page.getByTestId(`garage-vehicle-row-${other.vehicleId}`)).toHaveCount(0);
  await expect(list).not.toContainText(other.vehicleName);
  await expect(list).not.toContainText(other.odometer);
}

async function expectAiIsolated(page: Page, self: ProfileExpectation) {
  await page.goto("/settings/ai-provider?section=reading");
  const section = page.getByTestId("settings-reading-statements");
  await expect(section).toBeVisible();

  const connection = page.getByTestId("setting-connection");
  const savedHeading = page.getByRole("heading", { level: 4, name: "Replace what's saved" });
  const emptyHeading = page.getByRole("heading", { level: 4, name: "Your key" });

  if (self.aiConfigured) {
    // `CredentialsForm` renders the connection row and the clear-credentials row only when
    // `get_ai_config` reports `configured`, so both are proof this profile's key was found.
    await expect(connection).toBeVisible();
    await expect(connection).toContainText(self.aiProvider);
    await expect(page.getByTestId("setting-clear-credentials")).toBeVisible();
    await expect(savedHeading).toBeVisible();
    await expect(emptyHeading).toHaveCount(0);
  } else {
    await expect(emptyHeading).toBeVisible();
    await expect(connection).toHaveCount(0);
    await expect(page.getByTestId("setting-clear-credentials")).toHaveCount(0);
    await expect(savedHeading).toHaveCount(0);
  }
}

/** Every profile-scoped `localStorage` key, plus the draft prompt that reads one of them. */
async function expectNoProfileScopedStorage(page: Page) {
  await page.goto("/import");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("import-draft-prompt")).toHaveCount(0);

  expect(
    await readStorage(page, [IMPORT_DRAFT_KEY, FINANCE_DISMISSED_KEY, CAR_DISMISSED_KEY]),
  ).toEqual([null, null, null]);
}

/** Writes a resumable import draft plus both dismissal flags, exactly as the app persists them. */
async function seedProfileScopedStorage(page: Page, merchants: string[]) {
  await page.evaluate(
    (payload: {
      draftKey: string;
      financeKey: string;
      carKey: string;
      merchants: string[];
    }) => {
      localStorage.setItem(
        payload.draftKey,
        JSON.stringify({
          version: 1,
          transactions: payload.merchants.map((merchant, index) => ({
            merchant,
            amount_cents: 1000 + index,
            date: "2026-08-01",
            suggested_category_id: null,
            confidence: 0.9,
          })),
          unreadable: [],
          duplicateIndices: [],
          fieldOverrides: {},
          deselected: [],
          manualEntries: [],
          savedAt: "2026-08-19T00:00:00.000Z",
        }),
      );
      localStorage.setItem(payload.financeKey, "true");
      localStorage.setItem(payload.carKey, "true");
    },
    {
      draftKey: IMPORT_DRAFT_KEY,
      financeKey: FINANCE_DISMISSED_KEY,
      carKey: CAR_DISMISSED_KEY,
      merchants,
    },
  );
}

/** Seeds a draft on `/import` and proves the app reads it back, so its later absence means something. */
async function seedAndConfirmDraft(page: Page, merchants: string[], expected: string) {
  await page.goto("/import");
  await seedProfileScopedStorage(page, merchants);
  await page.reload();
  await expect(page.getByTestId("import-draft-prompt")).toContainText(expected);
}

test.describe("isolation across repeated switching", () => {
  test("each profile's finance, car, AI, and draft state stays its own across Default → new → Default → new", async ({
    page,
  }) => {
    // Both profiles are seeded as already-populated: this test is about isolation, and a profile
    // still sitting in the wizard has no dashboard figures to compare. The unonboarded-on-creation
    // behaviour is its own test below.
    await setupIsolationMock(page, {
      datasets: [DEFAULT_ENTRY],
      seeds: POPULATED_SEEDS,
    });

    await launchAndCreateSecondProfile(page);

    // ---- launch selection: Default ----------------------------------------------------------
    await selectProfileRow(page, DEFAULT_PROFILE.label, /localhost:1420\/$/);
    await expectFinanceIsolated(page, DEFAULT_PROFILE);
    await expectCarIsolated(page, DEFAULT_PROFILE, CREATED_PROFILE);
    await expectAiIsolated(page, DEFAULT_PROFILE);
    await seedAndConfirmDraft(
      page,
      ["Default Grocer", "Default Fuel"],
      "2 transactions, reviewed but not added yet.",
    );

    // ---- switch 1: the created profile ------------------------------------------------------
    await switchProfileAndExpectCacheCleared(page, DEFAULT_PROFILE, CREATED_PROFILE);
    // Default's draft and dismissals must not be visible from here, and must not merely be
    // out-of-view: the keys themselves are gone.
    await expectNoProfileScopedStorage(page);
    await expectCarIsolated(page, CREATED_PROFILE, DEFAULT_PROFILE);
    await expectAiIsolated(page, CREATED_PROFILE);
    // The mirror image, so the sweep is proven in both directions rather than only away from
    // Default.
    await seedAndConfirmDraft(
      page,
      ["Local Cafe", "Local Transit", "Local Pharmacy"],
      "3 transactions, reviewed but not added yet.",
    );

    // ---- switch 2: back to Default ---------------------------------------------------------
    await switchProfileAndExpectCacheCleared(page, CREATED_PROFILE, DEFAULT_PROFILE);
    // The created profile's 3-transaction draft is gone — and Default's own 2-transaction draft
    // does not come back either, so nothing is being remembered per profile on this machine.
    await expectNoProfileScopedStorage(page);
    await expectCarIsolated(page, DEFAULT_PROFILE, CREATED_PROFILE);
    await expectAiIsolated(page, DEFAULT_PROFILE);

    // ---- switch 3: the created profile again -----------------------------------------------
    await switchProfileAndExpectCacheCleared(page, DEFAULT_PROFILE, CREATED_PROFILE);
    await expectNoProfileScopedStorage(page);
    await expectCarIsolated(page, CREATED_PROFILE, DEFAULT_PROFILE);
    await expectAiIsolated(page, CREATED_PROFILE);

    // Attributes every assertion above to the row that was actually clicked: four real selections,
    // alternating, snake_case on the wire.
    expect(await readSelections(page)).toEqual([
      "default",
      CREATED_ID,
      "default",
      CREATED_ID,
    ]);
  });

  test("a created profile keeps its own onboarding status across repeated switching", async ({
    page,
  }) => {
    // What a genuinely empty dataset reports. The wizard is reached through the existing,
    // unmodified `check_onboarding_status` gate on `/` — the picker knows nothing about onboarding.
    await setupIsolationMock(page, {
      datasets: [DEFAULT_ENTRY],
      seeds: {
        default: {
          budget: POPULATED_SEEDS.default.budget,
          onboarding: { needs_onboarding: false, setup_incomplete: false },
        },
        [CREATED_ID]: {
          onboarding: { needs_onboarding: true, setup_incomplete: false },
        },
      },
    });

    await launchAndCreateSecondProfile(page);

    await selectProfileRow(page, CREATED_PROFILE.label, /\/onboarding$/);
    await expect(page.getByTestId("onboarding-wizard")).toBeVisible();

    // Default is onboarded and stays onboarded: the wizard is not a state the app fell into.
    await switchProfile(page, DEFAULT_PROFILE.label, /localhost:1420\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");
    await expect(page.getByTestId("onboarding-wizard")).toHaveCount(0);

    // And the created profile is still unonboarded after Default has been opened in between —
    // opening an onboarded profile does not mark the other one done.
    await switchProfile(page, CREATED_PROFILE.label, /\/onboarding$/);
    await expect(page.getByTestId("onboarding-wizard")).toBeVisible();

    await switchProfile(page, DEFAULT_PROFILE.label, /localhost:1420\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Today");

    expect(await readSelections(page)).toEqual([
      CREATED_ID,
      "default",
      CREATED_ID,
      "default",
    ]);
  });

  test("dismissing the setup banner in one profile leaves it standing in the other", async ({
    page,
  }) => {
    // Both profiles report the same setup-incomplete status, so the banner's presence can only be
    // decided by the dismissal flag — which is exactly the per-profile value under test.
    const setupIncomplete: DatasetSeed = {
      budget: POPULATED_SEEDS.default.budget,
      onboarding: { needs_onboarding: false, setup_incomplete: true },
    };
    await setupIsolationMock(page, {
      datasets: [DEFAULT_ENTRY],
      seeds: { default: setupIncomplete, [CREATED_ID]: setupIncomplete },
    });

    await launchAndCreateSecondProfile(page);

    const banner = page.getByTestId("setup-incomplete-banner");

    await selectProfileRow(page, DEFAULT_PROFILE.label, /localhost:1420\/$/);
    await expect(banner).toBeVisible();
    await page.getByTestId("setup-incomplete-dismiss").click();
    await expect(banner).toHaveCount(0);
    expect(await readStorage(page, [FINANCE_DISMISSED_KEY])).toEqual(["true"]);

    // The created profile has dismissed nothing, so it must still be told to finish setting up.
    await switchProfile(page, CREATED_PROFILE.label, /localhost:1420\/$/);
    await expect(banner).toBeVisible();
    expect(await readStorage(page, [FINANCE_DISMISSED_KEY])).toEqual([null]);

    await page.getByTestId("setup-incomplete-dismiss").click();
    await expect(banner).toHaveCount(0);

    // And back: Default's dismissal was its own, so the created profile's dismissal cannot have
    // carried into it either.
    await switchProfile(page, DEFAULT_PROFILE.label, /localhost:1420\/$/);
    await expect(banner).toBeVisible();
    expect(await readStorage(page, [FINANCE_DISMISSED_KEY])).toEqual([null]);
  });
});
