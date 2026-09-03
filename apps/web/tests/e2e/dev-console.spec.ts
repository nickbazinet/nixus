import { expect, test, type Page } from "@playwright/test";

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

/**
 * Hero backdrop contract.
 *
 * Each colour scheme has exactly one atmosphere asset: the pale skyline in light,
 * the photograph in dark. Both are declared in the head and `media`-scoped, so the
 * browser fetches the one it will paint and leaves the other alone — a preload
 * Chromium never uses is a wasted download, and it warns about it.
 */
async function heroPreloads(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("link[rel=preload][as=image]")).map(
      (link) => ({
        href: link.getAttribute("href"),
        media: link.getAttribute("media"),
        fetchpriority: link.getAttribute("fetchpriority"),
        matches: window.matchMedia(link.getAttribute("media") ?? "all").matches,
      }),
    ),
  );
}

async function heroBackdrop(page: Page) {
  return page.evaluate(() => {
    const hero = document.querySelector("[data-testid=hero]");
    if (!hero) return null;
    const layer = getComputedStyle(hero, "::before");
    return {
      backgroundImage: layer.backgroundImage,
      opacity: Number(layer.opacity),
      backgroundSize: layer.backgroundSize,
      backgroundPosition: layer.backgroundPosition,
      backgroundRepeat: layer.backgroundRepeat,
      maskImage: layer.maskImage || layer.webkitMaskImage,
      mixBlendMode: layer.mixBlendMode,
      top: layer.top,
      height: layer.height,
    };
  });
}

/* Every dev project runs this file, and they are not all desktop: dev-pixel and
 * dev-tablet sit below the `lg` boundary where the hero deliberately switches to the
 * width-fit atmosphere. So no test here may read the project's default viewport and
 * call it "desktop" — each one sets the width whose contract it is asserting. That
 * also means every project now exercises BOTH tiers rather than only its own. */
const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;

/* F-1: at phone and small-tablet widths `cover` scaled the 16:9 asset to ~1988px
 * wide and centre-cropped it, so the only thing on screen was a slice of the asset's
 * near-flat sky — downloaded, paid for, and invisible. Below the desktop tier the
 * atmosphere is width-fit and bottom-anchored so the skyline itself is what lands on
 * the page. Both widths the finding named are covered. */
const NARROW_VIEWPORTS = [
  { width: 375, height: 720 },
  { width: 640, height: 900 },
] as const;

/** Resize, then let the media query and layout settle before measuring. */
async function resize(
  page: Page,
  viewport: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

const SCHEMES = [
  { scheme: "light", painted: "/hero-bg-light.webp", idle: "/hero-bg-dark.webp" },
  { scheme: "dark", painted: "/hero-bg-dark.webp", idle: "/hero-bg-light.webp" },
] as const;

for (const { scheme, painted, idle } of SCHEMES) {
  test(`preloads both backdrops and fetches only the ${scheme} one`, async ({
    page,
  }) => {
    const imageRequests: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "image") imageRequests.push(request.url());
    });
    const devtools = captureConsole(page);

    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const declared = await heroPreloads(page);
    expect(declared).toHaveLength(2);
    for (const link of declared) {
      expect(link.fetchpriority).toBe("high");
    }

    // Exactly one variant may match the active scheme, or the browser downloads a
    // hero backdrop it will never paint.
    const active = declared.filter((link) => link.matches);
    expect(active).toHaveLength(1);
    expect(active[0]?.href).toBe(painted);

    expect(imageRequests.some((url) => url.endsWith(painted))).toBe(true);
    expect(imageRequests.some((url) => url.endsWith(idle))).toBe(false);

    expect(
      devtools.messages.filter((message) => /preload/i.test(message)),
    ).toEqual([]);
  });

  test(`paints only the ${scheme} backdrop, at every width`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // The asset swap is a colour-scheme decision, so it must hold at both tiers —
    // asserted at explicit widths rather than at whatever the project happens to be.
    for (const viewport of [DESKTOP_VIEWPORT, ...NARROW_VIEWPORTS]) {
      await resize(page, viewport);
      const backdrop = await heroBackdrop(page);
      expect(backdrop?.backgroundImage, `${scheme} @ ${viewport.width}`).toContain(
        painted,
      );
      expect(
        backdrop?.backgroundImage,
        `${scheme} @ ${viewport.width}`,
      ).not.toContain(idle);

      // Geometry is tier-dependent for light and tier-independent for dark.
      const narrowLight = scheme === "light" && viewport.width < 1024;
      expect(backdrop?.backgroundSize, `${scheme} @ ${viewport.width}`).toBe(
        narrowLight ? "100%" : "cover",
      );
      expect(backdrop?.maskImage, `${scheme} @ ${viewport.width}`).toContain(
        scheme === "dark"
          ? "none"
          : narrowLight
            ? "linear-gradient"
            : "radial-gradient",
      );
    }
  });
}

