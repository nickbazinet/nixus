import { test, expect, type Page } from "@playwright/test";

/**
 * The AI-generated Home dashboard (PRD FR-1..FR-11), driven through the real UI against a stateful
 * IPC mock. The mock plays the backend's role — persisting widgets across reloads, resolving each
 * binding into data, and scripting what the generation turn answers — so every user-visible step of
 * ask -> confirm -> reopen -> refine -> remove is exercised end to end.
 */

type MockWindow = Record<string, unknown>;

interface HomeMockOptions {
  access?: string;
  byoConfigured?: boolean;
  /** Answer the pre-built sections' reads with a profile that has something to show. */
  overview?: boolean;
}

const NET_WORTH_WIDGET = {
  component: "LineChart",
  title: "Net Worth, Month over Month",
  dataBinding: { source: "net_worth_history", params: { months: 12 } },
};

const CATEGORIES_WIDGET = {
  component: "PieChart",
  title: "Top Spending Categories This Month",
  dataBinding: { source: "expenses_by_category", params: { months: 1, limit: 8 } },
};

function proposal(params: Record<string, unknown>, label: string) {
  return (
    "```action\n" +
    JSON.stringify({
      action: true,
      action_type: "propose_home_surface_change",
      display: { label, details: [] },
      params,
    }) +
    "\n```"
  );
}

