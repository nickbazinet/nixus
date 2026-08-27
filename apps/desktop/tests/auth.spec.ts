import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * `AuthState` as the Rust side serialises it — `#[serde(tag = "status")]`, plain tagged JSON with no
 * envelope. Redeclared locally rather than imported: `apps/desktop/tests/` has no shared helper
 * module and a spec must not reach into `src/`.
 */
type MockAuthState =
  | { status: "LoggedOut" }
  | { status: "LoggedIn"; email: string; name: string | null }
  | { status: "SessionExpired" };

/**
 * Outcome of one auth command. `delayMs` is what makes the pending window observable, which is the
 * only honest way to prove the header's loading affordance is real rather than assumed.
 */
type CommandOutcome =
  | { kind: "resolve"; value: unknown; delayMs?: number }
  | {
      kind: "reject";
      error: { type: string; message: string; recoverable?: boolean };
      delayMs?: number;
    };

interface AuthOptions {
  /**
   * What `get_auth_session` answers. Omit to leave the command unstubbed so it falls through to the
   * reject fallback — the state every pre-existing spec in this directory runs in.
   */
  session?: MockAuthState;
  /** Delays the `get_auth_session` answer so the query's pending window is assertable. */
  sessionDelayMs?: number;
  /** Replaces the `get_auth_session` answer once `sign_out` has been invoked. */
  sessionAfterSignOut?: MockAuthState;
  start_login?: CommandOutcome;
  sign_out?: CommandOutcome;
  /**
   * What `get_active_profile` answers. Omit to leave it unstubbed so it falls through to the reject
   * fallback — the state every pre-existing spec in this directory runs in, and the one the account
   * menu must degrade to Switch profile under, without reading the session at all.
   */
  activeProfile?: MockActiveProfile;
  /**
   * Delays the `get_active_profile` answer so the window in which the profile's kind is unknown is
   * assertable. That window is what gates every auth read now, so it has to be observable.
   */
  activeProfileDelayMs?: number;
  /** Replaces the `get_active_profile` answer once `sign_out` has been invoked. */
  activeProfileAfterSignOut?: MockActiveProfile;
  /**
   * What `list_datasets` answers. Stubbed by the specs that follow the header's Switch profile action
   * to `/picker`, so the destination renders its list instead of `picker-load-error`.
   */
  datasets?: MockDataset[];
  /**
   * What `get_cloud_ai_premium` answers. Omit for a non-premium account: an entitlement is never
   * assumed, so the default is the answer that makes no claim.
   */
  cloudAiPremium?: CommandOutcome;
}

/** `get_active_profile`'s wire shape. The Cognito subject is deliberately absent from it (AD-10). */
interface MockActiveProfile {
  dataset_id: string;
  kind: "local" | "cloud-linked";
  label: string;
  is_signed_in: boolean;
}

/** One entry of the dataset registry as `list_datasets` serialises it. */
interface MockDataset {
  id: string;
  label: string;
  kind: "local" | "cloud-linked";
  cognito_sub: string | null;
  linked_from: string | null;
  is_default: boolean;
  created_at: string;
}

