import { expect, test } from "@playwright/test";

import { UA, isDesktopTier, openMenu } from "./support/site";

test.describe("phone and tablet conversion path", () => {
  test.skip(({ page }) => isDesktopTier(page), "below-desktop tier only");

  test("keeps the full send-to-computer affordance out of sticky chrome", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.locator("header").getByTestId("download-cta"),
    ).toBeHidden();

    const inPage = page.locator("#main-content").getByTestId("download-cta");
    await expect(inPage).toHaveCount(1);
    await expect(inPage).toBeVisible();
    await expect(
      inPage.getByTestId("download-cta-mobile-headline"),
    ).toBeVisible();
    await expect(
      inPage.getByTestId("download-cta-mobile-affordance"),
    ).toBeVisible();
  });

  test("keeps the Founding destination reachable and email-driven", async ({
    page,
  }) => {
    await page.goto("/");
    const founding = page.getByTestId("header-beta-link");
    await expect(founding).toBeVisible();
    await expect(founding).toHaveText("Founding");
    await founding.click();
    await expect(page).toHaveURL(/\/beta$/);
    await expect(page.getByTestId("beta-page")).toBeVisible();
    await expect(
      page.getByTestId("header-beta-link"),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("beta-hero-cta")).toHaveAttribute(
      "href",
      "mailto:nixus@gmail.com?subject=Nixus%20Founding%20User%20Program",
    );
  });

  test("keeps the locale switch reachable from chrome", async ({ page }) => {
    await page.goto("/");
    await openMenu(page.getByTestId("language-toggle"));
    await page.getByTestId("language-toggle-option-fr").click();
    await expect(page).toHaveURL(/\/fr\/$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  });

  test("offers no desktop binary button to a phone visitor", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("download-cta-primary")).toHaveCount(0);
    await expect(page.getByTestId("download-cta-macos")).toHaveCount(0);
    await expect(page.getByTestId("download-cta-windows")).toHaveCount(0);
  });
});

test.describe("desktop download behaviour is unchanged", () => {
  test.skip(({ page }) => !isDesktopTier(page), "desktop tier only");

  test("serves the detected-OS download from the header and the hero", async ({
    page,
  }) => {
    await page.goto("/");

    const headerCta = page.locator("header").getByTestId("download-cta");
    await expect(headerCta).toBeVisible();

    const primaries = page.getByTestId("download-cta-primary");
    await expect(primaries).toHaveCount(2);
    for (const anchor of await primaries.all()) {
      await expect(anchor).toHaveAttribute("href", /\.dmg$/);
      await expect(anchor).toHaveAttribute("download", "");
    }

    await expect(page.getByTestId("download-cta-alt")).toHaveAttribute(
      "href",
      /\.exe$/,
    );
    await expect(
      page.getByTestId("download-cta-mobile-headline"),
    ).toHaveCount(0);
  });

  test.describe("unsupported desktop UA", () => {
    test.use({ userAgent: UA.linux });

    test("keeps the platform chooser and both direct links", async ({ page }) => {
      await page.goto("/");
      const hero = page.locator("#main-content").getByTestId("download-cta");
      await expect(hero.getByTestId("download-cta-macos")).toHaveAttribute(
        "href",
        /\.dmg$/,
      );
      await expect(hero.getByTestId("download-cta-windows")).toHaveAttribute(
        "href",
        /\.exe$/,
      );
      await expect(
        hero.getByTestId("download-cta-linux-note"),
      ).toBeVisible();
    });
  });

  test.describe("no-JS visitor", () => {
    test.use({ javaScriptEnabled: false });

    /* The prerendered HTML must already carry working download links: the
     * `mobile` and single-OS variants only exist after hydration, so the
     * server shape is the whole no-JS fallback (NFR-W7). */
    test("still gets both prerendered download links", async ({ page }) => {
      await page.goto("/");
      await expect(
        page.locator("#main-content").getByTestId("download-cta-macos"),
      ).toHaveAttribute("href", /\.dmg$/);
      await expect(
        page.locator("#main-content").getByTestId("download-cta-windows"),
      ).toHaveAttribute("href", /\.exe$/);
    });
  });
});
