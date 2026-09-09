import { test, expect, type Page } from "@playwright/test";

const AGENT_NAME = "Budget Helper";
const AGENT_PATH = "/ai/budget-helper";

type MockWindow = Record<string, unknown>;

function mockApi(page: Page) {
  return {
    setResponse: (type: string) =>
      page.evaluate(
        (t) =>
          ((window as unknown as MockWindow).__MOCK_SET_RESPONSE__ as (v: string) => void)(t),
        type
      ),
    emitChunk: (chunk: string, done = false) =>
      page.evaluate(
        ([c, d]) =>
          (
            (window as unknown as MockWindow).__MOCK_EMIT_CHUNK__ as (
              a: string,
              b: boolean
            ) => void
          )(c as string, d as boolean),
        [chunk, done] as const
      ),
    executedActions: () =>
      page.evaluate(
        () => (window as unknown as MockWindow).__MOCK_EXECUTED_ACTIONS__ as string[]
      ),
    cancelledActions: () =>
      page.evaluate(
        () =>
          (window as unknown as MockWindow).__MOCK_CANCELLED_ACTIONS__ as {
            conversation_id: number;
            action_type: string;
          }[]
      ),
    executedActionParams: () =>
      page.evaluate(
        () =>
          (window as unknown as MockWindow).__MOCK_EXECUTED_ACTION_PARAMS__ as Record<
            string,
            unknown
          >[]
      ),
    setPickedFile: (path: string | null) =>
      page.evaluate(
        (p) =>
          ((window as unknown as MockWindow).__MOCK_SET_PICKED_FILE__ as (
            v: string | null
          ) => void)(p),
        path
      ),
    setAttachmentRejection: (field: string | null) =>
      page.evaluate(
        (f) =>
          ((window as unknown as MockWindow).__MOCK_SET_ATTACHMENT_REJECTION__ as (
            v: string | null
          ) => void)(f),
        field
      ),
    setSendAttachmentRejection: (field: string | null) =>
      page.evaluate(
        (f) =>
          ((
            window as unknown as MockWindow
          ).__MOCK_SET_SEND_ATTACHMENT_REJECTION__ as (v: string | null) => void)(f),
        field
      ),
    sentAttachmentPaths: () =>
      page.evaluate(
        () =>
          (window as unknown as MockWindow).__MOCK_SENT_ATTACHMENT_PATHS__ as (
            | string
            | null
          )[]
      ),
  };
}

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
      | "action"
      | "category-action"
      | "unsupported-action"
      | "approximate"
      | "manual" = "query";
    const w = window as unknown as Record<string, unknown>;
    w.__MOCK_SET_RESPONSE__ = (type: string) => {
      nextResponseType = type as typeof nextResponseType;
    };
    // "manual" lets a test drive the stream chunk by chunk, so the sentence-boundary
    // announcer can be observed at an exact buffer state instead of racing a timer.
    w.__MOCK_EMIT_CHUNK__ = (chunk: string, done: boolean) =>
      emitEvent("chat:response-chunk", { chunk, done });
    const executedActions: string[] = [];
    w.__MOCK_EXECUTED_ACTIONS__ = executedActions;
    const executedActionParams: Record<string, unknown>[] = [];
    w.__MOCK_EXECUTED_ACTION_PARAMS__ = executedActionParams;
    const cancelledActions: { conversation_id: number; action_type: string }[] = [];
    w.__MOCK_CANCELLED_ACTIONS__ = cancelledActions;

    // The native picker returns null unless a test scripts a path, which is exactly the
    // "user cancelled the picker" state.
    let pickedFile: string | null = null;
    w.__MOCK_SET_PICKED_FILE__ = (path: string | null) => {
      pickedFile = path;
    };
    let attachmentRejection: string | null = null;
    w.__MOCK_SET_ATTACHMENT_REJECTION__ = (field: string | null) => {
      attachmentRejection = field;
    };
    /* The real boundary refuses again inside `send_chat_message`, so a file that passed the
     * pick-time check can still be rejected at send time — a different code path, and the one
     * whose refusal outlives the attempt if nothing clears it. */
    let sendAttachmentRejection: string | null = null;
    w.__MOCK_SET_SEND_ATTACHMENT_REJECTION__ = (field: string | null) => {
      sendAttachmentRejection = field;
    };
    const sentAttachmentPaths: (string | null)[] = [];
    w.__MOCK_SENT_ATTACHMENT_PATHS__ = sentAttachmentPaths;

    w.__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: Record<string, unknown>) => {
        if (cmd === "plugin:event|listen") {
          const event = args.event as string;
          const handlerId = args.handler as number;
          if (!eventListeners[event]) eventListeners[event] = [];
          const cb = callbacks[handlerId];
          if (cb) eventListeners[event].push(cb);
          return Promise.resolve(handlerId);
        }
        // Must precede the blanket plugin branch below, or every pick resolves null and
        // no attachment can ever be selected.
        if (cmd === "plugin:dialog|open") return Promise.resolve(pickedFile);
        // Every other plugin command resolves null on purpose: a truthy updater check makes
        // UpdateChecker render an always-open dialog that aria-hides the entire app.
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);

        switch (cmd) {
          case "check_picker_gate":
            return Promise.resolve({ needs_picker: false });

          case "validate_chat_attachment": {
            if (attachmentRejection !== null) {
              return Promise.reject({
                type: "validation",
                message: "refused",
                field: attachmentRejection,
              });
            }
            const path = args.file_path as string;
            return Promise.resolve({
              file_name: path.split(/[\\/]/).pop(),
              file_size: 2048,
            });
          }

          case "send_chat_message": {
            sentAttachmentPaths.push(
              (args.attachment_path as string | null) ?? null
            );

            if (sendAttachmentRejection !== null) {
              return Promise.reject({
                type: "validation",
                message: "refused",
                field: sendAttachmentRejection,
              });
            }

            if (nextResponseType === "manual") {
              return Promise.resolve({ conversation_id: 1, user_message_id: 1 });
            }

            let response: string;
            if (nextResponseType === "action") {
              response = '```action\n' + JSON.stringify({
                action: true,
                action_type: "create_expense",
                display: {
                  label: "Add Expense",
                  details: [
                    { field: "Merchant", value: "Costco" },
                    { field: "Amount", value: "$45.00" },
                    { field: "Category", value: "Groceries" },
                    { field: "Date", value: "2026-03-15" },
                  ],
                },
                params: { merchant: "Costco", amount_cents: 4500, category_name: "Groceries", date: "2026-03-15" },
              }) + '\n```';
            } else if (nextResponseType === "category-action") {
              response = 'I can add that category.\n```action\n' + JSON.stringify({
                action: true,
                action_type: "create_budget_category",
                display: {
                  label: "Add Budget Category",
                  details: [
                    { field: "Category", value: "House" },
                    { field: "Group", value: "Needs" },
                    { field: "Target", value: "$1.00" },
                  ],
                },
                params: { category_name: "House", group_name: "Needs" },
              }) + '\n```';
            } else if (nextResponseType === "unsupported-action") {
              /* Shaped exactly like a real card but for a type `ACTION_TYPES` does not contain —
               * what the model actually produced for the "House" category. */
              response = 'I can add that for you.\n```action\n' + JSON.stringify({
                action: true,
                action_type: "create_category",
                display: {
                  label: "Add Category",
                  details: [{ field: "Category", value: "House" }],
                },
                params: { category_name: "House" },
              }) + '\n```';
            } else if (nextResponseType === "approximate") {
              response = "Rent runs ~$430 and groceries ~$260 a month.";
            } else {
              // Money is plain text, never backticked: a figure must not land in a <code> run.
              response = "You spent $125.50 on dining out this month across 5 transactions.";
            }

            setTimeout(() => {
              emitEvent("chat:response-chunk", { chunk: response, done: false });
            }, 50);
            setTimeout(() => {
              emitEvent("chat:response-chunk", { chunk: "", done: true });
            }, 100);

            return Promise.resolve({ conversation_id: 1, user_message_id: 1 });
          }

          case "record_chat_action_cancelled":
            cancelledActions.push({
              conversation_id: args.conversation_id as number,
              action_type: args.action_type as string,
            });
            return Promise.resolve(null);

          case "execute_chat_action":
            executedActions.push(args.action_type as string);
            executedActionParams.push(args.params as Record<string, unknown>);
            if (args.action_type === "create_budget_category") {
              return Promise.resolve({ success: true, message: "Done. House added to Needs." });
            }
            return Promise.resolve({ success: true, message: "Done. $45.00 expense added for Costco." });

          case "list_conversations":
            return Promise.resolve([]);

          case "get_chat_messages":
            return Promise.resolve([]);

          case "get_db_status":
            return Promise.resolve({ db_path: "mock.db", wal_mode: true, schema_version: 9, migrations_applied: 9 });

          case "get_savings_projects_summary":
            return Promise.resolve({
              active_project_count: 0,
              total_saved_cents: 0,
              total_target_cents: 0,
            });
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

    // Must really detach: StrictMode mounts useChat's listener twice, and a no-op unregister
    // leaves the first one attached, so every streamed chunk lands in the buffer twice.
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (event: string, eventId: number) => {
        const cb = callbacks[eventId];
        const listeners = eventListeners[event];
        if (!cb || !listeners) return;
        const index = listeners.indexOf(cb);
        if (index !== -1) listeners.splice(index, 1);
      },
    };
  });
}