interface IpcCall {
  cmd: string;
  args: unknown;
}

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
async function setupTauriMock(page: Page, options: AuthOptions = {}) {
  await page.addInitScript((opts: AuthOptions) => {
    const settle = (outcome: CommandOutcome): Promise<unknown> => {
      const run = () =>
        outcome.kind === "reject"
          ? Promise.reject(outcome.error)
          : Promise.resolve(outcome.value);
      if (outcome.delayMs === undefined) return run();
      return new Promise((resolve, reject) => {
        setTimeout(() => run().then(resolve, reject), outcome.delayMs);
      });
    };

    // Mutable on purpose: sign-out flips both answers mid-test, which is what proves the header
    // re-reads the one ["auth", "session"] cache entry — and the profile the badge derives from —
    // rather than holding private copies.
    let session = opts.session;
    let activeProfile = opts.activeProfile;

    // Mirrors the real `PICKER_PASSED` AtomicBool, including the one thing that unlatches it:
    // `sign_out` re-arms the gate Rust-side, so a mock that stayed latched would let a sign-out test
    // "pass" on a destination the product would have bounced away from.
    let needsPicker = false;

    // The whole command surface is recorded, not just the auth commands, so per-command counts are
    // derived by filtering. Mirrors the `__APPLIED_TEMPLATE_CALLS` idiom in onboarding.spec.ts.
    const ipcCalls: IpcCall[] = [];
    (window as unknown as Record<string, unknown>).__IPC_CALLS = ipcCalls;

    const groups = [
      { id: 1, name: "Essentials", sort_order: 0, created_at: "2026-01-01" },
    ];
    const categories = [
      {
        id: 1,
        group_id: 1,
        name: "Groceries",
        target_cents: 70000,
        sort_order: 0,
        created_at: "2026-01-01",
      },
    ];
    const accounts = [
      {
        id: 1,
        name: "Main Chequing",
        institution: "TD Bank",
        account_type: "chequing",
        currency: "CAD",
        balance_cents: 150000,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    ];
    const assets = [
      {
        id: 1,
        name: "Family Home",
        asset_type: "real_estate",
        value_cents: 50000000,
        created_at: "2026-01-01",
        updated_at: "2026-01-01",
      },
    ];
    const yearlySummary = {
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
    };
    const financialHealth = {
      data_sufficient: false,
      emergency_fund: null,
      savings: null,
      waterfall: {
        current_step: "build_emergency_fund",
        action_line_key: "build_emergency_fund",
      },
    };

    (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ =
      { unregisterListener: () => {} };

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: (cmd: string, args: Record<string, unknown>) => {
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);

        ipcCalls.push({ cmd, args: args ?? null });

        switch (cmd) {
          // ---- auth surface -------------------------------------------------------------------
          case "get_auth_session":
            return session === undefined
              ? Promise.reject(`Unknown command: ${cmd}`)
              : settle({
                  kind: "resolve",
                  value: session,
                  delayMs: opts.sessionDelayMs,
                });

          case "get_active_profile":
            return activeProfile === undefined
              ? Promise.reject(`Unknown command: ${cmd}`)
              : settle({
                  kind: "resolve",
                  value: activeProfile,
                  delayMs: opts.activeProfileDelayMs,
                });

          case "list_datasets":
            return opts.datasets === undefined
              ? Promise.reject(`Unknown command: ${cmd}`)
              : Promise.resolve(opts.datasets);

          case "get_cloud_ai_premium":
            return opts.cloudAiPremium === undefined
              ? Promise.resolve(false)
              : settle(opts.cloudAiPremium);

          case "start_login":
            return opts.start_login === undefined
              ? Promise.resolve(null)
              : settle(opts.start_login);

          case "sign_out": {
            if (opts.sessionAfterSignOut !== undefined) {
              session = opts.sessionAfterSignOut;
            }
            if (opts.activeProfileAfterSignOut !== undefined) {
              activeProfile = opts.activeProfileAfterSignOut;
            }
            needsPicker = true;
            return opts.sign_out === undefined
              ? Promise.resolve(null)
              : settle(opts.sign_out);
          }

          // ---- shell and target surfaces ------------------------------------------------------
          // A rejected command renders an error card, which would silently weaken the "app still
          // works with no gating" assertions into "the surface failed to load".
          case "check_onboarding_status":
            return Promise.resolve({
              needs_onboarding: false,
              setup_incomplete: false,
            });
          case "check_picker_gate":
            return Promise.resolve({ needs_picker: needsPicker });
          case "get_active_dataset_id":
            return Promise.resolve(activeProfile?.dataset_id ?? null);
          case "get_budget_groups":
            return Promise.resolve(groups);
          case "get_budget_categories":
            return Promise.resolve(
              categories.filter((c) => c.group_id === (args.group_id as number)),
            );
          case "get_budget_status":
            return Promise.resolve(
              categories.map((c) => ({
                id: c.id,
                group_id: c.group_id,
                name: c.name,
                target_cents: c.target_cents,
                spent_cents: 35000,
              })),
            );
          case "get_budget_summary":
            return Promise.resolve({
              total_target_cents: 70000,
              total_spent_cents: 35000,
              remaining_cents: 35000,
              month: "2026-03",
            });
          case "get_top_budget_categories":
            return Promise.resolve([]);
          case "get_all_budget_categories":
            return Promise.resolve(categories);
          case "get_accounts":
            return Promise.resolve(accounts);
          case "get_assets":
            return Promise.resolve(assets);
          case "get_current_net_worth":
            return Promise.resolve({
              total_cents: 50150000,
              cash_cents: 150000,
              investments_cents: 0,
              assets_cents: 50000000,
            });
          case "get_recent_net_worth_snapshots":
            return Promise.resolve([]);
          case "get_net_worth_history":
            return Promise.resolve([]);
          case "get_net_worth_change":
            return Promise.resolve({
              absolute_change_cents: 0,
              percentage_change: 0,
              direction: "flat",
            });
          case "get_spending_breakdown":
            return Promise.resolve([]);
          case "get_expenses":
            return Promise.resolve([]);
          case "get_latest_expense":
            return Promise.resolve(null);
          case "get_income_total":
            return Promise.resolve({ total_cents: 0, month: "2026-03" });
          case "get_yearly_summary":
            return Promise.resolve(yearlySummary);
          case "get_financial_health_summary":
            return Promise.resolve(financialHealth);
          case "get_db_status":
            return Promise.resolve({
              db_path: "mock.db",
              wal_mode: true,
              schema_version: 10,
              migrations_applied: 10,
            });
          case "get_savings_projects_summary":
            return Promise.resolve({
              active_project_count: 0,
              total_saved_cents: 0,
              total_target_cents: 0,
            });
          default:
            return Promise.reject(`Unknown command: ${cmd}`);
        }
      },
      convertFileSrc: (path: string) => path,
    };
  }, options);
}

