import { test, expect, type Page } from "@playwright/test";

/**
 * The MANUAL customization layer over the AI-built Home widgets: reorder, width, rename, accent.
 * None of it goes through the composer — each control is a direct `void` command followed by a
 * surface re-read, so every assertion here checks the RE-RENDERED card rather than the click, and
 * the mock below keeps real state so a stale read would show up as a failure.
 */

type MockWindow = Record<string, unknown>;

interface SeedWidget {
  id: string;
  title: string;
}

const SEED: SeedWidget[] = [
  { id: "w_net_worth", title: "Net Worth, Month over Month" },
  { id: "w_categories", title: "Top Spending Categories" },
  { id: "w_recent", title: "Recent Expenses" },
];

async function setupCustomizeMock(page: Page, seed: SeedWidget[] = SEED) {
  await page.addInitScript((widgets: SeedWidget[]) => {
    const w = window as unknown as Record<string, unknown>;

    const state = widgets.map((widget) => ({
      id: widget.id,
      title: widget.title,
      title_override: null as string | null,
      span: 1,
      accent: null as number | null,
    }));

    const calls: { cmd: string; args: Record<string, unknown> }[] = [];
    w.__CUSTOMIZE_CALLS__ = calls;

    const NET_WORTH = {
      dimension: "month",
      detail_columns: [],
      series: ["net_worth"],
      rows: [
        { key: "2026-08", label: "2026-08", details: [], values: [4_100_000] },
        { key: "2026-09", label: "2026-09", details: [], values: [4_250_000] },
        { key: "2026-10", label: "2026-10", details: [], values: [4_410_000] },
      ],
    };

    const find = (id: unknown) => state.find((widget) => widget.id === id);

    w.__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: Record<string, unknown> = {}) => {
        if (cmd.startsWith("plugin:")) return Promise.resolve(null);
        calls.push({ cmd, args });

        switch (cmd) {
          case "check_picker_gate":
            return Promise.resolve({ needs_picker: false });
          case "get_ai_config":
            return Promise.resolve({ provider: null, configured: false, region: "" });
          case "get_home_composer_access":
            return Promise.resolve("available");
          case "get_home_surface":
            return Promise.resolve(
              state.map((widget, index) => ({
                id: widget.id,
                position: index + 1,
                title: widget.title_override ?? widget.title,
                title_override: widget.title_override,
                span: widget.span,
                accent: widget.accent,
                root: {
                  component: "LineChart",
                  title: null,
                  columns: null,
                  source: "net_worth_history",
                  data: NET_WORTH,
                  unsupported: false,
                  children: [],
                },
              }))
            );
          case "reorder_home_widgets": {
            const ids = args.widget_ids as string[];
            const byId = new Map(state.map((widget) => [widget.id, widget]));
            const next = ids
              .map((id) => byId.get(id))
              .filter((widget): widget is (typeof state)[number] => widget !== undefined);
            // The real command refuses anything that is not a full permutation and writes
            // nothing; dropping widgets here instead would hide that contract from the test.
            if (next.length === state.length) state.splice(0, state.length, ...next);
            return Promise.resolve(null);
          }
          case "rename_home_widget": {
            const target = find(args.widget_id);
            if (target) {
              const title = args.title as string | null;
              target.title_override =
                title === null || title.trim() === "" ? null : title.trim();
            }
            return Promise.resolve(null);
          }
          case "set_home_widget_span": {
            const target = find(args.widget_id);
            if (target) target.span = args.span as number;
            return Promise.resolve(null);
          }
          case "set_home_widget_accent": {
            const target = find(args.widget_id);
            if (target) target.accent = args.accent as number | null;
            return Promise.resolve(null);
          }
          case "delete_home_widget": {
            const at = state.findIndex((widget) => widget.id === args.widget_id);
            // The real command refuses an id that is no longer there rather than no-opping, so a
            // stale delete has to fail here too.
            if (at === -1) return Promise.reject("That widget is no longer on the Home Surface");
            state.splice(at, 1);
            return Promise.resolve(null);
          }
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
  }, seed);
}

const callsTo = (page: Page, cmd: string) =>
  page.evaluate(
    (c) =>
      (
        (window as unknown as MockWindow).__CUSTOMIZE_CALLS__ as {
          cmd: string;
          args: Record<string, unknown>;
        }[]
      ).filter((call) => call.cmd === c),
    cmd
  );

const titles = (page: Page) => page.getByTestId("widget-title").allTextContents();

const gridColumnEnd = (page: Page, index: number) =>
  page
    .getByTestId("home-widget-slot")
    .nth(index)
    .evaluate((el) => getComputedStyle(el).gridColumnEnd);

/**
 * Which ramp token a card's chart actually painted with. Read off the rendered markup rather than
 * one element's `stroke` attribute, because recharts is free to place a colour on an attribute or
 * in an inline style and the question here is only which `var(--chart-N)` the widget resolved to.
 */
const chartMarkup = (page: Page, index: number) =>
  page
    .getByTestId("home-widget")
    .nth(index)
    .getByTestId("home-chart-LineChart")
    .evaluate((el) => el.outerHTML);

test.describe("Home widget customization", () => {
  test.beforeEach(async ({ page }) => {
    await setupCustomizeMock(page);
    await page.goto("/home");
    await expect(page.getByTestId("home-widget")).toHaveCount(3);
  });

  test("the controls stay out of the way until the card is hovered or focused", async ({
    page,
  }) => {
    const handle = page.getByTestId("widget-drag-handle").first();
    await expect(handle).toHaveCSS("opacity", "0");

    await page.getByTestId("home-widget").first().hover();
    await expect(handle).toHaveCSS("opacity", "1");

    // Keyboard-only users never hover, so focusing a control inside the card has to reveal the
    // same cluster — otherwise it would be operable but invisible.
    await page.mouse.move(0, 0);
    await expect(handle).toHaveCSS("opacity", "0");
    await page.getByTestId("widget-title").first().focus();
    await expect(handle).toHaveCSS("opacity", "1");
  });

  test("a widget can be renamed and reset back to the AI's title", async ({ page }) => {
    const first = page.getByTestId("home-widget").first();
    await expect(page.getByTestId("widget-title").first()).toHaveText(
      "Net Worth, Month over Month"
    );

    await page.getByTestId("widget-title").first().click();
    const input = first.getByTestId("widget-title-input");
    await expect(input).toBeFocused();
    // The backend refuses anything longer, so the field must not let one be composed.
    await expect(input).toHaveAttribute("maxlength", "80");

    await input.fill("My money, over time");
    await first.getByTestId("widget-title-save").click();

    await expect(page.getByTestId("widget-title").first()).toHaveText("My money, over time");
    expect(await callsTo(page, "rename_home_widget")).toEqual([
      {
        cmd: "rename_home_widget",
        args: { widget_id: "w_net_worth", title: "My money, over time" },
      },
    ]);

    // Reset is only offered once there is an override to go back to.
    await page.getByTestId("widget-title").first().click();
    await first.getByTestId("widget-title-reset").click();
    await expect(page.getByTestId("widget-title").first()).toHaveText(
      "Net Worth, Month over Month"
    );

    await page.getByTestId("widget-title").first().click();
    await expect(first.getByTestId("widget-title-reset")).toHaveCount(0);
  });

  test("emptying the title clears the override instead of saving a blank heading", async ({
    page,
  }) => {
    const first = page.getByTestId("home-widget").first();
    await page.getByTestId("widget-title").first().click();
    await first.getByTestId("widget-title-input").fill("Temporary");
    await first.getByTestId("widget-title-save").click();
    await expect(page.getByTestId("widget-title").first()).toHaveText("Temporary");

    await page.getByTestId("widget-title").first().click();
    await first.getByTestId("widget-title-input").fill("   ");
    await first.getByTestId("widget-title-save").click();

    await expect(page.getByTestId("widget-title").first()).toHaveText(
      "Net Worth, Month over Month"
    );
    expect((await callsTo(page, "rename_home_widget")).at(-1)).toEqual({
      cmd: "rename_home_widget",
      args: { widget_id: "w_net_worth", title: null },
    });
  });

  test("Escape abandons a rename without writing anything", async ({ page }) => {
    const first = page.getByTestId("home-widget").first();
    await page.getByTestId("widget-title").first().click();
    await first.getByTestId("widget-title-input").fill("Discard me");
    await first.getByTestId("widget-title-input").press("Escape");

    await expect(page.getByTestId("widget-title").first()).toHaveText(
      "Net Worth, Month over Month"
    );
    expect(await callsTo(page, "rename_home_widget")).toEqual([]);
  });

  test("a widget toggles between half and full width", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const toggle = page.getByTestId("widget-span-toggle").first();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(await gridColumnEnd(page, 0)).toBe("auto");

    await toggle.click();
    await expect(page.getByTestId("widget-span-toggle").first()).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.getByTestId("home-widget-slot").first()).toHaveAttribute(
      "data-widget-span",
      "2"
    );
    expect(await gridColumnEnd(page, 0)).toBe("span 2");
    expect(await callsTo(page, "set_home_widget_span")).toEqual([
      { cmd: "set_home_widget_span", args: { widget_id: "w_net_worth", span: 2 } },
    ]);

    await page.getByTestId("widget-span-toggle").first().click();
    await expect(page.getByTestId("home-widget-slot").first()).toHaveAttribute(
      "data-widget-span",
      "1"
    );
    expect(await gridColumnEnd(page, 0)).toBe("auto");
  });

  /* The grid is already one column below `@3xl`, so a full-width widget must look no different
   * there — a span that leaked into the narrow layout would be a stray `col-span-2` against a
   * single track. */
  test("full width is a no-op while the grid is one column", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.getByTestId("widget-span-toggle").first().click();
    await expect(page.getByTestId("home-widget-slot").first()).toHaveAttribute(
      "data-widget-span",
      "2"
    );
    expect(await gridColumnEnd(page, 0)).toBe("span 2");

    await page.setViewportSize({ width: 680, height: 900 });
    await expect(page.getByTestId("home-widget-slot").first()).toHaveAttribute(
      "data-widget-span",
      "2"
    );
    expect(await gridColumnEnd(page, 0)).toBe("auto");
  });

  test("an accent colour repaints the widget's own charts and resets to the default", async ({
    page,
  }) => {
    const first = page.getByTestId("home-widget").first();
    expect(await chartMarkup(page, 0)).toContain("var(--chart-1)");

    await first.getByTestId("widget-accent-trigger").click();
    const picker = page.getByTestId("widget-accent-popover");
    // The picker promises a palette START, not per-series colour control.
    await expect(picker).toContainText("start in the palette");
    await picker.getByTestId("widget-accent-2").click();

    expect(await callsTo(page, "set_home_widget_accent")).toEqual([
      { cmd: "set_home_widget_accent", args: { widget_id: "w_net_worth", accent: 2 } },
    ]);
    await expect.poll(() => chartMarkup(page, 0)).toContain("var(--chart-3)");

    // A widget's accent is its own: the other two cards keep the default ramp.
    expect(await chartMarkup(page, 1)).toContain("var(--chart-1)");
    expect(await chartMarkup(page, 1)).not.toContain("var(--chart-3)");

    await first.getByTestId("widget-accent-trigger").click();
    await page.getByTestId("widget-accent-popover").getByTestId("widget-accent-reset").click();
    expect((await callsTo(page, "set_home_widget_accent")).at(-1)).toEqual({
      cmd: "set_home_widget_accent",
      args: { widget_id: "w_net_worth", accent: null },
    });
    await expect.poll(() => chartMarkup(page, 0)).toContain("var(--chart-1)");
  });

  test("widgets reorder from the keyboard, without a pointer", async ({ page }) => {
    expect(await titles(page)).toEqual([
      "Net Worth, Month over Month",
      "Top Spending Categories",
      "Recent Expenses",
    ]);

    const firstCard = page.getByTestId("home-widget").first();
    await expect(firstCard.getByTestId("widget-move-earlier")).toBeDisabled();
    await firstCard.getByTestId("widget-move-later").click();

    await expect
      .poll(() => titles(page))
      .toEqual([
        "Top Spending Categories",
        "Net Worth, Month over Month",
        "Recent Expenses",
      ]);
    expect(await callsTo(page, "reorder_home_widgets")).toEqual([
      {
        cmd: "reorder_home_widgets",
        args: { widget_ids: ["w_categories", "w_net_worth", "w_recent"] },
      },
    ]);

    await expect(
      page.getByTestId("home-widget").nth(2).getByTestId("widget-move-later")
    ).toBeDisabled();
  });

  /* Pointer events, never the HTML5 drag API: WKWebView never reliably fires `drop` for an
   * in-page drag, so this is the interaction the shipped app actually runs. */
  test("widgets reorder by dragging a card onto another one", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const source = page.getByTestId("home-widget").first();
    await source.hover();

    const handle = page.getByTestId("widget-drag-handle").first();
    const handleBox = await handle.boundingBox();
    const targetBox = await page.getByTestId("home-widget-slot").nth(2).boundingBox();
    expect(handleBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    if (!handleBox || !targetBox) return;

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    // Two moves: the first enters the drag, the second lands inside the third card's rect, which
    // is what the two-dimensional hit test resolves against.
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + 20);
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height / 2
    );
    await page.mouse.up();

    await expect
      .poll(() => titles(page))
      .toEqual([
        "Top Spending Categories",
        "Recent Expenses",
        "Net Worth, Month over Month",
      ]);
    expect(await callsTo(page, "reorder_home_widgets")).toEqual([
      {
        cmd: "reorder_home_widgets",
        args: { widget_ids: ["w_categories", "w_recent", "w_net_worth"] },
      },
    ]);
  });
});

