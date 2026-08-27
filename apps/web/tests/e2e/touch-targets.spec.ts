import { expect, test, type Locator, type Page } from "@playwright/test";

import { TAP_MIN, isDesktopTier, openMenu, scope } from "./support/site";

type Target = { name: string; locator: Locator };

/** Boxes of every named control, so one failure names all offenders at once. */
async function undersized(targets: Target[]): Promise<string[]> {
  const offenders: string[] = [];
  for (const { name, locator } of targets) {
    // `count()` does not auto-wait. Several of these controls only exist after
    // hydration swaps the OS-neutral CTA for the detected-OS one, so counting
    // straight after `goto` would measure the prerendered shape instead.
    await locator.first().waitFor({ state: "visible" });
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const box = await locator.nth(index).boundingBox();
      if (box === null) {
        offenders.push(`${name}[${index}]: not rendered`);
        continue;
      }
      if (box.width < TAP_MIN || box.height < TAP_MIN) {
        offenders.push(
          `${name}[${index}]: ${Math.round(box.width)}x${Math.round(box.height)}`,
        );
      }
    }
  }
  return offenders;
}

function chromeTargets(page: Page): Target[] {
  return [
    { name: "brand", locator: page.locator("header a[aria-label]") },
    { name: "beta", locator: page.getByTestId("header-beta-link") },
    { name: "theme-toggle", locator: page.getByTestId("theme-toggle") },
    { name: "language-toggle", locator: page.getByTestId("language-toggle") },
    {
      name: "pre-alpha-dismiss",
      locator: page.getByTestId("pre-alpha-banner").getByRole("button"),
    },
    {
      name: "footer-link",
      locator: page.getByRole("contentinfo").getByRole("link"),
    },
  ];
}

test.describe("touch targets below the desktop tier", () => {
  test.skip(
    ({ page }) => isDesktopTier(page),
    "44px floor is scoped below 1024px on purpose — widening desktop chrome would be a desktop layout change",
  );

  test("site chrome controls are at least 44x44", async ({ page }, testInfo) => {
    await page.goto("/");
    expect(
      await undersized(chromeTargets(page)),
      `${scope(testInfo, "/")}: undersized chrome controls`,
    ).toEqual([]);
  });

  test("homepage conversion and disclosure controls are at least 44x44", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    const main = page.locator("#main-content");
    expect(
      await undersized([
        { name: "send-to-computer-copy", locator: main.getByTestId("download-cta-mobile-copy") },
        { name: "send-to-computer-email", locator: main.getByTestId("download-cta-mobile-email") },
        { name: "beta-invite-cta", locator: main.getByTestId("beta-invite-cta") },
        { name: "beta-full-guide", locator: main.getByTestId("beta-full-guide-link") },
        { name: "faq-trigger", locator: main.getByTestId("faq").getByRole("button") },
      ]),
      `${scope(testInfo, "/")}: undersized page controls`,
    ).toEqual([]);
  });

  test("beta page controls are at least 44x44", async ({ page }, testInfo) => {
    await page.goto("/beta");
    const main = page.locator("#main-content");
    expect(
      await undersized([
        { name: "feedback-cta", locator: main.getByTestId("beta-feedback-cta") },
        { name: "faq-trigger", locator: main.getByRole("button") },
      ]),
      `${scope(testInfo, "/beta")}: undersized beta controls`,
    ).toEqual([]);
  });

  test("open dropdown menu items are at least 44x44", async ({ page }, testInfo) => {
    await page.goto("/");
    await openMenu(page.getByTestId("theme-toggle"));
    expect(
      await undersized([
        { name: "theme-light", locator: page.getByTestId("theme-toggle-option-light") },
        { name: "theme-dark", locator: page.getByTestId("theme-toggle-option-dark") },
        { name: "theme-system", locator: page.getByTestId("theme-toggle-option-system") },
      ]),
      `${scope(testInfo, "/")}: undersized menu items`,
    ).toEqual([]);
  });
});

test.describe("desktop tier keeps its own density", () => {
  test.skip(({ page }) => !isDesktopTier(page), "desktop-only assertion");

  /* The inverse of the gate above. Without it, dropping the `@media (width <
   * 64rem)` wrapper in main.css would pass every test in this file while
   * silently restyling the desktop header. */
  test("does not inflate chrome controls to the phone floor", async ({ page }) => {
    await page.goto("/");
    const toggle = await page.getByTestId("theme-toggle").boundingBox();
    expect(toggle?.height).toBeLessThan(TAP_MIN);
  });
});