function countIpcCalls(page: Page, command: string): Promise<number> {
  return page.evaluate(
    (target) =>
      (
        (window as unknown as { __IPC_CALLS?: { cmd: string }[] }).__IPC_CALLS ??
        []
      ).filter((call) => call.cmd === target).length,
    command,
  );
}

function argsOfFirstCall(page: Page, command: string): Promise<unknown> {
  return page.evaluate(
    (target) =>
      (
        (window as unknown as { __IPC_CALLS?: IpcCall[] }).__IPC_CALLS ?? []
      ).filter((call) => call.cmd === target)[0]?.args ?? null,
    command,
  );
}

async function centreX(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error("Element has no bounding box, so it is not laid out.");
  }
  return box.x + box.width / 2;
}

/** Sonner renders each toast as an `li[data-sonner-toast]` outside the router subtree. */
function toasts(page: Page): Locator {
  return page.locator("[data-sonner-toast]");
}

/**
 * The destination nav's Spending link, which deep-links straight to `/spending/budget`.
 * `exact` is load-bearing: the dashboard's year-to-date card is also a link and its accessible name
 * contains the word, so a loose match is a strict-mode violation.
 */
function spendingLink(page: Page): Locator {
  return page.getByRole("link", { name: "Spending", exact: true });
}

/**
 * The NFR1 sweep. Deliberately scoped to gating/paywall copy rather than a blanket
 * `getByRole("alert")` count: legitimate non-auth banners (`setup-incomplete-banner`) occupy that
 * role, so the broad version would fail on something this feature has nothing to do with.
 */
async function expectNoGating(page: Page) {
  await expect(
    page.getByText(
      /upgrade|paywall|requires an account|sign in to continue|not entitled/i,
    ),
  ).toHaveCount(0);
}

const LOGGED_IN: MockAuthState = {
  status: "LoggedIn",
  email: "user@example.com",
  name: "Test User",
};

const LOCAL_PROFILE: MockActiveProfile = {
  dataset_id: "00000000-0000-4000-8000-000000000001",
  kind: "local",
  label: "Local Profile 1",
  is_signed_in: false,
};

