import { test, expect, type Page } from "@playwright/test";

/**
 * `AuthState` as the Rust side serialises it — `#[serde(tag = "status")]`, plain tagged JSON with no
 * envelope. Redeclared locally rather than imported: `apps/desktop/tests/` has no shared helper
 * module and a spec must not reach into `src/`.
 */
type MockAuthState =
  | { status: "LoggedOut" }
  | { status: "LoggedIn"; email: string; name: string | null }
  | { status: "SessionExpired" };

/** `UserProfile` as `profile_store` writes it — snake_case, `schema_version` and `cognito_sub` included. */
interface MockUserProfile {
  schema_version: number;
  cognito_sub: string;
  first_name: string | null;
  last_name: string | null;
  birth_date: string | null;
  income_bracket: string | null;
  income_bracket_currency: string | null;
  country_code: string | null;
  subdivision_code: string | null;
  created_at: string;
  updated_at: string;
}

/** `Country` as `get_countries` returns it — `name_fr` omitted entirely where no French name exists. */
interface MockCountry {
  code: string;
  name_en: string;
  name_fr?: string;
}

/** `Subdivision` as `get_subdivisions` returns it — same omit-don't-null contract as `MockCountry`. */
interface MockSubdivision {
  code: string;
  name_en: string;
  name_fr?: string;
}

/** `get_active_profile`'s wire shape. The Cognito subject is deliberately absent from it (AD-10). */
interface MockActiveProfile {
  dataset_id: string;
  kind: "local" | "cloud-linked";
  label: string;
  is_signed_in: boolean;
}

/** One entry of the dataset registry as `list_datasets` serialises it, for the `/picker` destination. */
interface MockDataset {
  id: string;
  label: string;
  kind: "local" | "cloud-linked";
  cognito_sub: string | null;
  linked_from: string | null;
  is_default: boolean;
  created_at: string;
}

/** `TfsaAccumulatedLimit` no longer renders on this surface — see `tfsa-room.spec.ts`. */

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
  start_login?: CommandOutcome;
  sign_out?: CommandOutcome;
  /** What `get_user_profile` answers. Omit for "no profile yet" (`null`). */
  profile?: MockUserProfile | null;
  get_user_profile?: CommandOutcome;
  save_user_profile?: CommandOutcome;
  /** What `get_countries` answers. Omit for the small default fixture. */
  countries?: MockCountry[];
  /** What `get_subdivisions` answers, keyed by country code. An absent key answers `[]`, as Rust does. */
  subdivisions?: Record<string, MockSubdivision[]>;
  /**
   * What `get_active_profile` answers. Omit to leave it unstubbed so it falls through to the reject
   * fallback — the state every pre-existing spec in this directory runs in, and the one the guard
   * must degrade to "Switch profile" under, since a Login would activate a cloud dataset instead.
   */
  activeProfile?: MockActiveProfile;
  /** What `list_datasets` answers, so the `/picker` destination renders its list rather than an error. */
  datasets?: MockDataset[];
  /**
   * What `get_cloud_ai_premium` answers. Omit for a non-premium account: an entitlement is never
   * assumed, so the default is the answer that makes no claim.
   */
  cloudAiPremium?: CommandOutcome;
  /** Seeds `i18nextLng` before the app boots, so the FR locale is active on first paint. */
  language?: string;
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
 *
 * Only already-shipped commands are stubbed. `get_user_profile` / `save_user_profile` are stubbed
 * because Story 28.2's ProfileForm invokes them from the `/profile` route's LoggedIn branch.
 */
