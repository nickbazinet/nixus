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
 * only honest way to prove the account prompt never flashes while `get_auth_session` is in flight.
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

    // Mutable on purpose: sign-out flips the answer mid-test, which is what proves both auth
    // surfaces re-read the one ["auth", "session"] cache entry after the invalidation.
    let session = opts.session;

    // The whole command surface is recorded, not just the auth commands. Recording everything is
    // what makes the "Continue Offline persisted nothing" assertion possible — auth-specific counts
    // are derived by filtering. Mirrors the `__APPLIED_TEMPLATE_CALLS` idiom in onboarding.spec.ts.
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

          case "start_login":
            return opts.start_login === undefined
              ? Promise.resolve(null)
              : settle(opts.start_login);

          case "sign_out": {
            if (opts.sessionAfterSignOut !== undefined) {
              session = opts.sessionAfterSignOut;
            }
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

/** Every command the page has invoked so far, in order. */
function readIpcCommands(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (
      (window as unknown as { __IPC_CALLS?: { cmd: string }[] }).__IPC_CALLS ?? []
    ).map((call) => call.cmd),
  );
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

function readLocalStorageKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(localStorage));
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

test.describe("account prompt on launch", () => {
  test("a launch with no session shows the prompt with both actions", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: { status: "LoggedOut" } });
    await page.goto("/");

    const dialog = page.getByTestId("account-prompt-dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("create-account-button")).toBeVisible();
    await expect(page.getByTestId("continue-offline-button")).toBeVisible();
    await expect(dialog).not.toContainText("auth.");
  });

  test("Continue Offline closes it, persists nothing, and the prompt returns next launch", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: { status: "LoggedOut" } });
    await page.goto("/");

    const dialog = page.getByTestId("account-prompt-dialog");
    await expect(dialog).toBeVisible();

    const keysBefore = await readLocalStorageKeys(page);
    const commandsBefore = await readIpcCommands(page);

    await page.getByTestId("continue-offline-button").click();
    await expect(dialog).toHaveCount(0);

    // Never assert an empty storage: the app legitimately owns `i18nextLng`, `theme`,
    // `values-hidden`, and `finance.onboarding.dismissed`. The contract is that dismissal adds
    // nothing, on either axis.
    const keysAfter = await readLocalStorageKeys(page);
    expect(keysAfter.filter((key) => !keysBefore.includes(key))).toEqual([]);
    expect(keysAfter.filter((key) => /auth|cognito|offline|session/i.test(key))).toEqual(
      [],
    );

    const commandsAfter = await readIpcCommands(page);
    const writesFromDismissal = commandsAfter
      .slice(commandsBefore.length)
      .filter((cmd) => /^(set|save|create|update|complete|delete)_/.test(cmd));
    expect(writesFromDismissal).toEqual([]);

    // "Relaunch" in the Vite harness is a reload: addInitScript re-runs, the component's dismissal
    // state is discarded, and the every-launch cadence reproduces faithfully.
    await page.reload();
    await expect(page.getByTestId("account-prompt-dialog")).toBeVisible();
  });

  test("after dismissing, the app is fully usable with no gating", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: { status: "LoggedOut" } });
    await page.goto("/");

    await page.getByTestId("continue-offline-button").click();
    await expect(page.getByTestId("account-prompt-dialog")).toHaveCount(0);

    await expect(page.getByTestId("budget-overall-progress")).toBeVisible();
    await expectNoGating(page);

    // Client-side navigation, not page.goto: a reload would re-show the prompt (that is the
    // every-launch cadence, asserted above) and this test is about life after dismissal.
    await spendingLink(page).click();
    await expect(page.getByTestId("add-group-button")).toBeVisible();
    await expect(page.getByTestId("account-prompt-dialog")).toHaveCount(0);
    await expectNoGating(page);
  });

  test("the prompt is absent for a signed-in user", async ({ page }) => {
    await setupTauriMock(page, { session: LOGGED_IN });
    await page.goto("/");

    await expect(page.getByTestId("budget-overall-progress")).toBeVisible();
    await expect(page.getByTestId("account-prompt-dialog")).toHaveCount(0);
  });

  test("the prompt never flashes while the session query is pending", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: { status: "LoggedOut" },
      sessionDelayMs: 2000,
    });
    await page.goto("/");

    // The loading affordance is the proof the pending window was real — a bare waitForTimeout would
    // assert nothing about whether the query had settled.
    const trigger = page.getByTestId("profile-menu-trigger");
    await expect(trigger).toHaveAttribute("data-auth-state", "loading");
    await expect(page.getByTestId("account-prompt-dialog")).toHaveCount(0);
    expect(await countIpcCalls(page, "get_auth_session")).toBeGreaterThan(0);

    await expect(trigger).toHaveAttribute("data-auth-state", "logged-out");
    await expect(page.getByTestId("account-prompt-dialog")).toBeVisible();
  });
});