const CLOUD_PROFILE_SIGNED_IN: MockActiveProfile = {
  dataset_id: "00000000-0000-4000-8000-0000000000c1",
  kind: "cloud-linked",
  label: "user@example.com",
  is_signed_in: true,
};

const CLOUD_PROFILE_SIGNED_OUT: MockActiveProfile = {
  ...CLOUD_PROFILE_SIGNED_IN,
  is_signed_in: false,
};

/** The registry `/picker` reads once the header's Switch profile action has navigated there. */
const PICKER_DATASETS: MockDataset[] = [
  {
    id: LOCAL_PROFILE.dataset_id,
    label: LOCAL_PROFILE.label,
    kind: "local",
    cognito_sub: null,
    linked_from: null,
    is_default: false,
    created_at: "2026-01-01T00:00:00+00:00",
  },
];

/**
 * The same registry plus the cloud-linked profile a sign-out has just left behind.
 *
 * Present in the registry and absent from the picker's local list is the whole point: sign-out
 * preserves the dataset's cloud-linked identity, and the list is local-only.
 */
const PICKER_DATASETS_WITH_CLOUD: MockDataset[] = [
  ...PICKER_DATASETS,
  {
    id: CLOUD_PROFILE_SIGNED_IN.dataset_id,
    label: CLOUD_PROFILE_SIGNED_IN.label,
    kind: "cloud-linked",
    cognito_sub: "sub-1",
    linked_from: null,
    is_default: false,
    created_at: "2026-02-01T00:00:00+00:00",
  },
];

/** The resumable-import-draft key, from `src/lib/datasetSwitch.ts`. */
const IMPORT_DRAFT_KEY = "nixus:import-draft.v1";

/**
 * The picker really rendered, rather than merely the URL having changed: a destination stuck on
 * `picker-load-error` is a dead end, and asserting the URL alone would not notice.
 *
 * The header's action carries its arrival context in the URL, so the local list is already open here
 * — nothing is clicked to reveal it. Clicking the disclosure at this point would *collapse* it, which
 * is why this helper asserts the panel instead of asking for it.
 */
async function expectPickerUsable(page: Page) {
  await expect(page).toHaveURL(/\/picker\?from=switch$/);
  await expect(page.getByTestId("picker-local-panel")).toBeVisible();
  await expect(page.getByTestId("picker-local-disclosure")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.getByTestId("picker-dataset-list")).toBeVisible();
  await expect(page.getByTestId("picker-load-error")).toHaveCount(0);
}

const LOCAL_PROFILE_KEYRING_COMMANDS = ["get_auth_session", "start_login"];

