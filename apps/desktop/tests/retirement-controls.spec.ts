import { test, expect, type Page } from "@playwright/test";

/**
 * The retirement heatmap's two ephemeral "what if" controls, on `/insights/retirement`.
 *
 * Every row of the feature's I/O matrix is walked here rather than in vitest because all of them are
 * browser-only claims: the anchor slider's `aria-valuetext` is produced by Base UI's nested
 * `<input type="range">`, the "(current pace)" / "(exploring)" flip is React state, and the
 * privacy-masked readout depends on the ValuesVisibility provider reading localStorage at mount.
 *
 * The slider is driven by keyboard, not by synthetic drags: `Home`/`End`/`ArrowRight` move the real
 * range input through the same `step` a pointer drag snaps to, so an assertion about a $50 increment
 * cannot pass because a mouse happened to land on a round pixel.
 *
 * Neither control is persisted, which is a boundary of the feature and not an accident — the reload
 * test is what holds that line.
 */

interface MockOptions {
  /** Monthly income in cents. With `expenseCents`, fixes the derived anchor the slider opens on. */
  incomeCents?: number;
  expenseCents?: number;
  /** Retirement-eligible capital, and what keeps the page off its no-accounts empty state. */
  investedCents?: number;
  /** Resolved via `get_retirement_age_override`; `null` withholds age and gates the grid. */
  ageOverride?: number | null;
  /** Seeds the values-privacy toggle before first paint. */
  valuesHidden?: boolean;
  language?: string;
}

