import { expect, test } from "@playwright/test";

import {
  ROUTES,
  captureConsole,
  clippedHeadings,
  expectedHeaderHeight,
  headerReport,
  overflowReport,
  scope,
  viewportWidth,
} from "./support/site";

/**
 * The layout gate. Runs on every viewport project in `playwright.config.ts`, so
 * one spec covers 320/375/390/430/768/1280 across all ten EN/FR routes.
 */
for (const route of ROUTES) {
  test.describe(route, () => {
    test("renders without sideways scroll, escaped chrome, clipped headings or console errors", async ({
      page,
    }, testInfo) => {
      const devtools = captureConsole(page);
      const width = viewportWidth(page);

      await page.goto(route);
      await page.waitForLoadState("networkidle");

      const where = scope(testInfo, route);

      expect(await overflowReport(page), `${where}: horizontal overflow`).toEqual({
        overflowPx: 0,
        offenders: [],
      });

      expect(await headerReport(page), `${where}: sticky chrome`).toEqual({
        height: expectedHeaderHeight(width),
        escaping: [],
        overlapsFirstContent: false,
      });

      expect(await clippedHeadings(page), `${where}: clipped headings`).toEqual(
        [],
      );

      expect(devtools.messages, `${where}: console`).toEqual([]);
    });

    test("stays overflow-free after scrolling to the bottom", async ({
      page,
    }, testInfo) => {
      await page.goto(route);
      await page.waitForLoadState("networkidle");

      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      // The sticky header re-styles on scroll (border + backdrop-blur); give the
      // rAF-throttled listener a frame to land before measuring.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => resolve(null))),
      );

      const where = `${scope(testInfo, route)} (scrolled)`;

      expect(await overflowReport(page), `${where}: horizontal overflow`).toEqual({
        overflowPx: 0,
        offenders: [],
      });

      const report = await headerReport(page);
      expect(report.escaping, `${where}: escaped chrome`).toEqual([]);
      expect(report.height, `${where}: header height`).toBe(
        expectedHeaderHeight(viewportWidth(page)),
      );
    });
  });
}