// === Story 7.1 Tests ===

test.describe("AI Chat Page — Story 7.1", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/chat");
  });

  test("legacy /chat resolves to the agent chat surface", async ({ page }) => {
    await expect(page).toHaveURL(AGENT_PATH);
  });

  test("chat page renders with message input area at the bottom [AC1]", async ({ page }) => {
    // The chat surface is titled by its agent and carries the same surface-heading contract
    // every other route gets, since the shell's skip link and route-change focus target it.
    const heading = page.getByRole("heading", { level: 1, name: AGENT_NAME, exact: true });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveAttribute("data-surface-heading", "");

    await expect(page.getByTestId("chat-input-area")).toBeVisible();
    await expect(page.getByTestId("chat-input")).toBeVisible();
    const send = page.getByTestId("chat-send-button");
    await expect(send).toBeVisible();
    // An icon-only control needs its own name; borrowing the input's placeholder announced
    // "Ask about your finances..." on the button that sends.
    await expect(send).toHaveAttribute("aria-label", "Send message");
  });

  test("the agent name is a heading and a nav link, never two of the same role [AC1]", async ({
    page,
  }) => {
    await expect(page.getByRole("heading", { name: AGENT_NAME, exact: true })).toHaveCount(1);
    await expect(page.getByRole("link", { name: AGENT_NAME, exact: true })).toHaveCount(1);
  });

  test("message container is role=log and is not itself a live region [AC2]", async ({ page }) => {
    const messageArea = page.getByTestId("chat-message-area");
    await expect(messageArea).toHaveAttribute("role", "log");
    // Deliberately not aria-live: bound to a token stream it would announce every DOM
    // mutation. Announcement is published per sentence by chat-live-region instead.
    await expect(messageArea).not.toHaveAttribute("aria-live", /.*/);
  });

  test("streamed answers are announced per sentence, never per token [AC2, AC4]", async ({
    page,
  }) => {
    const mock = mockApi(page);
    await mock.setResponse("manual");

    await page.getByTestId("chat-input").fill("How am I tracking this month?");
    await page.getByTestId("chat-input").press("Enter");

    const bubble = page.getByTestId("chat-message-assistant");
    const live = page.getByTestId("chat-live-region");
    await expect(bubble).toBeVisible();
    await expect(live).toHaveAttribute("aria-live", "polite");

    await mock.emitChunk("You spent ");
    await mock.emitChunk("$125.50 on dining");

    // Mid-sentence: on screen already, but nothing handed to assistive tech yet. The decimal
    // point in $125.50 must not read as a sentence end.
    await expect(bubble).toContainText("$125.50 on dining");
    await expect(live).toHaveText("");

    await mock.emitChunk(" out this month.");
    await expect(live).toHaveText("You spent $125.50 on dining out this month.");

    await mock.emitChunk(" Groceries led");
    await expect(live).toHaveText("You spent $125.50 on dining out this month.");

    await mock.emitChunk(" at $58.20.");
    await mock.emitChunk("", true);
    await expect(live).toHaveText("Groceries led at $58.20.");
  });

  test("typing a message and pressing Enter sends it [AC3]", async ({ page }) => {
    await page.getByTestId("chat-input").fill("How much did I spend on dining out?");
    await page.getByTestId("chat-input").press("Enter");
    await expect(page.getByTestId("chat-message-user")).toBeVisible();
    await expect(page.getByTestId("chat-message-user")).toContainText("How much did I spend on dining out?");
  });

  test("user messages appear right-aligned [AC2]", async ({ page }) => {
    await page.getByTestId("chat-input").fill("Test message");
    await page.getByTestId("chat-input").press("Enter");
    const alignment = await page
      .getByTestId("chat-message-user")
      .evaluate((el) => getComputedStyle(el).justifyContent);
    expect(alignment).toBe("flex-end");
  });

  test("AI messages appear left-aligned with streamed content [AC2, AC4]", async ({ page }) => {
    await page.getByTestId("chat-input").fill("How much did I spend?");
    await page.getByTestId("chat-input").press("Enter");
    const aiMsg = page.getByTestId("chat-message-assistant");
    await expect(aiMsg).toBeVisible({ timeout: 5000 });
    await expect(aiMsg).toContainText("$125.50", { timeout: 5000 });

    const alignment = await aiMsg.evaluate((el) => getComputedStyle(el).justifyContent);
    expect(alignment).toBe("flex-start");
  });

  test("money in an answer is tabular Inter, never monospace [AC4]", async ({ page }) => {
    await page.getByTestId("chat-input").fill("How much did I spend?");
    await page.getByTestId("chat-input").press("Enter");

    const aiMsg = page.getByTestId("chat-message-assistant");
    await expect(aiMsg).toContainText("$125.50", { timeout: 5000 });

    const figure = await aiMsg.evaluate((root) => {
      // Skip the `sr-only` aria-live region (ChatMessageBubble renders it BEFORE
      // the visible answer and duplicates the same text). It is outside the
      // `.money` wrapper, so walking into it reports font-variant-numeric
      // "normal" and fails a passing implementation. Assert on visible text only.
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          node.parentElement?.closest('.sr-only')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      });
      let node = walker.nextNode();
      while (node !== null) {
        if (node.textContent?.includes("$125.50") && node.parentElement) {
          const style = getComputedStyle(node.parentElement);
          const chain: string[] = [];
          let el: Element | null = node.parentElement;
          while (el !== null && el !== root.parentElement) {
            chain.push(
              `${el.tagName}.${el.className}=${getComputedStyle(el).fontVariantNumeric}`
            );
            el = el.parentElement;
          }
          return {
            tag: node.parentElement.tagName,
            variant: style.fontVariantNumeric,
            family: style.fontFamily.toLowerCase(),
            chain,
          };
        }
        node = walker.nextNode();
      }
      return null;
    });
    console.log("MONEY_CHAIN", JSON.stringify(figure, null, 2));

    expect(figure).not.toBeNull();
    expect(figure?.tag).toBe("P");
    expect(figure?.variant).toBe("tabular-nums");
    expect(figure?.family).not.toContain("mono");
  });

  test("approximate figures are not struck through [AC4]", async ({ page }) => {
    const mock = mockApi(page);
    await mock.setResponse("approximate");

    await page.getByTestId("chat-input").fill("Roughly what are my fixed costs?");
    await page.getByTestId("chat-input").press("Enter");

    const aiMsg = page.getByTestId("chat-message-assistant");
    await expect(aiMsg).toContainText("~$430", { timeout: 5000 });
    await expect(aiMsg).toContainText("~$260");

    // remark-gfm's singleTilde default turns a pair of "approximately" tildes into
    // strikethrough, so the assistant looks like it is crossing out dollar amounts.
    const struck = await aiMsg.evaluate((root) =>
      [...root.querySelectorAll("*")].some(
        (el) =>
          el.tagName === "DEL" ||
          el.tagName === "S" ||
          getComputedStyle(el).textDecorationLine.includes("line-through")
      )
    );
    expect(struck).toBe(false);
  });
});