async function setupHomeMock(page: Page, options: HomeMockOptions = {}) {
  await page.addInitScript(
    ({ access, byoConfigured, overview }) => {
      const w = window as unknown as Record<string, unknown>;
      const STORE_KEY = "__home_mock_widgets__";

      // Persisted in localStorage so a reload stands for closing and reopening the app.
      const load = (): { id: string; spec: Record<string, unknown> }[] =>
        JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
      const save = (widgets: { id: string; spec: Record<string, unknown> }[]) =>
        localStorage.setItem(STORE_KEY, JSON.stringify(widgets));

      const DATA: Record<string, unknown> = {
        net_worth_history: {
          dimension: "month",
          detail_columns: [],
          series: ["net_worth"],
          rows: [
            { key: "2026-08", label: "2026-08", values: [4_100_000] },
            { key: "2026-09", label: "2026-09", values: [4_250_000] },
            { key: "2026-10", label: "2026-10", values: [4_410_000] },
          ],
        },
        expenses_by_category: {
          dimension: "category",
          detail_columns: [],
          series: ["spent"],
          rows: [
            { key: "category:1", label: "Groceries", values: [61_000] },
            { key: "category:2", label: "Dining", values: [24_000] },
            { key: "__other__", label: "Other", values: [9_000] },
          ],
        },
        expenses_by_month: {
          dimension: "month",
          detail_columns: [],
          series: ["spent"],
          rows: [
            { key: "2026-09", label: "2026-09", values: [180_000] },
            { key: "2026-10", label: "2026-10", values: [210_000] },
          ],
        },
        recent_expenses: {
          dimension: "expense",
          detail_columns: ["date", "category"],
          series: ["amount"],
          rows: [
            { key: "expense:12", label: "Corner Cafe", details: ["2026-10-30", "Restaurants"], values: [1_250] },
            { key: "expense:11", label: "FreshMart", details: ["2026-10-28", "Groceries"], values: [8_430] },
          ],
        },
        account_balances: {
          dimension: "account",
          detail_columns: [],
          series: ["balance"],
          rows: [{ key: "account:1", label: "Chequing", values: [320_000] }],
        },
      };

      const LAYOUTS = ["Card", "Row", "Column", "Grid"];
      const render = (node: Record<string, unknown>): Record<string, unknown> => {
        const component = node.component as string;
        if (LAYOUTS.includes(component)) {
          return {
            component,
            title: (node.title as string) ?? null,
            columns: (node.columns as number) ?? null,
            source: null,
            data: null,
            unsupported: false,
            children: ((node.children as Record<string, unknown>[]) ?? []).map(render),
          };
        }
        const source = (node.dataBinding as { source: string }).source;
        return {
          component,
          title: (node.title as string) ?? null,
          columns: null,
          source,
          data: DATA[source] ?? null,
          unsupported: !(source in DATA),
          children: [],
        };
      };

      const replies: unknown[] = [];
      const calls: { cmd: string; args: Record<string, unknown> }[] = [];
      let currentAccess = access;
      w.__HOME_QUEUE_REPLY__ = (reply: unknown) => replies.push(reply);
      w.__HOME_CALLS__ = calls;
      w.__HOME_SET_ACCESS__ = (value: string) => {
        currentAccess = value;
      };

      const daysAgo = (days: number) =>
        new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
      const OVERVIEW: Record<string, unknown> = {
        get_budget_status: [
          { id: 1, group_id: 1, name: "Restaurants", target_cents: 20_000, spent_cents: 28_600, is_deleted: false },
          { id: 2, group_id: 1, name: "Groceries", target_cents: 60_000, spent_cents: 57_000, is_deleted: false },
          { id: 3, group_id: 1, name: "Hobbies", target_cents: 0, spent_cents: 4_000, is_deleted: false },
        ],
        get_vehicles: [{ id: 1, nickname: "Civic", make: null, model: null, year: null, odometer_km: 80_000, created_at: "", updated_at: "" }],
        get_vehicle: {
          vehicle: { id: 1, nickname: "Civic", make: null, model: null, year: null, odometer_km: 80_000, created_at: "", updated_at: "" },
          tasks: [
            {
              id: 9, vehicle_id: 1, task_type_key: "engine_oil_filter", interval_km: 8000, interval_months: 6,
              default_interval_km: 8000, default_interval_months: 6, last_service_date: "2026-01-01",
              last_service_odometer_km: 70_000, created_at: "", updated_at: "", status: "overdue",
              km_remaining: -2000, days_remaining: null, next_due_date: null, next_due_odometer_km: 78_000,
            },
          ],
        },
        get_accounts: [
          { id: 1, name: "Chequing", institution: "Bank", account_type: "chequing", currency: "CAD", balance_cents: 320_000, created_at: daysAgo(90), updated_at: daysAgo(45) },
        ],
        get_latest_expense: { id: 1, merchant: "Cafe", amount_cents: 500, budget_category_id: 1, date: daysAgo(2).slice(0, 10), source: "manual", created_at: daysAgo(2) },
        get_financial_health_summary: {
          data_sufficient: true, emergency_fund: null, savings: null,
          waterfall: { current_step: "build_emergency_fund", action_line_key: "build_emergency_fund" },
        },
        get_current_net_worth: { total_cents: 4_410_000, cash_cents: 0, investments_cents: 0, assets_cents: 0, liabilities_cents: 0 },
        get_recent_net_worth_snapshots: [
          { total_cents: 4_100_000, snapshot_date: "2026-08-01" },
          { total_cents: 4_410_000, snapshot_date: "2026-10-01" },
        ],
        get_budget_summary: { total_target_cents: 80_000, total_spent_cents: 89_600, remaining_cents: -9_600, month: "", average_monthly_income_cents: 0, income_month_count: 0 },
        get_income_total: { total_cents: 500_000, month: "" },
      };

      w.__TAURI_INTERNALS__ = {
        invoke: (cmd: string, args: Record<string, unknown> = {}) => {
          if (cmd.startsWith("plugin:")) return Promise.resolve(null);
          calls.push({ cmd, args });
          if (overview && cmd in OVERVIEW) return Promise.resolve(OVERVIEW[cmd]);

          switch (cmd) {
            case "check_picker_gate":
              return Promise.resolve({ needs_picker: false });
            case "get_ai_config":
              return Promise.resolve(
                byoConfigured
                  ? { provider: "openai", configured: true, region: "" }
                  : { provider: null, configured: false, region: "" }
              );
            case "get_home_composer_access":
              return Promise.resolve(currentAccess);
            case "get_home_surface":
              return Promise.resolve(
                load().map((widget, index) => ({
                  id: widget.id,
                  position: index + 1,
                  title: widget.spec.title,
                  root: render(widget.spec),
                }))
              );
            case "send_home_composer_message": {
              const next = replies.shift();
              if (next === undefined) {
                return Promise.reject({ type: "hosted_ai", code: "hosted_unavailable", message: "down", recoverable: true });
              }
              if ((next as { error?: unknown }).error) {
                return Promise.reject((next as { error: unknown }).error);
              }
              return new Promise((resolve) =>
                setTimeout(() => resolve({ conversation_id: 7, candidates: [], ...(next as object) }), 150)
              );
            }
            case "execute_chat_action": {
              const params = args.params as Record<string, unknown>;
              const widgets = load();
              if (params.op === "add") {
                widgets.push({ id: `w_${widgets.length + 1}`, spec: params.widget as Record<string, unknown> });
              } else if (params.op === "remove") {
                save(widgets.filter((widget) => widget.id !== params.widget_id));
                return Promise.resolve({ success: true, message: "Done." });
              } else if (params.op === "modify") {
                const target = widgets.find((widget) => widget.id === params.widget_id);
                if (target) target.spec = params.widget as Record<string, unknown>;
              }
              save(widgets);
              return Promise.resolve({ success: true, message: "Done." });
            }
            case "record_chat_action_cancelled":
              return Promise.resolve(null);
            // A list read answers a list, as the real command does for an empty profile.
            case "get_vehicles":
            case "get_accounts":
            case "get_budget_status":
              return Promise.resolve([]);
            case "sync_status":
              return Promise.resolve({
                state: "unlinked",
                dataset_id: "default",
                enabled: false,
                paused: false,
                last_sync_ms: null,
                error_code: null,
                recoverable: true,
                prompt: null,
              });
            default:
              return Promise.resolve(null);
          }
        },
        transformCallback: () => 1,
        unregisterCallback: () => {},
        convertFileSrc: (path: string) => path,
      };
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    },
    {
      access: options.access ?? "available",
      byoConfigured: options.byoConfigured ?? false,
      overview: options.overview ?? false,
    }
  );
}

