import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";

import { CLASSIC_ACCOUNT } from "./support/billing-api";
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

const SECTIONS = ["personal", "subscription", "payment", "invoices", "signin"] as const;

let harness: Harness;

test.beforeAll(async () => {
  test.skip(DIR === "", "set ACCOUNT_SHOT_DIR to capture screenshots");
  mkdirSync(DIR, { recursive: true });
  harness = await startHarness();
  // A paying subscriber with a filled-in profile, so every card shows content.
  for (let nth = 1; nth <= VIEWPORTS.length; nth += 1) {
    harness.billing.accounts.set(`access-code-${nth}`, CLASSIC_ACCOUNT);
  }
  harness.api.profile = {
    first_name: "Alex",
    last_name: "Tremblay",
    birth_date: "1990-04-12",
    income_bracket: "50k_99k",
    income_bracket_currency: "CAD",
    country_code: "CA",
    subdivision_code: "CA-ON",
    version: 1,
    avatar_version: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
  };
});

test.afterAll(async () => {
  if (harness) await harness.stop();
});

test("captures every account section at both widths", async ({ browser }) => {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
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
      for (const section of SECTIONS) {
        await page.getByTestId(`account-nav-${section}`).click();
        await page.getByTestId(`section-${section}`).waitFor();
        await page.screenshot({
          path: `${DIR}/${label}-${section}-${viewport.name}.png`,
          fullPage: true,
        });
      }
    }

    await context.close();
  }
});
