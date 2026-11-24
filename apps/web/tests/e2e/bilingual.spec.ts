import { expect, test, type Page } from "@playwright/test";

/**
 * The bilingual contract, against the production artifact.
 *
 * `preview:static` serves `.output/public` through the shipped CloudFront
 * viewer-request function, so these tests exercise the real objects and the real
 * edge rule: a French page that was never prerendered, or an unknown `/fr/` URL
 * that resolves to a homepage at 200, fails here rather than in Search Console.
 */

const ORIGIN = "https://nixusapp.com";

/** Every page, English path first. The French slug is the English one under /fr. */
const PAGES = [
  { en: "/", fr: "/fr/" },
  { en: "/features", fr: "/fr/features" },
  { en: "/pricing", fr: "/fr/pricing" },
  { en: "/mission", fr: "/fr/mission" },
  { en: "/privacy", fr: "/fr/privacy" },
  { en: "/founding-users", fr: "/fr/founding-users" },
  { en: "/download", fr: "/fr/download" },
  { en: "/terms", fr: "/fr/terms" },
  { en: "/privacy-policy", fr: "/fr/privacy-policy" },
  { en: "/404", fr: "/fr/404" },
] as const;

async function attribute(page: Page, selector: string, name: string): Promise<string | null> {
  return page.locator(selector).first().getAttribute(name);
}

async function hreflangs(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((link) => [
        link.getAttribute("hreflang"),
        link.getAttribute("href"),
      ]),
    ),
  );
}

test.describe("every page exists in both languages", () => {
  for (const { en, fr } of PAGES) {
    test(`${en} and ${fr} are served, each in its own language`, async ({ page }) => {
      for (const [path, lang] of [
        [en, "en-CA"],
        [fr, "fr-CA"],
      ] as const) {
        const response = await page.goto(path);
        // The 404 pages are real objects; the edge only 404s on unknown URLs.
        expect(response?.status(), `${path} status`).toBe(200);
        expect(await attribute(page, "html", "lang"), `${path} lang`).toBe(lang);
        await expect(page.locator("#main-content")).toBeVisible();
      }
    });
  }
});

test.describe("canonical and hreflang", () => {
  for (const { en, fr } of PAGES) {
    test(`${en} advertises the full, reciprocal cluster`, async ({ page }) => {
      for (const path of [en, fr] as const) {
        await page.goto(path);
        expect(await attribute(page, 'link[rel="canonical"]', "href")).toBe(`${ORIGIN}${path}`);
        expect(await attribute(page, 'meta[property="og:url"]', "content")).toBe(
          `${ORIGIN}${path}`,
        );
        expect(await hreflangs(page)).toEqual({
          "en-CA": `${ORIGIN}${en}`,
          "fr-CA": `${ORIGIN}${fr}`,
          "x-default": `${ORIGIN}${en}`,
        });
      }
    });
  }

  test("declares og:locale per language, with the other as the alternate", async ({ page }) => {
    await page.goto("/pricing");
    expect(await attribute(page, 'meta[property="og:locale"]', "content")).toBe("en_CA");
    expect(await attribute(page, 'meta[property="og:locale:alternate"]', "content")).toBe("fr_CA");

    await page.goto("/fr/pricing");
    expect(await attribute(page, 'meta[property="og:locale"]', "content")).toBe("fr_CA");
    expect(await attribute(page, 'meta[property="og:locale:alternate"]', "content")).toBe("en_CA");
  });
});

test.describe("the language switcher", () => {
  test("walks a visitor from an English page to its French twin and back", async ({ page }) => {
    await page.goto("/features");

    await page.getByRole("link", { name: "View this page in French" }).first().click();
    await expect(page).toHaveURL(/\/fr\/features$/);
    expect(await attribute(page, "html", "lang")).toBe("fr-CA");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Plus de clarté");

    await page.getByRole("link", { name: "Voir cette page en anglais" }).first().click();
    await expect(page).toHaveURL(/\/features$/);
    expect(await attribute(page, "html", "lang")).toBe("en-CA");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("More clarity");
  });

  test("reaches the French home at its canonical, slashed URL", async ({ page }) => {
    await page.goto("/");
    const toFrench = page.getByRole("link", { name: "View this page in French" }).first();
    expect(await toFrench.getAttribute("href")).toBe("/fr/");

    await toFrench.click();
    await expect(page).toHaveURL(/\/fr\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Moins la paperasse");
  });
});

test.describe("French page behaviour", () => {
  test("prices the plans in Canadian French", async ({ page }) => {
    await page.goto("/fr/pricing");

    // Comma decimal, symbol last, non-breaking space before it.
    await expect(page.getByText("19,99\u00A0$", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("/mois").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Commencer l'essai gratuit de 7 jours/ }).first()).toBeVisible();
  });

  test("carries the language into the account app's checkout", async ({ page }) => {
    await page.goto("/fr/pricing");

    const trial = page.getByRole("link", { name: /Commencer l'essai gratuit de 7 jours/ }).first();
    expect(await trial.getAttribute("href")).toBe(
      "https://account.nixusapp.com/fr/billing?plan=advance_trial",
    );
  });

  test("keeps the announcement bar on the French home only", async ({ page }) => {
    // The sentence, not its CTA: the pricing page has its own "Voir le
    // programme" link to the same destination.
    const announcement = page.getByText(/les utilisateurs fondateurs obtiennent un accès anticipé/);

    await page.goto("/fr/");
    await expect(announcement).toBeVisible();

    await page.goto("/fr/pricing");
    await expect(announcement).toHaveCount(0);
  });

  test("shows no English copy on a French page", async ({ page }) => {
    await page.goto("/fr/");
    const text = (await page.locator("body").innerText()).toLowerCase();
    for (const phrase of [
      "skip to main content",
      "minus the admin",
      "free on your computer",
      "download nixus",
    ]) {
      expect(text, `French home shows "${phrase}"`).not.toContain(phrase);
    }
  });
});

test.describe("the edge rule", () => {
  test("answers an unknown French URL with a real 404", async ({ page }) => {
    const response = await page.goto("/fr/does-not-exist");
    expect(response?.status()).toBe(404);
  });

  test("answers an unknown English URL with a real 404", async ({ page }) => {
    const response = await page.goto("/does-not-exist");
    expect(response?.status()).toBe(404);
  });
});
