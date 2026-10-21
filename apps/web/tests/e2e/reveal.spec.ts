import { expect, test, type Page } from "@playwright/test";

/**
 * Scroll reveal, verified by its failure modes rather than its happy path.
 *
 * The animation itself is cosmetic. What is NOT cosmetic is that it hides
 * content until a condition is met, so every path where that condition cannot
 * be met has to be proven to leave the content visible. Those paths are the
 * three describes below: no JavaScript, reduced motion, and a reveal that never
 * gets observed.
 *
 * `opacity` is the thing asserted throughout, because that is what the CSS
 * animates. Playwright's own visibility check ignores opacity, so
 * `toBeVisible()` would pass on a permanently invisible card and prove nothing.
 */

/** Resolved opacity of every reveal target on the page. */
async function opacities(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-reveal-item]")).map((el) =>
      Number.parseFloat(getComputedStyle(el).opacity),
    ),
  );
}

async function revealGate(page: Page): Promise<string | null> {
  return page.evaluate(() =>
    document.documentElement.getAttribute("data-reveal"),
  );
}

async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = window.innerHeight * 0.7;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
    }
    window.scrollTo(0, 0);
  });
  // Longer than the 450ms transition plus the capped 210ms stagger.
  await page.waitForTimeout(900);
}

test.describe("scroll reveal", () => {
  test("settles every target fully opaque once scrolled through", async ({
    page,
  }) => {
    await page.goto("/");
    expect(await revealGate(page)).toBe("on");

    const targets = await opacities(page);
    expect(targets.length).toBeGreaterThan(8);

    await scrollThrough(page);
    const after = await opacities(page);
    expect(after).toHaveLength(targets.length);
    // Not "greater than 0" — a reveal that stalls at 0.6 is a contrast failure,
    // so the resting state has to be exactly opaque.
    expect(after.every((o) => o === 1)).toBe(true);
  });

  test("never hides the hero, so the LCP element is painted immediately", async ({
    page,
  }) => {
    await page.goto("/");
    const hero = page.getByTestId("hero");
    await expect(hero).toBeVisible();

    const heroState = await hero.evaluate((el) => ({
      isTarget: el.hasAttribute("data-reveal-item"),
      containsTarget: el.querySelector("[data-reveal-item]") !== null,
      headingOpacity: getComputedStyle(
        el.querySelector("h1") as Element,
      ).opacity,
    }));
    expect(heroState).toEqual({
      isTarget: false,
      containsTarget: false,
      headingOpacity: "1",
    });
  });
});

test.describe("reduced motion", () => {
  /* The gate must be absent, not merely overridden. The global
   * `prefers-reduced-motion` rule in `tokens.css` collapses transitions to
   * 0.01ms, so if the hidden state were applied here the content would be
   * permanently invisible rather than un-animated.
   *
   * `emulateMedia` rather than `test.use`: the pre-hydration script reads the
   * media query, so the emulation has to be in place before the first
   * navigation, which is what this ordering guarantees. */
  test("never applies the hidden state at all", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    expect(await revealGate(page)).toBeNull();

    const before = await opacities(page);
    expect(before.length).toBeGreaterThan(8);
    expect(before.every((o) => o === 1)).toBe(true);
  });
});

test.describe("no-JS visitor", () => {
  test.use({ javaScriptEnabled: false });

  test("sees every reveal target in the prerendered HTML", async ({ page }) => {
    await page.goto("/");
    // The pre-hydration script never ran, so nothing opted in to being hidden.
    expect(await revealGate(page)).toBeNull();

    const all = await opacities(page);
    expect(all.length).toBeGreaterThan(8);
    expect(all.every((o) => o === 1)).toBe(true);

    // Content, not just opacity: a no-JS visitor has to be able to read it.
    await expect(page.getByTestId("feature-card").first()).toContainText(/\S/);
    await expect(page.getByTestId("closing-cta")).toContainText(/\S/);
  });
});

test.describe("observer failure", () => {
  /* Every hidden element depends on something revealing it, so a dead observer
   * is the one bug that could ship blank sections. Stubbing
   * `IntersectionObserver` into a no-op reproduces that whole class — a browser
   * quirk, a detached node, an observer starved of a frame — and proves the
   * scroll fallback still gets the reader to readable content.
   *
   * Note what this does NOT assert: that below-fold content reveals on a timer.
   * An earlier version guarded the dead-observer case with a 2.5s sweep over
   * the whole page, which revealed every section before the reader reached it
   * and silently disabled the animation from the fourth section down. */
  test("still reveals on scroll when the observer never reports", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      class DeadObserver {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
        takeRecords(): [] {
          return [];
        }
      }
      Object.defineProperty(window, "IntersectionObserver", {
        writable: true,
        value: DeadObserver,
      });
    });

    await page.goto("/");
    // The gate still turns on: `IntersectionObserver` exists as far as the
    // pre-hydration check can tell, so content IS hidden at this point.
    expect(await revealGate(page)).toBe("on");

    await scrollThrough(page);
    const after = await opacities(page);
    expect(after.length).toBeGreaterThan(8);
    expect(after.every((o) => o === 1)).toBe(true);
  });
});

test.describe("reveal timing", () => {
  /* The defect this locks out is the one a reader reports as "I scrolled past
   * the third section and the animation stopped": anything that reveals targets
   * the reader has not reached spends the effect before it can be seen. */
  test("leaves below-fold targets hidden until they are scrolled to", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByTestId("hero")).toBeVisible();

    const belowFold = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-reveal-item]")).filter(
          (el) => el.getBoundingClientRect().top > window.innerHeight,
        ).length,
      );
    const revealedBelowFold = () =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-reveal-item]")).filter(
          (el) =>
            el.getBoundingClientRect().top > window.innerHeight &&
            el.getAttribute("data-revealed") === "1",
        ).length,
      );

    expect(await belowFold()).toBeGreaterThan(5);

    // Well past the old 2.5s sweep, and past the transition, with no scrolling.
    await page.waitForTimeout(4000);
    expect(await revealedBelowFold()).toBe(0);

    // Arriving at a section is what reveals it.
    const section = page.getByTestId("how-it-works");
    await section.scrollIntoViewIfNeeded();
    await page.waitForTimeout(900);
    const steps = page.getByTestId("how-it-works-step");
    const stepOpacity = await steps.evaluateAll((els) =>
      els.map((el) => Number.parseFloat(getComputedStyle(el).opacity)),
    );
    expect(stepOpacity.length).toBe(3);
    expect(stepOpacity.every((o) => o === 1)).toBe(true);

    // The invariant, restated after scrolling: arriving at one section must not
    // cascade into the rest. Targets still below the fold are still waiting, and
    // none of them has been revealed.
    expect(await belowFold()).toBeGreaterThan(0);
    expect(await revealedBelowFold()).toBe(0);
  });
});