async function setupTauriMock(page: Page, options: AuthOptions = {}) {
  await page.addInitScript((opts: AuthOptions) => {
    if (opts.language !== undefined) {
      window.localStorage.setItem("i18nextLng", opts.language);
    }

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

    const session = opts.session;

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
          case "get_auth_session":
            return session === undefined
              ? Promise.reject(`Unknown command: ${cmd}`)
              : settle({
                  kind: "resolve",
                  value: session,
                  delayMs: opts.sessionDelayMs,
                });

          case "get_active_profile":
            return opts.activeProfile === undefined
              ? Promise.reject(`Unknown command: ${cmd}`)
              : Promise.resolve(opts.activeProfile);

          case "get_cloud_ai_premium":
            return opts.cloudAiPremium === undefined
              ? Promise.resolve(false)
              : settle(opts.cloudAiPremium);

          case "list_datasets":
            return opts.datasets === undefined
              ? Promise.reject(`Unknown command: ${cmd}`)
              : Promise.resolve(opts.datasets);

          case "start_login":
            return opts.start_login === undefined
              ? Promise.resolve(null)
              : settle(opts.start_login);

          case "sign_out":
            return opts.sign_out === undefined
              ? Promise.resolve(null)
              : settle(opts.sign_out);

          case "get_user_profile":
            return opts.get_user_profile === undefined
              ? Promise.resolve(opts.profile ?? null)
              : settle(opts.get_user_profile);

          case "save_user_profile":
            if (opts.save_user_profile !== undefined) {
              return settle(opts.save_user_profile);
            }
            return Promise.resolve({
              schema_version: 1,
              cognito_sub: "mock-sub",
              first_name: (args.first_name as string | null) ?? null,
              last_name: (args.last_name as string | null) ?? null,
              birth_date: (args.birth_date as string | null) ?? null,
              income_bracket: (args.income_bracket as string | null) ?? null,
              income_bracket_currency:
                (args.income_bracket_currency as string | null) ?? null,
              country_code: (args.country_code as string | null) ?? null,
              subdivision_code: (args.subdivision_code as string | null) ?? null,
              created_at: "2026-01-01T00:00:00+00:00",
              updated_at: "2026-06-01T00:00:00+00:00",
            });

          case "get_countries":
            return Promise.resolve(
              opts.countries ?? [
                { code: "CA", name_en: "Canada", name_fr: "Canada" },
                { code: "FR", name_en: "France", name_fr: "France" },
                { code: "JP", name_en: "Japan", name_fr: "Japon" },
              ],
            );

          case "get_subdivisions": {
            const byCountry = opts.subdivisions ?? {
              CA: [
                { code: "CA-QC", name_en: "Quebec", name_fr: "Québec" },
                { code: "CA-ON", name_en: "Ontario" },
              ],
              US: [
                { code: "US-NY", name_en: "New York" },
                { code: "US-CA", name_en: "California" },
              ],
              VA: [],
            };
            return Promise.resolve(
              byCountry[args.country_code as string] ?? [],
            );
          }

          case "check_picker_gate":
            return Promise.resolve({ needs_picker: false });
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

/** The argument payloads of every call to one command, in order. */
function readIpcArgs(page: Page, cmd: string): Promise<unknown[]> {
  return page.evaluate((name) => {
    const calls =
      (window as unknown as { __IPC_CALLS?: { cmd: string; args: unknown }[] })
        .__IPC_CALLS ?? [];
    return calls.filter((call) => call.cmd === name).map((call) => call.args);
  }, cmd);
}

/** Sonner renders each toast as an `li[data-sonner-toast]` outside the router subtree. */
function toastCount(page: Page) {
  return page.locator("[data-sonner-toast]");
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

/**
 * Signed out, and cloud-linked: the one state in which the guard may offer a one-click Login, because
 * the profile it would land on is the one already open.
 */
const CLOUD_PROFILE: MockActiveProfile = {
  dataset_id: "00000000-0000-4000-8000-0000000000c1",
  kind: "cloud-linked",
  label: "user@example.com",
  is_signed_in: false,
};

/**
 * The same profile with its account attached. The account menu reads the session only for a
 * cloud-linked profile, so every spec that drives the menu's signed-in panel supplies this.
 */
const CLOUD_PROFILE_SIGNED_IN: MockActiveProfile = {
  ...CLOUD_PROFILE,
  is_signed_in: true,
};

/** The registry `/picker` reads once the guard's Switch profile action has navigated there. */
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

/** Commands later stories introduce. None of them may be reachable from this story's code. */
const FUTURE_PROFILE_COMMANDS = ["get_location_catalog"];

/** Includes the subdivision-less country and the two subdivision-bearing ones the specs below switch between. */
const LOCATION_COUNTRIES: MockCountry[] = [
  { code: "CA", name_en: "Canada", name_fr: "Canada" },
  { code: "US", name_en: "United States", name_fr: "États-Unis" },
  { code: "VA", name_en: "Holy See", name_fr: "Saint-Siège" },
];

const SAVED_PROFILE: MockUserProfile = {
  schema_version: 1,
  cognito_sub: "mock-sub",
  first_name: "Ada",
  last_name: "Lovelace",
  birth_date: "1985-03-14",
      income_bracket: "100k_149k",
      income_bracket_currency: "CAD",
  country_code: "CA",
  subdivision_code: "CA-QC",
  created_at: "2026-01-01T00:00:00+00:00",
  updated_at: "2026-02-01T00:00:00+00:00",
};

test.describe("profile entry point", () => {
  test("the signed-in dropdown offers Profile and navigates to /profile", async ({
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

    await expect(page.getByTestId("profile-menu-panel")).toBeVisible();
    const profileItem = page.getByTestId("profile-menu-profile");
    await expect(profileItem).toBeVisible();
    await expect(page.getByTestId("profile-menu-sign-out")).toBeVisible();

    await profileItem.click();

    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByTestId("profile-page")).toHaveAttribute(
      "data-auth-state",
      "logged-in",
    );
    await expect(page.getByTestId("profile-email")).toHaveText(
      "user@example.com",
    );
  });

  test("reaching /profile requests the profile and nothing a later story owns", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
    });
    await page.goto("/");

    await page.getByTestId("profile-menu-trigger").click();
    await page.getByTestId("profile-menu-profile").click();
    await expect(page.getByTestId("profile-email")).toBeVisible();
    await expect(page.getByTestId("profile-form")).toBeVisible();

    const commands = await readIpcCommands(page);
    expect(commands).toContain("get_user_profile");
    expect(commands).toContain("get_countries");
    // The accumulated TFSA figure moved off this surface onto Where-to-put-your-money and
    // Insights, so this surface asking for it again would be the regression.
    expect(commands).not.toContain("get_tfsa_accumulated_limit");
    for (const command of FUTURE_PROFILE_COMMANDS) {
      expect(commands).not.toContain(command);
    }
  });

  test("the account dropdown itself requests no profile data", async ({ page }) => {
    // ProfileMenu is always mounted, so an invoke() added there would force every other spec's
    // Tauri mock to grow a case. The form must be the only consumer, and it lives behind a route.
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
    });
    await page.goto("/");

    await page.getByTestId("profile-menu-trigger").click();
    await expect(page.getByTestId("profile-menu-panel")).toBeVisible();

    const requested = await readIpcCommands(page);
    expect(requested).not.toContain("get_user_profile");
    expect(requested).not.toContain("get_tfsa_accumulated_limit");
  });

  test("a local profile's header offers no dropdown and no Profile item", async ({
    page,
  }) => {
    // A local profile has no account, so there is nothing for a panel to show — and the Profile item
    // in particular would lead to a surface that only an account can fill.
    await setupTauriMock(page, {
      session: { status: "LoggedOut" },
      activeProfile: LOCAL_PROFILE,
    });
    await page.goto("/");

    const trigger = page.getByTestId("profile-menu-trigger");
    await expect(trigger).toHaveAttribute("data-profile-kind", "local");
    await expect(page.getByTestId("profile-menu-profile")).toHaveCount(0);
    await expect(page.getByTestId("profile-menu-panel")).toHaveCount(0);
  });
});