// === Story 7.2 Tests ===

test.describe("AI Chat Page — Story 7.2", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/chat");
    await mockApi(page).setResponse("action");
  });

  test("action confirmation card renders with action details [AC1]", async ({ page }) => {
    await page.getByTestId("chat-input").fill("Add $45 expense at Costco under Groceries");
    await page.getByTestId("chat-input").press("Enter");

    const card = page.getByTestId("action-confirmation-card");
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card).toContainText("Add Expense");
    await expect(card).toContainText("Costco");
    await expect(card).toContainText("$45.00");
    await expect(card).toContainText("Groceries");
  });

  test("confirmation card has Confirm and Cancel buttons [AC2]", async ({ page }) => {
    await page.getByTestId("chat-input").fill("Add expense");
    await page.getByTestId("chat-input").press("Enter");

    await expect(page.getByTestId("action-confirm-button")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("action-cancel-button")).toBeVisible();
  });

  test("a write waits for approval and is never issued unprompted [AC1, AC3]", async ({ page }) => {
    const mock = mockApi(page);

    await page.getByTestId("chat-input").fill("Add $45 expense at Costco under Groceries");
    await page.getByTestId("chat-input").press("Enter");

    const card = page.getByTestId("action-confirmation-card");
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card).toContainText("won't add anything until you say so");
    expect(await mock.executedActions()).toEqual([]);

    await page.getByTestId("action-confirm-button").click();
    await expect(page.getByTestId("chat-message-assistant").last()).toContainText(
      "expense added for Costco"
    );
    expect(await mock.executedActions()).toEqual(["create_expense"]);

    const [forwarded] = await mock.executedActionParams();
    expect(forwarded.category_name).toBe("Groceries");
    expect(forwarded).not.toHaveProperty("budget_category_id");
  });

  test("clicking Cancel shows 'Action cancelled' message [AC5]", async ({ page }) => {
    const mock = mockApi(page);

    await page.getByTestId("chat-input").fill("Add expense");
    await page.getByTestId("chat-input").press("Enter");

    await expect(page.getByTestId("action-cancel-button")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("action-cancel-button").click();

    const messages = page.getByTestId("chat-message-assistant");
    await expect(messages.last()).toContainText("Action cancelled");
    expect(await mock.executedActions()).toEqual([]);

    /* The cancellation is persisted, not just drawn: without this the model never learns the card
     * was refused and proposes the identical one again next turn. */
    expect(await mock.cancelledActions()).toEqual([
      { conversation_id: 1, action_type: "create_expense" },
    ]);
  });

  /* The reproduced bug: an action_type outside the backend's closed set still drew a card, so every
   * Confirm failed and the model kept re-proposing it. The answer must survive; only the dead
   * offer of an action disappears. */
  test("an action type the backend cannot run renders no confirmation card", async ({ page }) => {
    const mock = mockApi(page);
    await mock.setResponse("unsupported-action");

    await page.getByTestId("chat-input").fill("Add a House category");
    await page.getByTestId("chat-input").press("Enter");

    await expect(page.getByTestId("chat-message-assistant")).toContainText(
      "I can add that for you",
      { timeout: 5000 }
    );
    await expect(page.getByTestId("action-confirmation-card")).toHaveCount(0);
    await expect(page.getByTestId("action-confirm-button")).toHaveCount(0);
    expect(await mock.executedActions()).toEqual([]);
  });

  /* `create_budget_category` is the type that used to have no frontend branch at all, so the card
   * either never rendered or rendered dead. This drives the whole path end to end: the card the
   * model proposes, the params the confirm forwards, and the success line coming back. */
  test("a create_budget_category card confirms into exactly one backend call", async ({ page }) => {
    const mock = mockApi(page);
    await mock.setResponse("category-action");

    await page.getByTestId("chat-input").fill("Add a House category under Needs");
    await page.getByTestId("chat-input").press("Enter");

    const card = page.getByTestId("action-confirmation-card");
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card).toContainText("Add Budget Category");
    await expect(card).toContainText("House");
    await expect(card).toContainText("Needs");
    await expect(card).toContainText("$1.00");

    // Nothing is written before the user approves, whatever the card is for.
    expect(await mock.executedActions()).toEqual([]);

    await page.getByTestId("action-confirm-button").click();
    await expect(page.getByTestId("chat-message-assistant").last()).toContainText(
      "House added to Needs"
    );

    /* Exactly one call: a card that re-fires on a single confirm would create duplicate categories,
     * and the backend's idempotency would hide it from any weaker assertion. */
    expect(await mock.executedActions()).toEqual(["create_budget_category"]);
    expect(await mock.executedActionParams()).toEqual([
      { category_name: "House", group_name: "Needs" },
    ]);

    // The confirm path appends `Error: ...` on failure, so its absence is what proves success.
    await expect(page.getByTestId("chat-message-area")).not.toContainText("Error:");
  });

  test("after cancel, buttons on the card are disabled [AC5]", async ({ page }) => {
    await page.getByTestId("chat-input").fill("Add expense");
    await page.getByTestId("chat-input").press("Enter");

    await expect(page.getByTestId("action-cancel-button")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("action-cancel-button").click();

    await expect(page.getByTestId("action-confirm-button")).toBeDisabled();
    await expect(page.getByTestId("action-cancel-button")).toBeDisabled();
  });
});

