import { expect, test } from "@playwright/test";

import { ROUTES, captureConsole } from "./support/site";

/**
 * Dev-build console gate.
 *
 * The production projects assert a clean console too, but React compiles its
 * hydration-mismatch and unknown-DOM-prop diagnostics out of production builds —
 * so a page can hydrate wrongly, lose its interactivity, and still pass there.
 * These run against `vite dev`, where those diagnostics are emitted, and treat
 * every one of them as a failure.
 *
 * The Pixel project is the viewport the reported breakage came from.
 */
for (const route of ROUTES) {
  test(`${route} hydrates clean in a dev build`, async ({ page }) => {
    const devtools = captureConsole(page);

    await page.goto(route);
    await page.waitForLoadState("networkidle");
    // Hydration diagnostics land after the client bundle attaches, which
    // `networkidle` does not guarantee. Waiting on a hydration-only side effect
    // is the deterministic signal that React has attached and had its say.
    await expect(page.locator("html")).toHaveAttribute("style", /color-scheme/);

    expect(devtools.messages, `${route}: dev console`).toEqual([]);
  });
}

test("serves a fully styled document with every stylesheet applied", async ({
  page,
}) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  /* The reported failure was an unstyled page: default serif body text, blue
   * links, an unbounded logo. Each assertion below is one of those symptoms
   * measured directly, so a missing stylesheet cannot pass as "renders". */
  const styling = await page.evaluate(() => {
    const body = getComputedStyle(document.body);
    const logo = document.querySelector("header svg");
    const logoBox = logo?.getBoundingClientRect();
    return {
      sheets: document.styleSheets.length,
      fontFamily: body.fontFamily,
      logoWidth: logoBox ? Math.round(logoBox.width) : null,
      headerIsSticky: (() => {
        const header = document.querySelector("header");
        return header ? getComputedStyle(header).position : null;
      })(),
    };
  });

  expect(styling.sheets).toBeGreaterThan(0);
  expect(styling.fontFamily).toMatch(/Inter/);
  expect(styling.headerIsSticky).toBe("sticky");
  expect(styling.logoWidth).not.toBeNull();
  expect(styling.logoWidth ?? 0).toBeLessThanOrEqual(48);
});

test("requests every hero preload it declares, and uses what it fetches", async ({
  page,
}) => {
  const imageRequests: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "image") imageRequests.push(request.url());
  });
  const devtools = captureConsole(page);

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const declared = await page.evaluate(() =>
    Array.from(document.querySelectorAll("link[rel=preload][as=image]")).map(
      (link) => ({
        href: link.getAttribute("href"),
        media: link.getAttribute("media"),
        fetchpriority: link.getAttribute("fetchpriority"),
        matches: window.matchMedia(link.getAttribute("media") ?? "all").matches,
      }),
    ),
  );

  expect(declared).toHaveLength(2);
  // Exactly one variant may match the active colour scheme, or the browser
  // downloads a hero backdrop it will never paint.
  expect(declared.filter((link) => link.matches)).toHaveLength(1);
  for (const link of declared) {
    expect(link.fetchpriority).toBe("high");
  }

  const active = declared.find((link) => link.matches);
  expect(
    imageRequests.some((url) => url.endsWith(active?.href ?? "\u0000")),
  ).toBe(true);

  // A preload the page never uses is a wasted download; Chromium says so.
  expect(
    devtools.messages.filter((message) => /preload/i.test(message)),
  ).toEqual([]);
});