const queueReply = (page: Page, reply: unknown) =>
  page.evaluate((r) => ((window as unknown as MockWindow).__HOME_QUEUE_REPLY__ as (v: unknown) => void)(r), reply);

const callsTo = (page: Page, cmd: string) =>
  page.evaluate(
    (c) =>
      ((window as unknown as MockWindow).__HOME_CALLS__ as { cmd: string; args: Record<string, unknown> }[]).filter(
        (call) => call.cmd === c
      ),
    cmd
  );

const seedWidgets = (page: Page, widgets: { id: string; spec: unknown }[]) =>
  page.addInitScript((w) => {
    if (localStorage.getItem("__home_mock_widgets__") === null) {
      localStorage.setItem("__home_mock_widgets__", JSON.stringify(w));
    }
  }, widgets);

/** An assistant turn by its visible text; the bubble's sr-only live region repeats it. */
const assistantSays = (page: Page, text: string | RegExp) =>
  page.getByTestId("home-composer-transcript").locator("p:not([data-testid=chat-live-region])").filter({ hasText: text });

/** Chat mode: opens the docked composer panel if the page is in view mode. */
async function openComposer(page: Page) {
  const toggle = page.getByTestId("home-composer-toggle");
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await expect(page.getByTestId("home-composer-panel")).toBeVisible();
}

async function ask(page: Page, text: string) {
  await openComposer(page);
  await page.getByTestId("home-composer-input").fill(text);
  await page.getByTestId("home-composer-send").click();
}

test.describe("Home dashboard — navigation (FR-10)", () => {
  test.beforeEach(async ({ page }) => {
    await setupHomeMock(page);
  });

  test("Home is a rail item above Finance and opens /home", async ({ page }) => {
    await page.goto("/");
    const rail = page.locator('nav[aria-label="Module navigation"]').getByRole("link");
    await expect(rail.first()).toHaveAccessibleName("Home");
    await expect(rail.nth(1)).toHaveAccessibleName("Finance");

    await expect(page.getByTestId("rail-home").locator("svg")).toHaveClass(/lucide-house/);

    await page.getByTestId("rail-home").click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(page.getByTestId("home-greeting").getByRole("heading", { level: 1 })).toHaveText(/^Good (morning|afternoon|evening)\.$/);
    // Home owns no Finance destination strip.
    await expect(page.locator('nav[aria-label="Finance navigation"]')).toHaveCount(0);
  });

  test("the Finance dashboard is unchanged at /", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("http://localhost:1420/");
    const nav = page.locator('nav[aria-label="Finance navigation"]');
    await expect(nav.getByRole("link", { name: "Today", exact: true })).toBeVisible();
  });

  /* Home is the landing surface, so it carries the onboarding gate `/` has: a profile that still
   * needs setup reaches the wizard first, wherever it lands. */
  test("a profile that needs onboarding is sent from Home to the wizard", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      const original = w.__TAURI_INTERNALS__ as { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
      const wrapped = { ...original };
      wrapped.invoke = (cmd: string, args?: unknown) =>
        cmd === "check_onboarding_status"
          ? Promise.resolve({ needs_onboarding: true })
          : original.invoke(cmd, args);
      w.__TAURI_INTERNALS__ = wrapped;
    });
    await page.goto("/home");
    await expect(page).toHaveURL(/\/onboarding$/);
  });
});