// === Story 7.3 Tests ===

test.describe("Floating Chat Bar — Story 7.3", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto("/");
  });

  test("pressing Cmd+K opens the floating chat bar overlay [AC1]", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    await expect(page.getByTestId("floating-chat-bar")).toBeVisible();
  });

  test("overlay appears with auto-focused input and ESC badge [AC1]", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    await expect(page.getByTestId("floating-chat-input")).toBeVisible();
    await expect(page.getByTestId("floating-chat-input")).toBeFocused();
    await expect(page.getByTestId("esc-badge")).toBeVisible();
  });

  test("overlay has role=dialog with aria-label [AC2]", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    const bar = page.getByTestId("floating-chat-bar");
    await expect(bar).toHaveAttribute("role", "dialog");
    await expect(bar).toHaveAttribute("aria-label", "Quick chat");
  });

  test("the bar is the one floating layer, so it carries the float shadow [AC1]", async ({
    page,
  }) => {
    await page.keyboard.press("Meta+k");
    const bar = page.getByTestId("floating-chat-bar");
    await expect(bar).toBeVisible();

    const shadow = await bar.evaluate((el) => {
      const probe = document.createElement("div");
      probe.style.boxShadow = "var(--shadow-float)";
      el.appendChild(probe);
      const token = getComputedStyle(probe).boxShadow;
      probe.remove();
      // Tailwind composes box-shadow from five slots (inset, ring, offset, shadow); the unused
      // ones resolve to fully transparent entries, so compare only the ones that actually paint.
      const painted = (getComputedStyle(el).boxShadow.match(/(rgba?\([^)]*\)[^,]*)/g) ?? [])
        .map((part) => part.trim())
        .filter((part) => !part.startsWith("rgba(0, 0, 0, 0)"));
      return { painted, token };
    });

    expect(shadow.token).not.toBe("none");
    expect(shadow.painted).toEqual([shadow.token]);
  });

  test("no text in the bar drops below the 12px floor [AC1]", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    const bar = page.getByTestId("floating-chat-bar");
    await expect(bar).toBeVisible();

    const undersized = await bar.evaluate((root) =>
      [root, ...root.querySelectorAll("*")]
        .filter((el) => (el.textContent ?? "").trim() !== "")
        .map((el) => Number.parseFloat(getComputedStyle(el).fontSize))
        .filter((size) => size > 0 && size < 12)
    );
    expect(undersized).toEqual([]);
  });

  test("pressing Escape closes the overlay [AC5]", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    await expect(page.getByTestId("floating-chat-bar")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("floating-chat-bar")).not.toBeVisible();
  });

  /* Attachments are a full-chat affordance by approved decision: the bar is a one-shot quick ask
   * with no room to show, replace, or remove a selected file. */
  test("the bar offers no attach control", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    const bar = page.getByTestId("floating-chat-bar");
    await expect(bar).toBeVisible();

    await expect(bar.getByTestId("chat-attach-button")).toHaveCount(0);
    await expect(bar.getByTestId("chat-attachment-chip")).toHaveCount(0);
    await expect(bar.getByTestId("chat-attachment-error")).toHaveCount(0);
  });

  test("a send from the bar carries no attachment path", async ({ page }) => {
    const mock = mockApi(page);
    await page.keyboard.press("Meta+k");

    await page.getByTestId("floating-chat-input").fill("How is my budget?");
    await page.getByTestId("floating-chat-input").press("Enter");

    await expect(page.getByTestId("chat-message-assistant")).toBeVisible({ timeout: 5000 });
    expect(await mock.sentAttachmentPaths()).toEqual([null]);
  });

  test("'Open the full chat' is a link and navigates to the agent chat [AC4]", async ({ page }) => {
    await page.keyboard.press("Meta+k");
    const link = page.getByTestId("open-full-chat-link");
    await expect(link).toBeVisible();
    await expect(link).toHaveRole("link");
    await link.click();
    await expect(page).toHaveURL(AGENT_PATH);
    await expect(page.getByTestId("floating-chat-bar")).not.toBeVisible();
  });
});

