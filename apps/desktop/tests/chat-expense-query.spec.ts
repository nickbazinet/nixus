import { test, expect, type Page } from "@playwright/test";

async function setupTauriMock(page: Page) {
  await page.addInitScript(() => {
    type EventCallback = (event: { event: string; payload: unknown; id: number }) => void;
    const eventListeners: Record<string, EventCallback[]> = {};
    const callbacks: Record<number, EventCallback> = {};
    let nextCallbackId = 1;

    function emitEvent(event: string, payload: unknown) {
      const cbs = eventListeners[event] ?? [];
      for (const cb of cbs) cb({ event, payload, id: Math.random() });
    }

    // Control mock response type
    let nextResponseType: "query" | "action" | "tool_call" | "tool_call_no_results" = "query";
    (window as unknown as Record<string, unknown>).__MOCK_SET_RESPONSE__ = (type: string) => {
      nextResponseType = type as typeof nextResponseType;
    };

    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "plugin:event|listen") {
          const event = args.event as string;
          const handlerId = args.handler as number;
          if (!eventListeners[event]) eventListeners[event] = [];
          const cb = callbacks[handlerId];
          if (cb) eventListeners[event].push(cb);
          return Promise.resolve(handlerId);
        }
        if (cmd === "plugin:event|unlisten") return Promise.resolve(null);

        switch (cmd) {
          case "send_chat_message": {
            if (nextResponseType === "tool_call") {
              // Simulate tool call flow:
              // 1. Stream tool_call block
              const toolCallJson = '```tool_call\n' + JSON.stringify({
                tool: "query_expenses",
                params: { limit: 1, sort: "date_desc" },
              }) + '\n```';

              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: toolCallJson, done: false });
              }, 50);
              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: "", done: true });
              }, 100);

              // 2. Emit tool-executing event
              setTimeout(() => {
                emitEvent("chat:tool-executing", "query_expenses");
              }, 200);

              // 3. Stream final answer with table
              const finalResponse =
                'Your most recent expense was `$45.00` at Costco on 2026-03-20 in the Groceries category.\n\n' +
                '| Date | Merchant | Amount | Category |\n' +
                '|------|----------|--------|----------|\n' +
                '| 2026-03-20 | Costco | $45.00 | Groceries |\n';

              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: finalResponse, done: false });
              }, 800);
              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: "", done: true });
              }, 850);
            } else if (nextResponseType === "tool_call_no_results") {
              const toolCallJson = '```tool_call\n' + JSON.stringify({
                tool: "query_expenses",
                params: { merchant: "Target" },
              }) + '\n```';

              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: toolCallJson, done: false });
              }, 30);
              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: "", done: true });
              }, 60);
              setTimeout(() => {
                emitEvent("chat:tool-executing", "query_expenses");
              }, 90);

              const finalResponse = "No expenses found matching your query for Target.";
              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: finalResponse, done: false });
              }, 120);
              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: "", done: true });
              }, 150);
            } else if (nextResponseType === "action") {
              const response = '```action\n' + JSON.stringify({
                action: true,
                action_type: "create_expense",
                display: {
                  label: "Add Expense",
                  details: [
                    { field: "Merchant", value: "Costco" },
                    { field: "Amount", value: "$45.00" },
                  ],
                },
                params: { merchant: "Costco", amount_cents: 4500, budget_category_id: 3, date: "2026-03-15" },
              }) + '\n```';

              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: response, done: false });
              }, 50);
              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: "", done: true });
              }, 100);
            } else {
              const response = "You spent `$125.50` on dining out this month across 5 transactions.";
              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: response, done: false });
              }, 50);
              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: "", done: true });
              }, 100);
            }

            return Promise.resolve({ conversation_id: 1, user_message_id: 1 });
          }

          case "execute_chat_action":
            return Promise.resolve({ success: true, message: "Done. $45.00 expense added for Costco." });

          case "get_db_status":
            return Promise.resolve({ db_path: "mock.db", wal_mode: true, schema_version: 9, migrations_applied: 9 });

          default:
            return Promise.resolve(null);
        }
      },
      transformCallback: (callback: EventCallback) => {
        const id = nextCallbackId++;
        callbacks[id] = callback;
        return id;
      },
      unregisterCallback: () => {},
      convertFileSrc: (path: string) => path,
    };
  });
}

test.describe("AI Chat Expense Query Tool", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/chat");
  });

  test("tool_call block shows searching indicator then final answer", async ({ page }) => {
    await page.evaluate(() => {
      ((window as unknown as Record<string, unknown>).__MOCK_SET_RESPONSE__ as (t: string) => void)("tool_call");
    });

    await page.getByTestId("chat-input").fill("When was my last expense?");
    await page.getByTestId("chat-input").press("Enter");

    // Should show the searching indicator
    await expect(page.getByTestId("tool-searching-indicator")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("tool-searching-indicator")).toContainText("Searching your expenses");

    // Should eventually show the final answer with expense data
    const aiMsg = page.getByTestId("chat-message-assistant");
    await expect(aiMsg).toContainText("$45.00", { timeout: 5000 });
    await expect(aiMsg).toContainText("Costco", { timeout: 5000 });
    await expect(aiMsg).toContainText("2026-03-20", { timeout: 5000 });
  });

  test("tool results render as a table", async ({ page }) => {
    await page.evaluate(() => {
      ((window as unknown as Record<string, unknown>).__MOCK_SET_RESPONSE__ as (t: string) => void)("tool_call");
    });

    await page.getByTestId("chat-input").fill("Show me my last expense");
    await page.getByTestId("chat-input").press("Enter");

    // Wait for final answer — use first() since trailing newlines may produce empty table matches
    await expect(page.getByTestId("chat-table").first()).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("chat-table").first()).toContainText("Costco");
    await expect(page.getByTestId("chat-table").first()).toContainText("$45.00");
  });

  test("no results query shows appropriate message", async ({ page }) => {
    await page.evaluate(() => {
      ((window as unknown as Record<string, unknown>).__MOCK_SET_RESPONSE__ as (t: string) => void)("tool_call_no_results");
    });

    await page.getByTestId("chat-input").fill("Show me expenses at Target");
    await page.getByTestId("chat-input").press("Enter");

    const aiMsg = page.getByTestId("chat-message-assistant");
    await expect(aiMsg).toContainText("No expenses found", { timeout: 5000 });
  });

  test("non-tool-call messages still work normally", async ({ page }) => {
    // Default mock returns a plain query response
    await page.getByTestId("chat-input").fill("What's my budget status?");
    await page.getByTestId("chat-input").press("Enter");

    const aiMsg = page.getByTestId("chat-message-assistant");
    await expect(aiMsg).toContainText("$125.50", { timeout: 5000 });
    // Should not show searching indicator
    await expect(page.getByTestId("tool-searching-indicator")).not.toBeVisible();
  });

  test("action blocks still work with tool call support", async ({ page }) => {
    await page.evaluate(() => {
      ((window as unknown as Record<string, unknown>).__MOCK_SET_RESPONSE__ as (t: string) => void)("action");
    });

    await page.getByTestId("chat-input").fill("Add $45 expense at Costco");
    await page.getByTestId("chat-input").press("Enter");

    await expect(page.getByTestId("action-confirmation-card")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("action-confirmation-card")).toContainText("Add Expense");
  });
});
