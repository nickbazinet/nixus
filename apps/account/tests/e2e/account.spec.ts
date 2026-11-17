import { expect, test, type Page } from "@playwright/test";

import { EMAIL, startHarness, type Harness } from "./support/harness";

/**
 * The account app's user-visible flows, driven in a real browser against the
 * packaged server: sign in, edit and save, upload an avatar, switch to French,
 * sign out.
 *
 * The security refusals have their own vitest gates; what can only be proved here
 * is that the derivative the BROWSER produces really is ≤256 px and ≤64 KiB, and
 * that the whole round trip works through the real `srvx` entry wrapper.
 */

let harness: Harness;

test.beforeEach(async () => {
  harness = await startHarness();
});

test.afterEach(async () => {
  await harness.stop();
});

async function signIn(page: Page): Promise<void> {
  await page.goto(`${harness.origin}/`);
  await page.getByTestId("sign-in").click();
  await page.waitForURL(`${harness.origin}/profile`);
}

/** A deliberately large, noisy PNG: a 16×16 solid square would fit without work. */
async function pickNoisyImage(page: Page, sizePx: number): Promise<void> {
  const dataUrl = await page.evaluate((size: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d context");
    const pixels = context.createImageData(size, size);
    for (let index = 0; index < pixels.data.length; index += 4) {
      pixels.data[index] = (index * 7) % 256;
      pixels.data[index + 1] = (index * 13) % 256;
      pixels.data[index + 2] = (index * 29) % 256;
      pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/png");
  }, sizePx);

  const base64 = dataUrl.split(",")[1] ?? "";
  await page.getByTestId("avatar-input").setInputFiles({
    name: "a-name-that-must-never-be-sent.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
}

test("signs in, shows the verified email and the storage notice", async ({ page }) => {
  await signIn(page);

  await expect(page.getByTestId("profile-email")).toContainText(EMAIL);
  await expect(page.getByTestId("cloud-notice")).toContainText("Nixus Cloud account");
  await expect(page.getByTestId("profile-form")).toBeVisible();

  // The browser was never given a token, and the cookie it did get is opaque.
  const cookies = await page.context().cookies();
  const session = cookies.find((cookie) => cookie.name === "__Host-nixus_session");
  expect(session).toBeDefined();
  expect(session?.httpOnly).toBe(true);
  expect(session?.secure).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  expect(harness.api.tokens.length).toBeGreaterThan(0);
  expect(cookies.map((cookie) => cookie.value).join(" ")).not.toContain("access-code-1");
});

test("saves the profile, including a country-dependent subdivision", async ({ page }) => {
  await signIn(page);

  await page.getByLabel("First name").fill("Alex");
  await page.getByLabel("Last name").fill("Tremblay");
  await page.getByLabel("Date of birth").fill("1990-04-02");
  await page.getByLabel("Income range").selectOption("100k_149k");
  await page.getByLabel("Currency").selectOption("CAD");
  await page.getByLabel("Country").selectOption("CA");
  await expect(page.getByLabel("State, province or region")).toBeEnabled();
  await page.getByLabel("State, province or region").selectOption("CA-QC");

  await page.getByTestId("profile-save").click();
  await expect(page.getByTestId("profile-status")).toContainText("Profile saved.");

  expect(harness.api.profile).toMatchObject({
    first_name: "Alex",
    last_name: "Tremblay",
    birth_date: "1990-04-02",
    income_bracket: "100k_149k",
    income_bracket_currency: "CAD",
    country_code: "CA",
    subdivision_code: "CA-QC",
    version: 1,
  });
});

test("reloads and explains a version conflict without blaming another actor", async ({ page }) => {
  await signIn(page);
  harness.api.conflictNext = true;

  await page.getByLabel("First name").fill("Alex");
  await page.getByTestId("profile-save").click();

  const status = page.getByTestId("profile-status");
  await expect(status).toContainText("reloaded");
  await expect(status).not.toContainText("someone");
});

test("uploads a 256px, 64KiB-bounded derivative the browser produced", async ({ page }) => {
  await signIn(page);

  await pickNoisyImage(page, 1024);
  await expect(page.getByTestId("profile-status")).toContainText("Picture saved.");

  const stored = harness.api.avatar;
  expect(stored).not.toBeNull();
  const bytes = Buffer.from(stored?.data ?? "", "base64");
  expect(bytes.byteLength).toBeLessThanOrEqual(64 * 1024);
  expect(["image/png", "image/jpeg"]).toContain(stored?.mime_type);

  // No filename, anywhere.
  expect(JSON.stringify(stored)).not.toContain("a-name-that-must-never-be-sent");

  const longestEdge = await page.evaluate(
    (dataUrl: string) =>
      new Promise<number>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(Math.max(image.naturalWidth, image.naturalHeight));
        image.onerror = () => reject(new Error("unreadable derivative"));
        image.src = dataUrl;
      }),
    `data:${stored?.mime_type};base64,${stored?.data}`,
  );
  expect(longestEdge).toBeLessThanOrEqual(256);
});

test("serves the French route and keeps the brand term untranslated", async ({ page }) => {
  await page.goto(`${harness.origin}/fr`);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByTestId("sign-in")).toHaveText("Se connecter");

  await page.getByTestId("sign-in").click();
  await page.waitForURL(`${harness.origin}/fr/profile`);

  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByTestId("cloud-notice")).toContainText("Nixus Cloud");
  await expect(page.getByTestId("cloud-notice")).not.toContainText("Nuage");
  await expect(page.getByLabel("Prénom")).toBeVisible();
});

test("signs out, revoking only this session and leaving the row gone", async ({ page }) => {
  await signIn(page);
  const before = harness.dynamo.items.size;
  expect(before).toBeGreaterThan(0);

  await page.getByTestId("sign-out").click();
  await page.waitForURL(`${harness.origin}/`);

  await expect(page.getByTestId("sign-in")).toBeVisible();
  expect(harness.idp.revoked).toEqual(["refresh-code-1"]);
  expect(harness.dynamo.items.size).toBe(0);

  // The cookie is gone, so going back to /profile shows the sign-in panel.
  await page.goto(`${harness.origin}/profile`);
  await expect(page.getByTestId("sign-in")).toBeVisible();
});

test("refuses a cross-origin mutation with 403 and no body", async ({ page }) => {
  await signIn(page);

  // `page.request` shares the browser context's cookie jar, so this presents the
  // real session cookie with a foreign Origin — which is exactly the shape of the
  // cross-site form POST the check exists for. A page script cannot set `Origin`.
  const refusal = await page.request.post(`${harness.origin}/auth/signout`, {
    headers: { origin: "https://evil.example" },
    maxRedirects: 0,
    failOnStatusCode: false,
  });

  expect(refusal.status()).toBe(403);
  expect(await refusal.text()).toBe("");
  expect(harness.dynamo.items.size).toBeGreaterThan(0);
});

test("refuses a mutation with no Origin header at all", async ({ page }) => {
  await signIn(page);

  const refusal = await page.request.post(`${harness.origin}/auth/signout`, {
    maxRedirects: 0,
    failOnStatusCode: false,
  });

  expect(refusal.status()).toBe(403);
  expect(harness.dynamo.items.size).toBeGreaterThan(0);
});
