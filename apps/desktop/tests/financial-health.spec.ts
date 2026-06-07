import { test, expect, type Page } from "@playwright/test";

const MASKED_CURRENCY = "$••••";

const yearlySummaryMock = {
  year: 2026,
  is_current_year: true,
  total_spent_cents: 450000,
  total_income_cents: 600000,
  cash_flow_net_cents: 150000,
  net_worth_gain_cents: 2500000,
  net_worth_gain_available: true,
  top_categories: [],
  monthly_totals: [],
  all_categories: [],
  available_years: [2026],
};

async function setupFinancialHealthMock(page: Page) {
  await page.addInitScript((yearlyMock) => {
    let targetMonths = 6;

    const buildSummary = () => {
      const waterfall = evaluateWaterfall(targetMonths);
      return {
        data_sufficient: true,
        emergency_fund: {
          coverage_months: 2.4,
          target_months: targetMonths,
          progress_ratio: 2.4 / targetMonths,
          status: "approaching" as const,
        },
        savings: {
          savings_rate_percent: 14,
          avg_monthly_surplus_cents: 62000,
        },
        waterfall: {
          current_step: waterfall.current_step,
          action_line_key: waterfall.reasoning_key,
        },
      };
    };

    const buildDetail = () => {
      const waterfall = evaluateWaterfall(targetMonths);
      return {
        ...buildSummary(),
        figures: {
          liquid_savings_cents: 1500000,
          avg_monthly_expenses_cents: 625000,
          avg_monthly_income_cents: 720000,
          credit_card_debt_cents: 0,
          expense_month_count: 3,
          income_month_count: 3,
        },
        waterfall,
        top_discretionary_categories: [
          {
            category_id: 1,
            category_name: "Dining Out",
            group_name: "Lifestyle",
            avg_monthly_spend_cents: 45000,
          },
          {
            category_id: 2,
            category_name: "Subscriptions",
            group_name: "Lifestyle",
            avg_monthly_spend_cents: 12000,
          },
        ],
        monthly_surplus_trend: [
          { month: "2025-10", income_cents: 720000, expense_cents: 650000, surplus_cents: 70000 },
          { month: "2025-11", income_cents: 720000, expense_cents: 640000, surplus_cents: 80000 },
          { month: "2025-12", income_cents: 720000, expense_cents: 660000, surplus_cents: 60000 },
          { month: "2026-01", income_cents: 720000, expense_cents: 630000, surplus_cents: 90000 },
          { month: "2026-02", income_cents: 720000, expense_cents: 645000, surplus_cents: 75000 },
          { month: "2026-03", income_cents: 720000, expense_cents: 658000, surplus_cents: 62000 },
        ],
      };
    };

    function evaluateWaterfall(months: number) {
      const coverageMonths = 2.4;
      const creditCardDebtCents = 0;
      const avgMonthlySurplusCents = 62000;
      const liquidSavingsCents = 1500000;
      const avgMonthlyExpensesCents = 625000;

      const emergencyFundComplete = coverageMonths >= months;
      const debtComplete = creditCardDebtCents === 0;

      const completedSteps: string[] = [];
      if (emergencyFundComplete) {
        completedSteps.push("build_emergency_fund");
      }
      if (emergencyFundComplete && debtComplete) {
        completedSteps.push("pay_high_interest_debt");
      }

      let currentStep = "build_emergency_fund";
      let reasoningKey = "build_emergency_fund";

      if (!emergencyFundComplete) {
        currentStep = "build_emergency_fund";
        reasoningKey = "build_emergency_fund";
      } else if (!debtComplete) {
        currentStep = "pay_high_interest_debt";
        reasoningKey = "pay_debt";
      } else if (avgMonthlySurplusCents > 0) {
        currentStep = "contribute_registered_accounts";
        reasoningKey = "contribute_registered";
      } else {
        currentStep = "invest_surplus";
        reasoningKey = "invest_surplus";
      }

      return {
        current_step: currentStep,
        completed_steps: completedSteps,
        reasoning_key: reasoningKey,
        reasoning_params: {
          coverage_months: coverageMonths,
          target_months: months,
          credit_card_debt_cents: creditCardDebtCents,
          avg_monthly_surplus_cents: avgMonthlySurplusCents,
          liquid_savings_cents: liquidSavingsCents,
          avg_monthly_expenses_cents: avgMonthlyExpensesCents,
        },
      };
    }

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args?: { months?: number }) => {
        switch (cmd) {
          case "get_budget_summary":
            return Promise.resolve({
              total_target_cents: 300000,
              total_spent_cents: 175000,
              remaining_cents: 125000,
              month: "2026-03",
            });
          case "get_top_budget_categories":
            return Promise.resolve([]);
          case "get_current_net_worth":
            return Promise.resolve({
              total_cents: 77300000,
              cash_cents: 1500000,
              investments_cents: 28300000,
              assets_cents: 47500000,
            });
          case "get_recent_net_worth_snapshots":
            return Promise.resolve([]);
          case "get_spending_breakdown":
            return Promise.resolve([]);
          case "get_yearly_summary":
            return Promise.resolve(yearlyMock);
          case "get_income_total":
            return Promise.resolve({ total_cents: 210000 });
          case "get_net_worth_history":
            return Promise.resolve([]);
          case "get_net_worth_change":
            return Promise.resolve({
              absolute_change_cents: 0,
              percentage_change: 0,
              direction: "flat",
            });
          case "get_financial_health_summary":
            return Promise.resolve(buildSummary());
          case "get_financial_health_detail":
            return Promise.resolve(buildDetail());
          case "set_emergency_fund_target":
            if (
              args?.months == null ||
              args.months < 1 ||
              args.months > 24 ||
              !Number.isInteger(args.months)
            ) {
              return Promise.reject("Validation error");
            }
            targetMonths = args.months;
            return Promise.resolve(null);
          default:
            return Promise.resolve(null);
        }
      },
    };
  }, yearlySummaryMock);
}

