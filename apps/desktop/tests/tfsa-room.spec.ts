import { test, expect, type Page } from "@playwright/test";

/**
 * The accumulated-TFSA-room figure, on the surface that owns it:
 *
 * `/wealth/where-to-put-your-money` — the `TfsaRoomPanel`, beside ActionWaterfall,
 * EmergencyFundPanel and SavingsCapacityPanel. This is the figure's only home: an Insights
 * placement was tried and removed, because accumulated contribution room is not a spending trend.
 *
 * Story 30.2's degradation matrix moved here wholesale when the figure moved off `/profile`. Every
 * withheld row asserts the same two things: the element is absent by `toHaveCount(0)` on a stable
 * `data-testid` — never by scraping visible text for a dollar sign, which passes for the wrong
 * reason the moment a currency format changes — and no toast, banner, or retry affordance appears.
 *
 * Rust decides every row. The stubbed `get_tfsa_accumulated_limit` answers `null` exactly where the
 * real command returns `Ok(None)`; `get_user_profile` is stubbed consistently with it so a frontend
 * eligibility check — a second decision point, which is forbidden — would show up here as a test
 * that passes for the wrong reason.
 */

interface MockTfsaAccumulatedLimit {
  total_cents: number;
  eligible_from_year: number;
  known_through_year: number;
}

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

interface MockOptions {
  /** What `get_tfsa_accumulated_limit` resolves to. `null` is "withheld". */
  tfsa?: MockTfsaAccumulatedLimit | null;
  /**
   * Reproduces the command's server-side balance gate on the wire: the command answers the room
   * when `cad_tfsa_balance_cents < room.total_cents` and `null` otherwise. The decision itself is
   * owned and unit-tested in Rust (`commands::profile::gate_on_cad_tfsa_balance`); this option
   * exists so the wire contract each outcome produces is walked end to end. Takes precedence
   * over `tfsa`.
   */
  gate?: { room: MockTfsaAccumulatedLimit; cad_tfsa_balance_cents: number };
  /** Rejects `get_tfsa_accumulated_limit`, e.g. with `AppError::Auth { recoverable: true }`. */
  tfsaError?: { type: string; message: string; recoverable?: boolean };
  /** Whether `get_financial_health_detail` reports three finished months. */
  dataSufficient?: boolean;
  profile?: MockUserProfile | null;
  /** TFSA and other accounts `get_accounts` reports, to prove no balance reaches the figure. */
  accounts?: unknown[];
  language?: string;
}