async function setupRetirement(page: Page, options: MockOptions = {}) {
  await page.addInitScript((opts: MockOptions) => {
    if (opts.language !== undefined) {
      window.localStorage.setItem("i18nextLng", opts.language);
    }
    if (opts.valuesHidden) {
      window.localStorage.setItem("values-hidden", "true");
    }

    const investedCents = opts.investedCents ?? 5_000_000;
    const retirementInput = {
      account_balances: [
        { account_type: "tfsa", total_cents: investedCents },
      ],
      avg_monthly_income_cents: opts.incomeCents ?? 500_000,
      avg_monthly_expense_cents: opts.expenseCents ?? 300_000,
      income_month_count: 12,
      expense_month_count: 12,
    };

    (
      window as unknown as Record<string, unknown>
    ).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      convertFileSrc: (path: string) => path,
      invoke: (cmd: string) => {
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);

        switch (cmd) {
          case "get_retirement_input":
            return Promise.resolve(retirementInput);
          case "get_retirement_age_override":
            return Promise.resolve(
              opts.ageOverride === undefined ? 40 : opts.ageOverride,
            );
          // Both pensions withheld, and a null profile keeps the CA age gate and its prefilled
          // CPP/OAS default out of the picture, so the grid is a function of the mocks above alone.
          case "get_retirement_pension_cents":
          case "get_retirement_employer_pension_cents":
          case "get_user_profile":
            return Promise.resolve(null);
          case "get_auth_session":
            return Promise.resolve({
              status: "LoggedIn",
              email: "user@example.com",
              name: "Test User",
            });
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

const RETIREMENT = "/insights/retirement";

const CONTROLS = "retirement-controls";
const SLIDER = "retirement-anchor-slider";
const READOUT = "retirement-anchor-readout";
const RESET = "retirement-anchor-reset";
const PACE_ROW = "retirement-current-pace-row";
const HEADLINE = "retirement-headline";
const HORIZON_TABS = "retirement-horizon-tabs";

/** Income $5,000 − expenses $3,000 rounds to a $2,000/mo derived anchor; the slider's max is 2x it. */
const DERIVED_ANCHOR = "$2,000.00";
const MAX_ANCHOR = "$4,000.00";

async function gotoRetirement(page: Page, options: MockOptions = {}) {
  await setupRetirement(page, options);
  await page.goto(RETIREMENT);
  await expect(page.getByTestId(CONTROLS)).toBeVisible();
}

function slider(page: Page) {
  return page.getByTestId(SLIDER).getByRole("slider");
}

function paceLabel(page: Page) {
  return page.getByTestId(PACE_ROW).locator("td").first();
}

/** Column header ages, which is how the horizon columns identify themselves to the user. */
function columnAges(page: Page) {
  return page.getByRole("columnheader").filter({ hasText: /^Age \d+$/ });
}

test.describe("retirement matrix — dynamic controls", () => {
  test("opens on the user's derived pace, with nothing to reset", async ({
    page,
  }) => {
    await gotoRetirement(page);

    await expect(page.getByTestId(READOUT)).toHaveText(DERIVED_ANCHOR);
    await expect(paceLabel(page)).toContainText("(current pace)");
    await expect(paceLabel(page)).not.toContainText("(exploring)");
    // The chip is the affordance for undoing an override; with no override it must be absent
    // entirely rather than present-and-disabled, which would imply there is something to undo.
    await expect(page.getByTestId(RESET)).toHaveCount(0);
  });

  test("opens on the 30y horizon, matching the grid's original fixed columns", async ({
    page,
  }) => {
    await gotoRetirement(page);

    await expect(
      page.getByTestId(`${HORIZON_TABS}-30y`),
    ).toHaveAttribute("aria-pressed", "true");
    // Age 40 today, so the untouched +5..+30 year columns land on ages 45..70.
    await expect(columnAges(page)).toHaveText([
      "Age 45",
      "Age 50",
      "Age 55",
      "Age 60",
      "Age 65",
      "Age 70",
    ]);
  });

  test("recomputes the grid live as the anchor moves, and flips to exploring", async ({
    page,
  }) => {
    await gotoRetirement(page);

    const firstCell = page.getByTestId(PACE_ROW).locator("td").nth(1);
    const before = await firstCell.textContent();

    await slider(page).press("ArrowRight");

    // One step is $50, applied with no debounce: the readout, the row label and the projected value
    // all move on the same tick as the keypress.
    await expect(page.getByTestId(READOUT)).toHaveText("$2,050.00");
    await expect(paceLabel(page)).toContainText("(exploring)");
    await expect(page.getByTestId(RESET)).toBeVisible();
    await expect(firstCell).not.toHaveText(before ?? "");
  });

  test("reverts the anchor, the label and the chip when reset is clicked", async ({
    page,
  }) => {
    await gotoRetirement(page);

    await slider(page).press("End");
    await expect(page.getByTestId(READOUT)).toHaveText(MAX_ANCHOR);
    await expect(paceLabel(page)).toContainText("(exploring)");

    await page.getByTestId(RESET).click();

    await expect(page.getByTestId(READOUT)).toHaveText(DERIVED_ANCHOR);
    await expect(paceLabel(page)).toContainText("(current pace)");
    await expect(page.getByTestId(RESET)).toHaveCount(0);
  });

  test("returns to current pace when dragged back onto the derived value", async ({
    page,
  }) => {
    await gotoRetirement(page);

    await slider(page).press("ArrowRight");
    await expect(paceLabel(page)).toContainText("(exploring)");

    // Exploring is measured against the derived pace, not a sticky "touched" flag, so arriving back
    // at your own number by hand must be indistinguishable from never having left it.
    await slider(page).press("ArrowLeft");
    await expect(page.getByTestId(READOUT)).toHaveText(DERIVED_ANCHOR);
    await expect(paceLabel(page)).toContainText("(current pace)");
    await expect(page.getByTestId(RESET)).toHaveCount(0);
  });

  test("zeroes every tier row at a $0 anchor instead of snapping to the $100 floor", async ({
    page,
  }) => {
    await gotoRetirement(page);

    await slider(page).press("Home");

    await expect(page.getByTestId(READOUT)).toHaveText("$0.00");
    // Six rows survive — the $0 ladder must not collapse to fewer rows through duplicate React keys.
    const savingsColumn = page.locator("tbody tr td:first-child");
    await expect(savingsColumn).toHaveCount(6);
    for (const cell of await savingsColumn.all()) {
      await expect(cell).toContainText("$0.00");
    }
  });

  test("moves the pressed state onto the picked horizon pill", async ({
    page,
  }) => {
    await gotoRetirement(page);

    for (const picked of ["6y", "12y", "30y"] as const) {
      await page.getByTestId(`${HORIZON_TABS}-${picked}`).click();
      for (const zoom of ["6y", "12y", "30y"] as const) {
        await expect(
          page.getByTestId(`${HORIZON_TABS}-${zoom}`),
          `after picking ${picked}, ${zoom} pressed state`,
        ).toHaveAttribute("aria-pressed", String(zoom === picked));
      }
    }
  });

  test("rescales the horizon columns when a zoom pill is picked", async ({
    page,
  }) => {
    await gotoRetirement(page);

    await page.getByTestId(`${HORIZON_TABS}-6y`).click();
    await expect(columnAges(page)).toHaveText([
      "Age 41",
      "Age 42",
      "Age 43",
      "Age 44",
      "Age 45",
      "Age 46",
    ]);

    await page.getByTestId(`${HORIZON_TABS}-12y`).click();
    await expect(columnAges(page)).toHaveText([
      "Age 42",
      "Age 44",
      "Age 46",
      "Age 48",
      "Age 50",
      "Age 52",
    ]);

    await page.getByTestId(`${HORIZON_TABS}-30y`).click();
    await expect(columnAges(page)).toHaveText([
      "Age 45",
      "Age 50",
      "Age 55",
      "Age 60",
      "Age 65",
      "Age 70",
    ]);
  });

  test("recomputes the nest-egg row when the horizon zoom changes", async ({
    page,
  }) => {
    await gotoRetirement(page);

    const nestEggRow = page.getByRole("columnheader").filter({
      hasText: /^\$/,
    });
    const atThirtyYears = await nestEggRow.allTextContents();

    await page.getByTestId(`${HORIZON_TABS}-6y`).click();

    expect(await nestEggRow.allTextContents()).not.toEqual(atThirtyYears);
  });

  test("keeps the headline's deadline honest across horizon zooms", async ({
    page,
  }) => {
    // Nothing invested and a bare $50/mo surplus never clears any column, so the headline stays on
    // the "not on track within N years" branch — the one that used to hardcode 30.
    await gotoRetirement(page, {
      investedCents: 100,
      incomeCents: 300_000,
      expenseCents: 295_000,
    });

    await expect(page.getByTestId(HEADLINE)).toContainText("within 30 years");

    await page.getByTestId(`${HORIZON_TABS}-6y`).click();
    await expect(page.getByTestId(HEADLINE)).toContainText("within 6 years");

    await page.getByTestId(`${HORIZON_TABS}-12y`).click();
    await expect(page.getByTestId(HEADLINE)).toContainText("within 12 years");
  });

  test("announces the anchor as a dollar amount to a screen reader", async ({
    page,
  }) => {
    await gotoRetirement(page);

    await expect(slider(page)).toHaveAttribute("aria-valuetext", DERIVED_ANCHOR);
    await expect(slider(page)).toHaveAttribute("aria-label", /savings/i);

    await slider(page).press("ArrowRight");
    await expect(slider(page)).toHaveAttribute("aria-valuetext", "$2,050.00");
  });

  test("masks the readout and the announcement under values privacy, still dragging", async ({
    page,
  }) => {
    await gotoRetirement(page, { valuesHidden: true });

    await expect(page.getByTestId(READOUT)).toHaveText("$\u2022\u2022\u2022\u2022");
    // Bullets are unreadable aloud, so the thumb names itself with the translated masked label
    // instead — the figure is withheld from the room, not from the user.
    await expect(slider(page)).toHaveAttribute("aria-valuetext", "Amount hidden");

    await slider(page).press("ArrowRight");
    await expect(slider(page)).toHaveAttribute("aria-valuenow", "205000");
    await expect(paceLabel(page)).toContainText("(exploring)");
  });

  test("persists neither control across a reload", async ({ page }) => {
    await gotoRetirement(page);

    await slider(page).press("End");
    await page.getByTestId(`${HORIZON_TABS}-6y`).click();
    await expect(page.getByTestId(READOUT)).toHaveText(MAX_ANCHOR);

    await page.reload();
    await expect(page.getByTestId(CONTROLS)).toBeVisible();

    await expect(page.getByTestId(READOUT)).toHaveText(DERIVED_ANCHOR);
    await expect(paceLabel(page)).toContainText("(current pace)");
    await expect(
      page.getByTestId(`${HORIZON_TABS}-30y`),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("hides the controls along with the grid when age is missing", async ({
    page,
  }) => {
    await setupRetirement(page, { ageOverride: null });
    await page.goto(RETIREMENT);

    await expect(page.getByTestId("retirement-age-required")).toBeVisible();
    // The controls drive the grid, so offering them beside an age prompt would be a dead end.
    await expect(page.getByTestId(CONTROLS)).toHaveCount(0);
  });

  test("localises both controls in French", async ({ page }) => {
    await gotoRetirement(page, { language: "fr" });

    await expect(page.getByTestId(CONTROLS)).toContainText(
      "Épargne mensuelle",
    );
    await expect(page.getByTestId(`${HORIZON_TABS}-6y`)).toHaveText("6 ans");
    await expect(paceLabel(page)).toContainText("(rythme actuel)");

    await slider(page).press("ArrowRight");
    await expect(paceLabel(page)).toContainText("(simulation)");
    await expect(page.getByTestId(RESET)).toContainText(
      "Revenir à mon rythme",
    );
  });
});