test.describe("header profile entry point", () => {
  test("the trigger stays inert until the profile's kind is known, then reports the cloud session", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
      activeProfileDelayMs: 2000,
    });
    await page.goto("/");

    // The kind is what decides whether an account exists at all, so nothing may touch the secure
    // store before it lands — and the trigger stays disabled, because its own action switches the
    // active profile and offering that about an unknown profile is offering nothing.
    const trigger = page.getByTestId("profile-menu-trigger");
    await expect(trigger).toHaveAttribute("data-profile-kind", "pending");
    await expect(trigger).toBeDisabled();
    expect(await countIpcCalls(page, "get_auth_session")).toBe(0);

    // Then the profile resolves cloud-linked, which is the one kind that unlocks the session read
    await expect(trigger).toHaveAttribute("data-auth-state", "logged-in");
    await expect(trigger).toBeEnabled();
    await expect
      .poll(() => countIpcCalls(page, "get_auth_session"))
      .toBeGreaterThan(0);
  });

  test("a cloud-linked trigger reports loading while its session query is in flight, then settles", async ({
    page,
  }) => {
    // The kind resolves immediately and the session does not, which is the only window in which the
    // gate is open but the answer has not arrived. The loading affordance is the proof that window
    // was real — a bare waitForTimeout would assert nothing about whether the query had settled.
    await setupTauriMock(page, {
      session: LOGGED_IN,
      sessionDelayMs: 2000,
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
    });
    await page.goto("/");

    const trigger = page.getByTestId("profile-menu-trigger");
    await expect(trigger).toHaveAttribute("data-auth-state", "loading");
    // The badge comes from the profile, not the session, so it is readable before the session is
    // and it does not flicker when the session lands.
    await expect(trigger).toHaveAttribute("data-cloud-status", "signed-in");
    expect(await countIpcCalls(page, "get_auth_session")).toBeGreaterThan(0);

    await expect(trigger).toHaveAttribute("data-auth-state", "logged-in");
    await trigger.click();
    await expect(page.getByTestId("profile-menu-email")).toHaveText(
      "user@example.com",
    );
  });

  test("a local profile's trigger goes to the picker, reading no session and starting no cloud flow", async ({
    page,
  }) => {
    // A stored Cognito session is present on purpose: a local profile is unauthenticated whatever
    // the machine-wide session says, so this header must not read it — reading it opens the OS
    // secure store and can POST a token refresh for a profile that has no account.
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: LOCAL_PROFILE,
      datasets: PICKER_DATASETS,
    });
    await page.goto("/");

    const trigger = page.getByTestId("profile-menu-trigger");
    await expect(trigger).toHaveAttribute("data-profile-kind", "local");
    await expect(trigger).toHaveAttribute("aria-label", "Switch profile");
    // Absent, not merely unset to some benign value: an auth-derived attribute here would mean the
    // header had an opinion about a session it is not allowed to have read.
    await expect(trigger).not.toHaveAttribute("data-auth-state");
    await trigger.click();

    // A single click may never begin an OAuth round trip, because completing one creates or reopens
    // a cloud profile and switches the active profile away from the local one the user works in.
    await expectPickerUsable(page);
    for (const command of LOCAL_PROFILE_KEYRING_COMMANDS) {
      expect(await countIpcCalls(page, command), command).toBe(0);
    }
    expect(await countIpcCalls(page, "handle_auth_callback")).toBe(0);

    // The user came here to change profiles, so the local list is what they land on — while Nixus
    // Cloud stays the primary action rather than being demoted by the expansion.
    await expect(page.getByTestId("picker-dataset-row")).toHaveCount(
      PICKER_DATASETS.length,
    );
    await expect(page.getByTestId("picker-login-cloud-button")).toBeEnabled();
  });

  test("a local profile's header offers switching profiles with no error state", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: { status: "LoggedOut" },
      activeProfile: LOCAL_PROFILE,
    });
    await page.goto("/");

    const header = page.locator("header");
    const trigger = page.getByTestId("profile-menu-trigger");

    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("data-profile-kind", "local");
    await expect(trigger).toHaveAttribute("aria-label", "Switch profile");
    await expect(trigger).not.toHaveAttribute("aria-label", /Nixus Cloud/);

    await expect(page.locator("[data-auth-state]")).toHaveCount(0);
    await expect(header).not.toContainText(/expired|error|failed/i);
    await expect(toasts(page)).toHaveCount(0);
    await expect(trigger).not.toContainText("auth.");
    await expect(header).not.toContainText("profile.");
  });

  test("the centred search trigger is not displaced by the profile icon", async ({
    page,
  }) => {
    // The local profile's labelled button is the widest shape this slot ever takes, so it is the one
    // that would displace the centred field if the header laid it out as a flex sibling.
    await setupTauriMock(page, {
      session: { status: "LoggedOut" },
      activeProfile: LOCAL_PROFILE,
    });
    await page.goto("/");

    const search = page.getByTestId("topbar-search-trigger");
    await expect(search).toBeVisible();
    await expect(page.getByTestId("profile-menu-trigger")).toBeVisible();

    // A right-hand icon laid out as a flex sibling in this `justify-center` row would shift the
    // search field by roughly half its footprint — at least 16px for any target meeting
    // min-h-target-min. 8px is tight enough to catch that and loose enough for subpixel rounding.
    const drift = Math.abs(
      (await centreX(search)) - (await centreX(page.locator("header"))),
    );
    expect(drift).toBeLessThan(8);

    await search.click();
    await expect(page.getByTestId("floating-chat-bar")).toBeVisible();
  });
});