async function setupMock(page: Page, options: MockOptions = {}) {
  await page.addInitScript((opts: MockOptions) => {
    if (opts.language !== undefined) {
      window.localStorage.setItem("i18nextLng", opts.language);
    }

    const ipcCalls: string[] = [];
    (window as unknown as Record<string, unknown>).__IPC_CALLS = ipcCalls;

    const dataSufficient = opts.dataSufficient ?? true;

    const resolveTfsa = (): Promise<unknown> => {
      if (opts.tfsaError !== undefined) return Promise.reject(opts.tfsaError);
      if (opts.gate !== undefined) {
        const { room, cad_tfsa_balance_cents } = opts.gate;
        return Promise.resolve(
          cad_tfsa_balance_cents < room.total_cents ? room : null,
        );
      }
      return Promise.resolve(opts.tfsa ?? null);
    };

    const waterfall = {
      current_step: "contribute_registered_accounts",
      completed_steps: ["build_emergency_fund", "pay_high_interest_debt"],
      reasoning_key: "contribute_registered",
      reasoning_params: {
        coverage_months: 8,
        target_months: 6,
        credit_card_debt_cents: 0,
        avg_monthly_surplus_cents: 62000,
        liquid_savings_cents: 5000000,
        avg_monthly_expenses_cents: 625000,
      },
    };

    const detail = {
      data_sufficient: dataSufficient,
      emergency_fund: dataSufficient
        ? {
            coverage_months: 8,
            target_months: 6,
            progress_ratio: 1,
            status: "funded" as const,
          }
        : null,
      savings: dataSufficient
        ? { savings_rate_percent: 14, avg_monthly_surplus_cents: 62000 }
        : null,
      figures: {
        liquid_savings_cents: 5000000,
        avg_monthly_expenses_cents: 625000,
        avg_monthly_income_cents: 720000,
        credit_card_debt_cents: 0,
        expense_month_count: dataSufficient ? 3 : 1,
        income_month_count: dataSufficient ? 3 : 1,
      },
      waterfall,
      top_discretionary_categories: [
        {
          category_id: 1,
          category_name: "Dining Out",
          group_name: "Lifestyle",
          avg_monthly_spend_cents: 45000,
        },
      ],
      monthly_surplus_trend: [
        {
          month: "2026-03",
          income_cents: 720000,
          expense_cents: 658000,
          surplus_cents: 62000,
        },
      ],
    };

    const trends = {
      by_category: [],
      totals: [
        { month: "2026-01", total_cents: 80000 },
        { month: "2026-02", total_cents: 81000 },
        { month: "2026-03", total_cents: 82000 },
      ],
      category_compare: [
        {
          category_id: 1,
          category_name: "Food",
          avg_cents: 45000,
          target_cents: 50000,
          delta_pct: -10,
          status: "on_track",
        },
      ],
    };

const defaultAccounts = [
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

(window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ =
  { unregisterListener: () => {} };

(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
  transformCallback: () => 1,
  convertFileSrc: (path: string) => path,
  invoke: (cmd: string) => {
    if (cmd.startsWith("plugin:")) return Promise.resolve(null);

    ipcCalls.push(cmd);

    switch (cmd) {
      case "get_tfsa_accumulated_limit":
        return resolveTfsa();
      case "get_user_profile":
        return Promise.resolve(opts.profile ?? null);
      case "get_auth_session":
        return Promise.resolve({
          status: "LoggedIn",
          email: "user@example.com",
          name: "Test User",
        });
      case "get_financial_health_detail":
      case "get_financial_health_summary":
        return Promise.resolve(detail);
      case "get_spending_trends":
        return Promise.resolve(trends);
      case "get_ai_config":
        return Promise.resolve({
          provider: "bedrock",
          configured: false,
          region: "us-east-1",
        });
      case "get_accounts":
        return Promise.resolve(opts.accounts ?? defaultAccounts);
      case "check_picker_gate":
        return Promise.resolve({ needs_picker: false });
      case "check_onboarding_status":
        return Promise.resolve({
          needs_onboarding: false,
          setup_incomplete: false,
        });
      default:
        return Promise.resolve(null);
    }
  },
    };
  }, options);
}

function readIpcCommands(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __IPC_CALLS?: string[] }).__IPC_CALLS ?? [],
  );
}

function toastCount(page: Page) {
  return page.locator("[data-sonner-toast]");
}

const WEALTH = "/wealth/where-to-put-your-money";

const PANEL = "tfsa-room-panel";
const FIGURE = "tfsa-room-panel-figure";