test("keeps the light atmosphere subdued while dark stays photographic", async ({
  page,
}) => {
  // Dark mode is a class on <html> resolved by the pre-hydration script, not a bare
  // media query, so the scheme has to be set before a navigation — flipping
  // `emulateMedia` on an already-painted page leaves the light values in place.
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  // Alpha and blending are the same restraint at every width; only geometry changes.
  const lightByTier = [];
  for (const viewport of [DESKTOP_VIEWPORT, ...NARROW_VIEWPORTS]) {
    await resize(page, viewport);
    lightByTier.push({ viewport, layer: await heroBackdrop(page) });
  }

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await resize(page, DESKTOP_VIEWPORT);
  const dark = await heroBackdrop(page);

  for (const { viewport, layer } of lightByTier) {
    const at = `light @ ${viewport.width}`;
    // The light skyline is atmosphere behind live text, so it is held well back; the
    // dark photograph is the surface itself and keeps the value it always had.
    expect(layer?.opacity ?? 1, at).toBeLessThanOrEqual(0.6);
    expect(layer?.opacity ?? 1, at).toBeLessThan(dark?.opacity ?? 0);
    // Multiply is what keeps the pale skyline from washing the warm paper cool; the
    // photograph must not inherit it.
    expect(layer?.mixBlendMode, at).toBe("multiply");
  }
  expect(dark?.opacity ?? 0).toBeGreaterThanOrEqual(0.85);
  expect(dark?.mixBlendMode).toBe("normal");
});

for (const viewport of NARROW_VIEWPORTS) {
  test(`fits the light atmosphere to the width at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Set the desktop baseline explicitly — dev-pixel and dev-tablet start narrow, so
    // reading the project default here is what made this test lie about the tier.
    await resize(page, DESKTOP_VIEWPORT);
    const desktop = await heroBackdrop(page);
    expect(desktop?.backgroundSize).toBe("cover");
    expect(desktop?.backgroundPosition).toBe("50% 50%");
    expect(desktop?.maskImage).toContain("radial-gradient");
    expect(desktop?.top).toBe("0px");

    await resize(page, viewport);
    const narrow = await heroBackdrop(page);

    // Chromium serialises `100% auto` back as `100%` — the second value is implied.
    expect(narrow?.backgroundSize).toMatch(/^100%( auto)?$/);
    expect(narrow?.backgroundRepeat).toBe("no-repeat");
    expect(narrow?.maskImage).toContain("linear-gradient");
    expect(narrow?.backgroundImage).toContain("/hero-bg-light.webp");
    // Bottom-anchored inside a capped band, so the skyline — not the sky — is what
    // lands on the page.
    expect(narrow?.backgroundPosition).toBe("50% 100%");
    expect(narrow?.height).toBe("120px");
    expect(Number.parseFloat(narrow?.height ?? "0")).toBeLessThan(
      Number.parseFloat(desktop?.height ?? "0"),
    );

    // The band must live strictly between the two small-text runs: below the brand
    // eyebrow and above the lead paragraph. Both carry a 4.5:1 requirement, while the
    // display headline between them only has to clear 3:1.
    const runs = await page.evaluate(() => {
      const hero = document.querySelector("[data-testid=hero]");
      if (!hero) return { eyebrowBottom: null, bodyCopyTop: null };
      const top = hero.getBoundingClientRect().top;
      const edge = (selector: string, side: "top" | "bottom") => {
        const el = hero.querySelector(selector);
        return el ? Math.round(el.getBoundingClientRect()[side] - top) : null;
      };
      return {
        eyebrowBottom: edge("[data-testid=hero-eyebrow]", "bottom"),
        bodyCopyTop: edge("h1 + p", "top"),
      };
    });
    const bandTop = Number.parseFloat(narrow?.top ?? "0");
    const bandBottom = bandTop + Number.parseFloat(narrow?.height ?? "0");
    expect(runs.eyebrowBottom ?? 0).toBeLessThanOrEqual(bandTop);
    expect(bandBottom).toBeLessThanOrEqual(runs.bodyCopyTop ?? 0);
  });
}

test("keeps the dark photograph byte-equivalent at every width", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("html")).toHaveClass(/dark/);

  const baseline = {
    backgroundSize: "cover",
    backgroundPosition: "50% 50%",
    backgroundRepeat: "repeat",
    maskImage: "none",
    mixBlendMode: "normal",
    opacity: 0.9,
  };

  await resize(page, DESKTOP_VIEWPORT);
  const wide = await heroBackdrop(page);
  expect(wide).toMatchObject(baseline);
  expect(wide?.top).toBe("0px");
  // The narrow light band caps the layer; dark must still stretch the full hero.
  expect(Number.parseFloat(wide?.height ?? "0")).toBeGreaterThan(208);

  // The narrow light overrides must not reach dark at either flagged width.
  for (const viewport of NARROW_VIEWPORTS) {
    await resize(page, viewport);
    const narrow = await heroBackdrop(page);
    const at = `dark @ ${viewport.width}`;
    expect(narrow, at).toMatchObject(baseline);
    expect(narrow?.backgroundImage, at).toContain("/hero-bg-dark.webp");
    expect(narrow?.top, at).toBe("0px");
    expect(Number.parseFloat(narrow?.height ?? "0"), at).toBeGreaterThan(208);
    // Height is the only value allowed to differ, because the hero itself reflows.
    expect({ ...narrow, height: null }, at).toEqual({ ...wide, height: null });
  }
});