test.describe("profile panel and sign out", () => {
  test("the signed-in panel shows identity and a sign-out action without navigating", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
    });
    await page.goto("/");

    const trigger = page.getByTestId("profile-menu-trigger");
    await expect(trigger).toHaveAttribute("data-auth-state", "logged-in");
    await trigger.click();

    const panel = page.getByTestId("profile-menu-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("profile-menu-email")).toHaveText(
      "user@example.com",
    );
    await expect(page.getByTestId("profile-menu-name")).toHaveText("Test User");
    await expect(page.getByTestId("profile-menu-sign-out")).toBeVisible();

    // Merely opening the panel navigates nowhere: `/profile` now exists as a route, but it is
    // reached by activating the Profile item, not by revealing the popover.
    await expect(page).toHaveURL(/localhost:1420\/$/);
    await expect(panel).not.toContainText("auth.");
    await expect(panel).not.toContainText("profile.");
  });

  test("a missing name claim degrades to email-only with no empty row", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: { status: "LoggedIn", email: "user@example.com", name: null },
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
    });
    await page.goto("/");

    await page.getByTestId("profile-menu-trigger").click();
    await expect(page.getByTestId("profile-menu-panel")).toBeVisible();
    await expect(page.getByTestId("profile-menu-email")).toHaveText(
      "user@example.com",
    );
    // Absent, not blank: an empty row would still occupy space and read as missing data.
    await expect(page.getByTestId("profile-menu-name")).toHaveCount(0);
  });

  test("sign-out invokes sign_out once and lands on the picker", async ({
    page,
  }) => {
    // The profile stays cloud-linked across a sign-out and simply reads as signed-out, so both
    // answers flip together — a dataset does not become local because its account signed out.
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
      sessionAfterSignOut: { status: "LoggedOut" },
      activeProfileAfterSignOut: CLOUD_PROFILE_SIGNED_OUT,
      datasets: PICKER_DATASETS_WITH_CLOUD,
    });
    await page.goto("/");

    const trigger = page.getByTestId("profile-menu-trigger");
    await expect(trigger).toHaveAttribute("data-auth-state", "logged-in");
    await trigger.click();

    const panel = page.getByTestId("profile-menu-panel");
    await expect(panel).toBeVisible();
    await page.getByTestId("profile-menu-sign-out").click();

    // Left the surface entirely rather than replacing its content in place: the profile that was open
    // is no longer authorized to be open, so the picker is the only honest destination.
    await expect(page).toHaveURL(/\/picker$/);
    await expect(page.getByTestId("dataset-picker")).toBeVisible();
    await expect(panel).toHaveCount(0);
    expect(await countIpcCalls(page, "sign_out")).toBe(1);

    // And the profile it just left is not offered back: it is still cloud-linked in the registry, so
    // it stays out of the local list.
    await page.getByTestId("picker-local-disclosure").click();
    const rows = page.getByTestId("picker-dataset-row");
    await expect(rows).toHaveCount(PICKER_DATASETS.length);
    await expect(page.getByTestId("picker-local-panel")).not.toContainText(
      CLOUD_PROFILE_SIGNED_IN.label,
    );
  });

  test("sign-out sweeps the signed-out profile's own stored draft on the way out", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
      sessionAfterSignOut: { status: "LoggedOut" },
      activeProfileAfterSignOut: CLOUD_PROFILE_SIGNED_OUT,
      datasets: PICKER_DATASETS_WITH_CLOUD,
    });
    await page.goto("/");

    // Given a resumable import draft belonging to the account that is about to leave
    await page.evaluate((key: string) => {
      localStorage.setItem(key, "{}");
    }, IMPORT_DRAFT_KEY);

    const trigger = page.getByTestId("profile-menu-trigger");
    await expect(trigger).toHaveAttribute("data-auth-state", "logged-in");
    await trigger.click();
    await page.getByTestId("profile-menu-sign-out").click();

    await expect(page.getByTestId("dataset-picker")).toBeVisible();

    // Then it is gone by the time the picker is on screen — the account's own work must not be
    // readable by whoever opens a profile next on this machine.
    expect(
      await page.evaluate((key: string) => localStorage.getItem(key), IMPORT_DRAFT_KEY),
    ).toBeNull();
  });
});

