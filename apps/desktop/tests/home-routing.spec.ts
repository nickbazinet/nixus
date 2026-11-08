import { test, expect, type Page } from "@playwright/test";

type MockWindow = Record<string, unknown>;

interface RoutingMockOptions {
  /** What `route_home_message` answers. Tier 1's verdict, scripted. */
  route?: { agent_id: string; kind: string };
}

/**
 * A Home mock that answers the routing command and actually registers the stream listeners, which
 * `home.spec.ts` deliberately does not — streaming in the Home panel is new in this step.
 */
async function setupRoutingMock(page: Page, options: RoutingMockOptions = {}) {
  await page.addInitScript((opts: RoutingMockOptions) => {
    type EventCallback = (event: { event: string; payload: unknown; id: number }) => void;
    const listeners: Record<string, EventCallback[]> = {};
    const callbacks: Record<number, EventCallback> = {};
    let nextCallbackId = 1;

    const w = window as unknown as MockWindow;
    const calls: { cmd: string; args: Record<string, unknown> }[] = [];
    w.__MOCK_CALLS__ = calls;

    w.__MOCK_EMIT_CHUNK__ = (chunk: string, done: boolean) => {
      for (const cb of listeners["chat:response-chunk"] ?? []) {
        cb({ event: "chat:response-chunk", payload: { chunk, done }, id: 1 });
      }
    };
    w.__MOCK_LISTENER_COUNT__ = () => (listeners["chat:response-chunk"] ?? []).length;

    w.__TAURI_INTERNALS__ = {
      transformCallback: (callback: EventCallback) => {
        const id = nextCallbackId++;
        callbacks[id] = callback;
        return id;
      },
      unregisterCallback: () => {},
      convertFileSrc: (path: string) => path,
      invoke: (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd === "plugin:event|listen") {
          const event = args.event as string;
          const cb = callbacks[args.handler as number];
          if (cb) {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(cb);
          }
          return Promise.resolve(args.handler);
        }
        /* A real unlisten, not a no-op: without it listeners accumulate inside the mock and this
         * spec could not tell a leaked subscription from a cleaned-up one. */
        if (cmd === "plugin:event|unlisten") {
          const event = args.event as string;
          const cb = callbacks[args.eventId as number];
          const registered = listeners[event];
          if (cb && registered) {
            const index = registered.indexOf(cb);
            if (index !== -1) registered.splice(index, 1);
          }
          return Promise.resolve(null);
        }
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);

        calls.push({ cmd, args });

        switch (cmd) {
          case "check_picker_gate":
            return Promise.resolve({ needs_picker: false });
          case "check_onboarding_status":
            return Promise.resolve({ needs_onboarding: false });
          case "get_home_composer_access":
            return Promise.resolve("available");
          case "get_home_surface":
            return Promise.resolve([]);
          case "list_agents":
            return Promise.resolve([
              {
                id: "budget-helper",
                name_key: "agents.budgetHelper.name",
                description_key: "agents.budgetHelper.description",
                kind: "chat",
                ready_key: "agents.budgetHelper.ready",
                scope_key: "agents.budgetHelper.scope",
                starter_keys: [
                  "agents.budgetHelper.starterTracking",
                  "agents.budgetHelper.starterVsLastMonth",
                  "agents.budgetHelper.starterWhereItGoes",
                ],
                routable: false,
              },
              {
                id: "car-maintenance",
                name_key: "agents.carMaintenance.name",
                description_key: "agents.carMaintenance.description",
                kind: "chat",
                ready_key: "agents.carMaintenance.ready",
                scope_key: "agents.carMaintenance.scope",
                starter_keys: [
                  "agents.carMaintenance.starterDue",
                  "agents.carMaintenance.starterHistory",
                  "agents.carMaintenance.starterOdometer",
                ],
                routable: false,
              },
            ]);
          case "route_home_message":
            return Promise.resolve(
              opts.route ?? { agent_id: "budget-helper", kind: "chat" }
            );
          case "send_chat_message":
            return Promise.resolve({ conversation_id: 42, user_message_id: 1 });
          case "send_home_composer_message":
            return Promise.resolve({
              conversation_id: 7,
              outcome: "proposal",
              candidates: [],
              content:
                '```action\n{"action":true,"action_type":"propose_home_surface_change","display":{"label":"Add widget","details":[{"field":"Widget","value":"Net worth"}]},"params":{"op":"add","widget":{"component":"Metric","title":"Net worth"}}}\n```',
            });
          case "execute_chat_action":
            return Promise.resolve({ success: true, message: "Done." });
          case "get_chat_messages":
          case "list_conversations":
          case "get_vehicles":
          case "get_accounts":
          case "get_budget_status":
            return Promise.resolve([]);
          default:
            return Promise.resolve(null);
        }
      },
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (event: string, eventId: number) => {
        const cb = callbacks[eventId];
        const registered = listeners[event];
        if (!cb || !registered) return;
        const index = registered.indexOf(cb);
        if (index !== -1) registered.splice(index, 1);
      },
    };
  }, options);
}