test.describe("Financial Health — Story 22.4", () => {
  test("dashboard card shows seeded stats", async ({ page }) => {
    await setupFinancialHealthMock(page);
    await page.goto("/");

    const card = page.getByTestId("financial-health-card");
    await expect(card).toBeVisible();
    await expect(page.getByTestId("financial-health-months")).toContainText("2.4 mo");
    await expect(page.getByTestId("financial-health-savings-rate")).toContainText("14%");
    await expect(page.getByTestId("financial-health-surplus")).toContainText(
      "+$620.00/mo"
    );
    await expect(page.getByTestId("financial-health-action")).toContainText(
      "Build your emergency fund"
    );
    await expect(page.getByTestId("financial-health-disclaimer")).toContainText(
      "Educational guidance, not professional financial advice."
    );
  });

  test("navigates to Financial Health section and renders all panels", async ({
    page,
  }) => {
    await setupFinancialHealthMock(page);
    await page.goto("/");

    await page.getByTestId("financial-health-card").click();
    await expect(page).toHaveURL(/\/net-worth\/financial-health/);
    await expect(page.getByText("Where your money should go next")).toBeVisible();

    await expect(page.getByTestId("emergency-fund-panel")).toBeVisible();
    await expect(page.getByTestId("emergency-fund-months")).toContainText("2.4 mo");
    await expect(page.getByTestId("emergency-fund-math-line")).toContainText(
      "$15,000.00 liquid savings"
    );
    await expect(page.getByTestId("emergency-fund-math-line")).toContainText(
      "$6,250.00 average monthly expenses"
    );

    const waterfall = page.getByTestId("action-waterfall");
    await expect(waterfall).toBeVisible();
    await expect(
      page.getByTestId("waterfall-rung-build_emergency_fund")
    ).toHaveAttribute("data-state", "current");

    const savingsPanel = page.getByTestId("savings-capacity-panel");
    await expect(savingsPanel).toBeVisible();
    await expect(page.getByTestId("savings-capacity-rate")).toContainText("14%");
    await expect(page.getByTestId("savings-capacity-surplus")).toContainText(
      "+$620.00/mo"
    );
    await expect(page.getByTestId("savings-capacity-trend")).toBeVisible();
    await expect(page.getByTestId("savings-capacity-category-1")).toContainText(
      "$450.00/mo"
    );
    await expect(page.getByTestId("savings-capacity-category-2")).toContainText(
      "$120.00/mo"
    );

    await expect(page.getByTestId("financial-health-section-disclaimer")).toContainText(
      "Educational guidance, not professional financial advice."
    );
  });

  test("editing emergency fund target shifts waterfall current rung", async ({
    page,
  }) => {
    await setupFinancialHealthMock(page);
    await page.goto("/net-worth/financial-health");

    await expect(
      page.getByTestId("waterfall-rung-build_emergency_fund")
    ).toHaveAttribute("data-state", "current");
    await expect(
      page.getByTestId("waterfall-rung-contribute_registered_accounts")
    ).toHaveAttribute("data-state", "future");

    await page.getByTestId("emergency-fund-target").click();
    const input = page.getByTestId("emergency-fund-target-input");
    await input.fill("2");
    await input.press("Enter");

    await expect(page.getByText("Emergency fund target updated")).toBeVisible();
    await expect(page.getByTestId("emergency-fund-target")).toContainText("2 mo");

    await expect(
      page.getByTestId("waterfall-rung-build_emergency_fund")
    ).toHaveAttribute("data-state", "completed");
    await expect(
      page.getByTestId("waterfall-rung-pay_high_interest_debt")
    ).toHaveAttribute("data-state", "completed");
    await expect(
      page.getByTestId("waterfall-rung-contribute_registered_accounts")
    ).toHaveAttribute("data-state", "current");
    await expect(
      page.getByTestId("waterfall-rung-contribute_registered_accounts")
    ).toContainText("You are here");
  });

  test("values privacy toggle masks all monetary displays in financial health module", async ({
    page,
  }) => {
    await setupFinancialHealthMock(page);
    await page.goto("/");

    await expect(page.getByTestId("financial-health-surplus")).toContainText(
      "+$620.00/mo"
    );

    await page.getByTestId("toggle-values-button").click();

    await expect(page.getByTestId("financial-health-surplus")).toContainText(
      `+${MASKED_CURRENCY}/mo`
    );
    await expect(page.getByTestId("financial-health-surplus")).not.toContainText(
      "620"
    );

    await page.getByTestId("financial-health-card").click();
    await expect(page).toHaveURL(/\/net-worth\/financial-health/);

    const mathLine = page.getByTestId("emergency-fund-math-line");
    await expect(mathLine).toContainText(MASKED_CURRENCY);
    await expect(mathLine).not.toContainText("15,000");
    await expect(mathLine).not.toContainText("6,250");

    await expect(page.getByTestId("savings-capacity-surplus")).toContainText(
      `+${MASKED_CURRENCY}/mo`
    );
    await expect(page.getByTestId("savings-capacity-category-1")).toContainText(
      `${MASKED_CURRENCY}/mo`
    );
    await expect(page.getByTestId("savings-capacity-category-2")).toContainText(
      `${MASKED_CURRENCY}/mo`
    );

    await page.getByTestId("emergency-fund-target").click();
    const targetInput = page.getByTestId("emergency-fund-target-input");
    await targetInput.fill("2");
    await targetInput.press("Enter");

    await expect(
      page.getByTestId("waterfall-rung-contribute_registered_accounts")
    ).toHaveAttribute("data-state", "current");

    await page.getByTestId("waterfall-why-toggle").click();
    const reasoning = page.getByTestId("waterfall-reasoning");
    await expect(reasoning).toBeVisible();
    await expect(reasoning).toContainText(MASKED_CURRENCY);
    await expect(reasoning).not.toContainText("620");
  });
});