/** A profile that satisfies every eligibility rule: Canadian, and eighteen well before today. */
const CA_PROFILE: MockUserProfile = {
  schema_version: 1,
  cognito_sub: "sub-abc",
  first_name: "Test",
  last_name: "User",
  birth_date: "1985-03-14",
  income_bracket: null,
  income_bracket_currency: null,
  country_code: "CA",
  subdivision_code: "CA-QC",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

/** $109,000 accumulated, accruing from 2009 because this user turned 18 before TFSAs existed. */
const ROOM: MockTfsaAccumulatedLimit = {
  total_cents: 10_900_000,
  eligible_from_year: 2009,
  known_through_year: 2026,
};

/**
 * The panel on `/wealth/where-to-put-your-money`, which is where the figure lives now that it has
 * moved off `/profile`. It sits beside ActionWaterfall, EmergencyFundPanel and SavingsCapacityPanel,
 * next to the "Contribute to registered accounts (TFSA/RRSP/FHSA)" rung it informs.
 */
test.describe("accumulated TFSA room — Where to put your money", () => {
  test("an eligible user sees the accumulated figure", async ({ page }) => {
    await setupMock(page, { profile: CA_PROFILE, tfsa: ROOM });
    await page.goto(WEALTH);

    await expect(page.getByTestId(PANEL)).toBeVisible();
    await expect(page.getByTestId(FIGURE)).toContainText("109,000");
  });

  // The caption is the honesty contract. Nixus tracks balances, not contributions or withdrawals,
  // so the figure is accumulated room and can never be presented as remaining room.
  test("the caption says accumulated room and disclaims remaining room", async ({
    page,
  }) => {
    await setupMock(page, { profile: CA_PROFILE, tfsa: ROOM });
    await page.goto(WEALTH);

    const panel = page.getByTestId(PANEL);
    await expect(panel).toContainText("2009");
    await expect(panel).toContainText("not your remaining room");
    await expect(panel).toContainText(/contributions or withdrawals/i);
  });

  test("no raw i18n key leaks in English", async ({ page }) => {
    await setupMock(page, { profile: CA_PROFILE, tfsa: ROOM });
    await page.goto(WEALTH);

    await expect(page.getByTestId(PANEL)).not.toContainText("profile.tfsa");
  });

  test("in French the copy is translated and no raw key leaks", async ({
    page,
  }) => {
    await setupMock(page, { profile: CA_PROFILE, tfsa: ROOM, language: "fr" });
    await page.goto(WEALTH);

    const panel = page.getByTestId(PANEL);
    await expect(panel).toBeVisible();
    await expect(panel).not.toContainText("profile.tfsa");
    await expect(panel).not.toContainText("not your remaining room");
  });

  // The surface itself is gated on three finished months of spending. With too little data the page
  // renders its own empty state, and the panel must not appear inside it — nor should the command
  // be invoked at all, since nothing would consume the answer.
  test("the data-insufficient empty state shows no panel", async ({ page }) => {
    await setupMock(page, {
      profile: CA_PROFILE,
      tfsa: ROOM,
      dataSufficient: false,
    });
    await page.goto(WEALTH);

    await expect(
      page.getByTestId("financial-health-section-empty"),
    ).toBeVisible();
    await expect(page.getByTestId(PANEL)).toHaveCount(0);
    await expect(toastCount(page)).toHaveCount(0);
  });

  test("a withheld figure renders nothing and leaves the surface intact", async ({
    page,
  }) => {
    await setupMock(page, { profile: CA_PROFILE, tfsa: null });
    await page.goto(WEALTH);

    await expect(page.getByTestId("action-waterfall")).toBeVisible();
    await expect(page.getByTestId(PANEL)).toHaveCount(0);
    await expect(toastCount(page)).toHaveCount(0);
  });
});


/**
 * The balance gate. `balance < room` means the user MIGHT have room, so the figure shows;
 * `balance >= room` means they almost certainly do not, so nothing shows.
 *
 * It is a heuristic filter and never a remaining-room claim: someone could have contributed the
 * maximum and then lost money in the market, showing a low balance with no real room. That is why
 * no case below may ever produce a difference, a subtraction, or the balance itself on screen.
 *
 * The comparison lives in the Rust command layer and is unit-tested there
 * (`gate_on_cad_tfsa_balance`). These cases walk the wire contract each outcome produces.
 */
test.describe("accumulated TFSA room — balance gate", () => {
  const TFSA_ACCOUNT = (currency: string, balance_cents: number) => ({
    id: 2,
    name: "My TFSA",
    institution: "Questrade",
    account_type: "tfsa",
    currency,
    balance_cents,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  });

  test("a balance below the accumulated room shows the figure on the wealth surface", async ({
    page,
  }) => {
    await setupMock(page, {
      profile: CA_PROFILE,
      gate: { room: ROOM, cad_tfsa_balance_cents: 3_000_000 },
      accounts: [TFSA_ACCOUNT("CAD", 3_000_000)],
    });

    await page.goto(WEALTH);
    await expect(page.getByTestId(PANEL)).toBeVisible();
  });

  test("a balance equal to the accumulated room shows nothing, silently", async ({
    page,
  }) => {
    await setupMock(page, {
      profile: CA_PROFILE,
      gate: { room: ROOM, cad_tfsa_balance_cents: ROOM.total_cents },
      accounts: [TFSA_ACCOUNT("CAD", ROOM.total_cents)],
    });

    await page.goto(WEALTH);
    await expect(page.getByTestId("action-waterfall")).toBeVisible();
    await expect(page.getByTestId(PANEL)).toHaveCount(0);
    await expect(toastCount(page)).toHaveCount(0);
  });

  test("a balance above the accumulated room shows nothing, silently", async ({
    page,
  }) => {
    await setupMock(page, {
      profile: CA_PROFILE,
      gate: { room: ROOM, cad_tfsa_balance_cents: 20_000_000 },
      accounts: [TFSA_ACCOUNT("CAD", 20_000_000)],
    });

    await page.goto(WEALTH);
    await expect(page.getByTestId("action-waterfall")).toBeVisible();
    await expect(page.getByTestId(PANEL)).toHaveCount(0);
  });

  // The gate decides shown-vs-withheld and nothing else. $109,000 room against a $30,000 balance
  // must read $109,000 — never $79,000, which is the remaining-room claim Nixus cannot make, and
  // never $30,000, which is the balance itself.
  test("the shown figure is the full accumulated room, never reduced by the balance", async ({
    page,
  }) => {
    await setupMock(page, {
      profile: CA_PROFILE,
      gate: { room: ROOM, cad_tfsa_balance_cents: 3_000_000 },
      accounts: [TFSA_ACCOUNT("CAD", 3_000_000)],
    });
    await page.goto(WEALTH);

    const panel = page.getByTestId(PANEL);
    await expect(panel).toContainText("109,000");
    await expect(panel).not.toContainText("79,000");
    await expect(panel).not.toContainText("30,000");
  });

  // Currency correctness: Nixus never converts between currencies, so a USD TFSA cannot count
  // toward a CAD-denominated CRA limit. The command's db/ query filters on currency = 'CAD', so a
  // USD balance far above the room still leaves the CAD sum at 0 and the figure shown.
  test("a USD TFSA balance above the room does not withhold the figure", async ({
    page,
  }) => {
    await setupMock(page, {
      profile: CA_PROFILE,
      gate: { room: ROOM, cad_tfsa_balance_cents: 0 },
      accounts: [TFSA_ACCOUNT("USD", 90_000_000)],
    });
    await page.goto(WEALTH);

    await expect(page.getByTestId(PANEL)).toBeVisible();
    await expect(page.getByTestId(PANEL)).toContainText("109,000");
  });

  test("the surface never reads account balances itself", async ({ page }) => {
    // The frontend half of the guarantee: no balance can enter the figure if the surfaces showing
    // it never read one. Rust's half is that the balance only ever reaches a comparison, never the
    // arithmetic that produces `total_cents`.
    await setupMock(page, { profile: CA_PROFILE, tfsa: ROOM, dataSufficient: true });
    await page.goto(WEALTH);

    await expect(page.getByTestId(PANEL)).toBeVisible();
    const commands = await readIpcCommands(page);
    expect(commands).toContain("get_tfsa_accumulated_limit");
    expect(commands).not.toContain("get_accounts");
    expect(commands).not.toContain("get_current_net_worth");
  });
});

/**
 * Story 30.2's degradation matrix, relocated from `profile.spec.ts` intact.
 *
 * Every row is a condition under which Rust answers `Ok(None)` — or, for the no-session row,
 * `AppError::Auth { recoverable: true }` — and every row must render nothing with no user-facing
 * error. The balance gate above is one more silent-withholding condition, not a replacement.
 */
test.describe("accumulated TFSA room degradation matrix", () => {
  const ROWS: { name: string; profile: MockUserProfile | null }[] = [
    {
      name: "a non-Canadian country",
      profile: { ...CA_PROFILE, country_code: "US", subdivision_code: null },
    },
    {
      name: "an unset country",
      profile: { ...CA_PROFILE, country_code: null, subdivision_code: null },
    },
    {
      name: "Canada with no date of birth",
      profile: { ...CA_PROFILE, birth_date: null },
    },
    {
      name: "Canada with an unparseable date of birth",
      profile: { ...CA_PROFILE, birth_date: "not-a-date" },
    },
    {
      name: "a user not yet eighteen",
      profile: { ...CA_PROFILE, birth_date: "2015-01-01" },
    },
    {
      name: "a current year past the limits table bound",
      profile: CA_PROFILE,
    },
    { name: "no profile document at all", profile: null },
  ];

  for (const row of ROWS) {
    test(`${row.name} shows no figure and raises nothing`, async ({
      page,
    }) => {
      await setupMock(page, { profile: row.profile, tfsa: null });

      await page.goto(WEALTH);
      await expect(page.getByTestId("action-waterfall")).toBeVisible();
      await expect(page.getByTestId(PANEL)).toHaveCount(0);
      await expect(toastCount(page)).toHaveCount(0);
    });
  }

  // Both target surfaces are reachable without a session, so a signed-out visitor hits a
  // session-requiring command. It must fail silently: no toast, no banner, no retry affordance.
  test("a rejected session read shows no figure, no toast, and no error banner", async ({
    page,
  }) => {
    await setupMock(page, {
      profile: CA_PROFILE,
      tfsaError: {
        type: "auth",
        message: "You are not signed in.",
        recoverable: true,
      },
    });

    await page.goto(WEALTH);
    await expect(page.getByTestId("action-waterfall")).toBeVisible();
    await expect(page.getByTestId(PANEL)).toHaveCount(0);
    await expect(toastCount(page)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      "You are not signed in.",
    );
  });
});