test.describe("Home widget customization — a lone widget", () => {
  test.beforeEach(async ({ page }) => {
    await setupCustomizeMock(page, SEED.slice(0, 1));
    await page.goto("/home");
    await expect(page.getByTestId("home-widget")).toHaveCount(1);
  });

  test("a single widget offers no reorder affordance at all", async ({ page }) => {
    await expect(page.getByTestId("widget-drag-handle")).toHaveCount(0);
    await expect(page.getByTestId("widget-move-earlier")).toHaveCount(0);
    await expect(page.getByTestId("widget-move-later")).toHaveCount(0);
    // Width and colour still apply to a lone widget.
    await expect(page.getByTestId("widget-span-toggle")).toHaveCount(1);
    await expect(page.getByTestId("widget-accent-trigger")).toHaveCount(1);
  });

  test("removing the last widget falls back to the invitation", async ({ page }) => {
    await page.getByTestId("widget-delete").click();
    await page.getByTestId("widget-delete-confirm").click();

    await expect(page.getByTestId("home-widget")).toHaveCount(0);
    await expect(page.getByTestId("home-empty")).toBeVisible();
  });
});

test.describe("Home widget customization — removing a widget", () => {
  test.beforeEach(async ({ page }) => {
    await setupCustomizeMock(page);
    await page.goto("/home");
    await expect(page.getByTestId("home-widget")).toHaveCount(3);
  });

  test("the trash icon asks before it removes anything", async ({ page }) => {
    await page.getByTestId("home-widget").first().getByTestId("widget-delete").click();

    await expect(page.getByTestId("widget-delete-dialog")).toBeVisible();
    // Nothing may have been written just by opening the dialog.
    expect(await callsTo(page, "delete_home_widget")).toEqual([]);
    await expect(page.getByTestId("home-widget")).toHaveCount(3);
  });

  test("cancelling leaves every widget exactly where it was", async ({ page }) => {
    const before = await titles(page);
    await page.getByTestId("home-widget").first().getByTestId("widget-delete").click();
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect(page.getByTestId("widget-delete-dialog")).toBeHidden();
    expect(await callsTo(page, "delete_home_widget")).toEqual([]);
    expect(await titles(page)).toEqual(before);
  });

  test("confirming removes only that widget and keeps the others' choices", async ({ page }) => {
    // A choice on a SURVIVING widget, so the delete cannot be a blanket rewrite.
    const second = page.getByTestId("home-widget").nth(1);
    await second.getByTestId("widget-span-toggle").click();
    await expect(page.getByTestId("home-widget-slot").nth(1)).toHaveAttribute(
      "data-widget-span",
      "2"
    );

    await page.getByTestId("home-widget").first().getByTestId("widget-delete").click();
    await page.getByTestId("widget-delete-confirm").click();

    await expect(page.getByTestId("home-widget")).toHaveCount(2);
    expect(await titles(page)).toEqual(["Top Spending Categories", "Recent Expenses"]);
    expect(await callsTo(page, "delete_home_widget")).toEqual([
      { cmd: "delete_home_widget", args: { widget_id: "w_net_worth" } },
    ]);
    // The survivor keeps its width, and is now the first card.
    await expect(page.getByTestId("home-widget-slot").first()).toHaveAttribute(
      "data-widget-span",
      "2"
    );
  });

  test("the dialog names the widget it is about to remove", async ({ page }) => {
    await page.getByTestId("home-widget").nth(2).getByTestId("widget-delete").click();

    await expect(page.getByTestId("widget-delete-dialog")).toContainText("Recent Expenses");
  });
});
