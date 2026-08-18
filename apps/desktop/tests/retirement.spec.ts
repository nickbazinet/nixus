import { test, expect, type Page } from "@playwright/test";

interface RetirementMockOptions {
  /** `null` leaves age unresolved so the age-required prompt is the expected surface. */
  ageOverride?: number | null;
  countryCode?: string | null;
  birthDate?: string | null;
  loggedIn?: boolean;
  /** Seeds a previously-saved employer-pension start age; omit to exercise the 65 default. */
  employerPensionStartAge?: number | null;
  /** Seeds a previously-saved pension tax rate; omit to exercise the 0% default. */
  pensionTaxRatePercent?: number | null;
  /** Drives the auto estimate, which is derived from spending; 0 makes it round to 0%. */
  avgMonthlyExpenseCents?: number;
}

/**
 * Stubs only the commands the retirement surface invokes. Pension values start unset (`null`) so
 * the CA prefill path is exercised, and the setters persist in-page so a save round-trips through
 * the same query invalidation the app uses.
 */
async function setupRetirementMock(page: Page, opts: RetirementMockOptions = {}) {
  await page.addInitScript((options: RetirementMockOptions) => {
    let governmentPensionCents: number | null = null;
    let employerPensionCents: number | null = null;
    let employerPensionStartAge: number | null =
      options.employerPensionStartAge ?? null;
    let pensionTaxRatePercent: number | null =
      options.pensionTaxRatePercent ?? null;
    let ageOverride: number | null = options.ageOverride ?? null;

    (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ =
      { unregisterListener: () => {} };

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: (cmd: string, args?: Record<string, unknown>) => {
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);

        switch (cmd) {
          case "get_retirement_input":
            return Promise.resolve({
              account_balances: [{ account_type: "tfsa", total_cents: 5_000_000 }],
              avg_monthly_income_cents: 800_000,
              avg_monthly_expense_cents: options.avgMonthlyExpenseCents ?? 500_000,
              income_month_count: 12,
              expense_month_count: 12,
            });
          // Left rejecting when signed out, matching the rest of the suite: a *resolved* LoggedOut
          // session opens the modal account prompt, whose focus trap aria-hides the whole page.
          case "get_auth_session":
            return options.loggedIn
              ? Promise.resolve({
                  status: "LoggedIn",
                  email: "user@example.com",
                  name: null,
                })
              : Promise.reject(`Unknown command: ${cmd}`);
          case "get_user_profile":
            return Promise.resolve(
              options.loggedIn
                ? {
                    schema_version: 1,
                    cognito_sub: "mock-sub",
                    first_name: null,
                    last_name: null,
                    birth_date: options.birthDate ?? null,
                    income_bracket: null,
                    income_bracket_currency: null,
                    country_code: options.countryCode ?? null,
                    subdivision_code: null,
                    created_at: "2026-01-01T00:00:00Z",
                    updated_at: "2026-01-01T00:00:00Z",
                  }
                : null,
            );
          case "get_retirement_pension_cents":
            return Promise.resolve(governmentPensionCents);
          case "set_retirement_pension_cents":
            governmentPensionCents = args?.cents as number;
            return Promise.resolve(null);
          case "get_retirement_employer_pension_cents":
            return Promise.resolve(employerPensionCents);
          case "set_retirement_employer_pension_cents":
            employerPensionCents = args?.cents as number;
            return Promise.resolve(null);
          case "get_retirement_employer_pension_start_age":
            return Promise.resolve(employerPensionStartAge);
          case "set_retirement_employer_pension_start_age":
            employerPensionStartAge = args?.years as number;
            return Promise.resolve(null);
          case "get_retirement_pension_tax_rate_percent":
            return Promise.resolve(pensionTaxRatePercent);
          case "set_retirement_pension_tax_rate_percent":
            pensionTaxRatePercent = args?.percent as number;
            return Promise.resolve(null);
          case "clear_retirement_pension_tax_rate_percent":
            pensionTaxRatePercent = null;
            return Promise.resolve(null);
          case "get_retirement_age_override":
            return Promise.resolve(ageOverride);
          case "set_retirement_age_override":
            ageOverride = args?.years as number;
            return Promise.resolve(null);
          default:
            return Promise.resolve(null);
        }
      },
    };
  }, opts);
}

const nestEggHeaderCells = (page: Page) =>
  page.locator("thead tr").nth(1).locator("th");

const nestEggFigures = (page: Page) =>
  page.getByTestId("retirement-nest-egg-figure");