test.describe("account menu hosted-AI entitlement", () => {
  const PREMIUM_ROW = "profile-menu-premium";

  async function openAccountMenu(page: Page) {
    await page.goto("/");
    await page.getByTestId("profile-menu-trigger").click();
    await expect(page.getByTestId("profile-menu-panel")).toBeVisible();
  }

  test("an eligible account shows the Premium label only", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
      cloudAiPremium: { kind: "resolve", value: true },
    });
    await openAccountMenu(page);

    const row = page.getByTestId(PREMIUM_ROW);
    await expect(row).toBeVisible();
    await expect(row).toHaveText("Premium");

    // Beneath the identity it qualifies, not above it: an entitlement announced before the account
    // it belongs to reads as a property of the app.
    const emailIsFirst = await page.evaluate(() => {
      const email = document.querySelector('[data-testid="profile-menu-email"]');
      const premium = document.querySelector('[data-testid="profile-menu-premium"]');
      if (email === null || premium === null) return null;
      return Boolean(
        email.compareDocumentPosition(premium) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });
    expect(emailIsFirst).toBe(true);
  });

  test("the badge uses the premium entitlement variant", async ({ page }) => {
    // Amber is the specific mis-signal this placement rejects: it already means attention-required
    // everywhere else in the product, and an entitlement demands nothing of the user.
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
      cloudAiPremium: { kind: "resolve", value: true },
    });
    await openAccountMenu(page);

    const badge = page.getByTestId(PREMIUM_ROW).locator("[data-slot='badge']");
    await expect(badge).toHaveAttribute("data-variant", "premium");
  });

  test("Premium belongs to the account control, not the wordmark", async ({ page }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
      cloudAiPremium: { kind: "resolve", value: true },
    });
    await page.goto("/");

    const lockup = page.locator("aside button[aria-expanded]").first();
    await expect(lockup.locator("svg")).toHaveCount(1);
    expect(
      await lockup.evaluate((node) => (node.textContent ?? "").replace(/\s/g, ""))
    ).toBe("ixus");
    await expect(page.getByTestId("sidebar-premium")).toHaveCount(0);

    const trigger = page.getByTestId("profile-menu-trigger");
    await expect(trigger).toHaveAttribute("data-premium", "true");
    await expect(trigger).toHaveAccessibleName(/Premium/);
  });

  test("the account icon uses the premium token and the trigger border does not", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
      cloudAiPremium: { kind: "resolve", value: true },
    });
    await openAccountMenu(page);

    const colors = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const normalise = (value: string) => {
        const probe = document.createElement("div");
        probe.style.color = value;
        document.body.append(probe);
        const resolved = getComputedStyle(probe).color;
        probe.remove();
        return resolved;
      };
      const trigger = document.querySelector('[data-testid="profile-menu-trigger"]');
      const icon = document.querySelector('[data-testid="profile-menu-icon"]');
      const badge = document.querySelector('[data-testid="profile-menu-premium"] [data-slot="badge"]');
      if (trigger === null || icon === null || badge === null) return null;
      return {
        triggerBorder: getComputedStyle(trigger).borderColor,
        icon: getComputedStyle(icon).color,
        badgeBorder: getComputedStyle(badge).borderColor,
        badgeText: getComputedStyle(badge).color,
        premium: normalise(root.getPropertyValue("--premium-ink").trim()),
        caution: normalise(root.getPropertyValue("--caution").trim()),
        cautionInk: normalise(root.getPropertyValue("--caution-ink").trim()),
      };
    });

    expect(colors).not.toBeNull();
    if (colors === null) return;
    expect(colors.icon).toBe(colors.premium);
    expect(colors.triggerBorder).not.toBe(colors.premium);
    expect(colors.badgeBorder).toBe(colors.premium);
    expect(colors.badgeText).toBe(colors.premium);
    expect(colors.badgeText).not.toBe(colors.cautionInk);
  });

  test("the trigger and menu render from a single entitlement request", async ({ page }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
      cloudAiPremium: { kind: "resolve", value: true },
    });
    await openAccountMenu(page);

    await expect(page.getByTestId("profile-menu-trigger")).toHaveAttribute(
      "data-premium",
      "true",
    );
    await expect(page.getByTestId(PREMIUM_ROW)).toBeVisible();

    const commands = await readIpcCommands(page);
    expect(commands.filter((cmd) => cmd === "get_cloud_ai_premium")).toHaveLength(1);
  });

  test("the premium row takes no keyboard focus and leaves the menu order unchanged", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
      cloudAiPremium: { kind: "resolve", value: true },
    });
    await openAccountMenu(page);

    // The two actuable items, in the order they shipped. A status row that had joined the roving
    // focus would insert itself here and strand a keyboard user on a label.
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("profile-menu-profile")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("profile-menu-sign-out")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("profile-menu-profile")).toBeFocused();
  });

  test("an ineligible account makes no premium claim and gets no free-tier label", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
      cloudAiPremium: { kind: "resolve", value: false },
    });
    await openAccountMenu(page);

    await expect(page.getByTestId(PREMIUM_ROW)).toHaveCount(0);
    expect(
      await page.getByTestId("profile-menu-trigger").getAttribute("data-premium"),
    ).toBeNull();
    await expect(page.getByText(/premium/i)).toHaveCount(0);
    await expect(page.getByText(/^free$/i)).toHaveCount(0);
    // The account is still fully usable: silence about the entitlement is not degradation.
    await expect(page.getByTestId("profile-menu-profile")).toBeVisible();
    await expect(page.getByTestId("profile-menu-sign-out")).toBeVisible();
  });

  test("a rejected status read stays silent and leaves every account action usable", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
      cloudAiPremium: {
        kind: "reject",
        error: { type: "auth", message: "boom", recoverable: true },
      },
    });
    await openAccountMenu(page);

    await expect(page.getByTestId(PREMIUM_ROW)).toHaveCount(0);
    expect(
      await page.getByTestId("profile-menu-trigger").getAttribute("data-premium"),
    ).toBeNull();
    await expect(page.getByTestId("profile-menu-profile")).toBeVisible();
    await expect(page.getByTestId("profile-menu-sign-out")).toBeVisible();
    // No toast and no error panel: this menu is mounted on every screen, so a failure surfaced here
    // would follow the user around the whole app.
    await expect(toastCount(page)).toHaveCount(0);
  });

  test("a slow status read never flashes a premium claim it has not confirmed", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
      cloudAiPremium: { kind: "resolve", value: true, delayMs: 1500 },
    });
    await openAccountMenu(page);

    await expect(page.getByTestId(PREMIUM_ROW)).toHaveCount(0);
    expect(
      await page.getByTestId("profile-menu-trigger").getAttribute("data-premium"),
    ).toBeNull();
    await expect(page.getByTestId(PREMIUM_ROW)).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("profile-menu-trigger")).toHaveAttribute(
      "data-premium",
      "true",
    );
  });

  test("a local profile never asks for the entitlement at all", async ({ page }) => {
    // NFR7: a local profile is a purely local concept, and this command resolves a Cognito token.
    await setupTauriMock(page, {
      session: { status: "LoggedOut" },
      activeProfile: LOCAL_PROFILE,
      cloudAiPremium: { kind: "resolve", value: true },
    });
    await page.goto("/");
    await expect(page.getByTestId("profile-menu-trigger")).toHaveAttribute(
      "data-profile-kind",
      "local",
    );

    expect(
      await page.getByTestId("profile-menu-trigger").getAttribute("data-premium"),
    ).toBeNull();
    expect(await readIpcCommands(page)).not.toContain("get_cloud_ai_premium");
  });

  test("a signed-out cloud profile never asks for the entitlement", async ({ page }) => {
    await setupTauriMock(page, {
      session: { status: "LoggedOut" },
      activeProfile: CLOUD_PROFILE,
      cloudAiPremium: { kind: "resolve", value: true },
    });
    await openAccountMenu(page);

    await expect(page.getByTestId("profile-menu-cloud-status")).toBeVisible();
    await expect(page.getByTestId(PREMIUM_ROW)).toHaveCount(0);
    expect(await readIpcCommands(page)).not.toContain("get_cloud_ai_premium");
  });

  test("a logged-in session belonging to another account claims nothing here", async ({
    page,
  }) => {
    // The subject-mismatch row of the matrix, and the one a kind+status gate lets through: the
    // session is machine-wide and says LoggedIn, while `is_signed_in` says that session is not
    // this profile's account. Without the extra condition a second cloud profile would paint the
    // first one's entitlement.
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: CLOUD_PROFILE,
      cloudAiPremium: { kind: "resolve", value: true },
    });
    await openAccountMenu(page);

    expect(
      await page.getByTestId("profile-menu-trigger").getAttribute("data-premium"),
    ).toBeNull();
    await expect(page.getByTestId(PREMIUM_ROW)).toHaveCount(0);
    await expect(page.getByText(/premium/i)).toHaveCount(0);
    expect(await readIpcCommands(page)).not.toContain("get_cloud_ai_premium");
  });

  test("an expired session never asks for the entitlement", async ({ page }) => {
    await setupTauriMock(page, {
      session: { status: "SessionExpired" },
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
      cloudAiPremium: { kind: "resolve", value: true },
    });
    await openAccountMenu(page);

    await expect(page.getByTestId(PREMIUM_ROW)).toHaveCount(0);
    expect(
      await page.getByTestId("profile-menu-trigger").getAttribute("data-premium"),
    ).toBeNull();
    expect(await readIpcCommands(page)).not.toContain("get_cloud_ai_premium");
  });

  test("in French the row resolves its label and leaks no raw key", async ({ page }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
      cloudAiPremium: { kind: "resolve", value: true },
      language: "fr",
    });
    await openAccountMenu(page);

    // The FR label is deliberately the same word as EN — `Premium` is the established French term
    // across this product — so the failure this catches is the key going missing from fr.json,
    // which i18next renders as the bare `profile.premiumBadge` string.
    const row = page.getByTestId(PREMIUM_ROW);
    await expect(row).toHaveText("Premium");
    await expect(row).not.toContainText("profile.");
    await expect(page.getByTestId("profile-menu-trigger")).toHaveAccessibleName(
      /Premium/,
    );
  });

  test("the row holds at the enforced minimum window without clipping the badge", async ({
    page,
  }) => {
    // 1024 x 680 is the enforced minimum, and the badge is `whitespace-nowrap`, so a panel too
    // narrow for a translated label truncates the only thing carrying the claim.
    await page.setViewportSize({ width: 1024, height: 680 });
    await setupTauriMock(page, {
      session: LOGGED_IN,
      activeProfile: CLOUD_PROFILE_SIGNED_IN,
      cloudAiPremium: { kind: "resolve", value: true },
      language: "fr",
    });
    await openAccountMenu(page);

    const badge = page.getByTestId(PREMIUM_ROW).locator("[data-slot='badge']");
    await expect(badge).toBeVisible();
    const clipped = await badge.evaluate(
      (node) => node.scrollWidth > node.clientWidth + 1,
    );
    expect(clipped).toBe(false);

    // And it sits inside the panel rather than overflowing it, which a clip check alone misses.
    const badgeBox = (await badge.boundingBox())!;
    const panelBox = (await page.getByTestId("profile-menu-panel").boundingBox())!;
    expect(badgeBox.x).toBeGreaterThanOrEqual(panelBox.x);
    expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(
      panelBox.x + panelBox.width + 1,
    );
  });

});