// === AI chat file uploads ===

const PICKED_FILE = "/Users/tester/Documents/january-expenses.csv";

/* An export name a bank or a scanner really produces. Underscores, deliberately: a hyphen is a CSS
 * break opportunity, so a hyphenated name wraps instead of overflowing and never exercises the width
 * guard. This one has no break opportunity at all and outruns the composer's `max-w-2xl` column at
 * both 1024 and 1280 — a shorter name fits the column and stops exercising truncation. */
const LONG_FILE_NAME =
  "RBC_Visa_Infinite_Avion_consolidated_monthly_credit_card_statement_january_2026_reviewed_categorized_final_v3.csv";
const LONG_PICKED_FILE = `/Users/tester/Documents/${LONG_FILE_NAME}`;

/**
 * How far the attachment chip reaches past the composer column that lays it out, plus how much of
 * the chip, the truncating stem, and the extension is clipped. Growing past that column IS the
 * overflow this measures; a stem narrower than its own text is what separates truncation from a
 * clip; and the extension is measured separately because it is the part that may NOT be dropped.
 */
async function chipFit(page: Page) {
  return page.getByTestId("chat-attachment-chip").evaluate((el) => {
    const column = el.parentElement;
    const stem = el.querySelector<HTMLElement>('[data-testid="chat-attachment-stem"]');
    const extension = el.querySelector<HTMLElement>(
      '[data-testid="chat-attachment-extension"]'
    );
    if (column === null || stem === null || extension === null) {
      throw new Error("the chip is not laid out inside a column, or renders no split name");
    }
    const chipRect = el.getBoundingClientRect();
    const extensionRect = extension.getBoundingClientRect();
    return {
      pastColumnPx: Math.round(chipRect.right - column.getBoundingClientRect().right),
      chipClippedPx: el.scrollWidth - el.clientWidth,
      stemClippedPx: stem.scrollWidth - stem.clientWidth,
      extensionWidthPx: Math.round(extensionRect.width),
      extensionClippedPx: extension.scrollWidth - extension.clientWidth,
      extensionPastChipPx: Math.round(extensionRect.right - chipRect.right),
    };
  });
}