test.describe("Home dashboard — premium composer loop (FR-4..FR-9)", () => {
  test.beforeEach(async ({ page }) => {
    await setupHomeMock(page);
    await page.goto("/home");
  });

  test("ask, confirm, reopen, refine, remove by description", async ({ page }) => {
    await expect(page.getByTestId("home-empty")).toBeVisible();

    // UJ-1: ask -> a confirmation card naming what will be added; nothing persists yet.
    await queueReply(page, {
      outcome: "proposal",
      content: proposal({ op: "add", widget: NET_WORTH_WIDGET }, "Add widget: Net Worth"),
    });
    await ask(page, "show me my net worth growth month over month");
    await expect(page.getByTestId("thinking-indicator")).toBeVisible();
    const card = page.getByTestId("action-confirmation-card");
    await expect(card).toContainText("Add “Net Worth, Month over Month” to Home");
    await expect(card).toContainText("Line chart");
    await expect(card).toContainText("Net worth history");
    await expect(page.getByTestId("home-widget")).toHaveCount(0);

    await card.getByTestId("action-confirm-button").click();
    await expect(assistantSays(page, "“Net Worth, Month over Month” is on your Home dashboard.")).toBeVisible();
    // A settled card collapses to one line: no dead buttons left in the transcript.
    await expect(page.getByTestId("action-confirmation-card")).toHaveCount(0);
    await expect(page.getByTestId("action-confirmation-collapsed")).toContainText("Add “Net Worth, Month over Month” to Home");
    const widget = page.getByTestId("home-widget");
    await expect(widget).toHaveCount(1);
    await expect(widget.getByTestId("home-chart-LineChart")).toBeVisible();

    const executed = await callsTo(page, "execute_chat_action");
    expect(executed).toHaveLength(1);
    expect(executed[0].args.action_type).toBe("propose_home_surface_change");
    expect(executed[0].args.conversation_id).toBe(7);

    // UJ-2: reopening shows the same widget with no AI call.
    await page.reload();
    await expect(page.getByTestId("home-widget")).toHaveCount(1);
    await expect(page.getByTestId("home-widget")).toContainText("Net Worth, Month over Month");
    expect(await callsTo(page, "send_home_composer_message")).toHaveLength(0);

    // UJ-3: add a second widget; the first is untouched.
    await queueReply(page, {
      outcome: "proposal",
      content: proposal({ op: "add", widget: CATEGORIES_WIDGET }, "Add widget"),
    });
    await ask(page, "also show my top spending categories this month");
    await page.getByTestId("action-confirm-button").click();
    await expect(page.getByTestId("home-widget")).toHaveCount(2);
    await expect(page.getByTestId("home-chart-PieChart")).toBeVisible();
    await expect(page.getByTestId("home-widget").first()).toContainText("Net Worth, Month over Month");

    // Remove the first by description: a card naming the matched widget, then it is gone.
    await queueReply(page, {
      outcome: "proposal",
      content: proposal({ op: "remove", widget_id: "w_1", title: NET_WORTH_WIDGET.title }, "Remove widget"),
    });
    await ask(page, "remove the net worth one");
    const removal = page.getByTestId("action-confirmation-card").last();
    await expect(removal).toContainText("Remove “Net Worth, Month over Month” from Home");
    await expect(removal.getByTestId("action-confirm-button")).toHaveText("Remove");
    await removal.getByTestId("action-confirm-button").click();
    await expect(page.getByTestId("home-widget")).toHaveCount(1);
    await expect(page.getByTestId("home-widget")).toContainText("Top Spending Categories This Month");
  });

  test("an ambiguous removal asks by title and proposes nothing", async ({ page }) => {
    await queueReply(page, {
      outcome: "ambiguous",
      content: "More than one widget matches.",
      candidates: ["Spending by Month", "Spending by Category"],
    });
    await ask(page, "remove the spending one");
    await expect(
      assistantSays(page, "More than one widget matches. Which one do you mean: Spending by Month, Spending by Category?")
    ).toBeVisible();
    await expect(page.getByTestId("action-confirmation-card")).toHaveCount(0);
  });

  test("a cancelled card persists nothing and records the cancellation", async ({ page }) => {
    await queueReply(page, {
      outcome: "proposal",
      content: proposal({ op: "add", widget: NET_WORTH_WIDGET }, "Add widget"),
    });
    await ask(page, "net worth");
    await page.getByTestId("action-cancel-button").click();
    await expect(assistantSays(page, "Cancelled. Nothing was changed.")).toBeVisible();
    await expect(page.getByTestId("action-confirmation-collapsed")).toHaveAttribute("data-outcome", "cancelled");
    await expect(page.getByTestId("action-confirm-button")).toHaveCount(0);
    expect(await callsTo(page, "execute_chat_action")).toHaveLength(0);
    expect(await callsTo(page, "record_chat_action_cancelled")).toHaveLength(1);
    await expect(page.getByTestId("home-widget")).toHaveCount(0);
  });
});