test.describe("/profile session guard", () => {
  test("a pending session shows the skeleton and never flashes the guard", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: LOGGED_IN, sessionDelayMs: 2000 });
    await page.goto("/profile");

    const surface = page.getByTestId("profile-page");
    await expect(surface).toHaveAttribute("data-auth-state", "loading");
    await expect(page.getByTestId("profile-skeleton")).toBeVisible();
    await expect(page.getByTestId("profile-sign-in-required")).toHaveCount(0);

    await expect(surface).toHaveAttribute("data-auth-state", "logged-in");
    await expect(page.getByTestId("profile-email")).toHaveText(
      "user@example.com",
    );
  });

  test("signed out on /profile shows the sign-in required state and no email", async ({
    page,
  }) => {
    // Cloud-linked, so the direct action is the correct offer: signing back in reopens the profile
    // already open rather than switching the user off a local one.
    await setupTauriMock(page, {
      session: { status: "LoggedOut" },
      activeProfile: CLOUD_PROFILE,
    });
    await page.goto("/profile");

    const guard = page.getByTestId("profile-sign-in-required");
    await expect(guard).toBeVisible();
    await expect(guard).toHaveAttribute("data-auth-state", "logged-out");
    await expect(page.getByTestId("profile-sign-in-action")).toHaveText(
      "Sign in with Nixus Cloud",
    );
    await expect(page.getByTestId("profile-email")).toHaveCount(0);
  });

  test("an expired session reuses the shipped expired copy", async ({ page }) => {
    await setupTauriMock(page, {
      session: { status: "SessionExpired" },
      activeProfile: CLOUD_PROFILE,
    });
    await page.goto("/profile");

    const guard = page.getByTestId("profile-sign-in-required");
    await expect(guard).toBeVisible();
    await expect(guard).toHaveAttribute("data-auth-state", "session-expired");
    await expect(page.getByTestId("profile-sign-in-action")).toHaveText(
      /Session expired/,
    );
  });

  test("a local profile's guard switches profiles instead of signing in silently", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: { status: "LoggedOut" },
      activeProfile: LOCAL_PROFILE,
      datasets: PICKER_DATASETS,
    });
    await page.goto("/profile");

    const guard = page.getByTestId("profile-sign-in-required");
    await expect(guard).toBeVisible();
    // The whole point: completing a Login find-or-creates a cloud dataset and activates it, so this
    // surface may not offer that in one click while a *local* profile is the one open.
    await expect(page.getByTestId("profile-sign-in-action")).toHaveCount(0);
    const switchProfile = page.getByTestId("profile-switch-profile-action");
    await expect(switchProfile).toHaveText("Switch profile");

    await switchProfile.click();

    // The destination is asserted, not just the URL: a picker that rendered its load error would
    // leave the user with no way back and the assertion would still pass on the URL alone.
    await expect(page).toHaveURL(/\/picker$/);
    // The local list sits behind the launch screen's default-collapsed disclosure, so it is asked for
    // before it is asserted.
    await page.getByTestId("picker-local-disclosure").click();
    await expect(page.getByTestId("picker-dataset-list")).toBeVisible();
    await expect(page.getByTestId("picker-load-error")).toHaveCount(0);
    const commands = await readIpcCommands(page);
    expect(commands).not.toContain("start_login");
  });

  test("an unreadable active profile withholds the direct sign-in too", async ({
    page,
  }) => {
    // `activeProfile` left unstubbed, so `get_active_profile` rejects: an unknown kind is treated as
    // possibly-local, because guessing wrong here costs the user their open profile.
    await setupTauriMock(page, {
      session: { status: "LoggedOut" },
      datasets: PICKER_DATASETS,
    });
    await page.goto("/profile");

    await expect(page.getByTestId("profile-sign-in-required")).toBeVisible();
    await expect(
      page.getByTestId("profile-switch-profile-action"),
    ).toBeVisible();
    await expect(page.getByTestId("profile-sign-in-action")).toHaveCount(0);
  });

  test("an unusable session payload fails closed and stays silent", async ({
    page,
  }) => {
    // `session` left unstubbed reproduces the 24 specs that never stub `get_auth_session`.
    await setupTauriMock(page);
    await page.goto("/profile");

    // The default QueryClient retries a rejected query three times with exponential backoff, so
    // `isError` lands ~7s in. The whole retry window must already fail closed, which is what the
    // skeleton assertion below proves: pending renders no profile content either.
    await expect(page.getByTestId("profile-skeleton")).toBeVisible();
    await expect(page.getByTestId("profile-email")).toHaveCount(0);

    const guard = page.getByTestId("profile-sign-in-required");
    await expect(guard).toBeVisible({ timeout: 20000 });
    await expect(guard).toHaveAttribute("data-auth-state", "unavailable");
    await expect(page.getByTestId("profile-email")).toHaveCount(0);
    await expect(toastCount(page)).toHaveCount(0);
  });

  test("no raw i18n key leaks onto the surface", async ({ page }) => {
    await setupTauriMock(page, { session: LOGGED_IN });
    await page.goto("/profile");

    const surface = page.getByTestId("profile-page");
    await expect(surface).toBeVisible();
    await expect(surface).not.toContainText("profile.");
  });

  test("/profile is not part of the navigation IA", async ({ page }) => {
    await setupTauriMock(page, { session: LOGGED_IN });
    await page.goto("/profile");

    await expect(page.getByTestId("profile-page")).toBeVisible();
    await expect(
      page
        .locator('nav[aria-label="Finance navigation"]')
        .getByRole("link", { name: /profil/i }),
    ).toHaveCount(0);
    await expect(
      page.locator("nav").first().getByRole("link", { name: /profil/i }),
    ).toHaveCount(0);
  });
});

