import { expect, test, type Page, type Request } from "@playwright/test";

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
  // `/` is a redirect now, so the whole flow is one navigation plus the stub
  // provider's own sign-in: entry -> `/auth/login` -> Managed Login ->
  // `/auth/callback` -> `/profile`. There is no landing page to press past.
  await page.goto(`${harness.origin}/`);
  await page.getByTestId("stub-idp-sign-in").click();
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

test("signs in and shows the verified email, with no storage notice", async ({ page }) => {
  await signIn(page);

  await expect(page.getByTestId("profile-email")).toContainText(EMAIL);
  await expect(page.getByTestId("cloud-notice")).toHaveCount(0);
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
  await expect(page.getByLabel("Province, state or region")).toBeEnabled();
  await page.getByLabel("Province, state or region").selectOption("CA-QC");

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
  await page.getByTestId("stub-idp-sign-in").click();
  await page.waitForURL(`${harness.origin}/fr/profile`);

  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page.getByLabel("Prénom")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Nuage");
});

/*
 * The entry gate (AD-10). There is no signed-out landing page any more, so `/`
 * and `/fr` have exactly two answers each, and the third state — a cookie whose
 * session has expired — has to resolve to the same answer as having no cookie
 * at all rather than to a profile page in an error state.
 *
 * Asserted on the response, with redirects unfollowed: a test that only checked
 * where the browser ended up would pass just as well on a client-side bounce,
 * which is the thing AD-10 forbids.
 */
test.describe("the entry redirects", () => {
  /**
   * The status and `Location` the SERVER answered `path` with.
   *
   * Read off the navigation's own redirect chain rather than through
   * `page.request`, for two reasons. The session cookie is `__Host-` and
   * therefore `Secure`, which Playwright's request fixture declines to send
   * over the harness's plain-http origin — so every such probe would look
   * signed out and the signed-in arm could never fail. And reading the response
   * headers is what proves the redirect was issued server-side: a client-side
   * bounce would leave a 200 here, which is the thing AD-10 forbids.
   */
  async function firstHop(page: Page, path: string): Promise<[number, string | null]> {
    const response = await page.goto(`${harness.origin}${path}`);
    const hops: Request[] = [];
    let request: Request | null = response?.request() ?? null;
    while (request !== null) {
      hops.unshift(request);
      request = request.redirectedFrom();
    }
    const served = hops[0] ? await hops[0].response() : null;
    return [served?.status() ?? 0, served?.headers()["location"] ?? null];
  }

  test("sends a signed-out visitor from / and /fr straight to sign-in", async ({ page }) => {
    expect(await firstHop(page, "/")).toEqual([302, "/auth/login?next=profile&lang=en"]);
    expect(await firstHop(page, "/fr")).toEqual([302, "/auth/login?next=profile-fr&lang=fr"]);
    expect(await firstHop(page, "/fr/")).toEqual([302, "/auth/login?next=profile-fr&lang=fr"]);

    // Followed to the end, that is the provider's sign-in page — not a page of
    // this app's own asking the visitor to press a button to get there.
    await expect(page.getByTestId("stub-idp-sign-in")).toBeVisible();
  });

  test("sends a signed-out visitor from /profile to sign-in, not to a panel", async ({
    page,
  }) => {
    // 307 rather than 302: this arm is a loader redirect, which preserves the
    // method. Same Location, from the same allow-list.
    expect(await firstHop(page, "/profile")).toEqual([
      307,
      "/auth/login?next=profile&lang=en",
    ]);
    expect(await firstHop(page, "/fr/profile")).toEqual([
      307,
      "/auth/login?next=profile-fr&lang=fr",
    ]);
    await expect(page.getByTestId("profile-form")).toHaveCount(0);
  });

  test("sends a signed-in visitor from / and /fr to their own profile", async ({ page }) => {
    await signIn(page);

    expect(await firstHop(page, "/")).toEqual([302, "/profile"]);
    expect(await firstHop(page, "/fr")).toEqual([302, "/fr/profile"]);
    expect(await firstHop(page, "/fr/")).toEqual([302, "/fr/profile"]);
    await expect(page.getByTestId("profile-form")).toBeVisible();
  });

  test("treats an expired session exactly like no session", async ({ page }) => {
    await signIn(page);
    const [expired] = harness.dynamo.sessionIds();
    expect(expired).toBeDefined();

    // Re-expired before every probe. Following a login redirect to the end
    // reaches a provider that still has its own session, so it silently grants
    // a fresh one — which is correct behaviour, and means one expiry only buys
    // one observation.
    for (const [path, status, location] of [
      ["/", 302, "/auth/login?next=profile&lang=en"],
      ["/fr", 302, "/auth/login?next=profile-fr&lang=fr"],
      ["/fr/", 302, "/auth/login?next=profile-fr&lang=fr"],
      ["/profile", 307, "/auth/login?next=profile&lang=en"],
      ["/fr/profile", 307, "/auth/login?next=profile-fr&lang=fr"],
    ] as const) {
      harness.dynamo.expireSessions();
      expect(await firstHop(page, path), path).toEqual([status, location]);
    }

    // The row the expired cookie pointed at is gone, not merely ignored.
    expect(harness.dynamo.sessionIds()).not.toContain(expired);
  });

  test("never renders the retired landing copy on any entry path", async ({ page }) => {
    await signIn(page);

    for (const path of ["/", "/fr", "/fr/", "/profile", "/fr/profile"]) {
      await page.goto(`${harness.origin}${path}`);
      const body = await page.content();
      expect(body, path).not.toContain("Your Nixus Cloud account");
      expect(body, path).not.toContain("Votre compte Nixus Cloud");
    }
  });
});