const tooltipContent = (page: Page) =>
  page.locator('[data-slot="tooltip-content"]');

/** Nest-egg header cells render formatted currency; only their digits are comparable. */
const moneyDigitsOf = (text: string) => Number(text.replace(/\D/g, ""));

test.describe("Retirement projection", () => {
  test("renders the 6x6 grid with a headline and a pinned current-pace row", async ({
    page,
  }) => {
    await setupRetirementMock(page, { ageOverride: 40 });
    await page.goto("/insights/retirement");

    await expect(page.getByTestId("retirement-headline")).toBeVisible();
    await expect(page.getByTestId("retirement-current-pace-row")).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(6);
    await expect(page.locator("tbody tr").first().locator("td")).toHaveCount(7);
    await expect(page.getByTestId("retirement-age-required")).toHaveCount(0);
  });

  test("column headers are labelled by the age reached at that horizon", async ({
    page,
  }) => {
    await setupRetirementMock(page, { ageOverride: 40 });
    await page.goto("/insights/retirement");

    const ageHeaders = page.locator("thead tr").first().locator("th");
    await expect(ageHeaders.nth(1)).toHaveText("Age 45");
    await expect(ageHeaders.nth(6)).toHaveText("Age 70");
  });

  test("hides the grid behind an age prompt until an age is entered inline", async ({
    page,
  }) => {
    await setupRetirementMock(page, { ageOverride: null });
    await page.goto("/insights/retirement");

    await expect(page.getByTestId("retirement-age-required")).toBeVisible();
    await expect(page.getByTestId("retirement-headline")).toHaveCount(0);

    const ageInput = page.locator("#retirement-age");
    await ageInput.fill("40");
    await ageInput.blur();

    await expect(page.getByTestId("retirement-headline")).toBeVisible();
    await expect(page.locator("thead tr").first().locator("th").nth(1)).toHaveText(
      "Age 45",
    );
  });

  test("prefills the CA government pension default and shows the age-gate note", async ({
    page,
  }) => {
    await setupRetirementMock(page, {
      ageOverride: 40,
      loggedIn: true,
      countryCode: "CA",
    });
    await page.goto("/insights/retirement");

    await expect(page.locator("#retirement-government-pension")).toHaveValue(
      "19,548.00",
    );
    await expect(
      page.getByText(
        "Counted only from age 65 onward — CPP and OAS aren't both fully payable before then, so columns retiring earlier are computed without it.",
      ),
    ).toBeVisible();
    // No default exists for a workplace plan, so that field must stay empty (zero).
    await expect(page.locator("#retirement-employer-pension")).toHaveValue("");
  });

  test("shows no CA prefill or gate note outside Canada", async ({ page }) => {
    await setupRetirementMock(page, {
      ageOverride: 40,
      loggedIn: true,
      countryCode: "US",
    });
    await page.goto("/insights/retirement");

    await expect(page.locator("#retirement-government-pension")).toHaveValue("");
    await expect(
      page.getByText("Counted only from age 65 onward", { exact: false }),
    ).toHaveCount(0);
  });

  test("a gated government pension leaves pre-65 columns untouched but lowers later ones", async ({
    page,
  }) => {
    await setupRetirementMock(page, {
      ageOverride: 50,
      loggedIn: true,
      countryCode: "CA",
    });
    await page.goto("/insights/retirement");

    // Government pension arrives prefilled at the CA default, so saving it is the only step needed
    // to move from "suggested" to "applied" — the age 55 column must not budge, the age 80 one must.
    const beforeAge55 = await nestEggHeaderCells(page).nth(1).innerText();
    const beforeAge80 = await nestEggHeaderCells(page).nth(6).innerText();

    const pensionInput = page.locator("#retirement-government-pension");
    // Click first, then fill: `MoneyInput` rewrites its display on focus (stripping the thousands
    // separators so the number is editable), which would clobber text set in the same tick.
    await pensionInput.click();
    await pensionInput.fill("30000");
    await pensionInput.blur();

    await expect(pensionInput).toHaveValue("30,000.00");

    await expect(nestEggHeaderCells(page).nth(6)).not.toHaveText(beforeAge80);
    await expect(nestEggHeaderCells(page).nth(1)).toHaveText(beforeAge55);
  });

  test("an employer pension lowers every column once its start age is met", async ({
    page,
  }) => {
    // Start age 55 makes every column of a 50-year-old (ages 55..80) eligible, which is what
    // isolates this assertion to the employer pension rather than the start-age gate.
    await setupRetirementMock(page, {
      ageOverride: 50,
      loggedIn: true,
      countryCode: "CA",
      employerPensionStartAge: 55,
    });
    await page.goto("/insights/retirement");

    const beforeAge55 = await nestEggHeaderCells(page).nth(1).innerText();
    const beforeAge80 = await nestEggHeaderCells(page).nth(6).innerText();

    const employerInput = page.locator("#retirement-employer-pension");
    await employerInput.click();
    await employerInput.fill("30000");
    await employerInput.blur();

    await expect(employerInput).toHaveValue("30,000.00");

    await expect(nestEggHeaderCells(page).nth(1)).not.toHaveText(beforeAge55);
    await expect(nestEggHeaderCells(page).nth(6)).not.toHaveText(beforeAge80);
  });

  test("defaults the employer start age to 65 and the tax rate to 0 with no prior save", async ({
    page,
  }) => {
    await setupRetirementMock(page, { ageOverride: 40 });
    await page.goto("/insights/retirement");

    await expect(
      page.locator("#retirement-employer-pension-start-age"),
    ).toHaveValue("65");
    await expect(page.locator("#retirement-pension-tax-rate")).toHaveValue("0");
  });

  test("an employer pension leaves columns retiring before its start age untouched", async ({
    page,
  }) => {
    await setupRetirementMock(page, { ageOverride: 50 });
    await page.goto("/insights/retirement");

    const beforeAge55 = await nestEggHeaderCells(page).nth(1).innerText();
    const beforeAge80 = await nestEggHeaderCells(page).nth(6).innerText();

    const employerInput = page.locator("#retirement-employer-pension");
    await employerInput.click();
    await employerInput.fill("30000");
    await employerInput.blur();

    await expect(employerInput).toHaveValue("30,000.00");

    // Age 80 clears the 65 default start age; age 55 does not, so it must not move at all.
    await expect(nestEggHeaderCells(page).nth(6)).not.toHaveText(beforeAge80);
    await expect(nestEggHeaderCells(page).nth(1)).toHaveText(beforeAge55);
  });

  test("raising the pension tax rate raises the nest egg required", async ({
    page,
  }) => {
    await setupRetirementMock(page, {
      ageOverride: 50,
      employerPensionStartAge: 55,
    });
    await page.goto("/insights/retirement");

    const employerInput = page.locator("#retirement-employer-pension");
    await employerInput.click();
    await employerInput.fill("30000");
    await employerInput.blur();
    await expect(employerInput).toHaveValue("30,000.00");

    const untaxedAge55 = await nestEggHeaderCells(page).nth(1).innerText();

    const taxRateInput = page.locator("#retirement-pension-tax-rate");
    await taxRateInput.click();
    await taxRateInput.fill("50");
    await taxRateInput.blur();

    await expect(taxRateInput).toHaveValue("50");
    await expect(nestEggHeaderCells(page).nth(1)).not.toHaveText(untaxedAge55);
  });

  test("offers a verifiable estimate for a Canadian profile with no saved override", async ({
    page,
  }) => {
    await setupRetirementMock(page, {
      ageOverride: 40,
      loggedIn: true,
      countryCode: "CA",
    });
    await page.goto("/insights/retirement");

    const badge = page.getByTestId("retirement-pension-tax-rate-badge");
    await expect(badge).toHaveText("Auto-estimated");

    const taxRateInput = page.locator("#retirement-pension-tax-rate");
    // Empty rather than 0: a 0 in the field would read as "no tax applied". The placeholder is what
    // makes the rate in effect readable anyway, so it has to be an actual number.
    await expect(taxRateInput).toHaveValue("");
    await expect(taxRateInput).toHaveAttribute("placeholder", /^\d+$/);
    // The caption names the same rate, so the estimate is verifiable without clicking anything.
    await expect(
      page.locator("#retirement-pension-tax-rate-note"),
    ).toContainText(
      `Using ${await taxRateInput.getAttribute("placeholder")}%`,
    );
    // Nothing to replace while the estimate is already the active model.
    await expect(
      page.getByTestId("retirement-pension-tax-rate-use-estimate"),
    ).toHaveCount(0);
  });

  test("flags a 0% estimate as no tax applied rather than claiming an estimate", async ({
    page,
  }) => {
    // No spending to gross up puts the estimate in the 0% band, which is exactly the case where
    // "Auto-estimated" would be technically true and still read as a working tax figure.
    await setupRetirementMock(page, {
      ageOverride: 40,
      loggedIn: true,
      countryCode: "CA",
      avgMonthlyExpenseCents: 0,
    });
    await page.goto("/insights/retirement");

    await expect(
      page.getByTestId("retirement-pension-tax-rate-badge"),
    ).toHaveText("No tax applied");
  });

  test("the auto estimate needs a bigger nest egg than a manually saved 0%", async ({
    page,
  }) => {
    await setupRetirementMock(page, {
      ageOverride: 40,
      loggedIn: true,
      countryCode: "CA",
    });
    await page.goto("/insights/retirement");

    const estimatedAge70 = moneyDigitsOf(
      await nestEggHeaderCells(page).nth(6).innerText(),
    );

    // Saving 0% is the only way back to the untaxed baseline — an override always wins.
    const taxRateInput = page.locator("#retirement-pension-tax-rate");
    await taxRateInput.click();
    await taxRateInput.fill("0");
    await taxRateInput.blur();

    await expect(
      page.getByTestId("retirement-pension-tax-rate-badge"),
    ).toHaveText("No tax applied");
    await expect
      .poll(async () =>
        moneyDigitsOf(await nestEggHeaderCells(page).nth(6).innerText()),
      )
      .toBeLessThan(estimatedAge70);
  });

  test("a saved rate overrides the estimate until the estimate is asked for by name", async ({
    page,
  }) => {
    await setupRetirementMock(page, {
      ageOverride: 40,
      loggedIn: true,
      countryCode: "CA",
      pensionTaxRatePercent: 40,
    });
    await page.goto("/insights/retirement");

    const taxRateInput = page.locator("#retirement-pension-tax-rate");
    await expect(taxRateInput).toHaveValue("40");
    await expect(
      page.getByTestId("retirement-pension-tax-rate-badge"),
    ).toHaveCount(0);

    // Naming the rate before it is accepted is what makes the estimate verifiable, not a leap.
    const useEstimate = page.getByTestId(
      "retirement-pension-tax-rate-use-estimate",
    );
    await expect(useEstimate).toHaveText(/^Use our estimate \(\d+%\)$/);
    await useEstimate.click();

    // The field can only empty out if the getter now reports no stored rate, so this also proves the
    // clear command reached the config key rather than only the client cache.
    await expect(taxRateInput).toHaveValue("");
    await expect(
      page.getByTestId("retirement-pension-tax-rate-badge"),
    ).toHaveText("Auto-estimated");
    await expect(useEstimate).toHaveCount(0);
    // The button unmounts as a result of its own click, so focus has to be handed to the field it
    // just changed instead of falling back to the document.
    await expect(taxRateInput).toBeFocused();
  });

  test("emptying the field hands the rate back to the estimate where one exists", async ({
    page,
  }) => {
    await setupRetirementMock(page, {
      ageOverride: 40,
      loggedIn: true,
      countryCode: "CA",
      pensionTaxRatePercent: 40,
    });
    await page.goto("/insights/retirement");

    const taxRateInput = page.locator("#retirement-pension-tax-rate");
    await expect(taxRateInput).toHaveValue("40");

    await taxRateInput.click();
    await taxRateInput.fill("");
    await taxRateInput.blur();

    await expect(taxRateInput).toHaveValue("");
    await expect(taxRateInput).toHaveAttribute("placeholder", /^\d+$/);
    await expect(
      page.getByTestId("retirement-pension-tax-rate-badge"),
    ).toHaveText("Auto-estimated");
    await expect(
      page.getByTestId("retirement-pension-tax-rate-use-estimate"),
    ).toHaveCount(0);
  });

  test("outside Canada a saved rate gets no estimate button and no estimate language", async ({
    page,
  }) => {
    await setupRetirementMock(page, {
      ageOverride: 40,
      loggedIn: true,
      countryCode: "US",
      pensionTaxRatePercent: 40,
    });
    await page.goto("/insights/retirement");

    await expect(page.locator("#retirement-pension-tax-rate")).toHaveValue("40");
    await expect(
      page.getByTestId("retirement-pension-tax-rate-use-estimate"),
    ).toHaveCount(0);
    // No table exists outside Canada, so there is no estimate to name — and a badge here could only
    // be the auto one, since a saved 40% is not zero.
    await expect(
      page.getByTestId("retirement-pension-tax-rate-badge"),
    ).toHaveCount(0);
    // The placeholder is the estimate standing in for an empty field, so it must not exist either.
    await expect(page.locator("#retirement-pension-tax-rate")).toHaveJSProperty(
      "placeholder",
      "",
    );
    await expect(
      page.locator("#retirement-pension-tax-rate-note"),
    ).not.toContainText("estimate");
  });

  test("outside Canada emptying the field reverts to the saved rate instead of committing 0", async ({
    page,
  }) => {
    await setupRetirementMock(page, {
      ageOverride: 40,
      loggedIn: true,
      countryCode: "US",
      pensionTaxRatePercent: 40,
    });
    await page.goto("/insights/retirement");

    const taxRateInput = page.locator("#retirement-pension-tax-rate");
    await expect(taxRateInput).toHaveValue("40");

    await taxRateInput.click();
    await taxRateInput.fill("");
    await taxRateInput.blur();

    // Reverting is the only honest outcome: there is no estimate to fall back to, and committing 0
    // would silently project untaxed retirement income the user never asked for.
    await expect(taxRateInput).toHaveValue("40");
    await expect(
      page.getByTestId("retirement-pension-tax-rate-badge"),
    ).toHaveCount(0);
  });

  test("outside Canada a 0% rate is flagged as no tax applied, with no estimate offered", async ({
    page,
  }) => {
    await setupRetirementMock(page, { ageOverride: 40 });
    await page.goto("/insights/retirement");

    await expect(page.locator("#retirement-pension-tax-rate")).toHaveValue("0");
    await expect(
      page.getByTestId("retirement-pension-tax-rate-badge"),
    ).toHaveText("No tax applied");
    await expect(
      page.getByTestId("retirement-pension-tax-rate-use-estimate"),
    ).toHaveCount(0);
  });

  test("masks every monetary cell when values privacy is toggled off", async ({
    page,
  }) => {
    await setupRetirementMock(page, { ageOverride: 40 });
    await page.goto("/insights/retirement");

    const currentPaceRow = page.getByTestId("retirement-current-pace-row");
    await expect(currentPaceRow).toContainText("$");
    await expect(currentPaceRow).not.toContainText("•");

    await page.getByTestId("toggle-values-button").click();

    await expect(currentPaceRow).toContainText("•");
    await expect(currentPaceRow).not.toContainText(/\d/);
  });
});