test.describe("the account menu's Nixus Cloud entry points", () => {
  test("a local profile exposes no account panel at all, whatever the stored session says", async ({
    page,
  }) => {
    // Signed in machine-wide, and it still changes nothing here: a local profile has no account, so
    // it gets no identity, no sign-out, and no migration entry point — and no session read either.
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: LOCAL_PROFILE,
      datasets: PICKER_DATASETS,
    });
    await page.goto("/");

    const trigger = page.getByTestId("profile-menu-trigger");
    await expect(trigger).toHaveAttribute("data-profile-kind", "local");
    await expect(trigger).toHaveText("Switch profile");

    for (const testId of [
      "profile-menu-panel",
      "profile-menu-cloud-status",
      "profile-menu-cloud-action",
      "profile-menu-email",
      "profile-menu-profile",
      "profile-menu-sign-out",
    ]) {
      await expect(page.getByTestId(testId), testId).toHaveCount(0);
    }
    expect(await countIpcCalls(page, "get_auth_session")).toBe(0);
  });

  test("a signed-in cloud-linked profile shows its identity without a repetitive status and no migrate action", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
    });
    await page.goto("/");

    const trigger = page.getByTestId("profile-menu-trigger");
    await expect(trigger).toHaveAttribute("data-cloud-status", "signed-in");
    await trigger.click();

    await expect(page.getByTestId("profile-menu-cloud-status")).toHaveCount(0);
    await expect(page.getByText("Signed in as", { exact: true })).toBeVisible();
    // Already linked: migrating again would only produce a second copy.
    await expect(page.getByTestId("profile-menu-cloud-action")).toHaveCount(0);
    await expect(page.getByTestId("profile-menu-sign-out")).toBeVisible();
  });

  test("a signed-out cloud-linked profile says so and offers signing back in", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: { status: "LoggedOut" },
      activeProfile: CLOUD_PROFILE_SIGNED_OUT,
    });
    await page.goto("/");

    const trigger = page.getByTestId("profile-menu-trigger");
    // Cloud-linked-but-signed-out, never reverted to a plain local profile: the panel still renders,
    // and it still says which state the account is in.
    await expect(trigger).toHaveAttribute("data-cloud-status", "signed-out");
    await trigger.click();

    await expect(page.getByTestId("profile-menu-cloud-status")).toHaveText(
      "Signed out of Nixus Cloud",
    );
    const cloudAction = page.getByTestId("profile-menu-cloud-action");
    await expect(cloudAction).toHaveText("Sign in with Nixus Cloud");
    // No sign-out to offer, and no migrate: reattaching is the only thing to do here.
    await expect(page.getByTestId("profile-menu-sign-out")).toHaveCount(0);

    await cloudAction.click();
    // The sign-in entry, never the signup one: this profile already has an account behind it, and
    // reattaching it is the whole action.
    expect(await argsOfFirstCall(page, "start_login")).toEqual({
      intent: { kind: "Login" },
      entry: "SignIn",
    });
  });

  test("no i18n key leaks into either cloud state", async ({ page }) => {
    for (const activeProfile of [LOCAL_PROFILE, CLOUD_PROFILE_SIGNED_OUT]) {
      await setupTauriMock(page, {
        session: { status: "LoggedOut" },
        activeProfile,
      });
      await page.goto("/");

      const trigger = page.getByTestId("profile-menu-trigger");
      await expect(trigger).toBeVisible();
      // Only the cloud-linked profile has a panel to open: a local one's trigger is the bare Switch
      // profile button, and clicking it leaves this surface for the picker entirely.
      if (activeProfile.kind === "cloud-linked") {
        await trigger.click();
      }

      const header = page.locator("header");
      await expect(header).not.toContainText("datasets.");
      await expect(header).not.toContainText("profile.");
    }
  });

  test("an unreadable active profile falls back to switching profiles without reading the session", async ({
    page,
  }) => {
    // `activeProfile` omitted, so `get_active_profile` rejects. An unknown kind is treated as
    // possibly-local, because guessing wrong costs the user the profile they had open — and a
    // machine-wide session is not evidence about *this* profile, so it is not consulted at all.
    await setupTauriMock(page, { session: LOGGED_IN, datasets: PICKER_DATASETS });
    await page.goto("/");

    const trigger = page.getByTestId("profile-menu-trigger");
    await expect(trigger).toBeDisabled();

    // The query settling is what has to be waited for, not merely its pending window: the default
    // QueryClient retries three times with exponential backoff, so the fourth attempt is the error
    // state landing — the exact moment a pending-only gate would have opened.
    await expect
      .poll(() => countIpcCalls(page, "get_active_profile"), { timeout: 20_000 })
      .toBeGreaterThanOrEqual(4);

    await expect(trigger).toHaveAttribute("data-profile-kind", "unknown");
    await expect(trigger).toHaveAttribute("aria-label", "Switch profile");
    await expect(page.getByTestId("profile-menu-panel")).toHaveCount(0);
    await expect(page.getByTestId("profile-menu-cloud-action")).toHaveCount(0);
    await expect(page.getByTestId("profile-menu-email")).toHaveCount(0);
    expect(await countIpcCalls(page, "get_auth_session")).toBe(0);

    await trigger.click();
    await expectPickerUsable(page);
    expect(await countIpcCalls(page, "start_login")).toBe(0);
  });
});