test("signs out, revoking only this session and leaving the row gone", async ({ page }) => {
  await signIn(page);
  expect(harness.dynamo.sessionCount()).toBe(1);

  await page.getByTestId("sign-out").click();

  // Managed Login returns the browser to `/`, which now bounces to sign-in
  // rather than to a landing page — so the provider's own sign-in page is where
  // a signed-out visitor lands, which is the intended end of the flow.
  await expect(page.getByTestId("stub-idp-sign-in")).toBeVisible();
  expect(harness.idp.revoked).toEqual(["refresh-code-1"]);
  expect(harness.dynamo.sessionCount()).toBe(0);

  // The cookie is gone, so /profile cannot be reached by typing it either.
  await page.goto(`${harness.origin}/profile`);
  await expect(page.getByTestId("stub-idp-sign-in")).toBeVisible();
  await expect(page.getByTestId("profile-form")).toHaveCount(0);
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
  expect(harness.dynamo.sessionCount()).toBe(1);
});

test("refuses a mutation with no Origin header at all", async ({ page }) => {
  await signIn(page);

  const refusal = await page.request.post(`${harness.origin}/auth/signout`, {
    maxRedirects: 0,
    failOnStatusCode: false,
  });

  expect(refusal.status()).toBe(403);
  expect(harness.dynamo.sessionCount()).toBe(1);
});

/*
 * The shell. These are the owner's complaints turned into assertions: the page
 * used to have no header, no logo and no footer, no way back to the brand other
 * than a bare text link, and no dark mode at all.
 */
test.describe("the site chrome", () => {
  test("carries the marketing header and footer, locale-aware", async ({ page }) => {
    await signIn(page);

    await expect(page.getByTestId("brand-home").first()).toHaveAttribute(
      "href",
      "https://nixusapp.com/",
    );
    await expect(page.getByRole("link", { name: "Pricing" })).toHaveAttribute(
      "href",
      "https://nixusapp.com/pricing",
    );
    await expect(page.getByTestId("footer-terms")).toHaveAttribute(
      "href",
      "https://nixusapp.com/terms",
    );
    await expect(page.getByTestId("footer-privacy")).toHaveAttribute(
      "href",
      "https://nixusapp.com/privacy",
    );

    await page.goto(`${harness.origin}/fr/profile`);
    await expect(page.getByTestId("brand-home").first()).toHaveAttribute(
      "href",
      "https://nixusapp.com/fr/",
    );
    await expect(page.getByTestId("footer-terms")).toHaveAttribute(
      "href",
      "https://nixusapp.com/fr/terms",
    );
    await expect(page.getByTestId("footer-privacy")).toHaveAttribute(
      "href",
      "https://nixusapp.com/fr/privacy",
    );

    await expect(page.getByText("Retour à nixusapp.com")).toHaveCount(0);
  });

  test("paints the marketing site's own surface and type", async ({ page }) => {
    await signIn(page);

    const shell = await page.evaluate(() => {
      const heading = document.querySelector("h1");
      return {
        background: getComputedStyle(document.body).backgroundColor,
        body: getComputedStyle(document.body).fontFamily,
        heading: heading === null ? "" : getComputedStyle(heading).fontFamily,
      };
    });

    // The account page's own `--bg`, and the two faces nixusapp.com serves.
    // Pinned because a token drift is invisible in a diff.
    expect(shell.background).toBe("rgb(248, 251, 255)");
    expect(shell.body).toContain("Nunito");
    expect(shell.heading).toContain("Poppins");
  });

  test("switches sections from the menu, one card at a time", async ({ page }) => {
    await signIn(page);

    await expect(page.getByTestId("account-nav-personal")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("profile-form")).toBeVisible();
    await expect(page.getByTestId("section-subscription")).toBeHidden();

    await page.getByTestId("account-nav-subscription").click();
    await expect(page).toHaveURL(`${harness.origin}/profile#subscription`);
    await expect(page.getByTestId("billing-tier")).toBeVisible();
    await expect(page.getByTestId("profile-form")).toBeHidden();

    for (const section of ["payment", "invoices", "signin"] as const) {
      await page.getByTestId(`account-nav-${section}`).click();
      await expect(page.getByTestId(`section-${section}`)).toBeVisible();
      await expect(page.getByTestId(`account-nav-${section}`)).toHaveAttribute(
        "aria-current",
        "page",
      );
    }

    // The menu is history: back walks the sections, and a reload keeps one.
    await page.goBack();
    await expect(page.getByTestId("section-invoices")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("section-invoices")).toBeVisible();
  });

  test("keeps an unsaved draft across a trip to another section", async ({ page }) => {
    await signIn(page);

    await page.getByLabel("First name").fill("Draft");
    await page.getByTestId("account-nav-signin").click();
    await expect(page.getByTestId("signin-email")).toContainText(EMAIL);
    await page.getByTestId("account-nav-personal").click();
    await expect(page.getByLabel("First name")).toHaveValue("Draft");

    await page.getByTestId("profile-cancel").click();
    await expect(page.getByLabel("First name")).toHaveValue("");
  });

  test("fits every supported width with no horizontal overflow", async ({ page }) => {
    await signIn(page);

    for (const width of [320, 375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["/profile", "/fr/profile"]) {
        await page.goto(`${harness.origin}${path}`);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(0);
      }
    }
  });
});

