import { test, expect, type Page } from "@playwright/test";

/**
 * Covers the Income Sources table's year-scoped total column. `nav-qa.spec.ts` only smoke-tests an
 * empty Income page, so nothing else proves the yearly aggregate is joined to the right source or
 * that the selected year reaches the backend.
 *
 * The mock aggregates from a real entry list rather than returning canned totals, so a frontend that
 * asked for the wrong year would show the wrong figure instead of the expected one.
 */

async function setupTauriMock(page: Page, rejectYearTotals = false) {
  await page.addInitScript(({ rejectYearTotals }) => {
    const requestedYears: number[] = [];
    (window as unknown as { __YEAR_TOTAL_ARGS__: number[] }).__YEAR_TOTAL_ARGS__ =
      requestedYears;

    const entries = [
      { source_id: 1, amount_cents: 520_000, date: "2026-02-15" },
      { source_id: 1, amount_cents: 200_000, date: "2026-05-01" },
      { source_id: 1, amount_cents: 90_000, date: "2025-11-02" },
      { source_id: 2, amount_cents: 150_000, date: "2024-07-10" },
    ];

    const sources = [
      {
        id: 1,
        name: "Acme Payroll",
        income_type: "employment",
        last_amount_cents: 200_000,
        last_month: "2026-05",
        created_at: "",
        updated_at: "",
      },
      {
        id: 2,
        name: "Consulting",
        income_type: "freelance",
        last_amount_cents: 150_000,
        last_month: "2024-07",
        created_at: "",
        updated_at: "",
      },
    ];

    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      transformCallback: (cb: unknown) => cb,
      invoke: (cmd: string, args: Record<string, unknown> = {}) => {
        // A truthy updater answer mounts an always-open modal that aria-hidden()s the whole app.
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);
        switch (cmd) {
          case "check_picker_gate":
            return Promise.resolve({ needs_picker: false });
          case "get_income_sources":
            return Promise.resolve(JSON.parse(JSON.stringify(sources)));
          case "get_income_source_year_totals": {
            if (rejectYearTotals) {
              return Promise.reject(new Error("year totals unavailable"));
            }
            const year = args.year as number;
            requestedYears.push(year);
            const prefix = `${year}-`;
            const sums = new Map<number, number>();
            for (const entry of entries) {
              if (!entry.date.startsWith(prefix)) continue;
              sums.set(
                entry.source_id,
                (sums.get(entry.source_id) ?? 0) + entry.amount_cents
              );
            }
            return Promise.resolve(
              [...sums].map(([source_id, total_cents]) => ({
                source_id,
                year,
                total_cents,
              }))
            );
          }
          case "get_income_total":
            return Promise.resolve({ total_cents: 200_000, month: "2026-05" });
          case "get_income_entries_by_month":
            return Promise.resolve([]);
          case "get_onboarding_status":
            return Promise.resolve({
              has_budget: true,
              has_accounts: true,
              has_assets: true,
              has_income: true,
            });
          // The account trigger is mounted on every screen, so this read must be answered even
          // where the surface under test has nothing to do with an account.
          case "get_user_avatar":
            return Promise.resolve(null);
          default:
            return Promise.resolve([]);
        }
      },
    };
  }, { rejectYearTotals });
}

function rowFor(page: Page, name: string) {
  return page.getByTestId("income-source-row").filter({ hasText: name });
}

test("income sources show the selected year's entered total, not the last recorded amount", async ({
  page,
}) => {
  await setupTauriMock(page);
  await page.goto("/spending/income?period=2026-05");

  // The column names the year it is scoped to, so the figure cannot be read as a running balance.
  const table = page.getByRole("table").filter({ hasText: "Acme Payroll" });
  await expect(table.getByRole("columnheader", { name: "Recorded in 2026" })).toBeVisible();

  // $5,200 + $2,000 in 2026; the $900 dated 2025 is excluded, and $2,000 was the last amount.
  const payrollRow = rowFor(page, "Acme Payroll");
  await expect(payrollRow.getByTestId("income-source-year-total")).toHaveText("$7,200.00");
  await expect(payrollRow).toContainText("May 2026");

  // No 2026 entries, so a formatted zero — while all-time "Last recorded" still reads July 2024.
  const consultingRow = rowFor(page, "Consulting");
  await expect(consultingRow.getByTestId("income-source-year-total")).toHaveText("$0.00");
  await expect(consultingRow).toContainText("July 2024");

  const requestedYears = await page.evaluate(
    () => (window as unknown as { __YEAR_TOTAL_ARGS__: number[] }).__YEAR_TOTAL_ARGS__
  );
  expect(requestedYears).toContain(2026);
  expect(requestedYears).not.toContain(2025);
});

test("the table waits for the year aggregate instead of flashing zero totals", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const sources = [
      {
        id: 1,
        name: "Acme Payroll",
        income_type: "employment",
        last_amount_cents: 200_000,
        last_month: "2026-05",
        created_at: "",
        updated_at: "",
      },
    ];

    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
      transformCallback: (cb: unknown) => cb,
      invoke: (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);
        switch (cmd) {
          case "check_picker_gate":
            return Promise.resolve({ needs_picker: false });
          case "get_income_sources":
            return Promise.resolve(JSON.parse(JSON.stringify(sources)));
          // Held back so the sources read resolves first — the exact ordering that used to render
          // every row at $0.00.
          case "get_income_source_year_totals":
            return new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve([
                    { source_id: 1, year: args.year as number, total_cents: 720_000 },
                  ]),
                1200
              )
            );
          case "get_income_total":
            return Promise.resolve({ total_cents: 200_000, month: "2026-05" });
          case "get_user_avatar":
            return Promise.resolve(null);
          default:
            return Promise.resolve([]);
        }
      },
    };
  });

  await page.goto("/spending/income?period=2026-05");

  await expect(page.getByTestId("income-sources-skeleton")).toBeVisible();
  await expect(page.getByTestId("income-source-year-total")).toHaveCount(0);

  await expect(page.getByTestId("income-source-year-total")).toHaveText("$7,200.00");
  await expect(page.getByTestId("income-sources-skeleton")).toHaveCount(0);
});

test("a failed year aggregate never masquerades as zero income", async ({ page }) => {
  await setupTauriMock(page, true);
  await page.goto("/spending/income?period=2026-05");

  await expect(page.getByTestId("income-year-totals-error")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Year totals unavailable")).toBeVisible();
  await expect(page.getByTestId("income-source-year-total")).toHaveCount(0);
});

test("crossing a year boundary refetches the totals for the newly selected year", async ({
  page,
}) => {
  await setupTauriMock(page);
  await page.goto("/spending/income?period=2026-01");

  await expect(
    rowFor(page, "Acme Payroll").getByTestId("income-source-year-total")
  ).toHaveText("$7,200.00");

  await page.getByTestId("prev-month-button").click();
  await expect(page.getByTestId("current-month-label")).toHaveText("December 2025");

  const table = page.getByRole("table").filter({ hasText: "Acme Payroll" });
  await expect(table.getByRole("columnheader", { name: "Recorded in 2025" })).toBeVisible();
  await expect(
    rowFor(page, "Acme Payroll").getByTestId("income-source-year-total")
  ).toHaveText("$900.00");
  await expect(
    rowFor(page, "Consulting").getByTestId("income-source-year-total")
  ).toHaveText("$0.00");

  const requestedYears = await page.evaluate(
    () => (window as unknown as { __YEAR_TOTAL_ARGS__: number[] }).__YEAR_TOTAL_ARGS__
  );
  expect(requestedYears).toContain(2025);
});