test.describe("expired session", () => {
  test("a cloud-linked profile states an expired session in the header and in a toast", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: { status: "SessionExpired" },
      activeProfile: CLOUD_PROFILE_SIGNED_OUT,
    });
    await page.goto("/");

    // Asserted first: the toast auto-dismisses after 4s, so it has to be read before the slower
    // layout assertions below.
    await expect(toasts(page)).toContainText(/Your session expired/);

    const trigger = page.getByTestId("profile-menu-trigger");
    await expect(trigger).toHaveAttribute("data-auth-state", "session-expired");
    await expect(trigger).toHaveAttribute("data-cloud-status", "signed-out");
    await expect(trigger).toHaveClass(/text-caution-ink/);

    // Reattaching the account is the answer to an expiry, and it stays a deliberate two step — the
    // panel, then the action — rather than a single header click.
    await trigger.click();
    await expect(page.getByTestId("profile-menu-cloud-action")).toHaveText(
      "Sign in with Nixus Cloud",
    );
  });

  test("an expired stored session never surfaces on a local profile", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: { status: "SessionExpired" },
      activeProfile: LOCAL_PROFILE,
    });
    await page.goto("/");

    const trigger = page.getByTestId("profile-menu-trigger");
    await expect(trigger).toHaveAttribute("data-profile-kind", "local");
    await expect(trigger).toHaveText("Switch profile");

    // The expiry is not this profile's to announce: the caution styling the cloud-linked trigger
    // carries cannot be derived here from a session that was never read.
    await expect(trigger).not.toHaveClass(/text-caution-ink/);
    await expect(toasts(page)).toHaveCount(0);
    expect(await countIpcCalls(page, "get_auth_session")).toBe(0);
  });

  test("an expired session does not break the app", async ({ page }) => {
    await setupTauriMock(page, {
      session: { status: "SessionExpired" },
      activeProfile: CLOUD_PROFILE_SIGNED_OUT,
    });
    await page.goto("/");

    await expect(page.getByTestId("budget-overall-progress")).toBeVisible();
    await expectNoGating(page);

    await spendingLink(page).click();
    await expect(page.getByTestId("add-group-button")).toBeVisible();
    await expectNoGating(page);
  });
});