test.describe("/profile name form", () => {
  test("no profile yet renders empty fields and no error", async ({ page }) => {
    await setupTauriMock(page, { session: LOGGED_IN, profile: null });
    await page.goto("/profile");

    await expect(page.getByTestId("profile-form")).toBeVisible();
    await expect(page.getByTestId("profile-first-name")).toHaveValue("");
    await expect(page.getByTestId("profile-last-name")).toHaveValue("");
    await expect(page.getByTestId("profile-save")).toBeEnabled();
    await expect(toastCount(page)).toHaveCount(0);
  });

  test("an existing profile populates both fields once the query resolves", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: LOGGED_IN, profile: SAVED_PROFILE });
    await page.goto("/profile");

    await expect(page.getByTestId("profile-first-name")).toHaveValue("Ada");
    await expect(page.getByTestId("profile-last-name")).toHaveValue("Lovelace");
  });

  test("saving submits every field, passing through the ones it does not render", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: LOGGED_IN, profile: SAVED_PROFILE });
    await page.goto("/profile");

    const firstName = page.getByTestId("profile-first-name");
    await expect(firstName).toHaveValue("Ada");
    await firstName.fill("Grace");
    await page.getByTestId("profile-save").click();

    await expect(toastCount(page)).toHaveCount(1);

    const [args] = await readIpcArgs(page, "save_user_profile");
    expect(args).toEqual({
      first_name: "Grace",
      last_name: "Lovelace",
      birth_date: "1985-03-14",
  income_bracket: "100k_149k",
      income_bracket_currency: "CAD",
      country_code: "CA",
      subdivision_code: "CA-QC",
    });
  });

  test("clearing a field submits null rather than an empty string", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: LOGGED_IN, profile: SAVED_PROFILE });
    await page.goto("/profile");

    const lastName = page.getByTestId("profile-last-name");
    await expect(lastName).toHaveValue("Lovelace");
    await lastName.fill("");
    await page.getByTestId("profile-save").click();

    await expect(toastCount(page)).toHaveCount(1);

    const [args] = await readIpcArgs(page, "save_user_profile");
    expect((args as Record<string, unknown>).last_name).toBeNull();
  });

  test("a field validation error lands on the field, not on a toast", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      profile: SAVED_PROFILE,
      save_user_profile: {
        kind: "reject",
        error: {
          type: "validation",
          message: "That first name is not acceptable",
          field: "first_name",
        },
      },
    });
    await page.goto("/profile");

    await expect(page.getByTestId("profile-first-name")).toHaveValue("Ada");
    await page.getByTestId("profile-save").click();

    await expect(
      page.getByText("That first name is not acceptable"),
    ).toBeVisible();
    await expect(page.getByTestId("profile-first-name")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(toastCount(page)).toHaveCount(0);
  });

  test("a non-field error falls back to the save-failed toast", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      profile: SAVED_PROFILE,
      save_user_profile: {
        kind: "reject",
        error: { type: "file", message: "Failed to write profile" },
      },
    });
    await page.goto("/profile");

    await expect(page.getByTestId("profile-first-name")).toHaveValue("Ada");
    await page.getByTestId("profile-save").click();

    await expect(toastCount(page)).toHaveCount(1);
    await expect(
      page.locator("[data-sonner-toast]").getByText(/Failed to save/i),
    ).toBeVisible();
  });

  test("the save button reports its pending state and re-enables", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      profile: SAVED_PROFILE,
      save_user_profile: {
        kind: "resolve",
        value: SAVED_PROFILE,
        delayMs: 1500,
      },
    });
    await page.goto("/profile");

    await expect(page.getByTestId("profile-first-name")).toHaveValue("Ada");
    const save = page.getByTestId("profile-save");
    await save.click();

    await expect(save).toBeDisabled();
    await expect(save).toHaveText(/Saving/);
    await expect(save).toBeEnabled({ timeout: 10000 });
    await expect(save).toHaveText("Save");
  });

  test("the form is absent in every non-signed-in state", async ({ page }) => {
    await setupTauriMock(page, { session: { status: "SessionExpired" } });
    await page.goto("/profile");

    await expect(page.getByTestId("profile-sign-in-required")).toBeVisible();
    await expect(page.getByTestId("profile-form")).toHaveCount(0);
    const requested = await readIpcCommands(page);
    expect(requested).not.toContain("get_user_profile");
    expect(requested).not.toContain("get_tfsa_accumulated_limit");
  });
});

