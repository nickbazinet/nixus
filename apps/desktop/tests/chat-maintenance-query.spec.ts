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

    let nextResponseType:
      | "query"
      | "maintenance_status"
      | "maintenance_history"
      | "tool_call"
      = "query";
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
            if (nextResponseType === "maintenance_status") {
              const toolCallJson =
                "```tool_call\n" +
                JSON.stringify({
                  tool: "query_maintenance_status",
                  params: { vehicle_id: 1, status_filter: "due" },
                }) +
                "\n```";

              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: toolCallJson, done: false });
              }, 50);
              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: "", done: true });
              }, 100);
              setTimeout(() => {
                emitEvent("chat:tool-executing", "query_maintenance_status");
              }, 200);

              const finalResponse =
                "Your Civic oil change (`engine_oil_filter`) is **due** now.\n\n" +
                "| Vehicle | Task | Status | Next Due Date | Next Due Km | Km Remaining | Days Remaining |\n" +
                "|---------|------|--------|---------------|-------------|--------------|----------------|\n" +
                "| Civic | engine_oil_filter | due | - | 8000 | 0 | - |\n";

              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: finalResponse, done: false });
              }, 800);
              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: "", done: true });
              }, 850);
            } else if (nextResponseType === "maintenance_history") {
              const toolCallJson =
                "```tool_call\n" +
                JSON.stringify({
                  tool: "query_maintenance_history",
                  params: { vehicle_id: 1, task_type_key: "engine_oil_filter" },
                }) +
                "\n```";

              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: toolCallJson, done: false });
              }, 50);
              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: "", done: true });
              }, 100);
              setTimeout(() => {
                emitEvent("chat:tool-executing", "query_maintenance_history");
              }, 200);

              const finalResponse =
                "Your last oil change on the Civic was on 2026-01-15 at 45,000 km.\n\n" +
                "| Date | Task | Odometer (km) | Notes |\n" +
                "|------|------|---------------|-------|\n" +
                "| 2026-01-15 | engine_oil_filter | 45000 | Synthetic oil |\n";

              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: finalResponse, done: false });
              }, 800);
              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: "", done: true });
              }, 850);
            } else if (nextResponseType === "tool_call") {
              const toolCallJson =
                "```tool_call\n" +
                JSON.stringify({
                  tool: "query_expenses",
                  params: { limit: 1, sort: "date_desc" },
                }) +
                "\n```";

              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: toolCallJson, done: false });
              }, 50);
              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: "", done: true });
              }, 100);
              setTimeout(() => {
                emitEvent("chat:tool-executing", "query_expenses");
              }, 200);

              const finalResponse =
                "You spent `$125.50` on dining out this month across 5 transactions.";

              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: finalResponse, done: false });
              }, 800);
              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: "", done: true });
              }, 850);
            } else {
              const response = "Your budget remaining is `$500.00` this month.";
              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: response, done: false });
              }, 50);
              setTimeout(() => {
                emitEvent("chat:response-chunk", { chunk: "", done: true });
              }, 100);
            }

            return Promise.resolve({ conversation_id: 1, user_message_id: 1 });
          }

          case "get_db_status":
            return Promise.resolve({
              db_path: "mock.db",
              wal_mode: true,
              schema_version: 18,
              migrations_applied: 18,
            });

          case "list_conversations":
            return Promise.resolve([]);

          case "get_chat_messages":
            return Promise.resolve([]);

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

test.describe("AI Chat Maintenance Query Tools", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/ai/budget-helper");
  });

  test("query_maintenance_status tool_call shows searching indicator then final answer", async ({
    page,
  }) => {
    await page.evaluate(() => {
      (
        (window as unknown as Record<string, unknown>).__MOCK_SET_RESPONSE__ as (
          t: string,
        ) => void
      )("maintenance_status");
    });

    await page.getByTestId("chat-input").fill("When is my Civic due for an oil change?");
    await page.getByTestId("chat-input").press("Enter");

    await expect(page.getByTestId("tool-searching-indicator")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("tool-searching-indicator")).toContainText(
      "Searching your expenses",
    );

    const aiMsg = page.getByTestId("chat-message-assistant");
    await expect(aiMsg).toContainText("engine_oil_filter", { timeout: 5000 });
    await expect(aiMsg).toContainText("due", { timeout: 5000 });
    await expect(aiMsg).toContainText("Civic", { timeout: 5000 });
  });

  test("query_maintenance_history tool_call flow works", async ({ page }) => {
    await page.evaluate(() => {
      (
        (window as unknown as Record<string, unknown>).__MOCK_SET_RESPONSE__ as (
          t: string,
        ) => void
      )("maintenance_history");
    });

    await page.getByTestId("chat-input").fill("When did I last change the oil on my Civic?");
    await page.getByTestId("chat-input").press("Enter");

    await expect(page.getByTestId("tool-searching-indicator")).toBeVisible({ timeout: 5000 });

    const aiMsg = page.getByTestId("chat-message-assistant");
    await expect(aiMsg).toContainText("2026-01-15", { timeout: 5000 });
    await expect(aiMsg).toContainText("engine_oil_filter", { timeout: 5000 });
    await expect(page.getByTestId("chat-table").first()).toBeVisible({ timeout: 5000 });
  });

  test("non-maintenance question does not trigger maintenance tool", async ({ page }) => {
    await page.evaluate(() => {
      (
        (window as unknown as Record<string, unknown>).__MOCK_SET_RESPONSE__ as (
          t: string,
        ) => void
      )("query");
    });

    await page.getByTestId("chat-input").fill("What's my budget status?");
    await page.getByTestId("chat-input").press("Enter");

    const aiMsg = page.getByTestId("chat-message-assistant");
    await expect(aiMsg).toContainText("$500.00", { timeout: 5000 });
    await expect(page.getByTestId("tool-searching-indicator")).not.toBeVisible();
    await expect(aiMsg).not.toContainText("engine_oil_filter");
  });
});