test.describe("Home dashboard — failures leave the surface intact (FR-5, FR-7)", () => {
  test.beforeEach(async ({ page }) => {
    await seedWidgets(page, [{ id: "w_1", spec: NET_WORTH_WIDGET }]);
  });

  test("exhausted retries show a plain failure and keep existing widgets", async ({ page }) => {
    await setupHomeMock(page);
    await page.goto("/home");
    await queueReply(page, { outcome: "failed", content: "I couldn't build that one." });
    await ask(page, "something odd");
    await expect(assistantSays(page, /I couldn't build that one\. Nothing on your Home dashboard was changed/)).toBeVisible();
    await expect(page.getByTestId("home-widget")).toHaveCount(1);
  });

  test("a transient hosted error is retryable and keeps the surface rendered", async ({ page }) => {
    await setupHomeMock(page);
    await page.goto("/home");
    await queueReply(page, {
      error: { type: "hosted_ai", code: "hosted_unavailable", message: "down", recoverable: true },
    });
    await ask(page, "net worth");
    const error = page.getByTestId("home-composer-error");
    await expect(error).toContainText("You can try again");
    await expect(page.getByTestId("home-widget")).toHaveCount(1);
    await expect(page.getByTestId("home-composer-input")).toBeEnabled();
  });

  test("hosted AI unavailable on open: widgets render live, composer shows transient copy", async ({ page }) => {
    await setupHomeMock(page, { access: "unavailable" });
    await page.goto("/home");
    await expect(page.getByTestId("home-widget")).toHaveCount(1);
    await openComposer(page);
    await expect(page.getByTestId("home-chart-LineChart")).toBeVisible();
    const notice = page.getByTestId("home-composer-unavailable");
    await expect(notice).toContainText("temporarily unavailable");
    await expect(notice).not.toContainText("premium");
    await expect(page.getByTestId("home-composer-locked")).toHaveCount(0);
  });
});

test.describe("Home dashboard — premium gating (FR-11)", () => {
  test.beforeEach(async ({ page }) => {
    await seedWidgets(page, [{ id: "w_1", spec: NET_WORTH_WIDGET }]);
  });

  test("a non-premium account with a configured BYO provider gets the locked composer", async ({ page }) => {
    await setupHomeMock(page, { access: "not_premium", byoConfigured: true });
    await page.goto("/home");
    await openComposer(page);

    const locked = page.getByTestId("home-composer-locked");
    await expect(locked).toContainText("Requires Nixus Cloud premium");
    await expect(page.getByTestId("home-composer-input")).toBeDisabled();
    // Already-built widgets still render with live data.
    await expect(page.getByTestId("home-widget")).toHaveCount(1);
    await expect(page.getByTestId("home-chart-LineChart")).toBeVisible();
    expect(await callsTo(page, "send_home_composer_message")).toHaveLength(0);
  });

  test("a local profile gets the locked composer even beside a premium account session", async ({ page }) => {
    await setupHomeMock(page, { access: "local_profile", overview: true });
    await page.goto("/home");

    await expect(page.getByTestId("home-ask-input")).toBeDisabled();
    await expect(page.getByTestId("home-ask-hint")).toContainText("Nixus Cloud profile");
    // No example asks to click, and no "build your first widget" nudge.
    await expect(page.getByTestId("home-widgets").getByRole("button", { name: /net worth growth/ })).toHaveCount(0);
    await expect(page.getByTestId("home-recommended-title")).not.toHaveText("Build your first AI widget");

    await openComposer(page);
    const locked = page.getByTestId("home-composer-locked");
    await expect(locked).toHaveAttribute("data-state", "local_profile");
    await expect(locked).toContainText("Available on your Nixus Cloud profile");
    await expect(page.getByTestId("home-composer-input")).toBeDisabled();
    expect(await callsTo(page, "send_home_composer_message")).toHaveLength(0);
  });

  test("an exhausted period locks with its own reason", async ({ page }) => {
    await setupHomeMock(page, { access: "quota_exhausted" });
    await page.goto("/home");
    await openComposer(page);
    const locked = page.getByTestId("home-composer-locked");
    await expect(locked).toHaveAttribute("data-state", "quota_exhausted");
    await expect(locked).toContainText("AI requests are used up");
    await expect(locked).not.toContainText("Requires Nixus Cloud premium");
  });

  test("a premium-required refusal during a turn locks the composer", async ({ page }) => {
    await setupHomeMock(page);
    await page.goto("/home");
    await openComposer(page);
    await expect(page.getByTestId("home-composer-input")).toBeEnabled();
    await page.evaluate(() => ((window as unknown as MockWindow).__HOME_SET_ACCESS__ as (v: string) => void)("not_premium"));
    await queueReply(page, {
      error: { type: "hosted_ai", code: "premium_required", message: "no", recoverable: true },
    });
    await ask(page, "net worth");
    await expect(page.getByTestId("home-composer-locked")).toBeVisible();
    await expect(page.getByTestId("home-widget")).toHaveCount(1);
  });
});

test.describe("Home dashboard — chat mode and view mode", () => {
  test("Home opens in view mode; asking from the hero switches to chat mode", async ({ page }) => {
    await setupHomeMock(page);
    await page.goto("/home");
    await expect(page.getByTestId("home-composer-panel")).toHaveCount(0);
    await queueReply(page, { outcome: "message", content: "Sure — which month?" });
    await page.getByTestId("home-ask-input").fill("show my spending");
    await page.getByTestId("home-ask-send").click();
    await expect(page.getByTestId("home-composer-panel")).toBeVisible();
    await expect(page.getByTestId("home-composer-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(assistantSays(page, "Sure — which month?")).toBeVisible();
    const sent = await callsTo(page, "send_home_composer_message");
    expect(sent[0].args.message).toBe("show my spending");
  });

  test("a built dashboard opens in view mode, full width", async ({ page }) => {
    await seedWidgets(page, [{ id: "w_1", spec: NET_WORTH_WIDGET }]);
    await setupHomeMock(page);
    await page.goto("/home");
    await expect(page.getByTestId("home-widget")).toHaveCount(1);
    await expect(page.getByTestId("home-composer-panel")).toHaveCount(0);
    await expect(page.getByTestId("home-composer-toggle")).toHaveAttribute("aria-pressed", "false");
  });

  test("switching modes keeps the conversation and a pending card", async ({ page }) => {
    await setupHomeMock(page);
    await page.goto("/home");
    await queueReply(page, {
      outcome: "proposal",
      content: proposal({ op: "add", widget: NET_WORTH_WIDGET }, "Add widget"),
    });
    await ask(page, "net worth");
    await expect(page.getByTestId("action-confirmation-card")).toBeVisible();

    await page.getByTestId("home-composer-close").click();
    await expect(page.getByTestId("home-composer-panel")).toHaveCount(0);
    await expect(page.getByTestId("home-composer-toggle")).toBeFocused();

    await page.getByTestId("home-composer-toggle").click();
    await page.getByTestId("action-confirm-button").click();
    // The confirmed widget lands in the dashboard beside the still-open conversation.
    await expect(page.getByTestId("home-view").getByTestId("home-widget")).toHaveCount(1);
    await expect(page.getByTestId("home-composer-panel")).toBeVisible();
  });

  test("Escape returns to view mode, and Home always lands in view mode", async ({ page }) => {
    await setupHomeMock(page);
    await page.goto("/home");
    await openComposer(page);
    await page.getByTestId("home-composer-input").press("Escape");
    await expect(page.getByTestId("home-composer-panel")).toHaveCount(0);
    await expect(page.getByTestId("home-composer-toggle")).toBeFocused();

    // Left open, then the user comes back: Home still opens on the dashboard.
    await openComposer(page);
    await page.reload();
    await expect(page.getByTestId("home-view")).toBeVisible();
    await expect(page.getByTestId("home-composer-panel")).toHaveCount(0);
    await page.getByTestId("rail-home").click();
    await expect(page.getByTestId("home-composer-panel")).toHaveCount(0);
  });
});

test.describe("Home dashboard — pre-built sections", () => {
  test("needs attention lists what is over, due and stale, worst first", async ({ page }) => {
    await setupHomeMock(page, { overview: true });
    await page.goto("/home");

    const items = page.getByTestId("home-attention-item");
    await expect(items).toHaveCount(4);
    await expect(items.nth(0)).toContainText("Restaurants");
    await expect(items.nth(0)).toContainText("$86.00 over");
    await expect(items.nth(1)).toContainText("Civic");
    await expect(items.nth(2)).toContainText("Groceries");
    await expect(items.nth(3)).toContainText("1 account balance is over a month old");
    await expect(page.getByTestId("home-status-pill")).toHaveText("4 things need you");

    await items.nth(1).click();
    await expect(page).toHaveURL(/\/car\/garage/);
  });

  test("an empty profile is all clear and recommends getting started", async ({ page }) => {
    await setupHomeMock(page);
    await page.goto("/home");
    await expect(page.getByTestId("home-attention-clear")).toBeVisible();
    await expect(page.getByTestId("home-status-pill")).toHaveText("All clear");
    await expect(page.getByTestId("home-recommended-title")).toHaveText("Build your first AI widget");
    await page.getByTestId("home-recommended").getByRole("button", { name: "Ask Nixus" }).click();
    await expect(page.getByTestId("home-composer-panel")).toBeVisible();
  });

  test("recommendations page one at a time", async ({ page }) => {
    await setupHomeMock(page, { overview: true });
    await page.goto("/home");
    const title = page.getByTestId("home-recommended-title");
    await expect(title).toHaveText("Build your emergency fund");
    await page.getByTestId("home-recommended-next").click();
    await expect(title).toHaveText("Build your first AI widget");
    await page.getByTestId("home-recommended-next").click();
    await expect(title).toHaveText("Give 1 category a monthly target");
  });

  test("at a glance shows each module's state and opens it", async ({ page }) => {
    await setupHomeMock(page, { overview: true });
    await page.goto("/home");
    await expect(page.getByTestId("home-glance-net-worth")).toContainText("$44,100.00");
    await expect(page.getByTestId("home-glance-net-worth")).toContainText("+$3,100.00");
    await expect(page.getByTestId("home-glance-spending")).toContainText("$96.00 over budget");
    await expect(page.getByTestId("home-glance-cash-flow")).toContainText("$4,104.00");
    await expect(page.getByTestId("home-glance-car")).toContainText("1 task due");
    await page.getByTestId("home-glance-spending").click();
    await expect(page).toHaveURL(/\/spending\/budget$/);
  });

  test("hidden values mask every pre-built figure", async ({ page }) => {
    await setupHomeMock(page, { overview: true });
    await page.goto("/home");
    await expect(page.getByTestId("home-glance-net-worth")).toContainText("$44,100.00");
    await page.getByTestId("toggle-values-button").click();
    for (const testId of ["home-glance-net-worth", "home-glance-spending", "home-glance-cash-flow", "home-attention"]) {
      for (const figure of ["44,100", "3,100", "896", "86.00", "4,104"]) {
        await expect(page.getByTestId(testId)).not.toContainText(figure);
      }
    }
  });

  test("the empty prompt types out example asks in turn", async ({ page }) => {
    await setupHomeMock(page);
    await page.goto("/home");
    const input = page.getByTestId("home-ask-input");
    // Mid-word at some point: the text is being written, not swapped.
    await expect
      .poll(async () => (await input.getAttribute("placeholder"))?.length ?? 0, { timeout: 4000 })
      .toBeGreaterThan(0);
    await expect
      .poll(async () => input.getAttribute("placeholder"), { timeout: 15_000 })
      .toBe("Show my net worth growth month over month");
    await expect(page.getByTestId("home-ask-hero").getByRole("button", { name: /net worth growth/ })).toHaveCount(0);
  });

  test("focusing the prompt rests the placeholder on the invitation", async ({ page }) => {
    await setupHomeMock(page);
    await page.goto("/home");
    const input = page.getByTestId("home-ask-input");
    await input.focus();
    await expect(input).toHaveAttribute("placeholder", "Ask Nixus to build a view of your finances…");
  });

  test("reduced motion shows the invitation without animating", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupHomeMock(page);
    await page.goto("/home");
    const input = page.getByTestId("home-ask-input");
    await expect(input).toHaveAttribute("placeholder", "Ask Nixus to build a view of your finances…");
    await page.waitForTimeout(800);
    await expect(input).toHaveAttribute("placeholder", "Ask Nixus to build a view of your finances…");
  });

  test("a non-premium hero says why and the rest of Home stays live", async ({ page }) => {
    await setupHomeMock(page, { access: "not_premium", overview: true });
    await page.goto("/home");
    await expect(page.getByTestId("home-ask-input")).toBeDisabled();
    await expect(page.getByTestId("home-ask-hint")).toContainText("Nixus Cloud premium");
    await expect(page.getByTestId("home-attention-item")).toHaveCount(4);
    await expect(page.getByTestId("home-recommended-title")).not.toHaveText("Build your first AI widget");
  });

  test("quick actions go straight to the upkeep screens", async ({ page }) => {
    await setupHomeMock(page);
    await page.goto("/home");
    const quick = page.getByTestId("home-quick-actions");
    await expect(quick.getByRole("link")).toHaveCount(4);
    await quick.getByRole("link", { name: "Ask Budget Helper" }).click();
    await expect(page).toHaveURL(/\/ai\/budget-helper$/);
  });
});

test.describe("Home dashboard — catalog rendering (FR-1, FR-2)", () => {
  test("a table of recent expenses lists each one with its date and category", async ({ page }) => {
    await seedWidgets(page, [
      {
        id: "w_1",
        spec: {
          component: "Table",
          title: "Last 10 Expenses",
          dataBinding: { source: "recent_expenses", params: { limit: 10 } },
        },
      },
    ]);
    await setupHomeMock(page);
    await page.goto("/home");

    const table = page.getByTestId("home-table");
    await expect(table.locator("thead th")).toHaveText(["Date", "Merchant", "Category", "Amount"]);
    const first = table.locator("tbody tr").first();
    await expect(first.locator("td")).toHaveText(["Oct 30, 2026", "Corner Cafe", "Restaurants", "$12.50"]);
    await expect(table.locator("tbody tr")).toHaveCount(2);
  });

  test("nested layout primitives render in their arrangement", async ({ page }) => {
    await seedWidgets(page, [
      {
        id: "w_1",
        spec: {
          component: "Card",
          title: "Cash at a Glance",
          children: [
            {
              component: "Row",
              children: [
                { component: "Metric", dataBinding: { source: "expenses_by_month", params: { months: 2 } } },
                {
                  component: "Grid",
                  columns: 2,
                  children: [
                    { component: "BarChart", dataBinding: { source: "account_balances", params: {} } },
                    { component: "Table", dataBinding: { source: "expenses_by_category", params: {} } },
                  ],
                },
              ],
            },
          ],
        },
      },
    ]);
    await setupHomeMock(page);
    await page.goto("/home");

    const widget = page.getByTestId("home-widget");
    await expect(widget).toContainText("Cash at a Glance");
    const row = widget.getByTestId("home-layout-Row");
    await expect(row.getByTestId("home-metric")).toBeVisible();
    await expect(row.getByTestId("home-layout-Grid").getByTestId("home-chart-BarChart")).toBeVisible();
    await expect(row.getByTestId("home-layout-Grid").getByTestId("home-table")).toContainText("Groceries");
    await expect(row.getByTestId("home-table")).toContainText("Other");
  });
});