test.describe("/profile country selector", () => {
  test("the selector offers every country from get_countries plus an explicit unset option", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: LOGGED_IN, profile: null });
    await page.goto("/profile");

    const trigger = page.getByTestId("profile-country");
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveText("Select a country");

    await trigger.click();
    for (const label of ["Not specified", "Canada", "France", "Japan"]) {
      await expect(
        page.getByRole("option", { name: label, exact: true }),
      ).toBeVisible();
    }
  });

  test("an existing country_code populates the trigger and saves unchanged", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: LOGGED_IN, profile: SAVED_PROFILE });
    await page.goto("/profile");

    await expect(page.getByTestId("profile-country")).toHaveText("Canada");

    await page.getByTestId("profile-save").click();
    await expect(toastCount(page)).toHaveCount(1);

    const [args] = await readIpcArgs(page, "save_user_profile");
    expect((args as Record<string, unknown>).country_code).toBe("CA");
  });

  test("selecting a country submits its alpha-2 code", async ({ page }) => {
    await setupTauriMock(page, { session: LOGGED_IN, profile: null });
    await page.goto("/profile");

    await page.getByTestId("profile-country").click();
    await page.getByRole("option", { name: "Japan", exact: true }).click();
    await expect(page.getByTestId("profile-country")).toHaveText("Japan");

    await page.getByTestId("profile-save").click();
    await expect(toastCount(page)).toHaveCount(1);

    const [args] = await readIpcArgs(page, "save_user_profile");
    expect((args as Record<string, unknown>).country_code).toBe("JP");
  });

  test("choosing not specified submits null rather than an empty string", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: LOGGED_IN, profile: SAVED_PROFILE });
    await page.goto("/profile");

    await expect(page.getByTestId("profile-country")).toHaveText("Canada");
    await page.getByTestId("profile-country").click();
    await page.getByRole("option", { name: "Not specified", exact: true }).click();

    await page.getByTestId("profile-save").click();
    await expect(toastCount(page)).toHaveCount(1);

    const [args] = await readIpcArgs(page, "save_user_profile");
    expect((args as Record<string, unknown>).country_code).toBeNull();
  });

  test("a country_code validation error lands on the field, not on a toast", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      profile: SAVED_PROFILE,
      save_user_profile: {
        kind: "reject",
        error: {
          type: "validation",
          message: "Invalid country code: ZZ",
          field: "country_code",
        },
      },
    });
    await page.goto("/profile");

    await expect(page.getByTestId("profile-country")).toHaveText("Canada");
    await page.getByTestId("profile-save").click();

    await expect(page.getByText("Invalid country code: ZZ")).toBeVisible();
    await expect(page.getByTestId("profile-country")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(toastCount(page)).toHaveCount(0);
  });

  // A country whose dataset entry carries no name_fr must still render its English
  // name: name_en is the only guaranteed-non-empty display field (G6).
  test("a country with no French name falls back to its English name", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      profile: null,
      countries: [
        { code: "CA", name_en: "Canada", name_fr: "Canada" },
        { code: "NU", name_en: "Niue" },
      ],
    });
    await page.goto("/profile");

    await page.getByTestId("profile-country").click();
    await expect(
      page.getByRole("option", { name: "Niue", exact: true }),
    ).toBeVisible();
  });
});

