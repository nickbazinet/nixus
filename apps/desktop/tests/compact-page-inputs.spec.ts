import { expect, test, type Page } from "@playwright/test";

type Surface = "budget" | "retirement";

async function setupPage(page: Page, surface: Surface) {
  await page.addInitScript((selectedSurface: Surface) => {
    (
      window as unknown as Record<string, unknown>
    ).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      convertFileSrc: (path: string) => path,
      invoke: (cmd: string) => {
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);

        switch (cmd) {
          case "check_picker_gate":
            return Promise.resolve({ needs_picker: false });
          case "check_onboarding_status":
            return Promise.resolve({
              needs_onboarding: false,
              setup_incomplete: false,
            });
          case "get_auth_session":
            return Promise.resolve({
              status: "LoggedIn",
              email: "user@example.com",
              name: "Test User",
            });
          case "get_user_avatar":
          case "get_user_profile":
            return Promise.resolve(null);
          case "get_retirement_input":
            return Promise.resolve({
              account_balances: [
                { account_type: "tfsa", total_cents: 5_000_000 },
              ],
              avg_monthly_income_cents: 800_000,
              avg_monthly_expense_cents: 500_000,
              income_month_count: 12,
              expense_month_count: 12,
            });
          case "get_retirement_age_override":
            return Promise.resolve(40);
          case "get_retirement_pension_cents":
            return Promise.resolve(600_000);
          case "get_retirement_employer_pension_cents":
            return Promise.resolve(5_000_000);
          case "get_retirement_employer_pension_start_age":
            return Promise.resolve(65);
          case "get_retirement_pension_tax_rate_percent":
            return Promise.resolve(6);
          case "get_budget_groups_for_month":
            return Promise.resolve(
              selectedSurface === "budget"
                ? [
                    {
                      id: 1,
                      name: "Essentials",
                      sort_order: 0,
                      created_at: "2026-01-01T00:00:00Z",
                    },
                  ]
                : [],
            );
          case "get_budget_categories":
          case "get_budget_status":
          case "get_expenses":
          case "get_all_budget_categories":
          case "get_accounts":
            return Promise.resolve([]);
          case "get_budget_summary":
            return Promise.resolve({
              total_target_cents: 0,
              total_spent_cents: 0,
              remaining_cents: 0,
              month: "2026-09",
              average_monthly_income_cents: 0,
              income_month_count: 0,
            });
          default:
            return Promise.resolve(null);
        }
      },
    };
  }, surface);
}

async function widthsFor(input: ReturnType<Page["locator"]>) {
  return input.evaluate((element) => {
    const card = element.closest('[data-slot="card"]');
    if (!(card instanceof HTMLElement)) {
      throw new Error("Expected the input to be inside a card");
    }

    return {
      input: element.getBoundingClientRect().width,
      card: card.getBoundingClientRect().width,
    };
  });
}

test("page-level retirement money inputs fit their expected content", async ({
  page,
}) => {
  // Given a wide retirement page with both pension values populated
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setupPage(page, "retirement");
  await page.goto("/insights/retirement");

  // When the assumptions card is laid out
  const inputs = [
    page.locator("#retirement-government-pension"),
    page.locator("#retirement-employer-pension"),
  ];

  // Then each short-value control is capped while its card remains wide
  for (const input of inputs) {
    await expect(input).toBeVisible();
    const widths = await widthsFor(input);
    expect(widths.input).toBeLessThanOrEqual(192);
    expect(widths.card).toBeGreaterThan(widths.input * 2);
  }
});

test("the page-level budget target fits its expected content", async ({ page }) => {
  // Given a wide budget page with an existing group
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setupPage(page, "budget");
  await page.goto("/spending/budget");

  // When the inline category form is opened
  await page.getByTestId("add-category-button").click();
  const target = page.getByLabel("Monthly Target");

  // Then the short-value control is capped while its card remains wide
  await expect(target).toBeVisible();
  const widths = await widthsFor(target);
  expect(widths.input).toBeLessThanOrEqual(192);
  expect(widths.card).toBeGreaterThan(widths.input * 2);
});
