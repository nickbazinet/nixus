import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";

import { startHarness, type Harness } from "./support/harness";

/**
 * Screenshot capture, not an assertion suite.
 *
 * Opt-in via `ACCOUNT_SHOT_DIR`: the gate suite must stay deterministic, and a
 * spec whose only output is a PNG proves nothing on its own. It drives the same
 * packaged server and the same fake edge/IdP/profile API as `account.spec.ts`,
 * so what it photographs is the artifact that deploys.
 */

const DIR = process.env.ACCOUNT_SHOT_DIR ?? "";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 375, height: 812 },
] as const;

const THEMES = ["light", "dark"] as const;

let harness: Harness;

test.beforeAll(async () => {
  test.skip(DIR === "", "set ACCOUNT_SHOT_DIR to capture screenshots");
  mkdirSync(DIR, { recursive: true });
  harness = await startHarness();
});

test.afterAll(async () => {
  if (harness) await harness.stop();
});

test("captures the profile pages at both widths in both themes", async ({ browser }) => {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        // The app resolves `system` from the OS preference, so emulating the
        // scheme photographs the real default rather than a click.
        colorScheme: theme,
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();

      // One sign-in per context. The stub provider keeps its own session across
      // contexts, so after the first one it grants silently and there is no
      // sign-in page to click through.
      await page.goto(`${harness.origin}/`);
      const providerSignIn = page.getByTestId("stub-idp-sign-in");
      if ((await providerSignIn.count()) > 0) await providerSignIn.click();
      await page.waitForURL(`${harness.origin}/profile`);

      for (const [label, path] of [
        ["profile", "/profile"],
        ["fr-profile", "/fr/profile"],
      ] as const) {
        await page.goto(`${harness.origin}${path}`);
        await page.waitForLoadState("networkidle");
        await page.screenshot({
          path: `${DIR}/${label}-${viewport.name}-${theme}.png`,
          fullPage: true,
        });
      }

      await context.close();
    }
  }
});