test.describe("/profile subdivision selector", () => {
  test("a country with subdivisions offers exactly its own, plus an unset option", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      profile: null,
      countries: LOCATION_COUNTRIES,
    });
    await page.goto("/profile");

    await page.getByTestId("profile-country").click();
    await page.getByRole("option", { name: "Canada", exact: true }).click();

    await expect(page.getByTestId("profile-subdivision")).toBeVisible();
    const trigger = page.getByTestId("profile-subdivision-trigger");
    await expect(trigger).toHaveText("Select a state, province, or region");

    await trigger.click();
    // Scoped to the subdivision's own popup: the country popup stays mounted after
    // it closes, and it carries the same "Not specified" label.
    const popup = page.locator('[data-slot="select-content"][data-open]');
    await expect(popup).toHaveCount(1);
    for (const label of ["Not specified", "Quebec", "Ontario"]) {
      await expect(
        popup.getByRole("option", { name: label, exact: true }),
      ).toBeVisible();
    }
    for (const label of ["New York", "California"]) {
      await expect(
        page.getByRole("option", { name: label, exact: true }),
      ).toHaveCount(0);
    }
  });

  test("a country with no subdivisions does not offer the field at all", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      profile: null,
      countries: LOCATION_COUNTRIES,
    });
    await page.goto("/profile");

    await page.getByTestId("profile-country").click();
    await page.getByRole("option", { name: "Holy See", exact: true }).click();
    await expect(page.getByTestId("profile-country")).toHaveText("Holy See");

    await expect(page.getByTestId("profile-subdivision")).toHaveCount(0);
  });

  test("no country selected means no field and no get_subdivisions call at all", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      profile: null,
      countries: LOCATION_COUNTRIES,
    });
    await page.goto("/profile");

    await expect(page.getByTestId("profile-form")).toBeVisible();
    await expect(page.getByTestId("profile-country")).toHaveText(
      "Select a country",
    );
    await expect(page.getByTestId("profile-subdivision")).toHaveCount(0);

    // The absent field alone would also pass with a query that ran and was merely
    // hidden; the recorded call count is what proves `enabled` is false.
    expect(await readIpcArgs(page, "get_subdivisions")).toEqual([]);
  });

  test("changing the country clears the subdivision and submits null", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      profile: null,
      countries: LOCATION_COUNTRIES,
    });
    await page.goto("/profile");

    await page.getByTestId("profile-country").click();
    await page.getByRole("option", { name: "Canada", exact: true }).click();
    await page.getByTestId("profile-subdivision-trigger").click();
    await page.getByRole("option", { name: "Quebec", exact: true }).click();
    await expect(page.getByTestId("profile-subdivision-trigger")).toHaveText(
      "Quebec",
    );

    await page.getByTestId("profile-country").click();
    await page
      .getByRole("option", { name: "United States", exact: true })
      .click();

    await expect(page.getByTestId("profile-subdivision-trigger")).toHaveText(
      "Select a state, province, or region",
    );

    await page.getByTestId("profile-save").click();
    await expect(toastCount(page)).toHaveCount(1);

    const [args] = await readIpcArgs(page, "save_user_profile");
    expect((args as Record<string, unknown>).country_code).toBe("US");
    expect((args as Record<string, unknown>).subdivision_code).toBeNull();
  });

  test("returning to a country already viewed makes no second call", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      profile: null,
      countries: LOCATION_COUNTRIES,
    });
    await page.goto("/profile");

    for (const country of ["Canada", "United States", "Canada"]) {
      await page.getByTestId("profile-country").click();
      await page.getByRole("option", { name: country, exact: true }).click();
      await expect(page.getByTestId("profile-country")).toHaveText(country);
      await expect(page.getByTestId("profile-subdivision")).toBeVisible();
    }

    expect(await readIpcArgs(page, "get_subdivisions")).toEqual([
      { country_code: "CA" },
      { country_code: "US" },
    ]);
  });

  test("in French a subdivision with no French name falls back to its English name", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      profile: SAVED_PROFILE,
      countries: LOCATION_COUNTRIES,
      language: "fr",
    });
    await page.goto("/profile");

    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByTestId("profile-subdivision")).toBeVisible();

    await page.getByTestId("profile-subdivision-trigger").click();
    await expect(
      page.getByRole("option", { name: "Québec", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Ontario", exact: true }),
    ).toBeVisible();

    for (const option of await page.getByRole("option").all()) {
      expect(((await option.textContent()) ?? "").trim()).not.toBe("");
    }
  });

  test("a subdivision_code validation error lands on the field, not on a toast", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      profile: SAVED_PROFILE,
      countries: LOCATION_COUNTRIES,
      save_user_profile: {
        kind: "reject",
        error: {
          type: "validation",
          message: "Invalid state, province, or region code: CA-QC",
          field: "subdivision_code",
        },
      },
    });
    await page.goto("/profile");

    await expect(page.getByTestId("profile-subdivision-trigger")).toHaveText(
      "Quebec",
    );
    await page.getByTestId("profile-save").click();

    await expect(
      page.getByText("Invalid state, province, or region code: CA-QC"),
    ).toBeVisible();
    await expect(page.getByTestId("profile-subdivision-trigger")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(toastCount(page)).toHaveCount(0);
  });
});

/** The five allow-listed ranges, in the order `profile_store.rs` declares them. */
const BRACKET_LABELS = [
  "Under 50,000",
  "50,000 – 99,999",
  "100,000 – 149,999",
  "150,000 – 249,999",
  "250,000 or more",
];

/** Mirrors `VALID_INCOME_BRACKET_CURRENCIES` — 20 codes, uppercase, unsorted. */
const CURRENCY_CODES = [
  "CAD",
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "CHF",
  "JPY",
  "CNY",
  "INR",
  "MXN",
  "BRL",
  "SEK",
  "NOK",
  "DKK",
  "NZD",
  "SGD",
  "HKD",
  "ZAR",
  "KRW",
  "PLN",
];

/**
 * Base UI leaves a closed Select popup mounted, so once a spec has opened two selects an unscoped
 * `getByRole("option")` matches the shared "Not specified" label twice. The scope is `[data-open]`
 * rather than `:visible` deliberately: a closing popup keeps a non-empty box for the length of its
 * exit animation, so a visibility-based scope races that animation under load.
 */
function openPopup(page: Page) {
  return page.locator('[data-slot="select-content"][data-open]');
}

async function chooseOption(page: Page, triggerTestId: string, name: string) {
  await page.getByTestId(triggerTestId).click();
  await expect(openPopup(page)).toHaveCount(1);
  await openPopup(page)
    .getByRole("option", { name, exact: true })
    .click();
  await expect(openPopup(page)).toHaveCount(0);
}

