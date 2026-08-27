import { expect, test } from "@playwright/test";

import { isDesktopTier, overflowReport } from "./support/site";

test.describe("reduced motion", () => {
  test("still delivers the full narrative statically", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("download-cta")).toHaveCount(2);
    await expect(page.getByTestId("ai-demo-summary")).toBeVisible();

    // The demo's value prop is carried by the end state, so reduced motion has
    // to land there rather than freezing the opening frame.
    const demo = await page.evaluate(() => {
      const summary = document.querySelector("[data-testid=ai-demo-summary]");
      const rows = Array.from(
        document.querySelectorAll("[data-testid=ai-demo-categorized-row]"),
      );
      const scanLine = document.querySelector("[data-testid=ai-demo-scan-line]");
      return {
        summaryOpacity: summary ? getComputedStyle(summary).opacity : null,
        rowOpacities: rows.map((row) => getComputedStyle(row).opacity),
        // The animated reveal hides rows via `visibility` as well as opacity, so
        // the reduced-motion override has to restore both or the demo stays
        // blank for exactly the users who cannot see the motion.
        rowVisibilities: rows.map((row) => getComputedStyle(row).visibility),
        scanAnimation: scanLine
          ? getComputedStyle(scanLine).animationName
          : null,
      };
    });

    expect(demo.summaryOpacity).toBe("1");
    expect(demo.rowOpacities).toEqual(["1", "1", "1", "1", "1"]);
    expect(demo.rowVisibilities).toEqual([
      "visible",
      "visible",
      "visible",
      "visible",
      "visible",
    ]);
    expect(demo.scanAnimation).toBe("none");
  });
});

test.describe("animated contrast", () => {
  /* The AI demo loops forever, and axe samples contrast once at an arbitrary
   * moment. So the invariant is not "readable at rest" but "never readable-ish":
   * across a whole cycle every text-bearing row is either fully hidden or fully
   * opaque. A row caught at 0.4 opacity composites into a washed-out foreground
   * and fails WCAG 1.4.3 for however long that frame is on screen. */
  test("never paints partially transparent text in the AI demo", async ({
    page,
  }) => {
    await page.goto("/");

    // Scroll only once the app is interactive. Scrolling first races hydration:
    // the router restores scroll to the top as it mounts, so the observer would
    // be created with the figure already out of view and never fire. The CTA
    // leaving its OS-neutral SSR value is the hydration barrier.
    await expect(
      page.locator("#main-content").getByTestId("download-cta"),
    ).not.toHaveAttribute("data-os", "choose");

    const demo = page.getByTestId("ai-demo");
    // Centre it, the way a reader scrolling to the demo does.
    // `scrollIntoViewIfNeeded` moves the minimum distance, which can leave the
    // figure only marginally intersecting under the sticky header and below the
    // observer's 30% threshold.
    await demo.evaluate((node) =>
      node.scrollIntoView({ block: "center", behavior: "instant" }),
    );
    await expect(demo).toHaveClass(/ai-demo--animated/);

    const partial = await page.evaluate(async () => {
      const seen: { node: string; opacity: string; visibility: string }[] = [];
      const deadline = performance.now() + 5600;
      while (performance.now() < deadline) {
        const rows = document.querySelectorAll(
          "[data-testid=ai-demo-categorized-row], [data-testid=ai-demo-summary]",
        );
        for (const row of Array.from(rows)) {
          const style = getComputedStyle(row);
          if (style.visibility === "hidden") continue;
          if (Number(style.opacity) === 1) continue;
          seen.push({
            node: row.getAttribute("data-testid") ?? row.tagName,
            opacity: style.opacity,
            visibility: style.visibility,
          });
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return seen.slice(0, 6);
    });

    expect(partial).toEqual([]);
  });
});

test.describe("keyboard operability", () => {
  test("lands on the skip link first and jumps to main content", async ({
    page,
  }) => {
    await page.goto("/");
    // No click before this: a pointer press moves Chromium's sequential focus
    // starting point to the clicked element, so the first Tab would resume from
    // mid-chrome instead of the document start.
    await page.keyboard.press("Tab");

    const first = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      href: document.activeElement?.getAttribute("href"),
    }));
    expect(first).toEqual({ tag: "A", href: "#main-content" });

    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("reaches every chrome destination by keyboard alone", async ({ page }) => {
    await page.goto("/");

    const reached: string[] = [];
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press("Tab");
      const id = await page.evaluate(
        () => document.activeElement?.getAttribute("data-testid") ?? "",
      );
      if (id) reached.push(id);
    }

    expect(reached).toContain("header-beta-link");
    expect(reached).toContain("theme-toggle");
    expect(reached).toContain("language-toggle");
  });
});

test.describe("200% zoom", () => {
  test.skip(
    ({ page }) => !isDesktopTier(page),
    "zoom halves the CSS viewport; only meaningful from the desktop tier down",
  );

  /* 200% browser zoom halves the CSS viewport, so a 1280px window becomes a
   * 640px layout — the WCAG 1.4.10 reflow case. Emulated by resizing rather
   * than by a zoom API, because the CSS viewport is what the layout reads. */
  test("reflows a 1280px window to 640px without sideways scroll", async ({
    page,
  }) => {
    await page.goto("/");
    await page.setViewportSize({ width: 640, height: 400 });

    expect(await overflowReport(page)).toEqual({
      overflowPx: 0,
      offenders: [],
    });

    const order = await page.evaluate(() => {
      const heading = document.querySelector("#main-content h1");
      const cta = document.querySelector(
        "#main-content [data-testid=download-cta]",
      );
      if (!heading || !cta) return null;
      return heading.compareDocumentPosition(cta) &
        Node.DOCUMENT_POSITION_FOLLOWING
        ? "cta-after-heading"
        : "cta-before-heading";
    });
    expect(order).toBe("cta-after-heading");
  });
});