const emitChunk = (page: Page, chunk: string, done = false) =>
  page.evaluate(
    ([c, d]) =>
      ((window as unknown as MockWindow).__MOCK_EMIT_CHUNK__ as (
        a: string,
        b: boolean
      ) => void)(c as string, d as boolean),
    [chunk, done] as const
  );

const callsTo = (page: Page, cmd: string) =>
  page.evaluate(
    (name) =>
      (
        (window as unknown as MockWindow).__MOCK_CALLS__ as {
          cmd: string;
          args: Record<string, unknown>;
        }[]
      ).filter((call) => call.cmd === name),
    cmd
  );

test.describe("Home bar routing (Step 4)", () => {
  test("a dashboard ask takes the surface path and still produces a confirmable proposal", async ({
    page,
  }) => {
    await setupRoutingMock(page, { route: { agent_id: "home-composer", kind: "surface" } });
    await page.goto("/home");

    await page.getByTestId("home-ask-input").fill("add a net worth widget");
    await page.getByTestId("home-ask-input").press("Enter");

    await expect(page.getByTestId("action-confirmation-card")).toBeVisible({ timeout: 5000 });
    expect(await callsTo(page, "send_home_composer_message")).toHaveLength(1);
    expect(await callsTo(page, "send_chat_message")).toHaveLength(0);
    // A surface answer is the panel's own voice, so there is no agent to continue in.
    await expect(page.getByTestId("home-continue-in-agent")).toHaveCount(0);
  });

  test("a financial question takes the chat path, streams, and offers a way to continue", async ({
    page,
  }) => {
    await setupRoutingMock(page, { route: { agent_id: "budget-helper", kind: "chat" } });
    await page.goto("/home");

    await page.getByTestId("home-ask-input").fill("what's my net worth");
    await page.getByTestId("home-ask-input").press("Enter");

    await expect(page.getByTestId("home-continue-in-agent")).toBeVisible({ timeout: 5000 });

    await emitChunk(page, "Your net worth is ");
    await emitChunk(page, "`$420,000`.", true);
    await expect(page.getByTestId("home-composer-transcript")).toContainText(
      "Your net worth is"
    );

    expect(await callsTo(page, "send_chat_message")).toHaveLength(1);
    expect(await callsTo(page, "send_home_composer_message")).toHaveLength(0);

    // Carries the conversation, so the thread survives the move.
    await expect(page.getByTestId("home-continue-in-agent")).toHaveAttribute(
      "href",
      /\/ai\/budget-helper\?conversation=42/
    );
  });

  /* Which agent answered is the router's business. The panel names no agent and offers no way to
   * correct one — the only agent-specific affordance is the link to keep going. */
  test("a routed answer is not labelled with the agent and offers no reroute", async ({ page }) => {
    await setupRoutingMock(page, { route: { agent_id: "budget-helper", kind: "chat" } });
    await page.goto("/home");

    await page.getByTestId("home-ask-input").fill("what's my net worth");
    await page.getByTestId("home-ask-input").press("Enter");
    await expect(page.getByTestId("home-continue-in-agent")).toBeVisible({ timeout: 5000 });

    await expect(page.getByTestId("home-answered-by")).toHaveCount(0);
    await expect(page.getByTestId("home-wrong-agent")).toHaveCount(0);
    await expect(page.getByText(/answered by/i)).toHaveCount(0);
  });

  /* The user never picks an agent — there is no picker. The hero has exactly one control, and the
   * backend works out where the ask belongs. */
  test("the hero offers no agent picker at all", async ({ page }) => {
    await setupRoutingMock(page);
    await page.goto("/home");

    await expect(page.getByTestId("home-ask-input")).toBeVisible();
    await expect(page.getByTestId("home-ask-route")).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);
  });

  test("an upkeep question is routed to the car agent without the user asking for it", async ({
    page,
  }) => {
    await setupRoutingMock(page, { route: { agent_id: "car-maintenance", kind: "chat" } });
    await page.goto("/home");

    await page.getByTestId("home-ask-input").fill("when is my oil change due");
    await page.getByTestId("home-ask-input").press("Enter");

    await expect(page.getByTestId("home-continue-in-agent")).toContainText(
      "Continue in Car Maintenance",
      { timeout: 5000 }
    );
    // The classifier decided — the one Home bar send always consults it.
    expect(await callsTo(page, "route_home_message")).toHaveLength(1);
    const [sent] = await callsTo(page, "send_chat_message");
    expect(sent.args.agent_id).toBe("car-maintenance");
  });

  test("a leading @mention forces the agent and is stripped from the message", async ({ page }) => {
    await setupRoutingMock(page, { route: { agent_id: "home-composer", kind: "surface" } });
    await page.goto("/home");

    await page.getByTestId("home-ask-input").fill("@car when is my oil change due");
    await page.getByTestId("home-ask-input").press("Enter");

    await expect(page.getByTestId("home-continue-in-agent")).toContainText(
      "Continue in Car Maintenance",
      { timeout: 5000 }
    );
    expect(await callsTo(page, "route_home_message")).toHaveLength(0);
    const [sent] = await callsTo(page, "send_chat_message");
    expect(sent.args.agent_id).toBe("car-maintenance");
    expect(sent.args.message).toBe("when is my oil change due");
  });

  /* R3: `chat:response-chunk` is an app-global Tauri event. Leaving a listener behind on a route
   * change would have the previous surface mutating its own transcript from this one's turn, and
   * the visible symptom is doubled text. */
  test("navigating Home -> an agent route -> Home leaks no duplicated chunks", async ({ page }) => {
    await setupRoutingMock(page, { route: { agent_id: "budget-helper", kind: "chat" } });
    await page.goto("/home");

    /* In-app navigation, not `page.goto`: a full reload would tear every listener down with the
     * document and prove nothing about unmount cleanup. */
    const rail = page.locator('nav[aria-label="Module navigation"]');
    await rail.getByRole("link", { name: "AI", exact: true }).click();
    await expect(page).toHaveURL(/\/ai$/);
    await page
      .locator('a[data-slot="card"]')
      .filter({ hasText: "Budget Helper" })
      .click();
    await expect(page).toHaveURL(/\/ai\/budget-helper/);
    await rail.getByRole("link", { name: "Home", exact: true }).click();
    await expect(page).toHaveURL(/\/home/);

    await page.getByTestId("home-ask-input").fill("what's my net worth");
    await page.getByTestId("home-ask-input").press("Enter");
    await expect(page.getByTestId("home-continue-in-agent")).toBeVisible({ timeout: 5000 });

    await emitChunk(page, "once");
    await emitChunk(page, "", true);

    const transcript = page.getByTestId("home-composer-transcript");
    await expect(transcript).toContainText("once");
    expect(await transcript.innerText()).not.toContain("onceonce");

    /* The direct check, because leaked listeners are only *sometimes* visible in the transcript:
     * one orphaned subscription writes into an unmounted hook's buffer and shows nothing at all.
     * Counting them is what actually detects accumulation across route changes. */
    const subscriptions = await page.evaluate(() =>
      ((window as unknown as MockWindow).__MOCK_LISTENER_COUNT__ as () => number)()
    );
    expect(subscriptions).toBe(1);
  });
});