test.describe("AI Chat attachments", () => {
  test.beforeEach(async ({ page }) => {
    await setupTauriMock(page);
    await page.goto(AGENT_PATH);
  });

  test("the composer offers a labelled attach control beside the input", async ({ page }) => {
    const attach = page.getByTestId("chat-attach-button");
    await expect(attach).toBeVisible();
    await expect(attach).toHaveAttribute("aria-label", "Attach a file");
    // No file selected yet, so nothing about one is shown.
    await expect(page.getByTestId("chat-attachment-chip")).toHaveCount(0);
    await expect(page.getByTestId("chat-attachment-error")).toHaveCount(0);
  });

  test("cancelling the picker leaves the draft and the selection untouched", async ({ page }) => {
    const mock = mockApi(page);
    await mock.setPickedFile(null);

    await page.getByTestId("chat-input").fill("How is my budget?");
    await page.getByTestId("chat-attach-button").click();

    await expect(page.getByTestId("chat-input")).toHaveValue("How is my budget?");
    await expect(page.getByTestId("chat-attachment-chip")).toHaveCount(0);
    await expect(page.getByTestId("chat-attachment-error")).toHaveCount(0);
  });

  test("a supported file is shown by basename and can be removed", async ({ page }) => {
    const mock = mockApi(page);
    await mock.setPickedFile(PICKED_FILE);

    await page.getByTestId("chat-attach-button").click();

    await expect(page.getByTestId("chat-attachment-chip")).toBeVisible();
    // The basename only: the directory it came from is never surfaced.
    await expect(page.getByTestId("chat-attachment-name")).toHaveText(
      "january-expenses.csv"
    );
    await expect(page.getByTestId("chat-attachment-chip")).not.toContainText(
      "/Users/tester"
    );

    const remove = page.getByTestId("chat-attachment-remove");
    await expect(remove).toHaveAttribute("aria-label", "Remove the attached file");
    await remove.click();
    await expect(page.getByTestId("chat-attachment-chip")).toHaveCount(0);
  });

  test("a selected file remains available for follow-up turns until removed", async ({ page }) => {
    const mock = mockApi(page);
    await mock.setPickedFile(PICKED_FILE);

    await page.getByTestId("chat-attach-button").click();
    await expect(page.getByTestId("chat-attachment-chip")).toBeVisible();

    await page.getByTestId("chat-input").fill("What is in this file?");
    await page.getByTestId("chat-input").press("Enter");

    await expect(page.getByTestId("chat-message-assistant")).toContainText("$125.50", {
      timeout: 5000,
    });
    expect(await mock.sentAttachmentPaths()).toEqual([PICKED_FILE]);

    await expect(page.getByTestId("chat-attachment-chip")).toBeVisible();
    await page.getByTestId("chat-input").fill("Use House for the housing rows");
    await page.getByTestId("chat-input").press("Enter");
    expect(await mock.sentAttachmentPaths()).toEqual([PICKED_FILE, PICKED_FILE]);

    await page.getByTestId("chat-attachment-remove").click();
    await page.getByTestId("chat-input").fill("Now answer without the file");
    await page.getByTestId("chat-input").press("Enter");
    expect(await mock.sentAttachmentPaths()).toEqual([PICKED_FILE, PICKED_FILE, null]);
  });

  test("a message with no file sends no attachment path", async ({ page }) => {
    const mock = mockApi(page);

    await page.getByTestId("chat-input").fill("How is my budget?");
    await page.getByTestId("chat-input").press("Enter");

    await expect(page.getByTestId("chat-message-assistant")).toBeVisible({ timeout: 5000 });
    expect(await mock.sentAttachmentPaths()).toEqual([null]);
  });

  /* Every refusal reason gets its own localized line: a shared message would tell the user
   * to shrink a file whose type was never supported in the first place. */
  const REJECTIONS = [
    { field: "attachment_unsupported_type", copy: "That file type can't be attached" },
    { field: "attachment_empty", copy: "That file is empty" },
    { field: "attachment_too_large", copy: "That file is over 4 MB" },
    { field: "attachment_unreadable", copy: "That file couldn't be read" },
  ] as const;

  for (const { field, copy } of REJECTIONS) {
    test(`a ${field} refusal shows its own localized error and attaches nothing`, async ({
      page,
    }) => {
      const mock = mockApi(page);
      await mock.setPickedFile(PICKED_FILE);
      await mock.setAttachmentRejection(field);

      await page.getByTestId("chat-attach-button").click();

      await expect(page.getByTestId("chat-attachment-error")).toContainText(copy);
      await expect(page.getByTestId("chat-attachment-chip")).toHaveCount(0);
    });
  }

  test("a refused file is never sent, and the error clears once a valid one replaces it", async ({
    page,
  }) => {
    const mock = mockApi(page);
    await mock.setPickedFile(PICKED_FILE);
    await mock.setAttachmentRejection("attachment_too_large");

    await page.getByTestId("chat-attach-button").click();
    await expect(page.getByTestId("chat-attachment-error")).toBeVisible();

    await page.getByTestId("chat-input").fill("Anything?");
    await page.getByTestId("chat-input").press("Enter");
    await expect(page.getByTestId("chat-message-assistant")).toBeVisible({ timeout: 5000 });
    expect(await mock.sentAttachmentPaths()).toEqual([null]);

    await mock.setAttachmentRejection(null);
    await page.getByTestId("chat-attach-button").click();

    await expect(page.getByTestId("chat-attachment-chip")).toBeVisible();
    await expect(page.getByTestId("chat-attachment-error")).toHaveCount(0);
  });

  test("a refused replacement drops the file that was already selected", async ({ page }) => {
    const mock = mockApi(page);
    await mock.setPickedFile(PICKED_FILE);

    await page.getByTestId("chat-attach-button").click();
    await expect(page.getByTestId("chat-attachment-chip")).toBeVisible();

    await mock.setAttachmentRejection("attachment_empty");
    await page.getByTestId("chat-attach-button").click();

    // A refused replacement drops the previous selection rather than silently keeping it.
    await expect(page.getByTestId("chat-attachment-error")).toBeVisible();
    await expect(page.getByTestId("chat-attachment-chip")).toHaveCount(0);
  });

  test("attaching cannot be started while a response is streaming", async ({ page }) => {
    const mock = mockApi(page);
    await mock.setResponse("manual");

    await page.getByTestId("chat-input").fill("How is my budget?");
    await page.getByTestId("chat-input").press("Enter");

    await expect(page.getByTestId("chat-attach-button")).toBeDisabled();
    await mock.emitChunk("", true);
    await expect(page.getByTestId("chat-attach-button")).toBeEnabled();
  });

  /* The whole reason attachments are read-only context: a file that implies a write must
   * still go through the same explicit confirmation card. */
  test("a file-driven action still requires the confirmation card [AC2]", async ({ page }) => {
    const mock = mockApi(page);
    await mock.setPickedFile(PICKED_FILE);
    await mock.setResponse("action");

    await page.getByTestId("chat-attach-button").click();
    await expect(page.getByTestId("chat-attachment-chip")).toBeVisible();

    await page.getByTestId("chat-input").fill("Add the expense from this file");
    await page.getByTestId("chat-input").press("Enter");

    const card = page.getByTestId("action-confirmation-card");
    await expect(card).toBeVisible({ timeout: 5000 });
    expect(await mock.executedActions()).toEqual([]);

    await page.getByTestId("action-confirm-button").click();
    expect(await mock.executedActions()).toEqual(["create_expense"]);
    expect(await mock.sentAttachmentPaths()).toEqual([PICKED_FILE]);
  });

  /* `send_chat_message` re-runs the real check, so a file that cleared the pick-time one can still
   * be refused at send time. That refusal lands in `useChat.chatError`, which nothing used to
   * reset — so it outlived the attempt it described. */
  test("a send-time refusal is reported and withdraws the turn it refused", async ({ page }) => {
    const mock = mockApi(page);
    await mock.setPickedFile(PICKED_FILE);
    await mock.setSendAttachmentRejection("attachment_too_large");

    await page.getByTestId("chat-attach-button").click();
    await expect(page.getByTestId("chat-attachment-chip")).toBeVisible();

    await page.getByTestId("chat-input").fill("What is in this file?");
    await page.getByTestId("chat-input").press("Enter");

    await expect(page.getByTestId("chat-attachment-error")).toContainText(
      "That file is over 4 MB"
    );
    // Nothing was written and no quota was spent, so neither optimistic turn may remain.
    await expect(page.getByTestId("chat-message-user")).toHaveCount(0);
    await expect(page.getByTestId("chat-message-assistant")).toHaveCount(0);

    /* Withdrawing both turns leaves the conversation empty, and this refusal lives in the composer
     * rather than the message area — so the starter card is the correct thing to be looking at.
     * Suppressing it on any `chatError` left the user an empty pane with nothing to act on. */
    await expect(page.getByTestId("chat-starter-prompt").first()).toBeVisible();
    await expect(page.getByTestId("chat-attachment-error")).toBeVisible();
  });

  test("retrying the send clears the previous send-time refusal", async ({ page }) => {
    const mock = mockApi(page);
    await mock.setPickedFile(PICKED_FILE);
    await mock.setSendAttachmentRejection("attachment_too_large");

    await page.getByTestId("chat-attach-button").click();
    await page.getByTestId("chat-input").fill("What is in this file?");
    await page.getByTestId("chat-input").press("Enter");
    await expect(page.getByTestId("chat-attachment-error")).toBeVisible();

    await mock.setSendAttachmentRejection(null);
    await page.getByTestId("chat-input").fill("Never mind, how is my budget?");
    await page.getByTestId("chat-input").press("Enter");

    await expect(page.getByTestId("chat-message-assistant")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("chat-attachment-error")).toHaveCount(0);
  });

  /* The starter buttons call the route's `send` directly, never the composer's submit, so a clear
   * living in the composer left this one path leaking a stale refusal next to a good answer. */
  test("a starter prompt send clears the previous send-time refusal", async ({ page }) => {
    const mock = mockApi(page);
    await mock.setPickedFile(PICKED_FILE);
    await mock.setSendAttachmentRejection("attachment_too_large");

    await page.getByTestId("chat-attach-button").click();
    await page.getByTestId("chat-input").fill("What is in this file?");
    await page.getByTestId("chat-input").press("Enter");
    await expect(page.getByTestId("chat-attachment-error")).toBeVisible();

    await mock.setSendAttachmentRejection(null);
    await page.getByTestId("chat-starter-prompt").first().click();

    await expect(page.getByTestId("chat-message-assistant")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("chat-attachment-error")).toHaveCount(0);
  });

  test("a newly valid file replaces a send-time refusal instead of stacking with it", async ({
    page,
  }) => {
    const mock = mockApi(page);
    await mock.setPickedFile(PICKED_FILE);
    await mock.setSendAttachmentRejection("attachment_unreadable");

    await page.getByTestId("chat-attach-button").click();
    await page.getByTestId("chat-input").fill("What is in this file?");
    await page.getByTestId("chat-input").press("Enter");
    await expect(page.getByTestId("chat-attachment-error")).toBeVisible();

    await mock.setSendAttachmentRejection(null);
    await page.getByTestId("chat-attach-button").click();

    await expect(page.getByTestId("chat-attachment-chip")).toBeVisible();
    await expect(page.getByTestId("chat-attachment-error")).toHaveCount(0);
  });

  /* Both refusals share one slot through `attachments.errorKey ?? sendErrorKey`, so clearing the
   * pick-time one on top would let a stale send-time one underneath re-surface. */
  test("removing a refused replacement does not resurrect the send-time refusal", async ({
    page,
  }) => {
    const mock = mockApi(page);
    await mock.setPickedFile(PICKED_FILE);
    await mock.setSendAttachmentRejection("attachment_too_large");

    await page.getByTestId("chat-attach-button").click();
    await page.getByTestId("chat-input").fill("What is in this file?");
    await page.getByTestId("chat-input").press("Enter");
    await expect(page.getByTestId("chat-attachment-error")).toContainText(
      "That file is over 4 MB"
    );

    // A pick-time refusal now covers the send-time one in the shared slot.
    await mock.setSendAttachmentRejection(null);
    await mock.setAttachmentRejection("attachment_empty");
    await page.getByTestId("chat-attach-button").click();
    await expect(page.getByTestId("chat-attachment-error")).toContainText("That file is empty");

    // Recovering from the pick-time refusal has to leave the slot empty, not the older message.
    await mock.setAttachmentRejection(null);
    await mock.setPickedFile(PICKED_FILE);
    await page.getByTestId("chat-attach-button").click();
    await expect(page.getByTestId("chat-attachment-chip")).toBeVisible();
    await page.getByTestId("chat-attachment-remove").click();
    await expect(page.getByTestId("chat-attachment-error")).toHaveCount(0);
  });

  /* The ring is drawn outside the button box (2px at a 2px offset), so the chip's own padding is
   * the only thing that keeps it off the chip border. Measured rather than pinned to a padding
   * value, because the clearance is what matters and the token may change. */
  test("the focused remove control's ring clears the chip edge", async ({ page }) => {
    const mock = mockApi(page);
    await mock.setPickedFile(PICKED_FILE);

    await page.getByTestId("chat-attach-button").click();
    await expect(page.getByTestId("chat-attachment-chip")).toBeVisible();

    // Real keyboard focus, since the ring only paints under :focus-visible. Tab order inside the
    // composer runs remove -> attach -> input, so the input is two steps back from the remove.
    await page.getByTestId("chat-input").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    const remove = page.getByTestId("chat-attachment-remove");
    await expect(remove).toBeFocused();

    const clearance = await remove.evaluate((el) => {
      const chip = el.closest('[data-testid="chat-attachment-chip"]');
      if (chip === null) throw new Error("the remove control is not inside a chip");
      const style = getComputedStyle(el);
      const outlineWidthPx = Number.parseFloat(style.outlineWidth);
      const ringPx = outlineWidthPx + Number.parseFloat(style.outlineOffset);
      const button = el.getBoundingClientRect();
      const bounds = chip.getBoundingClientRect();
      return {
        outlineWidthPx,
        ringPx,
        topPx: Math.round(button.top - ringPx - bounds.top),
        rightPx: Math.round(bounds.right - (button.right + ringPx)),
        bottomPx: Math.round(bounds.bottom - (button.bottom + ringPx)),
      };
    });

    // A ring of zero would make every clearance below pass for the wrong reason.
    expect(clearance.ringPx).toBeGreaterThan(0);

    /* At least the ring's own width of gap on each side. Expressed against the ring rather than as
     * a pixel constant so a ring token change cannot quietly turn this into a weaker check — and
     * because "greater than zero" is satisfied by the 1px hairline that reads as a collision. */
    expect(clearance.topPx).toBeGreaterThanOrEqual(clearance.outlineWidthPx);
    expect(clearance.rightPx).toBeGreaterThanOrEqual(clearance.outlineWidthPx);
    expect(clearance.bottomPx).toBeGreaterThanOrEqual(clearance.outlineWidthPx);
  });

  /* A basename is whatever the filesystem holds, and the composer's `max-w-2xl` column is the only
   * thing bounding it. An unbroken 60+ character name has no break opportunity, so before the chip
   * carried width guards it grew past that column and pushed the remove control out with it. */
  test("an unbroken 60+ character basename truncates inside the composer column", async ({
    page,
  }) => {
    const mock = mockApi(page);
    await page.setViewportSize({ width: 1024, height: 680 });
    await mock.setPickedFile(LONG_PICKED_FILE);

    await page.getByTestId("chat-attach-button").click();

    const chip = page.getByTestId("chat-attachment-chip");
    await expect(chip).toBeVisible();

    const fit = await chipFit(page);
    expect(fit.pastColumnPx).toBeLessThanOrEqual(0);
    expect(fit.chipClippedPx).toBeLessThanOrEqual(0);
    expect(fit.stemClippedPx).toBeGreaterThan(0);

    /* The extension says whether the PDF or the CSV of the same statement is attached, so it may
     * not be what truncation eats: it keeps full width inside the chip while the stem gives way. */
    expect(fit.extensionClippedPx).toBeLessThanOrEqual(0);
    expect(fit.extensionWidthPx).toBeGreaterThan(0);
    expect(fit.extensionPastChipPx).toBeLessThanOrEqual(0);
    const extension = page.getByTestId("chat-attachment-extension");
    await expect(extension).toBeVisible();
    await expect(extension).toHaveText(".csv");

    const documentScrollPx = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(documentScrollPx).toBeLessThanOrEqual(0);

    // Hidden characters have to stay recoverable, and the tooltip is a pointer user's only route.
    const name = page.getByTestId("chat-attachment-name");
    await expect(name).toHaveAttribute("title", LONG_FILE_NAME);
    // Splitting the name across two spans must not cost a screen reader the whole basename.
    await expect(name).toHaveText(LONG_FILE_NAME);

    // Truncation must not cost either control its reachability.
    await expect(page.getByTestId("chat-attach-button")).toBeVisible();
    const remove = page.getByTestId("chat-attachment-remove");
    await expect(remove).toBeVisible();
    await remove.click();
    await expect(chip).toHaveCount(0);
  });

  /* 1280 is the other size the app is laid out for, and a wider column changes which element the
   * chip is bounded by — the guard has to hold at both, not just at the minimum. */
  test("the same basename stays inside the composer column at 1280 x 800", async ({ page }) => {
    const mock = mockApi(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await mock.setPickedFile(LONG_PICKED_FILE);

    await page.getByTestId("chat-attach-button").click();

    const chip = page.getByTestId("chat-attachment-chip");
    await expect(chip).toBeVisible();

    const fit = await chipFit(page);
    expect(fit.pastColumnPx).toBeLessThanOrEqual(0);
    expect(fit.stemClippedPx).toBeGreaterThan(0);
    expect(fit.extensionPastChipPx).toBeLessThanOrEqual(0);
    await expect(page.getByTestId("chat-attachment-extension")).toHaveText(".csv");
    await expect(page.getByTestId("chat-attachment-name")).toHaveAttribute(
      "title",
      LONG_FILE_NAME
    );
    await expect(page.getByTestId("chat-attachment-remove")).toBeVisible();
  });

  /* The composer owns the draft but the starter buttons bypass it, so before the sendCount
   * signal a starter click answered one question while the typed one stayed in the box. */
  test("a starter prompt click empties a typed draft", async ({ page }) => {
    await page.getByTestId("chat-input").fill("a half-typed other question");

    await page.getByTestId("chat-starter-prompt").first().click();

    await expect(page.getByTestId("chat-message-assistant")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("chat-input")).toHaveValue("");
  });

  test("a normal send empties the typed draft", async ({ page }) => {
    await page.getByTestId("chat-input").fill("How is my budget?");
    await page.getByTestId("chat-input").press("Enter");

    await expect(page.getByTestId("chat-message-assistant")).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId("chat-input")).toHaveValue("");
  });

  /* Finding 1's cancel contract, end to end: dismissing the picker must leave both the draft
   * and a standing send-time refusal alone. */
  test("cancelling the picker leaves a typed draft and a standing refusal intact", async ({
    page,
  }) => {
    const mock = mockApi(page);
    await mock.setPickedFile(PICKED_FILE);
    await mock.setAttachmentRejection("attachment_too_large");

    await page.getByTestId("chat-attach-button").click();
    await expect(page.getByTestId("chat-attachment-error")).toBeVisible();

    await page.getByTestId("chat-input").fill("still typing this");
    await mock.setPickedFile(null);
    await page.getByTestId("chat-attach-button").click();

    await expect(page.getByTestId("chat-attachment-error")).toBeVisible();
    await expect(page.getByTestId("chat-input")).toHaveValue("still typing this");
  });

  /* The reproduced layout bug: a long card history made the app shell itself the scroller, so the
   * composer slid up off the viewport with dead space beneath it. The log has to be the only thing
   * that scrolls, and the composer has to stay pinned no matter how much history accumulates. */
  test("a long card history scrolls only inside the log, composer stays pinned", async ({
    page,
  }) => {
    const mock = mockApi(page);
    await page.setViewportSize({ width: 1024, height: 680 });
    await mock.setResponse("action");

    const cards = page.getByTestId("action-confirmation-card");
    for (let turn = 1; turn <= 8; turn++) {
      await page.getByTestId("chat-input").fill(`Add expense number ${turn}`);
      await page.getByTestId("chat-input").press("Enter");
      await expect(cards).toHaveCount(turn, { timeout: 5000 });
    }

    const log = page.getByTestId("chat-message-area");
    const overflow = await log.evaluate((el) => ({
      scrollablePx: el.scrollHeight - el.clientHeight,
      overscrollBehaviorY: getComputedStyle(el).overscrollBehaviorY,
    }));

    // Without real overflow the rest of this proves nothing: the layout would be untested.
    expect(overflow.scrollablePx).toBeGreaterThan(0);
    expect(overflow.overscrollBehaviorY).toBe("contain");

    const pinned = async (label: string) => {
      const state = await page.evaluate(() => {
        const composer = document.querySelector('[data-testid="chat-input-area"]');
        if (composer === null) throw new Error("the composer is not rendered");
        return {
          documentScrollTopPx: document.documentElement.scrollTop,
          windowScrollYPx: window.scrollY,
          composerGapPx: Math.round(
            window.innerHeight - composer.getBoundingClientRect().bottom
          ),
        };
      });
      expect(state.documentScrollTopPx, label).toBe(0);
      expect(state.windowScrollYPx, label).toBe(0);
      // Sub-pixel layout rounding is tolerable; a shifted-up composer is tens of pixels out.
      expect(Math.abs(state.composerGapPx), label).toBeLessThanOrEqual(2);
    };

    await pinned("after accumulating cards");

    // Scrolling back through the history must not drag the page with it.
    await log.evaluate((el) => {
      el.scrollTop = 0;
    });
    await pinned("after scrolling the log to the top");

    // And a fresh streaming turn must not either, which is when the auto-scroll runs.
    await mock.setResponse("query");
    await page.getByTestId("chat-input").fill("How is my budget?");
    await page.getByTestId("chat-input").press("Enter");
    await expect(page.getByTestId("chat-message-assistant").last()).toContainText("$125.50", {
      timeout: 5000,
    });
    await pinned("after a streaming turn");

    // The auto-scroll still parks the newest turn in view, in the log and only the log.
    const atBottom = await log.evaluate(
      (el) => el.scrollHeight - el.clientHeight - el.scrollTop
    );
    expect(atBottom).toBeLessThanOrEqual(2);
  });

  test("a reopened conversation shows no trace of a previous attachment", async ({ page }) => {
    const mock = mockApi(page);
    await mock.setPickedFile(PICKED_FILE);

    await page.getByTestId("chat-attach-button").click();
    await page.getByTestId("chat-input").fill("What is in this file?");
    await page.getByTestId("chat-input").press("Enter");
    await expect(page.getByTestId("chat-message-assistant")).toBeVisible({ timeout: 5000 });

    // get_chat_messages is the persisted record, and it carries text only.
    await page.goto(`${AGENT_PATH}?conversation=1`);

    await expect(page.getByTestId("chat-attachment-chip")).toHaveCount(0);
    await expect(page.getByTestId("chat-input-area")).not.toContainText(
      "january-expenses.csv"
    );
  });
});