test.describe("/profile income bracket and currency", () => {
  test("the bracket selector offers exactly the five allow-listed ranges plus an unset option", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: LOGGED_IN, profile: null });
    await page.goto("/profile");

    const trigger = page.getByTestId("profile-income-bracket");
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveText("Select an income range");

    await trigger.click();
    for (const label of BRACKET_LABELS) {
      await expect(
        page.getByRole("option", { name: label, exact: true }),
      ).toBeVisible();
    }
    // Five ranges plus the unset option and nothing else: a sixth range would be a
    // cut point Rust's allow-list rejects on save.
    await expect(page.getByRole("option")).toHaveCount(
      BRACKET_LABELS.length + 1,
    );
    await expect(
      page.getByRole("option", { name: "Not specified", exact: true }),
    ).toBeVisible();
  });

  test("bracket labels carry no currency symbol, because the currency is its own field", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: LOGGED_IN, profile: null });
    await page.goto("/profile");

    await page.getByTestId("profile-income-bracket").click();
    for (const option of await page.getByRole("option").all()) {
      const text = (await option.textContent()) ?? "";
      expect(text.trim()).not.toBe("");
      for (const symbol of ["$", "€", "£", "¥", "CAD", "USD"]) {
        expect(text).not.toContain(symbol);
      }
    }
  });

  test("the currency selector is present, unfilled, and offers the curated list", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: LOGGED_IN, profile: null });
    await page.goto("/profile");

    // Rendered without a bracket being chosen: a currency without a bracket is a
    // permitted state, and gating would make it unreachable.
    const trigger = page.getByTestId("profile-income-currency");
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveText("Select a currency");

    await trigger.click();
    await expect(page.getByRole("option")).toHaveCount(
      CURRENCY_CODES.length + 1,
    );
    // The unset entry is what is selected, so nothing was pre-filled from the
    // locale, from an account, or from any other derived guess (G3).
    await expect(
      page.locator('[role="option"][aria-selected="true"]'),
    ).toHaveText("Not specified");
    for (const code of CURRENCY_CODES) {
      await expect(
        page.getByRole("option", { name: code, exact: true }),
      ).toHaveCount(1);
    }
  });

  test("an untouched form submits null for both income fields rather than a guess", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: LOGGED_IN, profile: null });
    await page.goto("/profile");

    await expect(page.getByTestId("profile-income-currency")).toBeVisible();
    await page.getByTestId("profile-save").click();
    await expect(toastCount(page)).toHaveCount(1);

    const [args] = await readIpcArgs(page, "save_user_profile");
    expect((args as Record<string, unknown>).income_bracket).toBeNull();
    expect(
      (args as Record<string, unknown>).income_bracket_currency,
    ).toBeNull();
  });

  test("selecting a bracket and a currency submits the code and the uppercase currency", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: LOGGED_IN, profile: null });
    await page.goto("/profile");

    await chooseOption(page, "profile-income-bracket", "150,000 – 249,999");
    await chooseOption(page, "profile-income-currency", "EUR");
    await expect(page.getByTestId("profile-income-currency")).toHaveText("EUR");

    await page.getByTestId("profile-save").click();
    await expect(toastCount(page)).toHaveCount(1);

    const [args] = await readIpcArgs(page, "save_user_profile");
    expect((args as Record<string, unknown>).income_bracket).toBe("150k_249k");
    expect((args as Record<string, unknown>).income_bracket_currency).toBe(
      "EUR",
    );
  });

  test("an existing pair populates both triggers and saves unchanged", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: LOGGED_IN, profile: SAVED_PROFILE });
    await page.goto("/profile");

    await expect(page.getByTestId("profile-income-bracket")).toHaveText(
      "100,000 – 149,999",
    );
    await expect(page.getByTestId("profile-income-currency")).toHaveText("CAD");
    await expect(
      page.getByTestId("profile-income-currency-hint"),
    ).toHaveCount(0);

    await page.getByTestId("profile-save").click();
    await expect(toastCount(page)).toHaveCount(1);

    const [args] = await readIpcArgs(page, "save_user_profile");
    expect((args as Record<string, unknown>).income_bracket).toBe("100k_149k");
    expect((args as Record<string, unknown>).income_bracket_currency).toBe(
      "CAD",
    );
  });

  test("a bracket with no currency submits and the rejection lands on the currency field", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      profile: null,
      save_user_profile: {
        kind: "reject",
        error: {
          type: "validation",
          message: "Select the currency your income bracket is in",
          field: "income_bracket_currency",
        },
      },
    });
    await page.goto("/profile");

    await page.getByTestId("profile-income-bracket").click();
    await page.getByRole("option", { name: "Under 50,000", exact: true }).click();
    await expect(page.getByTestId("profile-income-currency")).toHaveText(
      "Select a currency",
    );

    await page.getByTestId("profile-save").click();

    const [args] = await readIpcArgs(page, "save_user_profile");
    expect((args as Record<string, unknown>).income_bracket).toBe("under_50k");
    expect(
      (args as Record<string, unknown>).income_bracket_currency,
    ).toBeNull();

    await expect(
      page.getByText("Select the currency your income bracket is in"),
    ).toBeVisible();
    await expect(page.getByTestId("profile-income-currency")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page.getByTestId("profile-income-bracket")).not.toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(toastCount(page)).toHaveCount(0);
  });

  test("an invalid bracket rejection lands on the bracket field, not on a toast", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      profile: SAVED_PROFILE,
      save_user_profile: {
        kind: "reject",
        error: {
          type: "validation",
          message: "Invalid income bracket: bracket-3",
          field: "income_bracket",
        },
      },
    });
    await page.goto("/profile");

    await expect(page.getByTestId("profile-income-bracket")).toHaveText(
      "100,000 – 149,999",
    );
    await page.getByTestId("profile-save").click();

    await expect(
      page.getByText("Invalid income bracket: bracket-3"),
    ).toBeVisible();
    await expect(page.getByTestId("profile-income-bracket")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(toastCount(page)).toHaveCount(0);
  });

  test("choosing not specified for a bracket submits null rather than an empty string", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: LOGGED_IN, profile: SAVED_PROFILE });
    await page.goto("/profile");

    await expect(page.getByTestId("profile-income-bracket")).toHaveText(
      "100,000 – 149,999",
    );
    await chooseOption(page, "profile-income-bracket", "Not specified");
    await chooseOption(page, "profile-income-currency", "Not specified");

    await page.getByTestId("profile-save").click();
    await expect(toastCount(page)).toHaveCount(1);

    const [args] = await readIpcArgs(page, "save_user_profile");
    expect((args as Record<string, unknown>).income_bracket).toBeNull();
    expect(
      (args as Record<string, unknown>).income_bracket_currency,
    ).toBeNull();
  });

  test("in French the bracket labels are translated and no raw key leaks", async ({
    page,
  }) => {
    await setupTauriMock(page, {
      session: LOGGED_IN,
      profile: null,
      language: "fr",
    });
    await page.goto("/profile");

    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByTestId("profile-income-bracket")).toHaveText(
      "Sélectionner une tranche de revenu",
    );

    await page.getByTestId("profile-income-bracket").click();
    for (const label of [
      "Moins de 50 000",
      "50 000 – 99 999",
      "250 000 ou plus",
    ]) {
      await expect(
        page.getByRole("option", { name: label, exact: true }),
      ).toBeVisible();
    }
    await expect(page.getByTestId("profile-page")).not.toContainText("profile.");
  });

  test("the hint appears only while a bracket has no currency", async ({
    page,
  }) => {
    await setupTauriMock(page, { session: LOGGED_IN, profile: null });
    await page.goto("/profile");

    const hint = page.getByTestId("profile-income-currency-hint");
    await expect(hint).toHaveCount(0);

    await chooseOption(page, "profile-income-bracket", "250,000 or more");
    await expect(hint).toBeVisible();

    await chooseOption(page, "profile-income-currency", "JPY");
    await expect(hint).toHaveCount(0);
  });
});