test.describe("Retirement figures in today's dollars", () => {
  test("reads highest for the earliest retirement age, matching the legend", async ({
    page,
  }) => {
    await setupRetirementMock(page, { ageOverride: 40 });
    await page.goto("/insights/retirement");

    await expect(nestEggFigures(page)).toHaveCount(6);
    const amounts = await nestEggFigures(page).evaluateAll((nodes) =>
      nodes.map((node) => Number((node.textContent ?? "").replace(/\D/g, ""))),
    );

    // Nominal figures rise before they fall across these columns, so a passing run here is only
    // possible once every figure has been deflated to a common unit.
    for (let index = 1; index < amounts.length; index++) {
      expect(amounts[index]).toBeLessThan(amounts[index - 1]);
    }
  });

  test("labels the row as today's dollars and explains the conversion once", async ({
    page,
  }) => {
    await setupRetirementMock(page, { ageOverride: 40 });
    await page.goto("/insights/retirement");

    await expect(nestEggHeaderCells(page).nth(0)).toContainText(
      "Nest egg needed (today's $)",
    );

    const info = page.getByTestId("retirement-todays-dollars-info");
    await expect(info).toHaveAttribute(
      "aria-label",
      "How today's dollars are calculated",
    );

    await info.hover();
    await expect(tooltipContent(page)).toContainText(
      "converted back to what it would buy today",
    );
    await expect(tooltipContent(page)).toContainText("2.5%/yr inflation");
  });

  test("discloses the future amount a header figure was deflated from", async ({
    page,
  }) => {
    await setupRetirementMock(page, { ageOverride: 40 });
    await page.goto("/insights/retirement");

    const trigger = nestEggFigures(page).nth(5);
    await expect(trigger).toHaveJSProperty("tagName", "BUTTON");
    const todaysAmount = (await trigger.innerText()).trim();

    await trigger.hover();
    await expect(tooltipContent(page)).toContainText(
      "Retiring at age 70, 30 years from now",
    );
    await expect(tooltipContent(page)).toContainText("2.5%/yr inflation");

    const disclosed =
      (await tooltipContent(page).innerText()).match(/\$[\d,]+\.\d{2}/g) ?? [];
    expect(disclosed).toHaveLength(2);
    const [futureAmount, deflatedAmount] = disclosed;
    expect(deflatedAmount).toBe(todaysAmount);
    expect(moneyDigitsOf(futureAmount)).toBeGreaterThan(
      moneyDigitsOf(deflatedAmount),
    );
  });

  test("names both amounts and the age in the trigger's accessible name", async ({
    page,
  }) => {
    await setupRetirementMock(page, { ageOverride: 40 });
    await page.goto("/insights/retirement");

    const trigger = nestEggFigures(page).nth(5);
    const ariaLabel = await trigger.getAttribute("aria-label");
    expect(ariaLabel).toContain("in today's dollars, converted from");
    expect(ariaLabel).toContain("at age 70");
    expect(ariaLabel?.match(/\$[\d,]+\.\d{2}/g)).toHaveLength(2);

    // Reachable without a pointer: the receipt is the only place the future figure is stated.
    await trigger.focus();
    await expect(trigger).toBeFocused();
  });

  test("leaves the 36 cells free of any trigger — only the header inverted", async ({
    page,
  }) => {
    await setupRetirementMock(page, { ageOverride: 40 });
    await page.goto("/insights/retirement");

    await expect(page.locator("tbody button")).toHaveCount(0);
    await expect(page.locator("tbody td:not(:first-child)")).toHaveCount(36);
  });

  test("compares each cell against its header in the same unit", async ({
    page,
  }) => {
    await setupRetirementMock(page, { ageOverride: 40 });
    await page.goto("/insights/retirement");

    const headerDigits = await nestEggFigures(page).evaluateAll((nodes) =>
      nodes.map((node) => Number((node.textContent ?? "").replace(/\D/g, ""))),
    );
    const cells = await page.locator("tbody tr").evaluateAll((rows) =>
      rows.map((row) =>
        Array.from(row.querySelectorAll("td"))
          .slice(1)
          .map((td) => ({
            digits: Number((td.textContent ?? "").replace(/\D/g, "")),
            achieved: td.className.includes("bg-good-bg"),
          })),
      ),
    );

    // A green cell claims it clears its column's requirement, so it must also read at or above the
    // figure printed above it. Deflating the header while leaving cells nominal would satisfy the
    // colour and contradict the numbers, which is the mixed-unit bug this pins down.
    expect(cells).toHaveLength(6);
    for (const row of cells) {
      row.forEach((cell, index) => {
        if (cell.achieved) {
          expect(cell.digits).toBeGreaterThanOrEqual(headerDigits[index]);
        } else {
          expect(cell.digits).toBeLessThan(headerDigits[index]);
        }
      });
    }
  });

  test("keeps a status colour on every cell", async ({ page }) => {
    await setupRetirementMock(page, { ageOverride: 40 });
    await page.goto("/insights/retirement");

    const classNames = await page
      .locator("tbody td:not(:first-child)")
      .evaluateAll((nodes) => nodes.map((node) => node.className));

    expect(classNames).toHaveLength(36);
    for (const className of classNames) {
      expect(/bg-good-bg|bg-caution-bg|bg-over-bg/.test(className)).toBe(true);
    }
  });

  test("shows a bare figure with no receipt when the conversion changes nothing", async ({
    page,
  }) => {
    // No spending leaves every nest egg at $0, so the deflated figure and the figure it came from
    // format identically — a receipt reading "$0.00, converted from $0.00" is a dead affordance.
    await setupRetirementMock(page, {
      ageOverride: 40,
      avgMonthlyExpenseCents: 0,
    });
    await page.goto("/insights/retirement");

    await expect(nestEggFigures(page)).toHaveCount(6);
    await expect(nestEggFigures(page).first()).toHaveText("$0.00");
    await expect(nestEggFigures(page).first()).toHaveJSProperty(
      "tagName",
      "SPAN",
    );
    await expect(page.locator("thead button")).toHaveCount(1);
  });

  test("drops the receipt trigger while values are hidden", async ({ page }) => {
    await setupRetirementMock(page, { ageOverride: 40 });
    await page.goto("/insights/retirement");

    await expect(nestEggFigures(page).first()).toHaveJSProperty(
      "tagName",
      "BUTTON",
    );

    await page.getByTestId("toggle-values-button").click();

    // Both figures mask to the same string, so the receipt has nothing left to disclose and must not
    // offer a trigger that opens a popup of bullets.
    await expect(nestEggFigures(page).first()).toHaveJSProperty(
      "tagName",
      "SPAN",
    );
  });
});