test.describe("sign-in launch", () => {
  test("Create Account invokes start_login exactly once and goes no further", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: { status: "LoggedOut" } });
    await page.goto("/");

    const dialog = page.getByTestId("account-prompt-dialog");
    await expect(dialog).toBeVisible();

    await page.getByTestId("create-account-button").click();
    // The dialog closes on the mutation's success, so its absence means start_login has settled.
    await expect(dialog).toHaveCount(0);

    expect(await countIpcCalls(page, "start_login")).toBe(1);

    // Everything past start_login — the Hosted UI, the identity provider, the nixus://auth/callback
    // deep link, handle_auth_callback, the PKCE token exchange, the auth:callback-received event —
    // is deliberately out of E2E scope: external services are never mocked through in this suite,
    // and none of it is reachable from the Vite harness.
    expect(await countIpcCalls(page, "handle_auth_callback")).toBe(0);
    await expect(page).toHaveURL(/localhost:1420\/$/);
  });
});

test.describe("header profile entry point", () => {
  test("the logged-out header icon renders a sign-in affordance with no error state", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: { status: "LoggedOut" } });
    await page.goto("/");

    const header = page.locator("header");
    const trigger = page.getByTestId("profile-menu-trigger");

    // Asserted with the prompt still open, because that is the real logged-out launch state.
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("data-auth-state", "logged-out");
    await expect(trigger).toHaveAttribute("aria-label", "Sign In with Nixus Cloud");

    // The prompt is modal, so it aria-hides the rest of the shell. Dismiss before the sweep below
    // so the clean-profile assertions are measuring the header and not the focus trap.
    await page.getByTestId("continue-offline-button").click();
    await expect(page.getByTestId("account-prompt-dialog")).toHaveCount(0);

    await expect(page.locator('[data-auth-state="session-expired"]')).toHaveCount(0);
    await expect(header).not.toContainText(/expired|error|failed/i);
    await expect(toasts(page)).toHaveCount(0);
    await expect(trigger).not.toContainText("auth.");
    await expect(header).not.toContainText("profile.");
  });

  test("the centred search trigger is not displaced by the profile icon", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: { status: "LoggedOut" } });
    await page.goto("/");

    await page.getByTestId("continue-offline-button").click();
    await expect(page.getByTestId("account-prompt-dialog")).toHaveCount(0);

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
    await setupTauriMock(page, { session: LOGGED_IN });
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

  test("sign-out invokes sign_out once and returns both surfaces to logged out", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      sessionAfterSignOut: { status: "LoggedOut" },
    });
    await page.goto("/");

    const trigger = page.getByTestId("profile-menu-trigger");
    await expect(trigger).toHaveAttribute("data-auth-state", "logged-in");
    await trigger.click();

    const panel = page.getByTestId("profile-menu-panel");
    await expect(panel).toBeVisible();
    await page.getByTestId("profile-menu-sign-out").click();

    await expect(panel).toHaveCount(0);
    await expect(trigger).toHaveAttribute("data-auth-state", "logged-out");
    await expect(trigger).toHaveAttribute("aria-label", "Sign In with Nixus Cloud");

    // The load-bearing assertion: the account prompt reappearing means it re-read the same
    // ["auth", "session"] cache entry the profile menu invalidated, rather than holding a private
    // copy of the session.
    await expect(page.getByTestId("account-prompt-dialog")).toBeVisible();

    expect(await countIpcCalls(page, "sign_out")).toBe(1);
  });
});

test.describe("expired session", () => {
  test("an expired session is stated plainly in the header and in a toast", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: { status: "SessionExpired" } });
    await page.goto("/");

    // Asserted first: the toast auto-dismisses after 4s, so it has to be read before the slower
    // layout assertions below.
    await expect(toasts(page)).toContainText(/Your session expired/);

    const trigger = page.getByTestId("profile-menu-trigger");
    await expect(trigger).toHaveAttribute("data-auth-state", "session-expired");
    await expect(trigger).toHaveAttribute("aria-label", /Session expired/);

    // The invitation to create an account is for users who have none. This user has one.
    await expect(page.getByTestId("account-prompt-dialog")).toHaveCount(0);
  });

  test("an expired session does not break the app", async ({ page }) => {
    await setupTauriMock(page, { session: { status: "SessionExpired" } });
    await page.goto("/");

    await expect(page.getByTestId("budget-overall-progress")).toBeVisible();
    await expectNoGating(page);

    await spendingLink(page).click();
    await expect(page.getByTestId("add-group-button")).toBeVisible();
    await expectNoGating(page);
  });
});
